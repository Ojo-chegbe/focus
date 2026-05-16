import { contextBridge, ipcRenderer } from "electron";
import { channels, type AppApi } from "../shared/ipc";

const api: AppApi = {
  getState: () => ipcRenderer.invoke(channels.getState),
  saveProfile: (profile) => ipcRenderer.invoke(channels.saveProfile, profile),
  deleteProfile: (profileId) => ipcRenderer.invoke(channels.deleteProfile, profileId),
  selectAppExecutable: () => ipcRenderer.invoke(channels.selectAppExecutable),
  selectWallpaperImage: () => ipcRenderer.invoke(channels.selectWallpaperImage),
  listRunningApps: () => ipcRenderer.invoke(channels.listRunningApps),
  saveBlockedApp: (app) => ipcRenderer.invoke(channels.saveBlockedApp, app),
  deleteBlockedApp: (id) => ipcRenderer.invoke(channels.deleteBlockedApp, id),
  saveAllowedApp: (app) => ipcRenderer.invoke(channels.saveAllowedApp, app),
  deleteAllowedApp: (id) => ipcRenderer.invoke(channels.deleteAllowedApp, id),
  saveBlockedSite: (site) => ipcRenderer.invoke(channels.saveBlockedSite, site),
  deleteBlockedSite: (id) => ipcRenderer.invoke(channels.deleteBlockedSite, id),
  saveSchedule: (schedule) => ipcRenderer.invoke(channels.saveSchedule, schedule),
  deleteSchedule: (id) => ipcRenderer.invoke(channels.deleteSchedule, id),
  startFocusSession: (profileIdOrConfig, minutes) => ipcRenderer.invoke(channels.startFocusSession, profileIdOrConfig, minutes),
  saveFocusSessionPreset: (preset) => ipcRenderer.invoke(channels.saveFocusSessionPreset, preset),
  deleteFocusSessionPreset: (id) => ipcRenderer.invoke(channels.deleteFocusSessionPreset, id),
  endFocusSession: (id) => ipcRenderer.invoke(channels.endFocusSession, id),
  pauseFocusSession: (id) => ipcRenderer.invoke(channels.pauseFocusSession, id),
  resumeFocusSession: (id) => ipcRenderer.invoke(channels.resumeFocusSession, id),
  saveProfileCondition: (condition) => ipcRenderer.invoke(channels.saveProfileCondition, condition),
  deleteProfileCondition: (id) => ipcRenderer.invoke(channels.deleteProfileCondition, id),
  lockProfile: (profileId, minutes) => ipcRenderer.invoke(channels.lockProfile, profileId, minutes),
  applyRules: () => ipcRenderer.invoke(channels.applyRules),
  getHelperStatus: () => ipcRenderer.invoke(channels.getHelperStatus),
  getUsageSummary: () => ipcRenderer.invoke(channels.getUsageSummary),
  getTimeline: () => ipcRenderer.invoke(channels.getTimeline),
  exportData: () => ipcRenderer.invoke(channels.exportData),
  deleteAllData: () => ipcRenderer.invoke(channels.deleteAllData),
  saveSettings: (settings) => ipcRenderer.invoke(channels.saveSettings, settings),
  openHostsFile: () => ipcRenderer.invoke(channels.openHostsFile),
  relaunchAsAdmin: () => ipcRenderer.invoke(channels.relaunchAsAdmin),
  refreshFirefox: () => ipcRenderer.invoke(channels.refreshFirefox)
};

contextBridge.exposeInMainWorld("focusApi", api);
