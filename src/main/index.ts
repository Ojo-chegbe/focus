import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, shell, Tray } from "electron";
import { execFile } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import type { AppState, UsageSummary } from "../shared/models";
import { channels, type SelectedAppExecutable } from "../shared/ipc";
import { getActiveRules } from "../shared/rules";
import { BlockPageServer } from "./blockPageServer";
import { HostsBlocker } from "./hostsBlocker";
import { FocusStore } from "./store";
import { WindowsMonitor } from "./windowsMonitor";
import { getAppIcon, getAppIconDataUrl, getAppIconPath } from "./appIcon";
import { initAutoUpdater, getUpdateStatus, checkForUpdates, quitAndInstallUpdate } from "./autoUpdater";

let mainWindow: BrowserWindow | undefined;
let focusModeWindow: BrowserWindow | undefined;
let tray: Tray | undefined;
let store: FocusStore;
let hostsBlocker: HostsBlocker;
let blockPageServer: BlockPageServer;
let monitor: WindowsMonitor;
let rulesRefreshTimer: NodeJS.Timeout | undefined;
let isQuitting = false;

const isDev = !app.isPackaged;

app.setAppUserModelId("com.focus.desktop");

if (isDev) {
  app.setPath("userData", `${app.getPath("userData")}-dev`);
}

const execFileAsync = promisify(execFile);
const launchTaskName = "FocusDesktop";
const shouldQuitEarly = isDev ? false : !app.requestSingleInstanceLock();

if (shouldQuitEarly) {
  app.quit();
}

function createWindow(): void {
  const iconPath = getAppIconPath();
  const appIcon = getAppIcon();
  mainWindow = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 980,
    minHeight: 680,
    title: "Focus",
    icon: iconPath || (!appIcon.isEmpty() ? appIcon : undefined),
    backgroundColor: "#f8fafc",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  if (iconPath) {
    mainWindow.setIcon(iconPath);
  }

  const isUninstall = process.argv.includes("--uninstall-challenge");

  if (isDev) {
    void mainWindow.loadURL(`http://127.0.0.1:5173${isUninstall ? "?uninstall=true" : ""}`);
  } else {
    void mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"), {
      search: isUninstall ? "uninstall=true" : undefined
    });
  }

  mainWindow.on("close", (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });
}

function showMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
  }
  if (mainWindow?.isMinimized()) mainWindow.restore();
  mainWindow?.show();
  mainWindow?.focus();
}

function createTray(): void {
  const icon = getAppIcon();
  const trayIcon = !icon.isEmpty() ? icon.resize({ width: 16, height: 16 }) : nativeImage.createEmpty();
  tray = new Tray(trayIcon);
  tray.setToolTip("Focus");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Open Focus", click: () => showMainWindow() },
      { label: "Apply Rules", click: () => void applyRulesAndRecord() },
      { type: "separator" },
      {
        label: "Quit",
        click: () => {
          isQuitting = true;
          app.quit();
        }
      }
    ])
  );
}

