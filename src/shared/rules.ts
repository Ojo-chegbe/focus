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
  if (!schedule?.enabled) return false;
  if (!Array.isArray(schedule.days) || schedule.days.length === 0) return false;
  if (typeof schedule.startTime !== "string" || typeof schedule.endTime !== "string") return false;
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
  const activationReasonsByProfileId: Record<string, "manual" | "schedule" | "focus-session"> = {};

  const activeProfiles = state.profiles.filter((profile) => {
    if (!profile.enabled) return false;
    const profileSchedules = state.schedules.filter((schedule) => schedule.profileId === profile.id && schedule.enabled);
    const hasActiveSchedule = profileSchedules.some((schedule) => isScheduleActive(schedule, now));
    const profileSessions = state.focusSessions.filter((session) => session.profileId === profile.id && session.active);
    const hasActiveSession = profileSessions.some((session) => new Date(session.endsAt).getTime() > now.getTime());
    const hasAutomation = profileSchedules.length > 0 || profileSessions.length > 0;

    // Profiles with no schedule/session remain manually active when enabled.
    if (!hasAutomation) {
      activationReasonsByProfileId[profile.id] = "manual";
      return true;
    }
    if (hasActiveSession) {
      activationReasonsByProfileId[profile.id] = "focus-session";
      return true;
    }
    if (hasActiveSchedule) {
      activationReasonsByProfileId[profile.id] = "schedule";
      return true;
    }
    return false;
  });
  const activeProfileIds = activeProfiles.map((profile) => profile.id);
  const activeProfileSet = new Set(activeProfileIds);
  const appPoliciesByProfileId = Object.fromEntries(
    activeProfiles.map((profile) => [profile.id, profile.appPolicy ?? "blocklist"])
  );
  const blockedApps = state.blockedApps.filter((app) => app.enabled && activeProfileSet.has(app.profileId));

  return {
    activeProfileIds,
    activeProfileNames: activeProfiles.map((profile) => profile.name),
    activationReasonsByProfileId,
    appPoliciesByProfileId,
    blockedApps,
    allowedApps: state.allowedApps.filter((app) => app.enabled && activeProfileSet.has(app.profileId)),
    apps: blockedApps,
    sites: state.blockedSites.filter((site) => site.enabled && activeProfileSet.has(site.profileId))
  };
}

export function parseClock(value: string): number {
  if (typeof value !== "string") return 0;
  const [hours, minutes] = value.split(":").map(Number);
  const normalizedHours = Number.isFinite(hours) ? hours : 0;
  const normalizedMinutes = Number.isFinite(minutes) ? minutes : 0;
  return Math.min(23, Math.max(0, normalizedHours)) * 60 + Math.min(59, Math.max(0, normalizedMinutes));
}
