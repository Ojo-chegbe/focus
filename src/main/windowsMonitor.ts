import { BrowserWindow } from "electron";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ActiveRules, BlockedApp } from "../shared/models";
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

    const blocked = this.getRules().apps.find((app) => matchesBlockedApp(app, current));
    if (blocked) {
      this.store.addUsageEvent({
        type: "app-blocked",
        target: blocked.displayName,
        profileId: blocked.profileId,
        detail: current.title || current.executable
      });
      await this.closeBlockedProcess(current.executable, blocked.displayName);
      this.showBlockedWindow(blocked.displayName);
    } else {
      this.hideBlockedWindow();
    }
  }

  private async closeBlockedProcess(executable: string, displayName: string): Promise<void> {
    const now = Date.now();
    const lastKillAt = this.lastKillByExecutable.get(executable) ?? 0;
    if (now - lastKillAt < 5000) return;
    this.lastKillByExecutable.set(executable, now);

    try {
      await execFileAsync("taskkill.exe", ["/IM", executable, "/F"], { windowsHide: true, timeout: 3000 });
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
  | { executable: string; title: string; path?: string; error?: undefined }
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
    const parsed = JSON.parse(output) as { executable?: string; title?: string; path?: string };
    if (!parsed.executable) return undefined;
    return {
      executable: parsed.executable,
      title: parsed.title ?? "",
      path: parsed.path || undefined
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

function matchesBlockedApp(app: BlockedApp, current: { executable: string; title: string; path?: string }): boolean {
  const executable = current.executable.toLowerCase();
  const title = current.title.toLowerCase();
  const currentPath = current.path?.toLowerCase();
  const blockedExecutable = app.executable.toLowerCase();
  const blockedPath = app.path?.toLowerCase();
  const displayName = app.displayName.toLowerCase().replace(/\.exe$/i, "").trim();

  return (
    executable === blockedExecutable ||
    Boolean(blockedPath && currentPath === blockedPath) ||
    Boolean(displayName && (executable.replace(/\.exe$/i, "") === displayName || title.includes(displayName)))
  );
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
