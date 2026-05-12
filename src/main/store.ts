import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import type {
  AppSettings,
  AppState,
  AllowedApp,
  BlockedApp,
  BlockedSite,
  FocusSession,
  Profile,
  Schedule,
  UsageEvent
} from "../shared/models";
import { createId, isStrictLocked, normalizeDomain } from "../shared/rules";

const nowIso = () => new Date().toISOString();

function clampInteger(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isInteger(value)) return fallback;
  return Math.min(max, Math.max(min, value));
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
    this.persist();
    return this.getState();
  }

  saveBlockedApp(blockedApp: BlockedApp): AppState {
    if (this.isProfileLocked(blockedApp.profileId)) return this.getState();
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

  startFocusSession(profileId: string, minutes: number): AppState {
    const session: FocusSession = {
      id: createId("session"),
      profileId,
      startedAt: nowIso(),
      endsAt: new Date(Date.now() + minutes * 60_000).toISOString(),
      active: true
    };
    this.state.focusSessions.push(session);
    this.addEvent({ type: "focus-started", target: `${minutes} minute session`, profileId });
    this.persist();
    return this.getState();
  }

  endFocusSession(id: string): AppState {
    const session = this.state.focusSessions.find((item) => item.id === id);
    if (session) {
      session.active = false;
      this.addEvent({ type: "focus-ended", target: "Focus session", profileId: session.profileId });
    }
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

  private upsert<K extends "profiles" | "blockedApps" | "allowedApps" | "blockedSites" | "schedules">(
    collection: K,
    value: AppState[K][number]
  ): void {
    const items = this.state[collection] as Array<AppState[K][number]>;
    const index = items.findIndex((item) => item.id === value.id);
    if (index >= 0) items[index] = value;
    else items.push(value);
    this.persist();
  }

  private deleteById<K extends "blockedApps" | "allowedApps" | "blockedSites" | "schedules">(
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
        session.active = false;
        changed = true;
      }
    }
    if (changed) this.persist();
  }
}
