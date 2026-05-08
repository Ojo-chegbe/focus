import { contextBridge, ipcRenderer } from "electron";
import { channels, type AppApi } from "../shared/ipc";

const api: AppApi = {
  getState: () => ipcRenderer.invoke(channels.getState),
  saveProfile: (profile) => ipcRenderer.invoke(channels.saveProfile, profile),
  deleteProfile: (profileId) => ipcRenderer.invoke(channels.deleteProfile, profileId),
  selectAppExecutable: () => ipcRenderer.invoke(channels.selectAppExecutable),
  saveBlockedApp: (app) => ipcRenderer.invoke(channels.saveBlockedApp, app),
  deleteBlockedApp: (id) => ipcRenderer.invoke(channels.deleteBlockedApp, id),
  saveBlockedSite: (site) => ipcRenderer.invoke(channels.saveBlockedSite, site),
  deleteBlockedSite: (id) => ipcRenderer.invoke(channels.deleteBlockedSite, id),
  saveBlockedKeyword: (keyword) => ipcRenderer.invoke(channels.saveBlockedKeyword, keyword),
  deleteBlockedKeyword: (id) => ipcRenderer.invoke(channels.deleteBlockedKeyword, id),
  saveSchedule: (schedule) => ipcRenderer.invoke(channels.saveSchedule, schedule),
  deleteSchedule: (id) => ipcRenderer.invoke(channels.deleteSchedule, id),
  startFocusSession: (profileId, minutes) => ipcRenderer.invoke(channels.startFocusSession, profileId, minutes),
  endFocusSession: (id) => ipcRenderer.invoke(channels.endFocusSession, id),
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
