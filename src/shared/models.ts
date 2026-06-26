export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export type RuleTarget = "app" | "site" | "phone";
export type AppPolicy = "blocklist" | "allowlist";

export type UsageEventType =
  | "app-session"
  | "site-blocked"
  | "app-blocked"
  | "rules-applied"
  | "strict-locked"
  | "strict-denied"
  | "focus-started"
  | "focus-ended";

export interface Profile {
  id: string;
  name: string;
  color: string;
  icon: string;
  enabled: boolean;
  appPolicy: AppPolicy;
  strictUntil?: string;
  strictMode: "off" | "timer" | "challenge";
  createdAt: string;
}

export interface BlockedApp {
  id: string;
  profileId: string;
  displayName: string;
  executable: string;
  path?: string;
  enabled: boolean;
  disabledUntil?: string;
  cooldownUntil?: string;
  dailyLimitMinutes?: number;
  launchLimit?: number;
}

export interface AllowedApp {
  id: string;
  profileId: string;
  displayName: string;
  executable: string;
  path?: string;
  enabled: boolean;
  disabledUntil?: string;
  cooldownUntil?: string;
}

export interface BlockedSite {
  id: string;
  profileId: string;
  domain: string;
  normalizedHost: string;
  includeSubdomains: boolean;
  enabled: boolean;
  disabledUntil?: string;
  cooldownUntil?: string;
  dailyLimitMinutes?: number;
}

export interface Schedule {
  id: string;
  profileId: string;
  label: string;
  days: Weekday[];
  startTime: string;
  endTime: string;
  enabled: boolean;
}

export interface FocusSession {
  id: string;
  profileId: string;
  mode?: "duration" | "pomodoro";
  focusMinutes?: number;
  breakMinutes?: number;
  rounds?: number;
  currentRound?: number;
  allowedApps?: AllowedApp[];
  wallpaperType?: "default" | "solid" | "custom";
  wallpaperValue?: string;
  showPauseButton?: boolean;
  strict?: boolean;
  paused?: boolean;
  pausedAt?: string;
  remainingMs?: number;
  startedAt: string;
  endsAt: string;
  active: boolean;
}

export interface FocusSessionConfig {
  profileId: string;
  mode: "duration" | "pomodoro";
  durationMinutes?: number;
  focusMinutes?: number;
  breakMinutes?: number;
  rounds?: number;
  allowedApps: AllowedApp[];
  wallpaperType: "default" | "solid" | "custom";
  wallpaperValue: string;
  showPauseButton: boolean;
  strict: boolean;
}

export interface FocusSessionPreset {
  id: string;
  name: string;
  profileId: string;
  mode: "duration" | "pomodoro";
  durationMinutes?: number;
  focusMinutes?: number;
  breakMinutes?: number;
  rounds?: number;
  allowedApps: AllowedApp[];
  wallpaperType: "default" | "solid" | "custom";
  wallpaperValue: string;
  showPauseButton: boolean;
  createdAt: string;
}

export interface ProfileCondition {
  id: string;
  profileId: string;
  type: "manual" | "schedule" | "quick-block" | "usage-limit";
  enabled: boolean;
  startsAt?: string;
  endsAt?: string;
  limitScope?: "daily" | "hourly";
  limitMinutes?: number;
}

export interface UsageEvent {
  id: string;
  type: UsageEventType;
  target: string;
  profileId?: string;
  startedAt: string;
  endedAt?: string;
  durationSeconds?: number;
  detail?: string;
}

export interface AppSettings {
  launchAtLogin: boolean;
  minimizeToTray: boolean;
  blockPagePort: number;
  helperPollSeconds: number;
  emergencyOverrideMinutes: number;
}

export interface AppState {
  profiles: Profile[];
  blockedApps: BlockedApp[];
  allowedApps: AllowedApp[];
  blockedSites: BlockedSite[];
  schedules: Schedule[];
  profileConditions: ProfileCondition[];
  focusSessionPresets: FocusSessionPreset[];
  focusSessions: FocusSession[];
  usageEvents: UsageEvent[];
  settings: AppSettings;
}

export interface ActiveRules {
  activeProfileIds: string[];
  activeProfileNames: string[];
  activationReasonsByProfileId: Record<string, "manual" | "schedule" | "focus-session">;
  appPoliciesByProfileId: Record<string, AppPolicy>;
  blockedApps: BlockedApp[];
  allowedApps: AllowedApp[];
  focusSessionAllowedApps: AllowedApp[];
  activeFocusSession?: FocusSession;
  apps: BlockedApp[];
  sites: BlockedSite[];
}

export interface HelperStatus {
  platform: NodeJS.Platform;
  isWindows: boolean;
  isElevated: boolean;
  hostsPath: string;
  lastAppliedAt?: string;
  lastError?: string;
  activeRules: ActiveRules;
}

export interface UsageSummary {
  totalSecondsToday: number;
  blockedAttemptsToday: number;
  activeProfiles: string[];
  topApps: Array<{ name: string; seconds: number }>;
}