function registerIpc(): void {
  ipcMain.handle(channels.getState, () => store.getState());
  ipcMain.handle(channels.saveProfile, async (_, profile) => saveAndApply(() => store.saveProfile(profile)));
  ipcMain.handle(channels.deleteProfile, async (_, profileId) => saveAndApply(() => store.deleteProfile(profileId)));
  ipcMain.handle(channels.selectAppExecutable, () => selectAppExecutable());
  ipcMain.handle(channels.selectWallpaperImage, () => selectWallpaperImage());
  ipcMain.handle(channels.listRunningApps, () => listRunningApps());
  ipcMain.handle(channels.saveBlockedApp, async (_, blockedApp) => saveAndApply(() => store.saveBlockedApp(blockedApp)));
  ipcMain.handle(channels.deleteBlockedApp, async (_, id) => saveAndApply(() => store.deleteBlockedApp(id)));
  ipcMain.handle(channels.saveAllowedApp, async (_, allowedApp) => saveAndApply(() => store.saveAllowedApp(allowedApp)));
  ipcMain.handle(channels.deleteAllowedApp, async (_, id) => saveAndApply(() => store.deleteAllowedApp(id)));
  ipcMain.handle(channels.saveBlockedSite, async (_, blockedSite) => saveAndApply(() => store.saveBlockedSite(blockedSite)));
  ipcMain.handle(channels.deleteBlockedSite, async (_, id) => saveAndApply(() => store.deleteBlockedSite(id)));
  ipcMain.handle(channels.saveSchedule, async (_, schedule) => saveAndApply(() => store.saveSchedule(schedule)));
  ipcMain.handle(channels.deleteSchedule, async (_, id) => saveAndApply(() => store.deleteSchedule(id)));
  ipcMain.handle(channels.startFocusSession, async (_, profileId, minutes) =>
    saveAndApply(() => store.startFocusSession(profileId, minutes))
  );
  ipcMain.handle(channels.saveFocusSessionPreset, async (_, preset) => saveAndApply(() => store.saveFocusSessionPreset(preset)));
  ipcMain.handle(channels.deleteFocusSessionPreset, async (_, id) => saveAndApply(() => store.deleteFocusSessionPreset(id)));
  ipcMain.handle(channels.endFocusSession, async (_, id) => saveAndApply(() => store.endFocusSession(id)));
  ipcMain.handle(channels.pauseFocusSession, async (_, id) => saveAndApply(() => store.pauseFocusSession(id)));
  ipcMain.handle(channels.resumeFocusSession, async (_, id) => saveAndApply(() => store.resumeFocusSession(id)));
  ipcMain.handle(channels.saveProfileCondition, async (_, condition) => saveAndApply(() => store.saveProfileCondition(condition)));
  ipcMain.handle(channels.deleteProfileCondition, async (_, id) => saveAndApply(() => store.deleteProfileCondition(id)));
  ipcMain.handle(channels.lockProfile, async (_, profileId, minutes) => saveAndApply(() => store.lockProfile(profileId, minutes)));
  ipcMain.handle(channels.takeBreak, async (_, profileId) => saveAndApply(() => store.takeBreak(profileId)));
  ipcMain.handle(channels.applyRules, () => applyRulesAndRecord());
  ipcMain.handle(channels.getHelperStatus, () => hostsBlocker.getStatus(getActiveRules(store.getState())));
  ipcMain.handle(channels.getUsageSummary, () => getUsageSummary(store.getState()));
  ipcMain.handle(channels.getTimeline, () => store.getState().usageEvents);
  ipcMain.handle(channels.exportData, () => store.exportData());
  ipcMain.handle(channels.deleteAllData, async () => saveAndApply(() => store.deleteAllData()));
  ipcMain.handle(channels.saveSettings, async (_, settings) => {
    const nextState = store.saveSettings(settings);
    await configureLaunchAtLogin(nextState.settings.launchAtLogin);
    restartRuntimeServices(nextState);
    await applyRulesAndRecord();
    return nextState;
  });
  ipcMain.handle(channels.openHostsFile, () => shell.openPath(hostsBlocker.hostsPath));
  ipcMain.handle(channels.relaunchAsAdmin, () => relaunchAsAdmin());
  ipcMain.handle(channels.refreshFirefox, async () => {
    await closeFirefox();
    return applyRulesAndRecord();
  });
  ipcMain.handle(channels.resumeUninstall, async () => {
    const fs = require("node:fs");
    const programData = process.env.ALLUSERSPROFILE || process.env.ProgramData || "C:\\ProgramData";
    const flagPaths = [
      path.join(programData, "Focus", "uninstall-allowed.flag"),
      path.join(programData, "focus-desktop", "uninstall-allowed.flag"),
      path.join(app.getPath("userData"), "uninstall-allowed.flag"),
      path.join(app.getPath("appData"), "Focus", "uninstall-allowed.flag"),
      path.join(app.getPath("appData"), "focus-desktop", "uninstall-allowed.flag")
    ];
    for (const p of flagPaths) {
      try {
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, "1", "utf-8");
      } catch {
        // Continue
      }
    }

    const exeDir = path.dirname(process.execPath);
    const uninstaller = path.join(exeDir, "Uninstall Focus.exe");
    if (fs.existsSync(uninstaller)) {
      try {
        const { spawn } = require("node:child_process");
        const child = spawn(uninstaller, [], { detached: true, stdio: "ignore" });
        child.unref();
      } catch {
        shell.openPath(uninstaller);
      }
    }
    isQuitting = true;
    setTimeout(() => {
      app.quit();
    }, 500);
  });
  ipcMain.handle(channels.getUpdateStatus, () => getUpdateStatus());
  ipcMain.handle(channels.checkForUpdates, () => checkForUpdates());
  ipcMain.handle(channels.quitAndInstallUpdate, () => quitAndInstallUpdate());
}

