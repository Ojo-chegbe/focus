import type { ActiveRules, AppState, Schedule, Weekday } from "./models";

export function normalizeDomain(input: string): string {
  let value = input.trim().toLowerCase();
  value = value.replace(/^https?:\/\//, "");
  value = value.replace(/^www\./, "");
  value = value.split("/")[0] ?? value;
  value = value.split(":")[0] ?? value;
  return value.replace(/[^a-z0-9.-]/g, "");
}

export function createId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function isStrictLocked(strictUntil?: string, now = new Date()): boolean {
  return Boolean(strictUntil && new Date(strictUntil).getTime() > now.getTime());
}

export function isScheduleActive(schedule: Schedule, now = new Date()): boolean {
  if (!schedule.enabled) return false;
  const currentDay = now.getDay() as Weekday;
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const start = parseClock(schedule.startTime);
  const end = parseClock(schedule.endTime);

  if (start === end) return schedule.days.includes(currentDay);
  if (start < end) {
    return schedule.days.includes(currentDay) && currentMinutes >= start && currentMinutes < end;
  }

  const previousDay = ((currentDay + 6) % 7) as Weekday;
  return (
    (schedule.days.includes(currentDay) && currentMinutes >= start) ||
    (schedule.days.includes(previousDay) && currentMinutes < end)
  );
}

export function getActiveRules(state: AppState, now = new Date()): ActiveRules {
  const activeProfiles = state.profiles.filter((profile) => profile.enabled);
  const activeProfileIds = activeProfiles.map((profile) => profile.id);
  const activeProfileSet = new Set(activeProfileIds);

  return {
    activeProfileIds,
    activeProfileNames: activeProfiles.map((profile) => profile.name),
    apps: state.blockedApps.filter((app) => app.enabled && activeProfileSet.has(app.profileId)),
    sites: state.blockedSites.filter((site) => site.enabled && activeProfileSet.has(site.profileId)),
    keywords: state.blockedKeywords.filter((keyword) => keyword.enabled && activeProfileSet.has(keyword.profileId))
  };
}

export function parseClock(value: string): number {
  const [hours, minutes] = value.split(":").map(Number);
  return (hours || 0) * 60 + (minutes || 0);
}
