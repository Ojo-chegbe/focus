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
          strictMode: "off",
          createdAt: "2026-05-01T00:00:00.000Z"
        }
      ],
      blockedApps: [
        { id: "a1", profileId: "p1", displayName: "Discord", executable: "discord.exe", enabled: true }
      ],
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
      blockedKeywords: [],
      schedules: [],
      focusSessions: [],
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
          strictMode: "off",
          createdAt: "2026-05-01T00:00:00.000Z"
        }
      ],
      blockedApps: [{ id: "a1", profileId: "p1", displayName: "Discord", executable: "discord.exe", enabled: true }],
      blockedSites: [],
      blockedKeywords: [],
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
});
