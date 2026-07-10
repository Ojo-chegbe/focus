import { BrowserWindow } from "electron";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ActiveRules, AllowedApp, BlockedApp } from "../shared/models";
import type { FocusStore } from "./store";

const execFileAsync = promisify(execFile);

const foregroundScript = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32 {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
"@
$handle = [Win32]::GetForegroundWindow()
$foregroundProcessId = 0
[void][Win32]::GetWindowThreadProcessId($handle, [ref]$foregroundProcessId)
if ($foregroundProcessId -gt 0) {
  $p = Get-Process -Id $foregroundProcessId -ErrorAction SilentlyContinue
  if ($p) {
    $processPath = ""
    try { $processPath = $p.Path } catch {}
    if (-not $processPath) {
      try { $processPath = $p.MainModule.FileName } catch {}
    }
    $titleText = ""
    try { $titleText = $p.MainWindowTitle } catch {}
    [PSCustomObject]@{
      processId = $foregroundProcessId
      executable = "$($p.ProcessName).exe"
      title = $titleText
      path = $processPath
    } | ConvertTo-Json -Compress
  }
}
`;

export class WindowsMonitor {
  private timer?: NodeJS.Timeout;
  private lastUsageTarget?: string;
  private lastTargetIsSite = false;
  private lastStartedAt = Date.now();
  private blockedWindow?: BrowserWindow;
  private readonly lastKillByExecutable = new Map<string, number>();
  private lastDetectionError?: string;

  constructor(
    private readonly store: FocusStore,
    private readonly getRules: () => ActiveRules
  ) {}

  start(pollSeconds: number): void {
    if (process.platform !== "win32" || this.timer) return;
    this.timer = setInterval(() => void this.poll(), Math.max(2, pollSeconds) * 1000);
    void this.poll();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  private async poll(): Promise<void> {
    const current = await getForegroundProcess();
    if (!current) return;
    if ("error" in current) {
      if (current.error !== this.lastDetectionError) {
        this.lastDetectionError = current.error;
        this.store.addUsageEvent({
          type: "app-blocked",
          target: "App monitor failed",
          detail: current.error
        });
      }
      return;
    }
    this.lastDetectionError = undefined;
    const executable = current.executable.toLowerCase();
    
    const rules = this.getRules();
    const state = this.store.getState();
    const currentSite = findSiteViolation({ sites: state.blockedSites } as any, current);
    const usageTarget = currentSite ? currentSite.displayName : executable;
    const isSite = Boolean(currentSite);

    if (this.lastUsageTarget && this.lastUsageTarget !== usageTarget) {
      const durationSeconds = Math.round((Date.now() - this.lastStartedAt) / 1000);
      if (durationSeconds > 2) {
        this.store.addUsageEvent({
          type: this.lastTargetIsSite ? "site-session" : "app-session",
          target: this.lastUsageTarget,
          durationSeconds,
          endedAt: new Date().toISOString()
        });
      }
      this.lastStartedAt = Date.now();
    }
    this.lastUsageTarget = usageTarget;
    this.lastTargetIsSite = isSite;

    const hasSessionAllowlist = rules.focusSessionAllowedApps.length > 0;
    const hasAllowlistMode = Object.values(rules.appPoliciesByProfileId).includes("allowlist");
    const blockedAppOrSite = hasSessionAllowlist
      ? findSessionAllowlistViolation(rules, current)
      : hasAllowlistMode
        ? findAllowlistViolation(rules, current)
        : rules.blockedApps.find((app) => matchesAppRule(app, current));

    const blocked = blockedAppOrSite || findSiteViolation(rules, current);

    if (blocked) {
      const isSite = "isSite" in blocked && blocked.isSite;
      this.store.addUsageEvent({
        type: isSite ? "site-blocked" : "app-blocked",
        target: blocked.displayName,
        profileId: blocked.profileId,
        detail: hasAllowlistMode && !isSite
          ? `${current.title || current.executable} is not in the active allowlist.`
          : hasSessionAllowlist && !isSite
          ? `${current.title || current.executable} is not in the active allowlist.`
          : current.title || current.executable
      });
      if (!isSite) {
        await this.closeBlockedProcess(current.processId, current.executable, blocked.displayName);
        this.showBlockedWindow(blocked.displayName);
      } else {
        this.showBlockedWindow(blocked.displayName);
        await new Promise((resolve) => setTimeout(resolve, 1500));
        this.hideBlockedWindow();
        await new Promise((resolve) => setTimeout(resolve, 100));
        await this.closeBrowserTab();
      }
    } else {
      this.hideBlockedWindow();
    }
  }

  private async closeBlockedProcess(processId: number, executable: string, displayName: string): Promise<void> {
    const now = Date.now();
    const killKey = `${executable}:${processId}`;
    const lastKillAt = this.lastKillByExecutable.get(killKey) ?? 0;
    if (now - lastKillAt < 5000) return;
    this.lastKillByExecutable.set(killKey, now);

    try {
      await execFileAsync("taskkill.exe", ["/PID", String(processId), "/F"], { windowsHide: true, timeout: 3000 });
    } catch (error) {
      this.store.addUsageEvent({
        type: "app-blocked",
        target: displayName,
        detail: `Could not close ${executable}: ${error instanceof Error ? error.message : String(error)}`
      });
    }
  }

  private async closeBrowserTab(): Promise<void> {
    const script = `
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.SendKeys]::SendWait("^{w}")
`;
    try {
      await execFileAsync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], { windowsHide: true, timeout: 3000 });
    } catch (error) {
      // Ignore errors sending keys
    }
  }

  private showBlockedWindow(appName: string): void {
    if (this.blockedWindow && !this.blockedWindow.isDestroyed()) return;
    this.blockedWindow = new BrowserWindow({
      fullscreen: true,
      alwaysOnTop: true,
      frame: false,
      title: "Blocked by Focus",
      webPreferences: { sandbox: true }
    });
    this.blockedWindow.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html>
<html>
<head>
  <style>
    body { margin: 0; height: 100vh; display: grid; place-items: center; background: #111827; color: #f9fafb; font-family: Segoe UI, sans-serif; }
    main { text-align: center; max-width: 560px; padding: 32px; }
    h1 { font-size: 42px; margin: 0 0 12px; }
    p { color: #d1d5db; font-size: 18px; line-height: 1.5; }
  </style>
</head>
<body>
  <main>
    <h1>${escapeHtml(appName)} is blocked</h1>
    <p>An active Focus profile is preventing this app from being used right now.</p>
  </main>
</body>
</html>`)}`
    );
  }

  private hideBlockedWindow(): void {
    if (this.blockedWindow && !this.blockedWindow.isDestroyed()) {
      this.blockedWindow.close();
    }
    this.blockedWindow = undefined;
  }
}

function findSessionAllowlistViolation(
  rules: ActiveRules,
  current: { executable: string; title: string; path?: string }
): BlockedApp | undefined {
  if (isProtectedProcess(current)) return undefined;
  if (rules.focusSessionAllowedApps.some((app) => matchesAppRule(app, current))) return undefined;
  return {
    id: "session-allowlist-violation",
    profileId: rules.activeFocusSession?.profileId ?? rules.activeProfileIds[0] ?? "",
    displayName: current.executable,
    executable: current.executable,
    path: current.path,
    enabled: true
  };
}

type ForegroundProcess =
  | { processId: number; executable: string; title: string; path?: string; error?: undefined }
  | { error: string; executable?: undefined; title?: undefined; path?: undefined };

async function getForegroundProcess(): Promise<ForegroundProcess | undefined> {
  try {
    const { stdout } = await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", foregroundScript],
      { windowsHide: true, timeout: 3000 }
    );
    const output = stdout.trim();
    if (!output) return undefined;
    const parsed = JSON.parse(output) as { processId?: number; executable?: string; title?: string; path?: string };
    if (!parsed.executable) return undefined;
    const processId = Number(parsed.processId);
    if (!Number.isFinite(processId) || processId <= 0) return undefined;
    return {
      processId,
      executable: parsed.executable,
      title: parsed.title ?? "",
      path: parsed.path || undefined
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

type AppRule = BlockedApp | AllowedApp;

function findAllowlistViolation(
  rules: ActiveRules,
  current: { executable: string; title: string; path?: string }
): BlockedApp | undefined {
  if (isProtectedProcess(current)) return undefined;
  const activeAllowlistProfileIds = Object.entries(rules.appPoliciesByProfileId)
    .filter(([, policy]) => policy === "allowlist")
    .map(([profileId]) => profileId);
  if (activeAllowlistProfileIds.length === 0) return undefined;
  const hasAllowRules = rules.allowedApps.some((app) => activeAllowlistProfileIds.includes(app.profileId));
  if (!hasAllowRules) return undefined;
  if (rules.allowedApps.some((app) => matchesAppRule(app, current))) return undefined;

  const allowlistProfileId = activeAllowlistProfileIds[0];
  return {
    id: "allowlist-violation",
    profileId: allowlistProfileId ?? rules.activeProfileIds[0] ?? "",
    displayName: current.executable,
    executable: current.executable,
    path: current.path,
    enabled: true
  };
}

export function matchesAppRule(app: AppRule, current: { executable: string; title: string; path?: string }): boolean {
  const executable = current.executable.toLowerCase();
  const currentPath = current.path?.toLowerCase();
  const ruleExecutable = app.executable.toLowerCase();
  const rulePath = app.path?.toLowerCase();
  const displayName = app.displayName.toLowerCase().replace(/\.exe$/i, "").trim();
  const executableStem = executable.replace(/\.exe$/i, "");
  const ruleExecutableStem = ruleExecutable.replace(/\.exe$/i, "");

  const matchesExecutableVariant = (ruleStem: string): boolean =>
    Boolean(ruleStem && (executableStem === ruleStem || executableStem.startsWith(`${ruleStem}.`)));

  return (
    executable === ruleExecutable ||
    Boolean(rulePath && currentPath === rulePath) ||
    matchesExecutableVariant(ruleExecutableStem) ||
    matchesExecutableVariant(displayName)
  );
}

function isProtectedProcess(current: { executable: string; path?: string }): boolean {
  const executable = current.executable.toLowerCase();
  const protectedExecutables = new Set([
    "applicationframehost.exe",
    "cmd.exe",
    "conhost.exe",
    "csrss.exe",
    "ctfmon.exe",
    "dwm.exe",
    "electron.exe",
    "explorer.exe",
    "focus.exe",
    "focusdesktop.exe",
    "lockapp.exe",
    "logonui.exe",
    "powershell.exe",
    "pwsh.exe",
    "runtimebroker.exe",
    "securityhealthsystray.exe",
    "services.exe",
    "sihost.exe",
    "smss.exe",
    "startmenuexperiencehost.exe",
    "svchost.exe",
    "system",
    "systemsettings.exe",
    "taskhostw.exe",
    "taskmgr.exe",
    "userinit.exe",
    "wininit.exe",
    "winlogon.exe",
    "wscript.exe"
  ]);

  if (protectedExecutables.has(executable)) return true;
  const currentExecutable = process.execPath.split(/[\\/]/).pop()?.toLowerCase();
  if (currentExecutable && executable === currentExecutable) return true;
  return Boolean(current.path && process.execPath.toLowerCase() === current.path.toLowerCase());
}

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

function findSiteViolation(
  rules: ActiveRules,
  current: { executable: string; title: string; path?: string }
): (BlockedApp & { isSite: boolean }) | undefined {
  const executable = current.executable.toLowerCase();
  const isBrowser = [
    "chrome.exe",
    "msedge.exe",
    "firefox.exe",
    "brave.exe",
    "opera.exe",
    "safari.exe",
    "iexplore.exe",
    "waterfox.exe",
    "librewolf.exe",
    "vivaldi.exe",
    "thorium.exe"
  ].includes(executable);
  
  if (!isBrowser) return undefined;

  const titleLower = current.title.toLowerCase();
  const site = rules.sites.find((s) => {
    if (s.normalizedHost === "x.com" || s.normalizedHost === "twitter.com") {
      if (titleLower.includes(" / x") || titleLower.includes(" on x") || titleLower.includes("twitter")) return true;
    }
    const domainParts = s.normalizedHost.split(".");
    if (domainParts.length >= 2) {
      const name = domainParts[domainParts.length - 2];
      if (name.length > 3 && titleLower.includes(name)) return true;
    }
    return titleLower.includes(s.normalizedHost);
  });

  if (site) {
    return {
      id: site.id,
      profileId: site.profileId,
      displayName: site.domain,
      executable: current.executable,
      enabled: true,
      isSite: true
    };
  }
  return undefined;
}
