import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  AlertTriangle,
  AppWindow,
  BarChart3,
  CalendarClock,
  CheckCircle2,
  Clock3,
  Download,
  FolderOpen,
  Globe,
  LayoutGrid,
  Lock,
  Plus,
  Power,
  RefreshCcw,
  Settings,
  Shield,
  Trash2,
  X
} from "lucide-react";
import type {
  AllowedApp,
  AppPolicy,
  AppState,
  BlockedApp,
  BlockedSite,
  HelperStatus,
  Profile,
  Schedule,
  UsageEvent,
  UsageSummary,
  Weekday
} from "../shared/models";
import type { SelectedAppExecutable } from "../shared/ipc";
import { createId, isScheduleActive, isStrictLocked, normalizeDomain } from "../shared/rules";
import "./styles.css";

const weekdays: Array<{ value: Weekday; label: string }> = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 0, label: "Sun" }
];

type Confirmation = {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => Promise<void>;
};

type NewProfileDraft = {
  name: string;
  appPolicy: AppPolicy;
  conditionType: "manual" | "schedule" | "quick-block" | "usage-limit";
  scheduleLabel: string;
  scheduleDays: Weekday[];
  scheduleStart: string;
  scheduleEnd: string;
  quickBlockMinutes: number;
  usageLimitScope: "daily" | "hourly";
  usageLimitMinutes: number;
  step: 1 | 2 | 3 | 4 | 5;
};

type FocusSessionDraft = {
  mode: "duration" | "pomodoro";
  durationMinutes: number;
  focusMinutes: number;
  breakMinutes: number;
  rounds: number;
  allowedApps: SelectedAppExecutable[];
  wallpaperType: "default" | "solid";
  wallpaperValue: string;
  showPauseButton: boolean;
};

