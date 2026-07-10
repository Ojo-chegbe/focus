import type {
  ActiveRules,
  FocusSessionConfig,
  FocusSessionPreset,
  AppState,
  AppSettings,
  AllowedApp,
  BlockedApp,
  BlockedSite,
  HelperStatus,
  Profile,
  Schedule,
  ProfileCondition,
  UsageEvent,
  UsageSummary
} from "./models";

export interface AppApi {
  getState(): Promise<AppState>;
  saveProfile(profile: Profile): Promise<AppState>;
  deleteProfile(profileId: string): Promise<AppState>;
  selectAppExecutable(): Promise<SelectedAppExecutable | undefined>;
  selectWallpaperImage(): Promise<string | undefined>;
  listRunningApps(): Promise<SelectedAppExecutable[]>;
  saveBlockedApp(app: BlockedApp): Promise<AppState>;
  deleteBlockedApp(id: string): Promise<AppState>;
  saveAllowedApp(app: AllowedApp): Promise<AppState>;
  deleteAllowedApp(id: string): Promise<AppState>;
  saveBlockedSite(site: BlockedSite): Promise<AppState>;
  deleteBlockedSite(id: string): Promise<AppState>;
  saveSchedule(schedule: Schedule): Promise<AppState>;
  deleteSchedule(id: string): Promise<AppState>;
  startFocusSession(profileIdOrConfig: string | FocusSessionConfig, minutes?: number): Promise<AppState>;
  saveFocusSessionPreset(preset: FocusSessionPreset): Promise<AppState>;
  deleteFocusSessionPreset(id: string): Promise<AppState>;
  endFocusSession(id: string): Promise<AppState>;
  pauseFocusSession(id: string): Promise<AppState>;
  resumeFocusSession(id: string): Promise<AppState>;
  saveProfileCondition(condition: ProfileCondition): Promise<AppState>;
  deleteProfileCondition(id: string): Promise<AppState>;
  lockProfile(profileId: string, minutes: number): Promise<AppState>;
  takeBreak(profileId: string): Promise<AppState>;
  applyRules(): Promise<HelperStatus>;
  getHelperStatus(): Promise<HelperStatus>;
  getUsageSummary(): Promise<UsageSummary>;
  getTimeline(): Promise<UsageEvent[]>;
  exportData(): Promise<string>;
  deleteAllData(): Promise<AppState>;
  saveSettings(settings: AppSettings): Promise<AppState>;
  openHostsFile(): Promise<void>;
  relaunchAsAdmin(): Promise<void>;
  refreshFirefox(): Promise<HelperStatus>;
}

export interface SelectedAppExecutable {
  displayName: string;
  executable: string;
  title?: string;
  path?: string;
}

export const channels = {
  getState: "state:get",
  saveProfile: "profile:save",
  deleteProfile: "profile:delete",
  selectAppExecutable: "blocked-app:select-executable",
  selectWallpaperImage: "focus-session:select-wallpaper-image",
  listRunningApps: "blocked-app:list-running",
  saveBlockedApp: "blocked-app:save",
  deleteBlockedApp: "blocked-app:delete",
  saveAllowedApp: "allowed-app:save",
  deleteAllowedApp: "allowed-app:delete",
  saveBlockedSite: "blocked-site:save",
  deleteBlockedSite: "blocked-site:delete",
  saveSchedule: "schedule:save",
  deleteSchedule: "schedule:delete",
  startFocusSession: "focus-session:start",
  saveFocusSessionPreset: "focus-session-preset:save",
  deleteFocusSessionPreset: "focus-session-preset:delete",
  endFocusSession: "focus-session:end",
  pauseFocusSession: "focus-session:pause",
  resumeFocusSession: "focus-session:resume",
  saveProfileCondition: "profile-condition:save",
  deleteProfileCondition: "profile-condition:delete",
  lockProfile: "profile:lock",
  takeBreak: "profile:take-break",
  applyRules: "rules:apply",
  getHelperStatus: "helper:status",
  getUsageSummary: "usage:summary",
  getTimeline: "usage:timeline",
  exportData: "data:export",
  deleteAllData: "data:delete-all",
  saveSettings: "settings:save",
  openHostsFile: "hosts:open",
  relaunchAsAdmin: "app:relaunch-as-admin",
  refreshFirefox: "browser:refresh-firefox"
} as const;
