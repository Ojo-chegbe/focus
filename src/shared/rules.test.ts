import { describe, expect, it } from "vitest";
import type { AppState, Schedule } from "./models";
import { getActiveRules, isScheduleActive, normalizeDomain } from "./rules";

describe("normalizeDomain", () => {
  it("normalizes URLs to host names", () => {
    expect(normalizeDomain("https://www.YouTube.com/shorts/abc")).toBe("youtube.com");
    expect(normalizeDomain(" reddit.com:443/r/all ")).toBe("reddit.com");
  });
});

describe("isScheduleActive", () => {
  it("matches same-day schedules", () => {
    const schedule: Schedule = {
      id: "s1",
      profileId: "p1",
      label: "Work",
      days: [1],
      startTime: "09:00",
      endTime: "17:00",
      enabled: true
    };
    expect(isScheduleActive(schedule, new Date("2026-05-04T10:00:00"))).toBe(true);
    expect(isScheduleActive(schedule, new Date("2026-05-04T18:00:00"))).toBe(false);
  });

  it("matches overnight schedules from the previous day", () => {
    const schedule: Schedule = {
      id: "s1",
      profileId: "p1",
      label: "Night",
      days: [1],
      startTime: "22:00",
      endTime: "06:00",
      enabled: true
    };
    expect(isScheduleActive(schedule, new Date("2026-05-04T23:00:00"))).toBe(true);
    expect(isScheduleActive(schedule, new Date("2026-05-05T05:30:00"))).toBe(true);
    expect(isScheduleActive(schedule, new Date("2026-05-05T07:00:00"))).toBe(false);
  });
});