function App() {
  const [view, setView] = useState<"dashboard" | "settings">("dashboard");
  const [state, setState] = useState<AppState>();
  const [summary, setSummary] = useState<UsageSummary>();
  const [status, setStatus] = useState<HelperStatus>();
  const [selectedProfileId, setSelectedProfileId] = useState<string>();
  const [siteInput, setSiteInput] = useState("");
  const [appInput, setAppInput] = useState("");
  const [error, setError] = useState<string>();
  const [confirmation, setConfirmation] = useState<Confirmation>();
  const [runningApps, setRunningApps] = useState<SelectedAppExecutable[]>([]);
  const [showRunningApps, setShowRunningApps] = useState(false);
  const [newProfileDraft, setNewProfileDraft] = useState<NewProfileDraft>();
  const [showFocusSetup, setShowFocusSetup] = useState(false);
  const [focusSessionDraft, setFocusSessionDraft] = useState<FocusSessionDraft>({
    mode: "duration",
    durationMinutes: 45,
    focusMinutes: 25,
    breakMinutes: 5,
    rounds: 4,
    allowedApps: [],
    wallpaperType: "default",
    wallpaperValue: "#0f1724",
    showPauseButton: true
  });

  const selectedProfile = useMemo(
    () => state?.profiles.find((profile) => profile.id === selectedProfileId) ?? state?.profiles[0],
    [selectedProfileId, state?.profiles]
  );

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => void refreshLight(), 5000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!selectedProfileId && state?.profiles[0]) setSelectedProfileId(state.profiles[0].id);
  }, [selectedProfileId, state?.profiles]);

  async function refresh() {
    try {
      const [nextState, nextSummary, nextStatus] = await Promise.all([
        window.focusApi.getState(),
        window.focusApi.getUsageSummary(),
        window.focusApi.getHelperStatus()
      ]);
      setState(nextState);
      setSummary(nextSummary);
      setStatus(nextStatus);
      setError(undefined);
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : String(refreshError));
    }
  }

  async function refreshLight() {
    try {
      const [nextState, nextSummary, nextStatus] = await Promise.all([
        window.focusApi.getState(),
        window.focusApi.getUsageSummary(),
        window.focusApi.getHelperStatus()
      ]);
      setState(nextState);
      setSummary(nextSummary);
      setStatus(nextStatus);
    } catch {
      // Full refresh surfaces errors; periodic refresh stays quiet.
    }
  }

  async function saveProfile(profile: Profile) {
    setState(await window.focusApi.saveProfile(profile));
    await refreshLight();
  }

  async function addProfile() {
    if (!newProfileDraft) return;
    const profile: Profile = {
      id: createId("profile"),
      name: newProfileDraft.name.trim() || `Profile ${(state?.profiles.length ?? 0) + 1}`,
      color: "#0f766e",
      icon: "target",
      enabled: true,
      appPolicy: newProfileDraft.appPolicy,
      strictMode: "off",
      createdAt: new Date().toISOString()
    };
    await saveProfile(profile);
    setSelectedProfileId(profile.id);
    await window.focusApi.saveProfileCondition({
      id: createId("condition"),
      profileId: profile.id,
      type: newProfileDraft.conditionType,
      enabled: true,
      ...(newProfileDraft.conditionType === "quick-block"
        ? {
            startsAt: new Date().toISOString(),
            endsAt: new Date(Date.now() + newProfileDraft.quickBlockMinutes * 60_000).toISOString()
          }
        : {}),
      ...(newProfileDraft.conditionType === "usage-limit"
        ? {
            limitScope: newProfileDraft.usageLimitScope,
            limitMinutes: newProfileDraft.usageLimitMinutes
          }
        : {})
    });
    if (newProfileDraft.conditionType === "schedule") {
      await window.focusApi.saveSchedule({
        id: createId("schedule"),
        profileId: profile.id,
        label: newProfileDraft.scheduleLabel.trim() || "Focus schedule",
        days: newProfileDraft.scheduleDays,
        startTime: newProfileDraft.scheduleStart,
        endTime: newProfileDraft.scheduleEnd,
        enabled: true
      });
    } else if (newProfileDraft.conditionType === "quick-block") {
      await window.focusApi.startFocusSession(profile.id, newProfileDraft.quickBlockMinutes);
    }
    setNewProfileDraft(undefined);
    await refreshLight();
  }

  async function addSite() {
    if (!selectedProfile || !siteInput.trim()) return;
    const normalizedHost = normalizeDomain(siteInput);
    if (!normalizedHost) return;
    const site: BlockedSite = {
      id: createId("site"),
      profileId: selectedProfile.id,
      domain: normalizedHost,
      normalizedHost,
      includeSubdomains: true,
      enabled: true
    };
    setSiteInput("");
    setState(await window.focusApi.saveBlockedSite(site));
    await refreshLight();
  }

  async function addApp() {
    if (!selectedProfile || !appInput.trim()) return;
    const appRule = createAppRuleFromInput(selectedProfile.id, appInput);
    if (!appRule) return;
    setAppInput("");
    setState(
      selectedProfile.appPolicy === "allowlist"
        ? await window.focusApi.saveAllowedApp(appRule)
        : await window.focusApi.saveBlockedApp(appRule)
    );
    await refreshLight();
  }

  async function chooseApp() {
    if (!selectedProfile) return;
    const selectedApp = await window.focusApi.selectAppExecutable();
    if (!selectedApp) return;
    await addSelectedApp(selectedApp);
  }

  async function showRunningAppPicker() {
    try {
      setShowRunningApps(true);
      setRunningApps(await window.focusApi.listRunningApps());
      setError(undefined);
    } catch (runningAppsError) {
      setRunningApps([]);
      setError(runningAppsError instanceof Error ? runningAppsError.message : String(runningAppsError));
    }
  }

  async function addSelectedApp(selectedApp: SelectedAppExecutable) {
    if (!selectedProfile) return;
    const appRule = {
      id: createId("app"),
      profileId: selectedProfile.id,
      displayName: selectedApp.displayName,
      executable: selectedApp.executable,
      path: selectedApp.path,
      enabled: true
    };
    setState(
      selectedProfile.appPolicy === "allowlist"
        ? await window.focusApi.saveAllowedApp(appRule)
        : await window.focusApi.saveBlockedApp(appRule)
    );
    setShowRunningApps(false);
    await refreshLight();
  }

  function openProfileCreator() {
    setNewProfileDraft({
      name: `Profile ${(state?.profiles.length ?? 0) + 1}`,
      appPolicy: "blocklist",
      conditionType: "manual",
      scheduleLabel: "Weekday focus",
      scheduleDays: [1, 2, 3, 4, 5],
      scheduleStart: "09:00",
      scheduleEnd: "17:00",
      quickBlockMinutes: 60,
      usageLimitScope: "daily",
      usageLimitMinutes: 60,
      step: 1
    });
  }

  async function startConfiguredFocusSession() {
    if (!selectedProfile) return;
    const allowedApps: AllowedApp[] = focusSessionDraft.allowedApps.map((app) => ({
      id: createId("app"),
      profileId: selectedProfile.id,
      displayName: app.displayName,
      executable: app.executable,
      path: app.path,
      enabled: true
    }));
    setState(
      await window.focusApi.startFocusSession({
        profileId: selectedProfile.id,
        mode: focusSessionDraft.mode,
        durationMinutes: focusSessionDraft.durationMinutes,
        focusMinutes: focusSessionDraft.focusMinutes,
        breakMinutes: focusSessionDraft.breakMinutes,
        rounds: focusSessionDraft.rounds,
        allowedApps,
        wallpaperType: focusSessionDraft.wallpaperType,
        wallpaperValue: focusSessionDraft.wallpaperValue,
        showPauseButton: locked ? false : focusSessionDraft.showPauseButton,
        strict: locked
      })
    );
    setShowFocusSetup(false);
    await refreshLight();
  }

  function changeAppPolicy(appPolicy: AppPolicy) {
    if (!selectedProfile || selectedProfile.appPolicy === appPolicy || locked) return;
    if (appPolicy === "allowlist") {
      confirmAction({
        title: "Switch to allowlist mode?",
        message:
          "Only apps in this profile's allowed list will be usable during active focus time. Other foreground apps may be closed.",
        confirmLabel: "Switch mode",
        onConfirm: async () => {
          await saveProfile({ ...selectedProfile, appPolicy });
        }
      });
      return;
    }
    confirmAction({
      title: "Switch to blocklist mode?",
      message: "This profile will stop closing unlisted apps and will only close apps in its blocked list.",
      confirmLabel: "Switch mode",
      onConfirm: async () => {
        await saveProfile({ ...selectedProfile, appPolicy });
      }
    });
  }

  function confirmAction(confirmationRequest: Confirmation): void {
    setConfirmation(confirmationRequest);
  }

  async function runConfirmedAction() {
    if (!confirmation) return;
    const action = confirmation.onConfirm;
    setConfirmation(undefined);
    try {
      await action();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : String(actionError));
    }
  }

  function deleteProfile() {
    if (!selectedProfile || state?.profiles.length === 1 || locked) return;
    confirmAction({
      title: "Delete profile?",
      message: `This removes "${selectedProfile.name}" and every rule and schedule inside it.`,
      confirmLabel: "Delete profile",
      onConfirm: async () => {
        const nextState = await window.focusApi.deleteProfile(selectedProfile.id);
        setState(nextState);
        setSelectedProfileId(nextState.profiles[0]?.id);
        await refreshLight();
      }
    });
  }

  async function saveSettings(nextSettings: AppState["settings"]) {
    setState(await window.focusApi.saveSettings(nextSettings));
    await refreshLight();
  }

  function resetData() {
    confirmAction({
      title: "Reset all data?",
      message: "This deletes every profile, rule, schedule, focus session, and usage event stored by Focus.",
      confirmLabel: "Reset data",
      onConfirm: async () => {
        const nextState = await window.focusApi.deleteAllData();
        setState(nextState);
        setSelectedProfileId(nextState.profiles[0]?.id);
        await refreshLight();
      }
    });
  }

  async function addSchedule() {
    if (!selectedProfile) return;
    const schedule: Schedule = {
      id: createId("schedule"),
      profileId: selectedProfile.id,
      label: "New schedule",
      days: [1, 2, 3, 4, 5],
      startTime: "09:00",
      endTime: "17:00",
      enabled: true
    };
    setState(await window.focusApi.saveSchedule(schedule));
    await refreshLight();
  }

  if (!state || !summary || !selectedProfile) {
    return (
      <main className="loading">
        <Shield size={34} />
        <span>Loading Focus...</span>
      </main>
    );
  }

  const locked = isStrictLocked(selectedProfile.strictUntil);
  const profileApps =
    selectedProfile.appPolicy === "allowlist"
      ? state.allowedApps.filter((app) => app.profileId === selectedProfile.id)
      : state.blockedApps.filter((app) => app.profileId === selectedProfile.id);
  const profileSites = state.blockedSites.filter((site) => site.profileId === selectedProfile.id);
  const profileSchedules = state.schedules.filter((schedule) => schedule.profileId === selectedProfile.id);
  const profileSessions = state.focusSessions.filter((session) => session.profileId === selectedProfile.id && session.active);
  const activeReason = status?.activeRules.activationReasonsByProfileId?.[selectedProfile.id];
  const isProfileActiveNow = Boolean(status?.activeRules.activeProfileIds.includes(selectedProfile.id));
  const enabledScheduleCount = profileSchedules.filter((schedule) => schedule.enabled).length;

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <Shield size={22} />
          </div>
          <div>
            <h1>Focus</h1>
            <p>Desktop blocker</p>
          </div>
        </div>

        <div className="side-nav">
          <button className={`nav-button ${view === "dashboard" ? "active" : ""}`} onClick={() => setView("dashboard")}>
            <LayoutGrid size={16} />
            Dashboard
          </button>
          <button className={`nav-button ${view === "settings" ? "active" : ""}`} onClick={() => setView("settings")}>
            <Settings size={16} />
            Settings
          </button>
        </div>

        <div className="helper-card">
          <div className="helper-title">
            {status?.lastError ? <AlertTriangle size={18} /> : <CheckCircle2 size={18} />}
            Helper
          </div>
          <p>{status?.isElevated ? "Admin access available" : "Admin access needed for hosts blocking"}</p>
          <p>{status?.activeRules.activeProfileNames.join(", ") || "No active profile right now"}</p>
          {status && !status.isElevated && (
            <button
              className="primary wide"
              onClick={() => void window.focusApi.relaunchAsAdmin().catch((adminError) => setError(adminError instanceof Error ? adminError.message : String(adminError)))}
            >
              <Shield size={16} />
              Relaunch as admin
            </button>
          )}
          <button className="secondary wide" onClick={() => void window.focusApi.applyRules().then(setStatus)}>
            <RefreshCcw size={16} />
            Apply rules
          </button>
        </div>
      </aside>

      <section className="workspace">
        {view === "dashboard" && (
          <>
            <header className="topbar">
              <div>
                <p className="eyebrow">Active profile</p>
                <input
                  className="profile-name-input"
                  value={selectedProfile.name}
                  disabled={locked}
                  onChange={(event) => void saveProfile({ ...selectedProfile, name: event.target.value })}
                />
                <p className="profile-activation-state">
                  {isProfileActiveNow
                    ? `Blocking active now${activeReason ? ` (${formatActivationReason(activeReason)})` : ""}`
                    : "Blocking idle now"}
                  {" - "}
                  {selectedProfile.appPolicy === "allowlist" ? "Allowlist mode" : "Blocklist mode"}
                </p>
              </div>
              <div className="topbar-actions">
                <button
                  className={selectedProfile.enabled ? "primary" : "secondary"}
                  disabled={locked}
                  onClick={() => void saveProfile({ ...selectedProfile, enabled: !selectedProfile.enabled })}
                >
                  {selectedProfile.enabled ? "Enabled" : "Disabled"}
                </button>
                <button className="danger icon-only" disabled={locked || state.profiles.length === 1} onClick={() => void deleteProfile()} aria-label="Delete profile">
                  <Trash2 size={16} />
                </button>
                <button className="secondary" onClick={() => void window.focusApi.exportData().then(downloadText)}>
                  <Download size={16} />
                  Export
                </button>
              </div>
            </header>

            {error && <div className="error-banner">{error}</div>}
            {status?.lastError && (
              <div className="warning-banner">
                Website rules could not be written to the hosts file. Run the app as administrator to enforce all-browser
                site blocking.
              </div>
            )}
            <section className="metrics-grid">
              <Metric icon={<Clock3 size={20} />} label="Screen time today" value={formatSeconds(summary.totalSecondsToday)} />
              <Metric icon={<Shield size={20} />} label="Blocked attempts" value={String(summary.blockedAttemptsToday)} />
              <Metric icon={<Activity size={20} />} label="Active profiles" value={String(summary.activeProfiles.length)} />
              <Metric icon={<Globe size={20} />} label="Blocked sites now" value={String(status?.activeRules.sites.length ?? 0)} />
            </section>

            <section className="content-grid">
          <Panel title="Profiles" icon={<Shield size={18} />} className="span-2">
            <div className="topbar-actions">
              <button className="primary" onClick={openProfileCreator}>
                <Plus size={16} />
                Add profile
              </button>
            </div>
            <div className="profile-grid">
              {state.profiles.map((profile) => (
                <button
                  key={profile.id}
                  className={profile.id === selectedProfile.id ? "profile-card active" : "profile-card"}
                  onClick={() => setSelectedProfileId(profile.id)}
                >
                  <div className="profile-card-head">
                    <span className="profile-dot" style={{ background: profile.color }} />
                    <strong>{profile.name}</strong>
                    {isStrictLocked(profile.strictUntil) && <Lock size={14} />}
                  </div>
                  <p>{profile.appPolicy === "allowlist" ? "Allowlist mode" : "Blocklist mode"}</p>
                  <p>
                    {state.schedules.filter((schedule) => schedule.profileId === profile.id && schedule.enabled).length} active schedule(s)
                  </p>
                </button>
              ))}
            </div>
          </Panel>

          <Panel title="Focus Sessions" icon={<Clock3 size={18} />}>
            <button className="primary compact" onClick={() => setShowFocusSetup(true)}>
              <Clock3 size={16} />
              Start focus session
            </button>
            <div className="session-list">
              {profileSessions.map((session) => (
                <div className="session-row" key={session.id}>
                  <span>Ends {new Date(session.endsAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                  <button
                    className="danger icon-only"
                    onClick={() =>
                      confirmAction({
                        title: "End focus session?",
                        message: "Blocking tied to this manual focus session will stop immediately.",
                        confirmLabel: "End session",
                        onConfirm: async () => {
                          setState(await window.focusApi.endFocusSession(session.id));
                          await refreshLight();
                        }
                      })
                    }
                    aria-label="End session"
                  >
                    <Power size={15} />
                  </button>
                </div>
              ))}
              {profileSessions.length === 0 && <p className="muted">No active manual session.</p>}
            </div>
          </Panel>

          <Panel title="Strict Mode" icon={<Lock size={18} />}>
            <div className="strict-row">
              <div>
                <strong>{locked ? "Locked" : "Unlocked"}</strong>
                <p className="muted">
                  {locked ? `Changes resume ${new Date(selectedProfile.strictUntil ?? "").toLocaleString()}` : "Lock edits during a focus block."}
                </p>
              </div>
              <button
                className="primary"
                disabled={locked}
                onClick={() =>
                  void window.focusApi.lockProfile(selectedProfile.id, 60).then(async (nextState) => {
                    setState(nextState);
                    await refreshLight();
                  })
                }
              >
                Lock 1h
              </button>
            </div>
          </Panel>

          <Panel title="App Mode" icon={<Shield size={18} />}>
            <div className="mode-options">
              <button
                className={selectedProfile.appPolicy === "blocklist" ? "mode-card active" : "mode-card"}
                disabled={locked}
                onClick={() => changeAppPolicy("blocklist")}
              >
                <strong>Blocklist</strong>
                <span>Close only the apps you select.</span>
              </button>
              <button
                className={selectedProfile.appPolicy === "allowlist" ? "mode-card active" : "mode-card"}
                disabled={locked}
                onClick={() => changeAppPolicy("allowlist")}
              >
                <strong>Allowlist</strong>
                <span>Allow selected apps. Close other foreground apps.</span>
              </button>
            </div>
          </Panel>

          <Panel title="Website Blocking" icon={<Globe size={18} />} className="span-2">
            <div className="entry-row">
              <input
                value={siteInput}
                disabled={locked}
                placeholder="youtube.com"
                onChange={(event) => setSiteInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void addSite();
                }}
              />
              <button className="primary" disabled={locked} onClick={() => void addSite()}>
                <Plus size={16} />
                Site
              </button>
            </div>
            <RuleTable
              empty="No blocked websites yet."
              rows={profileSites.map((site) => ({
                id: site.id,
                main: site.normalizedHost,
                meta: site.includeSubdomains ? "Includes www subdomain" : "Exact host only",
                enabled: site.enabled,
                onToggle: () =>
                  void window.focusApi.saveBlockedSite({ ...site, enabled: !site.enabled }).then(async (nextState) => {
                    setState(nextState);
                    await refreshLight();
                  }),
                onDelete: () =>
                  confirmAction({
                    title: "Delete website rule?",
                    message: `Remove "${site.normalizedHost}" from website blocking.`,
                    confirmLabel: "Delete rule",
                    onConfirm: async () => {
                      setState(await window.focusApi.deleteBlockedSite(site.id));
                      await refreshLight();
                    }
                  })
              }))}
              locked={locked}
            />
          </Panel>

          <Panel
            title={selectedProfile.appPolicy === "allowlist" ? "Allowed Apps" : "Blocked Apps"}
            icon={<AppWindow size={18} />}
            className="span-2"
          >
            <p className="muted">
              {selectedProfile.appPolicy === "allowlist"
                ? "During active focus time, only these foreground apps are allowed. Background activity is not targeted."
                : "During active focus time, these foreground apps are closed when detected."}
            </p>
            <div className="entry-row">
              <input
                value={appInput}
                disabled={locked}
                placeholder={selectedProfile.appPolicy === "allowlist" ? "code.exe" : "discord.exe"}
                onChange={(event) => setAppInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void addApp();
                }}
              />
              <button className="primary" disabled={locked} onClick={() => void addApp()}>
                <Plus size={16} />
                App
              </button>
              <button className="secondary icon-only" disabled={locked} onClick={() => void chooseApp()} aria-label="Choose app">
                <FolderOpen size={16} />
              </button>
              <button className="secondary" disabled={locked} onClick={() => void showRunningAppPicker()}>
                <AppWindow size={16} />
                Running apps
              </button>
            </div>
            {showRunningApps && (
              <div className="running-app-list">
                <div className="running-app-list-header">
                  <strong>Running apps</strong>
                  <button className="secondary icon-only" onClick={() => setShowRunningApps(false)} aria-label="Close running apps list">
                    <X size={16} />
                  </button>
                </div>
                {runningApps.map((runningApp) => (
                  <button
                    className="running-app-row"
                    key={`${runningApp.executable}-${runningApp.path ?? runningApp.displayName}`}
                    onClick={() => void addSelectedApp(runningApp)}
                  >
                    <strong>{runningApp.displayName}</strong>
                    <span>{runningApp.executable}</span>
                    <small>{runningApp.path || runningApp.title || "Path unavailable"}</small>
                  </button>
                ))}
                {runningApps.length === 0 && <p className="empty">No visible running apps found.</p>}
              </div>
            )}
            <RuleTable
              empty={selectedProfile.appPolicy === "allowlist" ? "No allowed apps yet." : "No blocked apps yet."}
              rows={profileApps.map((appRule) => ({
                id: appRule.id,
                main: appRule.displayName,
                meta: appRule.executable,
                enabled: appRule.enabled,
                onToggle: () =>
                  void (selectedProfile.appPolicy === "allowlist"
                    ? window.focusApi.saveAllowedApp({ ...appRule, enabled: !appRule.enabled })
                    : window.focusApi.saveBlockedApp({ ...appRule, enabled: !appRule.enabled })
                  ).then(async (nextState) => {
                      setState(nextState);
                      await refreshLight();
                    }),
                onDelete: () =>
                  confirmAction({
                    title: "Delete app rule?",
                    message: `Remove "${appRule.displayName}" from ${
                      selectedProfile.appPolicy === "allowlist" ? "allowed apps" : "app blocking"
                    }.`,
                    confirmLabel: "Delete rule",
                    onConfirm: async () => {
                      setState(
                        selectedProfile.appPolicy === "allowlist"
                          ? await window.focusApi.deleteAllowedApp(appRule.id)
                          : await window.focusApi.deleteBlockedApp(appRule.id)
                      );
                      await refreshLight();
                    }
                  })
              }))}
              locked={locked}
            />
          </Panel>

          <Panel title="Schedules" icon={<CalendarClock size={18} />} className="span-2">
            <p className="muted">
              {enabledScheduleCount > 0
                ? `${enabledScheduleCount} enabled schedule${enabledScheduleCount > 1 ? "s" : ""}. Blocking turns on only during schedule windows or active focus sessions.`
                : "No enabled schedules. This profile stays active whenever it is enabled unless you disable the profile."}
            </p>
            <button className="secondary compact" disabled={locked} onClick={() => void addSchedule()}>
              <Plus size={16} />
              Schedule
            </button>
            <div className="schedule-list">
              {profileSchedules.map((schedule) => (
                <ScheduleEditor
                  key={schedule.id}
                  schedule={schedule}
                  isActiveNow={isScheduleActive(schedule)}
                  locked={locked}
                  onSave={(next) =>
                    void window.focusApi.saveSchedule(next).then(async (nextState) => {
                      setState(nextState);
                      await refreshLight();
                    })
                  }
                  onDelete={() =>
                    confirmAction({
                      title: "Delete schedule?",
                      message: `Remove the "${schedule.label}" schedule.`,
                      confirmLabel: "Delete schedule",
                      onConfirm: async () => {
                        setState(await window.focusApi.deleteSchedule(schedule.id));
                        await refreshLight();
                      }
                    })
                  }
                />
              ))}
              {profileSchedules.length === 0 && <p className="empty">No schedules yet.</p>}
            </div>
          </Panel>

          <Panel title="Usage Statistics" icon={<BarChart3 size={18} />}>
            <div className="bar-list">
              {summary.topApps.map((app) => (
                <div key={app.name} className="bar-row">
                  <span>{app.name}</span>
                  <strong>{formatSeconds(app.seconds)}</strong>
                </div>
              ))}
              {summary.topApps.length === 0 && <p className="empty">Usage appears here after foreground app activity.</p>}
            </div>
          </Panel>

          <Panel title="Activity Timeline" icon={<Activity size={18} />} className="span-2">
            <Timeline events={state.usageEvents.slice(0, 12)} />
          </Panel>

            </section>
          </>
        )}

        {view === "settings" && (
          <>
            <header className="topbar">
              <div>
                <p className="eyebrow">Preferences</p>
                <h1 className="page-title">Settings</h1>
              </div>
              <div className="topbar-actions">
                <button className="secondary" onClick={() => setView("dashboard")}>
                  <LayoutGrid size={16} />
                  Dashboard
                </button>
              </div>
            </header>
            {error && <div className="error-banner">{error}</div>}
            <section className="content-grid">
              <Panel title="Settings" icon={<Settings size={18} />} className="span-2">
                <div className="settings-grid">
                  <label className="check-row">
                    <input
                      type="checkbox"
                      checked={state.settings.minimizeToTray}
                      onChange={(event) => void saveSettings({ ...state.settings, minimizeToTray: event.target.checked })}
                    />
                    Minimize to tray
                  </label>
                  <label className="check-row">
                    <input
                      type="checkbox"
                      checked={state.settings.launchAtLogin}
                      onChange={(event) => void saveSettings({ ...state.settings, launchAtLogin: event.target.checked })}
                    />
                    Launch at login
                  </label>
                  <label>
                    Poll seconds
                    <input
                      type="number"
                      min={1}
                      max={60}
                      value={state.settings.helperPollSeconds}
                      onChange={(event) => void saveSettings({ ...state.settings, helperPollSeconds: Number(event.target.value) })}
                    />
                  </label>
                  <label>
                    Block page port
                    <input
                      type="number"
                      min={1024}
                      max={65535}
                      value={state.settings.blockPagePort}
                      onChange={(event) => void saveSettings({ ...state.settings, blockPagePort: Number(event.target.value) })}
                    />
                  </label>
                </div>
                <div className="settings-actions">
                  <button className="secondary" onClick={() => setView("dashboard")}>
                    Back to dashboard
                  </button>
                  <button className="danger" onClick={() => resetData()}>
                    <Trash2 size={16} />
                    Reset data
                  </button>
                </div>
              </Panel>
            </section>
          </>
        )}
      </section>
      {confirmation && (
        <ConfirmationDialog
          title={confirmation.title}
          message={confirmation.message}
          confirmLabel={confirmation.confirmLabel}
          onCancel={() => setConfirmation(undefined)}
          onConfirm={() => void runConfirmedAction()}
        />
      )}
      {newProfileDraft && (
        <CreateProfileWizard
          draft={newProfileDraft}
          onChange={setNewProfileDraft}
          onCancel={() => setNewProfileDraft(undefined)}
          onCreate={() => void addProfile()}
        />
      )}
      {showFocusSetup && (
        <FocusSessionSetupDialog
          draft={focusSessionDraft}
          strictLocked={locked}
          onChange={setFocusSessionDraft}
          onCancel={() => setShowFocusSetup(false)}
          onStart={() => void startConfiguredFocusSession()}
          onPickRunningApps={() => void showRunningAppPicker()}
          runningApps={runningApps}
        />
      )}
    </main>
  );
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="metric">
      <div>{icon}</div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Panel({
  title,
  icon,
  children,
  className = ""
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel ${className}`}>
      <header>
        <div>
          {icon}
          <h2>{title}</h2>
        </div>
      </header>
      {children}
    </section>
  );
}

function ConfirmationDialog({
  title,
  message,
  confirmLabel,
  onCancel,
  onConfirm
}: {
  title: string;
  message: string;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="confirm-backdrop" role="presentation">
      <section className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
        <div className="confirm-icon">
          <AlertTriangle size={22} />
        </div>
        <div>
          <h2 id="confirm-title">{title}</h2>
          <p>{message}</p>
        </div>
        <div className="confirm-actions">
          <button className="secondary" onClick={onCancel}>
            Cancel
          </button>
          <button className="danger" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}

function CreateProfileWizard({
  draft,
  onChange,
  onCancel,
  onCreate
}: {
  draft: NewProfileDraft;
  onChange: (draft: NewProfileDraft) => void;
  onCancel: () => void;
  onCreate: () => void;
}) {
  return (
    <div className="confirm-backdrop" role="presentation">
      <section className="confirm-dialog profile-dialog" role="dialog" aria-modal="true" aria-labelledby="profile-create-title">
        <div>
          <p className="eyebrow">New profile</p>
          <h2 id="profile-create-title">Create profile (Step {draft.step}/5)</h2>
        </div>
        {draft.step === 1 && (
          <label>
            Profile name
            <input value={draft.name} onChange={(event) => onChange({ ...draft, name: event.target.value })} />
          </label>
        )}
        {draft.step === 2 && (
          <div className="mode-options">
            <button
              className={draft.appPolicy === "blocklist" ? "mode-card active" : "mode-card"}
              onClick={() => onChange({ ...draft, appPolicy: "blocklist" })}
            >
              <strong>Blocklist</strong>
              <span>Close only the apps you add to the blocked list.</span>
            </button>
            <button
              className={draft.appPolicy === "allowlist" ? "mode-card active" : "mode-card"}
              onClick={() => onChange({ ...draft, appPolicy: "allowlist" })}
            >
              <strong>Allowlist</strong>
              <span>Allow selected apps and close other foreground apps.</span>
            </button>
          </div>
        )}
        {draft.step === 3 && (
          <div className="mode-options">
            {(["manual", "schedule", "quick-block", "usage-limit"] as const).map((condition) => (
              <button
                key={condition}
                className={draft.conditionType === condition ? "mode-card active" : "mode-card"}
                onClick={() => onChange({ ...draft, conditionType: condition })}
              >
                <strong>{condition.replace("-", " ")}</strong>
              </button>
            ))}
          </div>
        )}
        {draft.step === 4 && (
          <div className="settings-grid">
            {draft.conditionType === "schedule" && (
              <>
                <label>
                  Schedule label
                  <input value={draft.scheduleLabel} onChange={(event) => onChange({ ...draft, scheduleLabel: event.target.value })} />
                </label>
                <label>
                  Start
                  <input type="time" value={draft.scheduleStart} onChange={(event) => onChange({ ...draft, scheduleStart: event.target.value })} />
                </label>
                <label>
                  End
                  <input type="time" value={draft.scheduleEnd} onChange={(event) => onChange({ ...draft, scheduleEnd: event.target.value })} />
                </label>
              </>
            )}
            {draft.conditionType === "quick-block" && (
              <label>
                Quick block minutes
                <input
                  type="number"
                  min={5}
                  max={720}
                  value={draft.quickBlockMinutes}
                  onChange={(event) => onChange({ ...draft, quickBlockMinutes: Number(event.target.value) || 60 })}
                />
              </label>
            )}
            {draft.conditionType === "usage-limit" && (
              <>
                <label>
                  Limit scope
                  <select value={draft.usageLimitScope} onChange={(event) => onChange({ ...draft, usageLimitScope: event.target.value as "daily" | "hourly" })}>
                    <option value="daily">Daily</option>
                    <option value="hourly">Hourly</option>
                  </select>
                </label>
                <label>
                  Limit minutes
                  <input
                    type="number"
                    min={5}
                    max={240}
                    value={draft.usageLimitMinutes}
                    onChange={(event) => onChange({ ...draft, usageLimitMinutes: Number(event.target.value) || 60 })}
                  />
                </label>
              </>
            )}
          </div>
        )}
        {draft.step === 5 && (
          <div className="muted">
            <p>Name: {draft.name || "Untitled profile"}</p>
            <p>Mode: {draft.appPolicy}</p>
            <p>Condition: {draft.conditionType}</p>
          </div>
        )}
        <div className="confirm-actions">
          <button className="secondary" onClick={onCancel}>
            Cancel
          </button>
          {draft.step > 1 && (
            <button className="secondary" onClick={() => onChange({ ...draft, step: (draft.step - 1) as NewProfileDraft["step"] })}>
              Back
            </button>
          )}
          {draft.step < 5 ? (
            <button className="primary" onClick={() => onChange({ ...draft, step: (draft.step + 1) as NewProfileDraft["step"] })}>
              Next
            </button>
          ) : (
            <button className="primary" onClick={onCreate}>
              Create profile
            </button>
          )}
        </div>
      </section>
    </div>
  );
}

function RuleTable({
  rows,
  empty,
  locked
}: {
  rows: Array<{ id: string; main: string; meta: string; enabled: boolean; onToggle: () => void; onDelete: () => void }>;
  empty: string;
  locked: boolean;
}) {
  if (rows.length === 0) return <p className="empty">{empty}</p>;
  return (
    <div className="rule-table">
      {rows.map((row) => (
        <div className="rule-row" key={row.id}>
          <div>
            <strong>{row.main}</strong>
            <span>{row.meta}</span>
          </div>
          <button className={row.enabled ? "toggle on" : "toggle"} disabled={locked} onClick={row.onToggle}>
            {row.enabled ? "On" : "Off"}
          </button>
          <button className="danger icon-only" disabled={locked} onClick={row.onDelete} aria-label="Delete rule">
            <Trash2 size={16} />
          </button>
        </div>
      ))}
    </div>
  );
}

function FocusSessionSetupDialog({
  draft,
  strictLocked,
  runningApps,
  onChange,
  onCancel,
  onStart,
  onPickRunningApps
}: {
  draft: FocusSessionDraft;
  strictLocked: boolean;
  runningApps: SelectedAppExecutable[];
  onChange: (draft: FocusSessionDraft) => void;
  onCancel: () => void;
  onStart: () => void;
  onPickRunningApps: () => void;
}) {
  function toggleAllowedApp(app: SelectedAppExecutable) {
    const exists = draft.allowedApps.some((item) => item.executable === app.executable && item.path === app.path);
    onChange({
      ...draft,
      allowedApps: exists
        ? draft.allowedApps.filter((item) => !(item.executable === app.executable && item.path === app.path))
        : [...draft.allowedApps, app]
    });
  }

  return (
    <div className="confirm-backdrop" role="presentation">
      <section className="confirm-dialog profile-dialog" role="dialog" aria-modal="true" aria-labelledby="focus-session-title">
        <div>
          <p className="eyebrow">Focus session</p>
          <h2 id="focus-session-title">Create session</h2>
        </div>
        <div className="mode-options">
          <button className={draft.mode === "duration" ? "mode-card active" : "mode-card"} onClick={() => onChange({ ...draft, mode: "duration" })}>
            <strong>Duration</strong>
          </button>
          <button className={draft.mode === "pomodoro" ? "mode-card active" : "mode-card"} onClick={() => onChange({ ...draft, mode: "pomodoro" })}>
            <strong>Pomodoro</strong>
          </button>
        </div>
        <div className="settings-grid">
          {draft.mode === "duration" ? (
            <label>
              Duration (minutes)
              <input
                type="number"
                min={5}
                max={720}
                value={draft.durationMinutes}
                onChange={(event) => onChange({ ...draft, durationMinutes: Number(event.target.value) || 45 })}
              />
            </label>
          ) : (
            <>
              <label>
                Focus (minutes)
                <input
                  type="number"
                  min={5}
                  max={120}
                  value={draft.focusMinutes}
                  onChange={(event) => onChange({ ...draft, focusMinutes: Number(event.target.value) || 25 })}
                />
              </label>
              <label>
                Break (minutes)
                <input
                  type="number"
                  min={1}
                  max={30}
                  value={draft.breakMinutes}
                  onChange={(event) => onChange({ ...draft, breakMinutes: Number(event.target.value) || 5 })}
                />
              </label>
              <label>
                Rounds
                <input
                  type="number"
                  min={1}
                  max={12}
                  value={draft.rounds}
                  onChange={(event) => onChange({ ...draft, rounds: Number(event.target.value) || 4 })}
                />
              </label>
            </>
          )}
          <label className="check-row">
            <input
              type="checkbox"
              checked={strictLocked ? false : draft.showPauseButton}
              disabled={strictLocked}
              onChange={(event) => onChange({ ...draft, showPauseButton: event.target.checked })}
            />
            Show pause button
          </label>
          <label>
            Wallpaper
            <select
              value={draft.wallpaperType}
              onChange={(event) =>
                onChange({
                  ...draft,
                  wallpaperType: event.target.value as "default" | "solid"
                })
              }
            >
              <option value="default">Default</option>
              <option value="solid">Solid color</option>
            </select>
          </label>
          {draft.wallpaperType === "solid" && (
            <label>
              Color
              <input
                type="color"
                value={draft.wallpaperValue}
                onChange={(event) => onChange({ ...draft, wallpaperValue: event.target.value })}
              />
            </label>
          )}
        </div>
        <div>
          <div className="topbar-actions">
            <button className="secondary" onClick={onPickRunningApps}>
              <AppWindow size={16} />
              Load running apps
            </button>
          </div>
          {runningApps.length > 0 && (
            <div className="running-app-list">
              {runningApps.map((runningApp) => {
                const selected = draft.allowedApps.some(
                  (item) => item.executable === runningApp.executable && item.path === runningApp.path
                );
                return (
                  <button
                    className={selected ? "running-app-row mode-card active" : "running-app-row"}
                    key={`${runningApp.executable}-${runningApp.path ?? runningApp.displayName}`}
                    onClick={() => toggleAllowedApp(runningApp)}
                  >
                    <strong>{runningApp.displayName}</strong>
                    <span>{runningApp.executable}</span>
                    <small>{runningApp.path || runningApp.title || "Path unavailable"}</small>
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <p className="muted">
          Allowed apps selected: {draft.allowedApps.length}. {draft.allowedApps.length === 0 ? "Only the focus screen will remain usable." : ""}
        </p>
        <div className="confirm-actions">
          <button className="secondary" onClick={onCancel}>
            Cancel
          </button>
          <button className="primary" onClick={onStart}>
            Start session
          </button>
        </div>
      </section>
    </div>
  );
}

function ScheduleEditor({
  schedule,
  isActiveNow,
  locked,
  onSave,
  onDelete
}: {
  schedule: Schedule;
  isActiveNow: boolean;
  locked: boolean;
  onSave: (schedule: Schedule) => void;
  onDelete: () => void;
}) {
  function toggleDay(day: Weekday) {
    const days = schedule.days.includes(day)
      ? schedule.days.filter((item) => item !== day)
      : [...schedule.days, day].sort();
    onSave({ ...schedule, days });
  }

  return (
    <div className="schedule-editor">
      <input
        value={schedule.label}
        disabled={locked}
        onChange={(event) => onSave({ ...schedule, label: event.target.value })}
      />
      <p className="muted">
        {schedule.enabled ? (isActiveNow ? "Active right now" : "Not active right now") : "Schedule is turned off"}
      </p>
      <div className="time-row">
        <input
          type="time"
          value={schedule.startTime}
          disabled={locked}
          onChange={(event) => onSave({ ...schedule, startTime: event.target.value })}
        />
        <span>to</span>
        <input
          type="time"
          value={schedule.endTime}
          disabled={locked}
          onChange={(event) => onSave({ ...schedule, endTime: event.target.value })}
        />
        <button className={schedule.enabled ? "toggle on" : "toggle"} disabled={locked} onClick={() => onSave({ ...schedule, enabled: !schedule.enabled })}>
          {schedule.enabled ? "On" : "Off"}
        </button>
        <button className="danger icon-only" disabled={locked} onClick={onDelete} aria-label="Delete schedule">
          <Trash2 size={16} />
        </button>
      </div>
      <div className="weekday-row">
        {weekdays.map((day) => (
          <button
            key={day.value}
            className={schedule.days.includes(day.value) ? "day active" : "day"}
            disabled={locked}
            onClick={() => toggleDay(day.value)}
          >
            {day.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Timeline({ events }: { events: UsageEvent[] }) {
  if (events.length === 0) return <p className="empty">No activity recorded yet.</p>;
  return (
    <div className="timeline">
      {events.map((event) => (
        <div className="timeline-row" key={event.id}>
          <span className="timeline-dot" />
          <div>
            <strong>{event.target}</strong>
            <p>{event.type.replace(/-/g, " ")} {event.detail ? `- ${event.detail}` : ""}</p>
          </div>
          <time>{new Date(event.startedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time>
        </div>
      ))}
    </div>
  );
}

function formatSeconds(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function createAppRuleFromInput(profileId: string, input: string): BlockedApp | AllowedApp | undefined {
  const trimmed = input.trim();
  if (!trimmed) return undefined;
  const fileName = trimmed.split(/[\\/]/).pop()?.trim() || trimmed;
  const executable = fileName.toLowerCase().endsWith(".exe") ? fileName.toLowerCase() : `${fileName.toLowerCase()}.exe`;
  const displayName = fileName.replace(/\.exe$/i, "").trim() || executable.replace(/\.exe$/i, "");

  return {
    id: createId("app"),
    profileId,
    displayName,
    executable,
    path: trimmed.includes("\\") || trimmed.includes("/") ? trimmed : undefined,
    enabled: true
  };
}

function downloadText(value: string): void {
  const blob = new Blob([value], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "focus-export.json";
  anchor.click();
  URL.revokeObjectURL(url);
}

function formatActivationReason(reason: "manual" | "schedule" | "focus-session"): string {
  if (reason === "manual") return "manual";
  if (reason === "schedule") return "schedule";
  return "focus session";
}

createRoot(document.getElementById("root")!).render(<App />);
