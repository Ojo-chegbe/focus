import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import type {
  AppSettings,
  AppState,
  AllowedApp,
  BlockedApp,
  BlockedSite,
  FocusSessionConfig,
  FocusSessionPreset,
  FocusSession,
  Profile,
  ProfileCondition,
  Schedule,
  UsageEvent
} from "../shared/models";
import { createId, isStrictLocked, normalizeDomain } from "../shared/rules";

const nowIso = () => new Date().toISOString();
const FIVE_MINUTES_MS = 5 * 60_000;
const ONE_HOUR_MS = 60 * 60_000;

function clampInteger(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isInteger(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function normalizePositiveNumber(value: number | undefined, fallback: number, min = 1, max = 10_000): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value as number));
}

function defaultSettings(): AppSettings {
  return {
    launchAtLogin: false,
    minimizeToTray: true,
    blockPagePort: 47831,
    helperPollSeconds: 5,
    emergencyOverrideMinutes: 10
  };
}

function defaultState(): AppState {
  const profileId = createId("profile");
  return {
    profiles: [
      {
        id: profileId,
        name: "Work",
        color: "#2563eb",
        icon: "briefcase",
        enabled: true,
        appPolicy: "blocklist",
        strictMode: "off",
        createdAt: nowIso()
      }
    ],
    blockedApps: [
      {
        id: createId("app"),
        profileId,
        displayName: "Example Game",
        executable: "game.exe",
        enabled: false
      }
    ],
    allowedApps: [],
    blockedSites: [
      {
        id: createId("site"),
        profileId,
        domain: "youtube.com",
        normalizedHost: "youtube.com",
        includeSubdomains: true,
        enabled: false
      }
    ],
    schedules: [
      {
        id: createId("schedule"),
        profileId,
        label: "Weekday focus",
        days: [1, 2, 3, 4, 5],
        startTime: "09:00",
        endTime: "17:00",
        enabled: false
      }
    ],
    profileConditions: [],
    focusSessionPresets: [],
    focusSessions: [],
    usageEvents: [],
    settings: defaultSettings()
  };
}

export class FocusStore {
  private readonly dataPath: string;
  private state: AppState;

  constructor() {
    const dir = path.join(app.getPath("userData"), "data");
    fs.mkdirSync(dir, { recursive: true });
    this.dataPath = path.join(dir, "focus-state.json");
    this.state = this.load();
  }

  getState(): AppState {
    this.expireFocusSessions();
    this.expireDisabledRules();
    return structuredClone(this.state);
  }

  exportData(): string {
    return JSON.stringify(this.getState(), null, 2);
  }

  deleteAllData(): AppState {
    this.state = defaultState();
    this.persist();
    return this.getState();
  }

  saveSettings(settings: AppSettings): AppState {
    const defaults = defaultSettings();
    this.state.settings = {
      ...defaults,
      ...settings,
      blockPagePort: clampInteger(settings.blockPagePort, 1024, 65535, defaults.blockPagePort),
      helperPollSeconds: clampInteger(settings.helperPollSeconds, 1, 60, defaults.helperPollSeconds),
      emergencyOverrideMinutes: clampInteger(settings.emergencyOverrideMinutes, 1, 1440, defaults.emergencyOverrideMinutes)
    };
    this.persist();
    return this.getState();
  }

  saveProfile(profile: Profile): AppState {
    const existing = this.state.profiles.find((item) => item.id === profile.id);
    if (existing && isStrictLocked(existing.strictUntil)) {
      this.addEvent({
        type: "strict-denied",
        target: existing.name,
        profileId: existing.id,
        detail: "Profile is locked and cannot be edited."
      });
      return this.getState();
    }

    this.upsert("profiles", {
      ...profile,
      name: profile.name.trim() || "Untitled profile",
      appPolicy: profile.appPolicy ?? "blocklist",
      strictMode: profile.strictMode ?? "off",
      createdAt: profile.createdAt || nowIso()
    });
    return this.getState();
  }

  deleteProfile(profileId: string): AppState {
    const profile = this.state.profiles.find((item) => item.id === profileId);
    if (profile && isStrictLocked(profile.strictUntil)) return this.getState();

    this.state.profiles = this.state.profiles.filter((item) => item.id !== profileId);
    this.state.blockedApps = this.state.blockedApps.filter((item) => item.profileId !== profileId);
    this.state.allowedApps = this.state.allowedApps.filter((item) => item.profileId !== profileId);
    this.state.blockedSites = this.state.blockedSites.filter((item) => item.profileId !== profileId);
    this.state.schedules = this.state.schedules.filter((item) => item.profileId !== profileId);
    this.state.profileConditions = this.state.profileConditions.filter((item) => item.profileId !== profileId);
    this.persist();
    return this.getState();
  }

