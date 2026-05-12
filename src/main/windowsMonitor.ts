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
    [PSCustomObject]@{
      processId = $foregroundProcessId
      executable = "$($p.ProcessName).exe"
      title = "$($p.MainWindowTitle)"
      path = "$($p.Path)"
    } | ConvertTo-Json -Compress
  }
}
`;

export class WindowsMonitor {
  private timer?: NodeJS.Timeout;
  private lastExecutable?: string;
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

    if (this.lastExecutable && this.lastExecutable !== executable) {
      const durationSeconds = Math.round((Date.now() - this.lastStartedAt) / 1000);
      if (durationSeconds > 2) {
        this.store.addUsageEvent({
          type: "app-session",
          target: this.lastExecutable,
          durationSeconds,
          endedAt: new Date().toISOString()
        });
      }
      this.lastStartedAt = Date.now();
    }
    this.lastExecutable = executable;

    const rules = this.getRules();
    const hasAllowlistMode = Object.values(rules.appPoliciesByProfileId).includes("allowlist");
    const blocked = hasAllowlistMode
      ? findAllowlistViolation(rules, current)
      : rules.blockedApps.find((app) => matchesAppRule(app, current));

    if (blocked) {
      this.store.addUsageEvent({
        type: "app-blocked",
        target: blocked.displayName,
        profileId: blocked.profileId,
        detail: hasAllowlistMode
          ? `${current.title || current.executable} is not in the active allowlist.`
          : current.title || current.executable
      });
      await this.closeBlockedProcess(current.processId, current.executable, blocked.displayName);
      this.showBlockedWindow(blocked.displayName);
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

function matchesAppRule(app: AppRule, current: { executable: string; title: string; path?: string }): boolean {
  const executable = current.executable.toLowerCase();
  const title = current.title.toLowerCase();
  const currentPath = current.path?.toLowerCase();
  const ruleExecutable = app.executable.toLowerCase();
  const rulePath = app.path?.toLowerCase();
  const displayName = app.displayName.toLowerCase().replace(/\.exe$/i, "").trim();

  return (
    executable === ruleExecutable ||
    Boolean(rulePath && currentPath === rulePath) ||
    Boolean(displayName && (executable.replace(/\.exe$/i, "") === displayName || title.includes(displayName)))
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