describe("getActiveRules", () => {
  it("returns enabled rules for enabled profiles without requiring a timer", () => {
    const state: AppState = {
      profiles: [
        {
          id: "p1",
          name: "Work",
          color: "#000",
          icon: "briefcase",
          enabled: true,
          appPolicy: "blocklist",
          strictMode: "off",
          createdAt: "2026-05-01T00:00:00.000Z"
        }
      ],
      blockedApps: [
        { id: "a1", profileId: "p1", displayName: "Discord", executable: "discord.exe", enabled: true }
      ],
      allowedApps: [],
      blockedSites: [
        {
          id: "w1",
          profileId: "p1",
          domain: "youtube.com",
          normalizedHost: "youtube.com",
          includeSubdomains: true,
          enabled: true
        }
      ],
      schedules: [],
      focusSessions: [],
      profileConditions: [],
      usageEvents: [],
      settings: {
        launchAtLogin: false,
        minimizeToTray: true,
        blockPagePort: 47831,
        helperPollSeconds: 5,
        emergencyOverrideMinutes: 10
      }
    };

    const active = getActiveRules(state, new Date("2026-05-04T12:00:00"));
    expect(active.activeProfileNames).toEqual(["Work"]);
    expect(active.apps).toHaveLength(1);
    expect(active.sites).toHaveLength(1);
  });

  it("does not activate rules for disabled profiles", () => {
    const state: AppState = {
      profiles: [
        {
          id: "p1",
          name: "Work",
          color: "#000",
          icon: "briefcase",
          enabled: false,
          appPolicy: "blocklist",
          strictMode: "off",
          createdAt: "2026-05-01T00:00:00.000Z"
        }
      ],
      blockedApps: [{ id: "a1", profileId: "p1", displayName: "Discord", executable: "discord.exe", enabled: true }],
      allowedApps: [],
      blockedSites: [],
      schedules: [
        {
          id: "s1",
          profileId: "p1",
          label: "Work",
          days: [1],
          startTime: "09:00",
          endTime: "17:00",
          enabled: true
        }
      ],
      focusSessions: [
        {
          id: "f1",
          profileId: "p1",
          startedAt: "2026-05-04T12:00:00.000Z",
          endsAt: "2026-05-04T13:00:00.000Z",
          active: true
        }
      ],
      profileConditions: [],
      usageEvents: [],
      settings: {
        launchAtLogin: false,
        minimizeToTray: true,
        blockPagePort: 47831,
        helperPollSeconds: 5,
        emergencyOverrideMinutes: 10
      }
    };

    const active = getActiveRules(state, new Date("2026-05-04T12:30:00"));
    expect(active.activeProfileNames).toEqual([]);
    expect(active.apps).toHaveLength(0);
  });

  it("activates a profile only during active schedule windows when schedules exist", () => {
    const state: AppState = {
      profiles: [
        {
          id: "p1",
          name: "Work",
          color: "#000",
          icon: "briefcase",
          enabled: true,
          appPolicy: "blocklist",
          strictMode: "off",
          createdAt: "2026-05-01T00:00:00.000Z"
        }
      ],
      blockedApps: [{ id: "a1", profileId: "p1", displayName: "Discord", executable: "discord.exe", enabled: true }],
      allowedApps: [],
      blockedSites: [],
      schedules: [
        {
          id: "s1",
          profileId: "p1",
          label: "Work hours",
          days: [1],
          startTime: "09:00",
          endTime: "17:00",
          enabled: true
        }
      ],
      focusSessions: [],
      profileConditions: [],
      usageEvents: [],
      settings: {
        launchAtLogin: false,
        minimizeToTray: true,
        blockPagePort: 47831,
        helperPollSeconds: 5,
        emergencyOverrideMinutes: 10
      }
    };

    expect(getActiveRules(state, new Date("2026-05-04T10:00:00")).activeProfileNames).toEqual(["Work"]);
    expect(getActiveRules(state, new Date("2026-05-04T18:00:00")).activeProfileNames).toEqual([]);
  });

  it("activates a profile while an active focus session exists even if no schedule is active", () => {
    const state: AppState = {
      profiles: [
        {
          id: "p1",
          name: "Work",
          color: "#000",
          icon: "briefcase",
          enabled: true,
          appPolicy: "blocklist",
          strictMode: "off",
          createdAt: "2026-05-01T00:00:00.000Z"
        }
      ],
      blockedApps: [{ id: "a1", profileId: "p1", displayName: "Discord", executable: "discord.exe", enabled: true }],
      allowedApps: [],
      blockedSites: [],
      schedules: [
        {
          id: "s1",
          profileId: "p1",
          label: "Work hours",
          days: [1],
          startTime: "09:00",
          endTime: "17:00",
          enabled: true
        }
      ],
      focusSessions: [
        {
          id: "f1",
          profileId: "p1",
          startedAt: "2026-05-04T18:00:00.000Z",
          endsAt: "2026-05-04T19:00:00.000Z",
          active: true
        }
      ],
      profileConditions: [],
      usageEvents: [],
      settings: {
        launchAtLogin: false,
        minimizeToTray: true,
        blockPagePort: 47831,
        helperPollSeconds: 5,
        emergencyOverrideMinutes: 10
      }
    };

    expect(getActiveRules(state, new Date("2026-05-04T18:30:00")).activeProfileNames).toEqual(["Work"]);
  });

  it("keeps profile manually active when all schedules are disabled", () => {
    const state: AppState = {
      profiles: [
        {
          id: "p1",
          name: "Work",
          color: "#000",
          icon: "briefcase",
          enabled: true,
          appPolicy: "blocklist",
          strictMode: "off",
          createdAt: "2026-05-01T00:00:00.000Z"
        }
      ],
      blockedApps: [{ id: "a1", profileId: "p1", displayName: "Discord", executable: "discord.exe", enabled: true }],
      allowedApps: [],
      blockedSites: [],
      schedules: [
        {
          id: "s1",
          profileId: "p1",
          label: "Work hours",
          days: [1],
          startTime: "09:00",
          endTime: "17:00",
          enabled: false
        }
      ],
      focusSessions: [],
      profileConditions: [],
      usageEvents: [],
      settings: {
        launchAtLogin: false,
        minimizeToTray: true,
        blockPagePort: 47831,
        helperPollSeconds: 5,
        emergencyOverrideMinutes: 10
      }
    };

    expect(getActiveRules(state, new Date("2026-05-04T18:30:00")).activeProfileNames).toEqual(["Work"]);
  });

  it("returns enabled allowed apps for active allowlist profiles", () => {
    const state: AppState = {
      profiles: [
        {
          id: "p1",
          name: "Deep Work",
          color: "#000",
          icon: "target",
          enabled: true,
          appPolicy: "allowlist",
          strictMode: "off",
          createdAt: "2026-05-01T00:00:00.000Z"
        }
      ],
      blockedApps: [{ id: "a1", profileId: "p1", displayName: "Discord", executable: "discord.exe", enabled: true }],
      allowedApps: [
        { id: "aa1", profileId: "p1", displayName: "VS Code", executable: "code.exe", enabled: true },
        { id: "aa2", profileId: "p1", displayName: "Browser", executable: "browser.exe", enabled: false }
      ],
      blockedSites: [],
      schedules: [],
      focusSessions: [],
      profileConditions: [],
      usageEvents: [],
      settings: {
        launchAtLogin: false,
        minimizeToTray: true,
        blockPagePort: 47831,
        helperPollSeconds: 5,
        emergencyOverrideMinutes: 10
      }
    };

    const active = getActiveRules(state, new Date("2026-05-04T18:30:00"));
    expect(active.appPoliciesByProfileId).toEqual({ p1: "allowlist" });
    expect(active.allowedApps.map((app) => app.executable)).toEqual(["code.exe"]);
    expect(active.blockedApps.map((app) => app.executable)).toEqual(["discord.exe"]);
  });
});