async function selectAppExecutable() {
  const options: Electron.OpenDialogOptions = {
    title: "Choose app to block",
    properties: ["openFile"],
    filters: process.platform === "win32" ? [{ name: "Applications", extensions: ["exe"] }] : undefined
  };
  const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);

  if (result.canceled || !result.filePaths[0]) return undefined;
  const selectedPath = result.filePaths[0];
  const executable = path.basename(selectedPath).toLowerCase();
  return {
    displayName: path.basename(executable, path.extname(executable)),
    executable,
    path: selectedPath
  };
}

async function selectWallpaperImage() {
  const options: Electron.OpenDialogOptions = {
    title: "Choose wallpaper image",
    properties: ["openFile"],
    filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "bmp"] }]
  };
  const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
  if (result.canceled || !result.filePaths[0]) return undefined;
  return result.filePaths[0];
}

async function listRunningApps(): Promise<SelectedAppExecutable[]> {
  if (process.platform !== "win32") return [];
  const script = `
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class FocusWindowEnum {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
"@
$items = New-Object System.Collections.Generic.List[object]
$callback = [FocusWindowEnum+EnumWindowsProc]{
  param([IntPtr]$hWnd, [IntPtr]$lParam)
  if ([FocusWindowEnum]::IsWindowVisible($hWnd)) {
    $builder = New-Object System.Text.StringBuilder 512
    [void][FocusWindowEnum]::GetWindowText($hWnd, $builder, $builder.Capacity)
    $title = $builder.ToString().Trim()
    if ($title.Length -gt 0) {
      $processId = 0
      [void][FocusWindowEnum]::GetWindowThreadProcessId($hWnd, [ref]$processId)
      if ($processId -gt 0) {
        try {
          $process = Get-Process -Id $processId -ErrorAction Stop
          $processPath = ""
          try { $processPath = $process.Path } catch {}
          if (-not $processPath) {
            try { $processPath = $process.MainModule.FileName } catch {}
          }
          $items.Add([PSCustomObject]@{
            displayName = $process.ProcessName
            executable = "$($process.ProcessName).exe"
            title = $title
            path = $processPath
          })
        } catch {}
      }
    }
  }
  return $true
}
[void][FocusWindowEnum]::EnumWindows($callback, [IntPtr]::Zero)
if ($items.Count -eq 0) {
  Get-Process | ForEach-Object {
    try {
      $processPath = ""
      try { $processPath = $_.Path } catch {}
      if (-not $processPath) {
        try { $processPath = $_.MainModule.FileName } catch {}
      }
      if ($processPath -and $processPath -notlike "$env:windir\\*") {
        $items.Add([PSCustomObject]@{
          displayName = $_.ProcessName
          executable = "$($_.ProcessName).exe"
          title = "Running process"
          path = $processPath
        })
      }
    } catch {}
  }
}
$items | Sort-Object displayName, path -Unique | ConvertTo-Json -Compress
`;

  const { stdout } = await execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
    { windowsHide: true, timeout: 5000 }
  );
  const output = stdout.trim();
  if (!output) return [];
  const parsed = JSON.parse(output) as SelectedAppExecutable | SelectedAppExecutable[];
  return (Array.isArray(parsed) ? parsed : [parsed]).filter((app) => app.executable);
}

