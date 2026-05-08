import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, shell, Tray } from "electron";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import type { AppState, UsageSummary } from "../shared/models";
import { channels } from "../shared/ipc";
import { getActiveRules } from "../shared/rules";
import { BlockPageServer } from "./blockPageServer";
import { HostsBlocker } from "./hostsBlocker";
import { FocusStore } from "./store";
import { WindowsMonitor } from "./windowsMonitor";

let mainWindow: BrowserWindow | undefined;
let tray: Tray | undefined;
let store: FocusStore;
let hostsBlocker: HostsBlocker;
let blockPageServer: BlockPageServer;
let monitor: WindowsMonitor;
let isQuitting = false;

const isDev = !app.isPackaged;
const execFileAsync = promisify(execFile);
const launchTaskName = "FocusDesktop";

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 980,
    minHeight: 680,
    title: "Focus",
    backgroundColor: "#f8fafc",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  if (isDev) {
    void mainWindow.loadURL("http://127.0.0.1:5173");
  } else {
    void mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }

  mainWindow.on("close", (event) => {
    if (store.getState().settings.minimizeToTray && !isQuitting) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });
}

function createTray(): void {
  const icon = nativeImage.createEmpty();
  tray = new Tray(icon);
  tray.setToolTip("Focus");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Open Focus", click: () => mainWindow?.show() },
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
  ipcMain.handle(channels.saveBlockedApp, async (_, blockedApp) => saveAndApply(() => store.saveBlockedApp(blockedApp)));
  ipcMain.handle(channels.deleteBlockedApp, async (_, id) => saveAndApply(() => store.deleteBlockedApp(id)));
  ipcMain.handle(channels.saveBlockedSite, async (_, blockedSite) => saveAndApply(() => store.saveBlockedSite(blockedSite)));
  ipcMain.handle(channels.deleteBlockedSite, async (_, id) => saveAndApply(() => store.deleteBlockedSite(id)));
  ipcMain.handle(channels.saveBlockedKeyword, async (_, keyword) => saveAndApply(() => store.saveBlockedKeyword(keyword)));
  ipcMain.handle(channels.deleteBlockedKeyword, async (_, id) => saveAndApply(() => store.deleteBlockedKeyword(id)));
  ipcMain.handle(channels.saveSchedule, async (_, schedule) => saveAndApply(() => store.saveSchedule(schedule)));
  ipcMain.handle(channels.deleteSchedule, async (_, id) => saveAndApply(() => store.deleteSchedule(id)));
  ipcMain.handle(channels.startFocusSession, async (_, profileId, minutes) =>
    saveAndApply(() => store.startFocusSession(profileId, minutes))
  );
  ipcMain.handle(channels.endFocusSession, async (_, id) => saveAndApply(() => store.endFocusSession(id)));
  ipcMain.handle(channels.lockProfile, async (_, profileId, minutes) => saveAndApply(() => store.lockProfile(profileId, minutes)));
  ipcMain.handle(channels.applyRules, () => applyRulesAndRecord());
  ipcMain.handle(channels.getHelperStatus, () => hostsBlocker.getStatus(getActiveRules(store.getState())));
  ipcMain.handle(channels.getUsageSummary, () => getUsageSummary(store.getState()));
  ipcMain.handle(channels.getTimeline, () => store.getState().usageEvents);
  ipcMain.handle(channels.exportData, () => store.exportData());
  ipcMain.handle(channels.deleteAllData, async () => saveAndApply(() => store.deleteAllData()));
  ipcMain.handle(channels.saveSettings, async (_, settings) => {
    const nextState = store.saveSettings(settings);
    await configureLaunchAtLogin(nextState.settings.launchAtLogin);
    await applyRulesAndRecord();
    return nextState;
  });
  ipcMain.handle(channels.openHostsFile, () => shell.openPath(hostsBlocker.hostsPath));
  ipcMain.handle(channels.relaunchAsAdmin, () => relaunchAsAdmin());
  ipcMain.handle(channels.refreshFirefox, async () => {
    await closeFirefox();
    return applyRulesAndRecord();
  });
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

async function saveAndApply(mutator: () => AppState): Promise<AppState> {
  const nextState = mutator();
  await applyRulesAndRecord();
  return nextState;
}

async function applyRulesAndRecord() {
  const activeRules = getActiveRules(store.getState());
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
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const todayEvents = state.usageEvents.filter((event) => new Date(event.startedAt) >= startOfToday);
  const appTotals = new Map<string, number>();

  for (const event of todayEvents) {
    if (event.type === "app-session") {
      appTotals.set(event.target, (appTotals.get(event.target) ?? 0) + (event.durationSeconds ?? 0));
    }
  }

  return {
    totalSecondsToday: [...appTotals.values()].reduce((sum, seconds) => sum + seconds, 0),
    blockedAttemptsToday: todayEvents.filter((event) => event.type.endsWith("blocked")).length,
    activeProfiles: getActiveRules(state).activeProfileNames,
    topApps: [...appTotals.entries()]
      .map(([name, seconds]) => ({ name, seconds }))
      .sort((a, b) => b.seconds - a.seconds)
      .slice(0, 6)
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

app.whenReady().then(async () => {
  store = new FocusStore();
  hostsBlocker = new HostsBlocker();
  if (!(await shouldContinueStartup())) return;
  blockPageServer = new BlockPageServer();
  blockPageServer.start(store.getState().settings.blockPagePort);
  monitor = new WindowsMonitor(store, () => getActiveRules(store.getState()));
  monitor.start(store.getState().settings.helperPollSeconds);
  registerIpc();
  createWindow();
  createTray();
  void applyRulesAndRecord();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
  else mainWindow?.show();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  isQuitting = true;
  monitor?.stop();
  blockPageServer?.stop();
});