  saveBlockedApp(blockedApp: BlockedApp): AppState {
    if (this.isProfileLocked(blockedApp.profileId)) return this.getState();
    const existing = this.state.blockedApps.find((a) => a.id === blockedApp.id);
    if (existing && existing.enabled && !blockedApp.enabled) {
      if (existing.cooldownUntil && new Date(existing.cooldownUntil).getTime() > Date.now()) return this.getState();
      blockedApp.disabledUntil = new Date(Date.now() + FIVE_MINUTES_MS).toISOString();
      blockedApp.cooldownUntil = undefined;
    } else if (blockedApp.enabled) {
      blockedApp.disabledUntil = undefined;
      blockedApp.cooldownUntil = existing?.cooldownUntil;
    }
    this.upsert("blockedApps", {
      ...blockedApp,
      displayName: blockedApp.displayName.trim() || blockedApp.executable.trim(),
      executable: blockedApp.executable.trim().toLowerCase()
    });
    return this.getState();
  }

  deleteBlockedApp(id: string): AppState {
    this.deleteById("blockedApps", id);
    return this.getState();
  }

  saveAllowedApp(allowedApp: AllowedApp): AppState {
    if (this.isProfileLocked(allowedApp.profileId)) return this.getState();
    const existing = this.state.allowedApps.find((a) => a.id === allowedApp.id);
    if (existing && existing.enabled && !allowedApp.enabled) {
      if (existing.cooldownUntil && new Date(existing.cooldownUntil).getTime() > Date.now()) return this.getState();
      allowedApp.disabledUntil = new Date(Date.now() + FIVE_MINUTES_MS).toISOString();
      allowedApp.cooldownUntil = undefined;
    } else if (allowedApp.enabled) {
      allowedApp.disabledUntil = undefined;
      allowedApp.cooldownUntil = existing?.cooldownUntil;
    }
    this.upsert("allowedApps", {
      ...allowedApp,
      displayName: allowedApp.displayName.trim() || allowedApp.executable.trim(),
      executable: allowedApp.executable.trim().toLowerCase()
    });
    return this.getState();
  }

  deleteAllowedApp(id: string): AppState {
    this.deleteById("allowedApps", id);
    return this.getState();
  }

  saveBlockedSite(blockedSite: BlockedSite): AppState {
    if (this.isProfileLocked(blockedSite.profileId)) return this.getState();
    const existing = this.state.blockedSites.find((a) => a.id === blockedSite.id);
    if (existing && existing.enabled && !blockedSite.enabled) {
      if (existing.cooldownUntil && new Date(existing.cooldownUntil).getTime() > Date.now()) return this.getState();
      blockedSite.disabledUntil = new Date(Date.now() + FIVE_MINUTES_MS).toISOString();
      blockedSite.cooldownUntil = undefined;
    } else if (blockedSite.enabled) {
      blockedSite.disabledUntil = undefined;
      blockedSite.cooldownUntil = existing?.cooldownUntil;
    }
    const normalizedHost = normalizeDomain(blockedSite.domain || blockedSite.normalizedHost);
    this.upsert("blockedSites", {
      ...blockedSite,
      domain: normalizedHost,
      normalizedHost,
      includeSubdomains: blockedSite.includeSubdomains ?? true
    });
    return this.getState();
  }

  deleteBlockedSite(id: string): AppState {
    this.deleteById("blockedSites", id);
    return this.getState();
  }

  saveSchedule(schedule: Schedule): AppState {
    if (this.isProfileLocked(schedule.profileId)) return this.getState();
    this.upsert("schedules", schedule);
    return this.getState();
  }

  deleteSchedule(id: string): AppState {
    this.deleteById("schedules", id);
    return this.getState();
  }

  saveProfileCondition(condition: ProfileCondition): AppState {
    if (this.isProfileLocked(condition.profileId)) return this.getState();
    this.upsert("profileConditions", condition);
    return this.getState();
  }

  deleteProfileCondition(id: string): AppState {
    this.deleteById("profileConditions", id);
    return this.getState();
  }