async function saveAndApply(mutator: () => AppState): Promise<AppState> {
  const nextState = mutator();
  await applyRulesAndRecord();
  return nextState;
}

async function applyRulesAndRecord() {
  const activeRules = getActiveRules(store.getState());
  syncFocusModeWindow(activeRules);
  try {
    await hostsBlocker.apply(activeRules);
    store.addUsageEvent({
      type: "rules-applied",
      target: activeRules.activeProfileNames.join(", ") || "No active profiles",
      detail: `${activeRules.sites.length} sites, ${activeRules.apps.length} apps`
    });
  } catch (error) {
    store.addUsageEvent({
      type: "rules-applied",
      target: "Failed to apply rules",
      detail: error instanceof Error ? error.message : String(error)
    });
  }
  return hostsBlocker.getStatus(activeRules);
}

function syncFocusModeWindow(activeRules: ReturnType<typeof getActiveRules>): void {
  const session = activeRules.activeFocusSession;
  if (!session || !session.active) {
    if (focusModeWindow && !focusModeWindow.isDestroyed()) focusModeWindow.close();
    focusModeWindow = undefined;
    return;
  }
  const sessionEndsAt = new Date(session.endsAt).getTime();
  if (!Number.isFinite(sessionEndsAt) || sessionEndsAt <= Date.now()) {
    if (focusModeWindow && !focusModeWindow.isDestroyed()) focusModeWindow.close();
    focusModeWindow = undefined;
    return;
  }
  const title = "Focus Mode";
  const allowedApps = (session.allowedApps ?? []).filter((app) => app.enabled);
  const wallpaper =
    session.wallpaperType === "solid"
      ? (session.wallpaperValue || "#0f1724")
      : session.wallpaperType === "custom" && session.wallpaperValue
        ? `url('${escapeHtml(pathToFileURL(session.wallpaperValue).toString())}') center / cover no-repeat fixed`
        : "linear-gradient(135deg, #0f1724 0%, #111827 60%, #1f2937 100%)";
  const endsAtLabel = new Date(session.endsAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const isPaused = Boolean(session.paused);
  const canPause = !session.strict && session.showPauseButton !== false;
  const canEnd = !session.strict;
  const iconDataUrl = getAppIconDataUrl();
  const iconHtml = iconDataUrl ? `<img src="${iconDataUrl}" width="60" height="60" style="border-radius:14px;margin-bottom:12px;display:inline-block;" alt="Focus" />` : "";
  const html = `<!doctype html>
<html><head><meta charset="utf-8" />
<title>${title}</title>
<style>
body{margin:0;font-family:Segoe UI,sans-serif;background:${wallpaper};color:#f9fafb;height:100vh;display:grid;place-items:center}
main{width:min(980px,94vw);text-align:center}
h1{font-size:48px;margin:0 0 8px} p{color:#d1d5db} .grid{margin-top:22px;display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px}
.chip{padding:12px;border-radius:10px;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.18);display:grid;gap:5px}
.chip button{height:34px;border:0;border-radius:8px;background:#f8fafc;color:#111827;font-weight:700;cursor:pointer}
.actions{display:flex;gap:10px;justify-content:center;margin-top:14px}
.actions button{height:38px;padding:0 14px;border:0;border-radius:8px;background:#f8fafc;color:#111827;font-weight:700;cursor:pointer}
</style></head><body><main>${iconHtml}<h1>Focus Session Active</h1><p>Session ends at ${endsAtLabel}</p><div class="grid">${
    allowedApps.length > 0
      ? allowedApps
          .map(
            (app) =>
              `<div class="chip"><strong>${escapeHtml(app.displayName || app.executable)}</strong><small>${escapeHtml(
                app.executable
              )}</small>${app.path ? `<button onclick="location.href='https://focus.local/launch/${encodeURIComponent(app.path)}'">Open</button>` : ""}</div>`
          )
          .join("")
      : "<div class=\"chip\">No allowed apps configured</div>"
  }</div><div class="actions">${
    canPause ? `<button onclick="location.href='https://focus.local/action/${isPaused ? "resume" : "pause"}/${session.id}'">${isPaused ? "Resume" : "Pause"}</button>` : ""
  }${canEnd ? `<button onclick="location.href='https://focus.local/action/end/${session.id}'">End Session</button>` : ""}</div></main></body></html>`;
  if (!focusModeWindow || focusModeWindow.isDestroyed()) {
    const appIcon = getAppIcon();
    focusModeWindow = new BrowserWindow({
      fullscreen: true,
      frame: false,
      alwaysOnTop: true,
      title: "Focus Mode",
      icon: !appIcon.isEmpty() ? appIcon : undefined,
      webPreferences: { sandbox: true }
    });
    focusModeWindow.webContents.on("will-navigate", (event, url) => {
      if (url.startsWith("https://focus.local/launch/")) {
        event.preventDefault();
        const encodedPath = url.replace("https://focus.local/launch/", "");
        const appPath = decodeURIComponent(encodedPath);
        void shell.openPath(appPath);
        return;
      }
      if (url.startsWith("https://focus.local/action/")) {
        event.preventDefault();
        const [action, id] = url.replace("https://focus.local/action/", "").split("/");
        if (!id) return;
        if (action === "pause") {
          void saveAndApply(() => store.pauseFocusSession(id));
          return;
        }
        if (action === "resume") {
          void saveAndApply(() => store.resumeFocusSession(id));
          return;
        }
        if (action === "end") {
          void saveAndApply(() => store.endFocusSession(id));
        }
      }
    });
  }
  void focusModeWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
}

function restartRuntimeServices(state: AppState): void {
  monitor?.stop();
  monitor?.start(state.settings.helperPollSeconds);

  blockPageServer?.stop();
  blockPageServer?.start(state.settings.blockPagePort);

  if (rulesRefreshTimer) clearInterval(rulesRefreshTimer);
  rulesRefreshTimer = setInterval(() => void applyRulesAndRecord(), 15_000);
}

async function configureLaunchAtLogin(openAtLogin: boolean): Promise<void> {
  if (process.platform !== "win32") {
    app.setLoginItemSettings({ openAtLogin });
    return;
  }

  if (!app.isPackaged) {
    app.setLoginItemSettings({ openAtLogin });
    return;
  }

  if (!openAtLogin) {
    app.setLoginItemSettings({ openAtLogin: false });
    try {
      await execFileAsync("schtasks.exe", ["/Delete", "/TN", launchTaskName, "/F"], { windowsHide: true });
    } catch {
      // The task may not exist yet.
    }
    return;
  }

  await execFileAsync(
    "schtasks.exe",
    [
      "/Create",
      "/TN",
      launchTaskName,
      "/SC",
      "ONLOGON",
      "/TR",
      `"${process.execPath}"`,
      "/RL",
      "HIGHEST",
      "/F"
    ],
    { windowsHide: true }
  );
}

function getUsageSummary(state: AppState): UsageSummary {
  const now = new Date();
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);

  // Compute stats for last 7 days
  const weeklyFocusStats = Array(7).fill(0);
  const msPerDay = 24 * 60 * 60 * 1000;
  
  for (const event of state.usageEvents) {
    if (event.type === "app-session" || event.type === "site-session") {
      const eventDate = new Date(event.startedAt);
      const daysAgo = Math.floor((startOfToday.getTime() - new Date(eventDate.getFullYear(), eventDate.getMonth(), eventDate.getDate()).getTime()) / msPerDay);
      
      if (daysAgo >= 0 && daysAgo < 7) {
        weeklyFocusStats[6 - daysAgo] += event.durationSeconds ?? 0;
      }
    }
  }

  const todayEvents = state.usageEvents.filter((event) => new Date(event.startedAt) >= startOfToday);
  const appTotals = new Map<string, number>();

  for (const event of todayEvents) {
    if (event.type === "app-session" || event.type === "site-session") {
      appTotals.set(event.target, (appTotals.get(event.target) ?? 0) + (event.durationSeconds ?? 0));
    }
  }

  return {
    totalSecondsToday: weeklyFocusStats[6],
    blockedAttemptsToday: todayEvents.filter((event) => event.type.endsWith("blocked")).length,
    activeProfiles: getActiveRules(state).activeProfileNames,
    topApps: [...appTotals.entries()]
      .map(([name, seconds]) => ({ name, seconds }))
      .sort((a, b) => b.seconds - a.seconds)
      .slice(0, 6),
    weeklyFocusStats
  };
}

