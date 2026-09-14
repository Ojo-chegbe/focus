import { app, type BrowserWindow } from "electron";
import { autoUpdater, type ProgressInfo, type UpdateInfo } from "electron-updater";
import { channels, type UpdateStatus } from "../shared/ipc";

let status: UpdateStatus = {
  state: "idle",
  currentVersion: app.getVersion()
};

let getTargetWindow: (() => BrowserWindow | undefined) | undefined;

function broadcastStatus(newStatus: Partial<UpdateStatus>): void {
  status = {
    ...status,
    ...newStatus,
    currentVersion: app.getVersion()
  };

  const win = getTargetWindow?.();
  if (win && !win.isDestroyed()) {
    win.webContents.send(channels.onUpdateStatus, status);
  }
}

export function initAutoUpdater(windowGetter: () => BrowserWindow | undefined): void {
  getTargetWindow = windowGetter;

  // Configure autoUpdater settings
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("checking-for-update", () => {
    broadcastStatus({ state: "checking", error: undefined });
  });

  autoUpdater.on("update-available", (info: UpdateInfo) => {
    broadcastStatus({
      state: "available",
      version: info.version,
      error: undefined
    });
  });

  autoUpdater.on("update-not-available", (_info: UpdateInfo) => {
    broadcastStatus({
      state: "not-available",
      error: undefined
    });
  });

  autoUpdater.on("error", (err: Error) => {
    broadcastStatus({
      state: "error",
      error: err.message || "Failed to check for updates"
    });
  });

  autoUpdater.on("download-progress", (progressObj: ProgressInfo) => {
    broadcastStatus({
      state: "downloading",
      progress: Math.round(progressObj.percent)
    });
  });

  autoUpdater.on("update-downloaded", (info: UpdateInfo) => {
    broadcastStatus({
      state: "downloaded",
      version: info.version,
      progress: 100,
      error: undefined
    });
  });

  // Only check automatically in packaged production builds
  if (app.isPackaged) {
    // Delay first check slightly to not block initial window render
    setTimeout(() => {
      void autoUpdater.checkForUpdates().catch((err) => {
        broadcastStatus({
          state: "error",
          error: err instanceof Error ? err.message : String(err)
        });
      });
    }, 5000);
  }
}

export function getUpdateStatus(): UpdateStatus {
  return status;
}

export async function checkForUpdates(): Promise<UpdateStatus> {
  if (!app.isPackaged) {
    broadcastStatus({
      state: "not-available",
      error: "Auto-updates are only active in packaged production builds."
    });
    return status;
  }

  try {
    broadcastStatus({ state: "checking", error: undefined });
    await autoUpdater.checkForUpdates();
  } catch (err) {
    broadcastStatus({
      state: "error",
      error: err instanceof Error ? err.message : String(err)
    });
  }

  return status;
}

export function quitAndInstallUpdate(): void {
  if (status.state === "downloaded") {
    autoUpdater.quitAndInstall();
  }
}