  startFocusSession(profileIdOrConfig: string | FocusSessionConfig, minutes?: number): AppState {
    const config: FocusSessionConfig =
      typeof profileIdOrConfig === "string"
        ? {
            profileId: profileIdOrConfig,
            mode: "duration",
            durationMinutes: Math.max(1, minutes ?? 30),
            focusMinutes: 25,
            breakMinutes: 5,
            rounds: 1,
            allowedApps: [],
            wallpaperType: "default",
            wallpaperValue: "#0f1724",
            showPauseButton: true,
            strict: false
          }
        : profileIdOrConfig;
    const rounds = normalizePositiveNumber(config.rounds, 1, 1, 100);
    const focusMinutes = normalizePositiveNumber(config.focusMinutes, 25, 1, 600);
    const breakMinutes = normalizePositiveNumber(config.breakMinutes, 5, 0, 180);
    const durationMinutes = normalizePositiveNumber(config.durationMinutes, 30, 1, 1440);
    const totalMinutes =
      config.mode === "pomodoro"
        ? Math.max(1, rounds * focusMinutes + Math.max(0, rounds - 1) * breakMinutes)
        : durationMinutes;
    const session: FocusSession = {
      id: createId("session"),
      profileId: config.profileId,
      mode: config.mode,
      focusMinutes,
      breakMinutes,
      rounds,
      currentRound: 1,
      allowedApps: config.allowedApps,
      wallpaperType: config.wallpaperType,
      wallpaperValue: config.wallpaperValue,
      showPauseButton: config.showPauseButton,
      strict: config.strict,
      startedAt: nowIso(),
      endsAt: new Date(Date.now() + totalMinutes * 60_000).toISOString(),
      active: true
    };
    this.state.focusSessions.push(session);
    this.addEvent({ type: "focus-started", target: `${totalMinutes} minute session`, profileId: config.profileId });
    this.persist();
    return this.getState();
  }

  saveFocusSessionPreset(preset: FocusSessionPreset): AppState {
    this.upsert("focusSessionPresets", {
      ...preset,
      name: preset.name.trim() || "Session preset",
      createdAt: preset.createdAt || nowIso()
    });
    return this.getState();
  }

  deleteFocusSessionPreset(id: string): AppState {
    this.state.focusSessionPresets = this.state.focusSessionPresets.filter((preset) => preset.id !== id);
    this.persist();
    return this.getState();
  }

  endFocusSession(id: string): AppState {
    const session = this.state.focusSessions.find((item) => item.id === id);
    if (session) {
      if (session.strict && session.active) return this.getState();
      session.active = false;
      session.paused = false;
      this.addEvent({ type: "focus-ended", target: "Focus session", profileId: session.profileId });
    }
    this.persist();
    return this.getState();
  }

  pauseFocusSession(id: string): AppState {
    const session = this.state.focusSessions.find((item) => item.id === id);
    if (!session || !session.active) return this.getState();
    if (session.strict || session.showPauseButton === false) return this.getState();
    if (session.paused) return this.getState();
    const remainingMs = Math.max(0, new Date(session.endsAt).getTime() - Date.now());
    session.paused = true;
    session.pausedAt = nowIso();
    session.remainingMs = remainingMs;
    this.persist();
    return this.getState();
  }

  resumeFocusSession(id: string): AppState {
    const session = this.state.focusSessions.find((item) => item.id === id);
    if (!session || !session.active || !session.paused) return this.getState();
    const remainingMs = Math.max(0, session.remainingMs ?? 0);
    session.paused = false;
    session.pausedAt = undefined;
    session.endsAt = new Date(Date.now() + remainingMs).toISOString();
    session.remainingMs = undefined;
    this.persist();
    return this.getState();
  }

  lockProfile(profileId: string, minutes: number): AppState {
    const profile = this.state.profiles.find((item) => item.id === profileId);
    if (!profile) return this.getState();
    profile.strictMode = "timer";
    profile.strictUntil = new Date(Date.now() + minutes * 60_000).toISOString();
    this.addEvent({ type: "strict-locked", target: profile.name, profileId, detail: `${minutes} minutes` });
    this.persist();
    return this.getState();
  }

  addUsageEvent(event: Omit<UsageEvent, "id" | "startedAt"> & { startedAt?: string }): AppState {
    this.addEvent(event);
    this.persist();
    return this.getState();
  }