async function relaunchAsAdmin(): Promise<void> {
  if (process.platform !== "win32") return;
  const appPath = app.getAppPath();
  const filePath = app.isPackaged ? process.execPath : "cmd.exe";
  const argumentList = app.isPackaged ? "" : `/k cd /d "${appPath}" && npm.cmd run dev`;
  const workingDirectory = app.isPackaged ? path.dirname(process.execPath) : appPath;
  const command = [
    "Start-Process",
    "-FilePath",
    toPowerShellSingleQuotedString(filePath),
    argumentList ? `-ArgumentList ${toPowerShellSingleQuotedString(argumentList)}` : "",
    "-WorkingDirectory",
    toPowerShellSingleQuotedString(workingDirectory),
    "-Verb",
    "RunAs"
  ]
    .filter(Boolean)
    .join(" ");

  await execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command],
    { windowsHide: true }
  );
  isQuitting = true;
  app.quit();
}

async function shouldContinueStartup(): Promise<boolean> {
  if (process.platform !== "win32") return true;
  if (await hostsBlocker.isElevated()) return true;

  try {
    await relaunchAsAdmin();
    return false;
  } catch {
    return true;
  }
}

async function closeFirefox(): Promise<void> {
  if (process.platform !== "win32") return;
  try {
    await execFileAsync("taskkill.exe", ["/IM", "firefox.exe", "/F"], { windowsHide: true });
  } catch {
    // Firefox may not be running; applying rules is still the important part.
  }
}

function toPowerShellSingleQuotedString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

if (!shouldQuitEarly) {
  app.whenReady().then(async () => {
    store = new FocusStore();
    hostsBlocker = new HostsBlocker();
    if (!(await shouldContinueStartup())) return;
    blockPageServer = new BlockPageServer();
    blockPageServer.start(store.getState().settings.blockPagePort);
    monitor = new WindowsMonitor(store, () => getActiveRules(store.getState()));
    monitor.start(store.getState().settings.helperPollSeconds);
    rulesRefreshTimer = setInterval(() => void applyRulesAndRecord(), 15_000);
    registerIpc();
    createWindow();
    createTray();
    initAutoUpdater(() => mainWindow);
    void applyRulesAndRecord();
  });
}

app.on("second-instance", (_event, commandLine) => {
  const isUninstall = commandLine.some((arg) => arg.includes("--uninstall-challenge"));
  if (isUninstall && mainWindow && !mainWindow.isDestroyed()) {
    if (isDev) {
      void mainWindow.loadURL("http://127.0.0.1:5173?uninstall=true");
    } else {
      void mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"), {
        search: "uninstall=true"
      });
    }
  }
  showMainWindow();
});

app.on("activate", () => {
  showMainWindow();
});

app.on("window-all-closed", () => undefined);

app.on("before-quit", () => {
  isQuitting = true;
  if (rulesRefreshTimer) clearInterval(rulesRefreshTimer);
  monitor?.stop();
  blockPageServer?.stop();
  if (focusModeWindow && !focusModeWindow.isDestroyed()) focusModeWindow.close();
});

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    };
    return entities[char] ?? char;
  });
}