  private load(): AppState {
    if (!fs.existsSync(this.dataPath)) {
      const initial = defaultState();
      fs.writeFileSync(this.dataPath, JSON.stringify(initial, null, 2), "utf8");
      return initial;
    }

    try {
      const parsed = JSON.parse(fs.readFileSync(this.dataPath, "utf8")) as Partial<AppState>;
      return {
        profiles: (parsed.profiles ?? []).map((profile) => ({
          ...profile,
          appPolicy: profile.appPolicy ?? "blocklist"
        })),
        blockedApps: parsed.blockedApps ?? [],
        allowedApps: parsed.allowedApps ?? [],
        blockedSites: parsed.blockedSites ?? [],
        schedules: (parsed.schedules ?? []).map((schedule) => ({
          ...schedule,
          days: Array.isArray(schedule.days) ? schedule.days : [],
          startTime: typeof schedule.startTime === "string" ? schedule.startTime : "09:00",
          endTime: typeof schedule.endTime === "string" ? schedule.endTime : "17:00",
          enabled: Boolean(schedule.enabled)
        })),
        profileConditions: parsed.profileConditions ?? [],
        focusSessionPresets: parsed.focusSessionPresets ?? [],
        focusSessions: (parsed.focusSessions ?? []).map((session) => ({
          ...session,
          active: Boolean(session.active)
        })),
        usageEvents: parsed.usageEvents ?? [],
        settings: { ...defaultSettings(), ...(parsed.settings ?? {}) }
      };
    } catch {
      const backupPath = `${this.dataPath}.${Date.now()}.bak`;
      fs.copyFileSync(this.dataPath, backupPath);
      return defaultState();
    }
  }

  private persist(): void {
    fs.writeFileSync(this.dataPath, JSON.stringify(this.state, null, 2), "utf8");
  }

  private upsert<K extends "profiles" | "blockedApps" | "allowedApps" | "blockedSites" | "schedules" | "profileConditions" | "focusSessionPresets">(
    collection: K,
    value: AppState[K][number]
  ): void {
    const items = this.state[collection] as Array<AppState[K][number]>;
    const index = items.findIndex((item) => item.id === value.id);
    if (index >= 0) items[index] = value;
    else items.push(value);
    this.persist();
  }

  private deleteById<K extends "blockedApps" | "allowedApps" | "blockedSites" | "schedules" | "profileConditions">(
    collection: K,
    id: string
  ): void {
    const item = (this.state[collection] as Array<AppState[K][number]>).find((entry) => entry.id === id);
    if (item && "profileId" in item && this.isProfileLocked(item.profileId)) return;
    this.state[collection] = (this.state[collection] as Array<AppState[K][number]>).filter(
      (entry) => entry.id !== id
    ) as AppState[K];
    this.persist();
  }

  private isProfileLocked(profileId: string): boolean {
    const profile = this.state.profiles.find((item) => item.id === profileId);
    if (!profile) return false;
    if (!isStrictLocked(profile.strictUntil)) return false;
    this.addEvent({
      type: "strict-denied",
      target: profile.name,
      profileId,
      detail: "Profile is locked and cannot be changed."
    });
    return true;
  }

  private addEvent(event: Omit<UsageEvent, "id" | "startedAt"> & { startedAt?: string }): void {
    this.state.usageEvents.unshift({
      id: createId("event"),
      startedAt: event.startedAt ?? nowIso(),
      ...event
    });
    this.state.usageEvents = this.state.usageEvents.slice(0, 1000);
  }

  private expireFocusSessions(): void {
    const now = Date.now();
    let changed = false;
    for (const session of this.state.focusSessions) {
      if (session.active && new Date(session.endsAt).getTime() <= now) {
        if (session.paused) continue;
        session.active = false;
        changed = true;
      }
    }
    if (changed) this.persist();
  }

  private expireDisabledRules(): void {
    const now = Date.now();
    let changed = false;
    for (const app of this.state.blockedApps) {
      if (!app.enabled && app.disabledUntil && new Date(app.disabledUntil).getTime() <= now) {
        app.enabled = true;
        app.disabledUntil = undefined;
        app.cooldownUntil = new Date(now + ONE_HOUR_MS).toISOString();
        changed = true;
      } else if (app.enabled && app.cooldownUntil && new Date(app.cooldownUntil).getTime() <= now) {
        app.cooldownUntil = undefined;
        changed = true;
      }
    }
    for (const app of this.state.allowedApps) {
      if (!app.enabled && app.disabledUntil && new Date(app.disabledUntil).getTime() <= now) {
        app.enabled = true;
        app.disabledUntil = undefined;
        app.cooldownUntil = new Date(now + ONE_HOUR_MS).toISOString();
        changed = true;
      } else if (app.enabled && app.cooldownUntil && new Date(app.cooldownUntil).getTime() <= now) {
        app.cooldownUntil = undefined;
        changed = true;
      }
    }
    for (const site of this.state.blockedSites) {
      if (!site.enabled && site.disabledUntil && new Date(site.disabledUntil).getTime() <= now) {
        site.enabled = true;
        site.disabledUntil = undefined;
        site.cooldownUntil = new Date(now + ONE_HOUR_MS).toISOString();
        changed = true;
      } else if (site.enabled && site.cooldownUntil && new Date(site.cooldownUntil).getTime() <= now) {
        site.cooldownUntil = undefined;
        changed = true;
      }
    }
    if (changed) this.persist();
  }
}
