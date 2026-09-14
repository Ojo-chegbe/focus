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
  Weekday,
  FocusSessionPreset
} from "../shared/models";
import type { SelectedAppExecutable, UpdateStatus } from "../shared/ipc";
import { createId, isScheduleActive, isStrictLocked, normalizeDomain } from "../shared/rules";
import { UninstallPuzzle } from "./UninstallPuzzle";
import focusIcon from "./assets/icon.png";
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

const STRICT_PRESETS = [
  { label: "15m", value: 15 },
  { label: "1h", value: 60 },
  { label: "2h", value: 120 },
  { label: "4h", value: 240 },
  { label: "8h", value: 480 },
  { label: "24h", value: 1440 }
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
  apps: SelectedAppExecutable[];
  appInput: string;
};

type FocusSessionDraft = {
  mode: "duration" | "pomodoro";
  durationMinutes: number;
  focusMinutes: number;
  breakMinutes: number;
  rounds: number;
  allowedApps: SelectedAppExecutable[];
  wallpaperType: "default" | "solid" | "custom";
  wallpaperValue: string;
  showPauseButton: boolean;
  presetName: string;
};

const SidebarIcon = ({ size = 20 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M4.16699 5.83331H15.8337" stroke="currentColor" strokeLinecap="round" />
    <path d="M4.16699 10H15.8337" stroke="currentColor" strokeLinecap="round" />
    <path d="M4.16699 14.1667H15.8337" stroke="currentColor" strokeLinecap="round" />
  </svg>
);

const BreakButton = ({ profile, onTakeBreak }: { profile: Profile; onTakeBreak: () => void }) => {
  const [nowMs, setNowMs] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  
  const breakActive = Boolean(profile.breakUntil && new Date(profile.breakUntil).getTime() > nowMs);
  const cooldownActive = Boolean(profile.lastBreakAt && nowMs - new Date(profile.lastBreakAt).getTime() < 60 * 60_000);
  
  const formatTime = (ms: number) => {
    const totalSeconds = Math.floor(Math.max(0, ms) / 1000);
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };
  
  let label = "Take 5m Break";
  if (breakActive) {
    const remaining = new Date(profile.breakUntil!).getTime() - nowMs;
    label = `Break: ${formatTime(remaining)}`;
  } else if (cooldownActive) {
    const remaining = new Date(profile.lastBreakAt!).getTime() + 60 * 60_000 - nowMs;
    label = `Cooldown: ${formatTime(remaining)}`;
  }
  
  return (
    <button className="secondary" disabled={breakActive || cooldownActive} onClick={onTakeBreak}>
      {label}
    </button>
  );
};

function App() {
  const [view, setView] = useState<"dashboard" | "settings" | "uninstall">(
    () => new URLSearchParams(window.location.search).has("uninstall") ? "uninstall" : "dashboard"
  );
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
  const [toast, setToast] = useState<string>();
  const [limitPrompt, setLimitPrompt] = useState<{ targetName: string; defaultMinutes?: number; defaultScope?: "daily" | "hourly"; onSave: (minutes?: number, scope?: "daily" | "hourly") => void }>();
  const [strictLockMinutes, setStrictLockMinutes] = useState(60);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
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
    showPauseButton: true,
    presetName: ""
  });
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>();
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);

  const selectedProfile = useMemo(
    () => state?.profiles.find((profile) => profile.id === selectedProfileId) ?? state?.profiles[0],
    [selectedProfileId, state?.profiles]
  );

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => void refreshLight(), 5000);
    window.focusApi.getUpdateStatus().then(setUpdateStatus).catch(() => undefined);
    const unsubscribe = window.focusApi.onUpdateStatus((nextStatus) => {
      setUpdateStatus(nextStatus);
      if (nextStatus.state !== "checking") {
        setIsCheckingUpdate(false);
      }
    });
    return () => {
      window.clearInterval(interval);
      unsubscribe();
    };
  }, []);

  const checkForUpdates = async () => {
    setIsCheckingUpdate(true);
    try {
      const res = await window.focusApi.checkForUpdates();
      setUpdateStatus(res);
    } catch (err) {
      setToast(err instanceof Error ? err.message : String(err));
    } finally {
      setIsCheckingUpdate(false);
    }
  };

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
    // Save apps added during profile creation
    for (const app of newProfileDraft.apps) {
      const appRule = {
        id: createId("app"),
        profileId: profile.id,
        displayName: app.displayName,
        executable: app.executable,
        path: app.path,
        enabled: true
      };
      setState(
        newProfileDraft.appPolicy === "allowlist"
          ? await window.focusApi.saveAllowedApp(appRule)
          : await window.focusApi.saveBlockedApp(appRule)
      );
    }
    setNewProfileDraft(undefined);
    setRunningApps([]);
    setToast(`"${profile.name}" created successfully`);
    setTimeout(() => setToast(undefined), 3000);
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
      name: "",
      appPolicy: "blocklist",
      conditionType: "manual",
      scheduleLabel: "Weekday focus",
      scheduleDays: [1, 2, 3, 4, 5],
      scheduleStart: "09:00",
      scheduleEnd: "17:00",
      quickBlockMinutes: 60,
      usageLimitScope: "daily",
      usageLimitMinutes: 60,
      apps: [],
      appInput: ""
    });
  }

  async function startConfiguredFocusSession() {
    if (!selectedProfile) return;
    try {
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
      setError(undefined);
    } catch (sessionError) {
      setError(sessionError instanceof Error ? sessionError.message : String(sessionError));
    }
  }

  async function saveCurrentSessionPreset() {
    if (!selectedProfile) return;
    const allowedApps: AllowedApp[] = focusSessionDraft.allowedApps.map((app) => ({
      id: createId("app"),
      profileId: selectedProfile.id,
      displayName: app.displayName,
      executable: app.executable,
      path: app.path,
      enabled: true
    }));
    const preset: FocusSessionPreset = {
      id: createId("preset"),
      name: focusSessionDraft.presetName.trim() || `Preset ${new Date().toLocaleTimeString()}`,
      profileId: selectedProfile.id,
      mode: focusSessionDraft.mode,
      durationMinutes: focusSessionDraft.durationMinutes,
      focusMinutes: focusSessionDraft.focusMinutes,
      breakMinutes: focusSessionDraft.breakMinutes,
      rounds: focusSessionDraft.rounds,
      allowedApps,
      wallpaperType: focusSessionDraft.wallpaperType,
      wallpaperValue: focusSessionDraft.wallpaperValue,
      showPauseButton: focusSessionDraft.showPauseButton,
      createdAt: new Date().toISOString()
    };
    setState(await window.focusApi.saveFocusSessionPreset(preset));
    setToast(`Preset "${preset.name}" saved`);
    setTimeout(() => setToast(undefined), 2500);
    await refreshLight();
  }

  function applyPresetToDraft(preset: FocusSessionPreset) {
    setFocusSessionDraft({
      mode: preset.mode,
      durationMinutes: preset.durationMinutes ?? 45,
      focusMinutes: preset.focusMinutes ?? 25,
      breakMinutes: preset.breakMinutes ?? 5,
      rounds: preset.rounds ?? 4,
      allowedApps: preset.allowedApps.map((app) => ({
        displayName: app.displayName,
        executable: app.executable,
        path: app.path
      })),
      wallpaperType: preset.wallpaperType,
      wallpaperValue: preset.wallpaperValue,
      showPauseButton: preset.showPauseButton,
      presetName: preset.name
    });
  }

  async function pickCustomWallpaper() {
    try {
      const selected = await window.focusApi.selectWallpaperImage();
      if (!selected) return;
      setFocusSessionDraft((prev) => ({
        ...prev,
        wallpaperType: "custom",
        wallpaperValue: selected
      }));
    } catch (wallpaperError) {
      setError(wallpaperError instanceof Error ? wallpaperError.message : String(wallpaperError));
    }
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

  if (view === "uninstall") {
    return <UninstallPuzzle />;
  }

  if (!state || !summary || !selectedProfile) {
    return (
      <main className="loading">
        <Shield size={28} />
        <span>Starting Focus…</span>
      </main>
    );
  }

  const locked = isStrictLocked(selectedProfile.strictUntil);
  const nowMs = Date.now();
  const breakActive = Boolean(selectedProfile.breakUntil && new Date(selectedProfile.breakUntil).getTime() > nowMs);
  const cooldownActive = Boolean(selectedProfile.lastBreakAt && nowMs - new Date(selectedProfile.lastBreakAt).getTime() < 60 * 60_000);
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
    <main className={sidebarCollapsed ? "app-shell sidebar-collapsed" : "app-shell"}>
      <aside className={sidebarCollapsed ? "sidebar collapsed" : "sidebar"}>
        <div className="brand">
          <div className="brand-mark">
            <img src={focusIcon} alt="Focus Logo" />
          </div>
          <div className="brand-copy">
            <h1>Focus</h1>
            <p>Stay on track</p>
          </div>
          <button
            className="secondary icon-only sidebar-toggle"
            onClick={() => setSidebarCollapsed((value) => !value)}
            aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            <SidebarIcon size={18} />
          </button>
        </div>

        <div className="side-nav">
          <button className={`nav-button ${view === "dashboard" ? "active" : ""}`} onClick={() => setView("dashboard")}>
            <LayoutGrid size={16} />
            <span>Dashboard</span>
          </button>
          <button className={`nav-button ${view === "settings" ? "active" : ""}`} onClick={() => setView("settings")}>
            <Settings size={16} />
            <span>Settings</span>
            {updateStatus?.state === "downloaded" && <span className="nav-badge">Update</span>}
          </button>
        </div>

        <div className="helper-card">
          <div className="helper-title">
            {status?.lastError ? <AlertTriangle size={18} /> : <CheckCircle2 size={18} />}
            System Status
          </div>
          <p>{status?.isElevated ? "System-level blocking active" : "Grant admin access to block websites"}</p>
          <p>
            {status?.activeRules.activeProfileNames.length 
              ? `Active: ${status.activeRules.activeProfileNames.join(", ")}` 
              : "Everything’s quiet right now"}
          </p>
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
            Sync rules
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
                    ? `Active${activeReason ? ` · ${formatActivationReason(activeReason)}` : ""}`
                    : "Idle"}
                  {" · "}
                  {selectedProfile.appPolicy === "allowlist" ? "Allowlist" : "Blocklist"}
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
          <Panel title="Focus Analytics" icon={<BarChart3 size={18} />} className="span-2">
            <div className="focus-heatmap">
              {summary.weeklyFocusStats?.map((seconds, index) => {
                const maxSeconds = Math.max(...(summary.weeklyFocusStats || []), 3600); // at least 1 hour scale
                const heightPercent = Math.max(5, Math.round((seconds / maxSeconds) * 100));
                
                // Get day label
                const date = new Date();
                date.setDate(date.getDate() - (6 - index));
                const dayLabel = index === 6 ? "Today" : date.toLocaleDateString(undefined, { weekday: "short" });

                return (
                  <div className="focus-heatmap-col" key={index} title={formatSeconds(seconds)}>
                    <div className="focus-heatmap-bar" style={{ height: `${heightPercent}%` }} />
                    <span className="focus-heatmap-label">{dayLabel}</span>
                  </div>
                );
              })}
            </div>
            {(!summary.weeklyFocusStats || summary.weeklyFocusStats.every(s => s === 0)) && (
               <p className="empty" style={{ textAlign: "center", marginTop: "10px" }}>No focus data yet for this week.</p>
            )}
          </Panel>

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
              {profileSessions.length === 0 && <p className="muted">Start a session to begin blocking.</p>}
            </div>
          </Panel>

          <Panel title="Strict Mode" icon={<Lock size={18} />}>
            <div className="strict-container">
              <div className="strict-header">
                <div>
                  <strong>{locked ? "Locked" : "Unlocked"}</strong>
                  <p className="muted">
                    {locked ? `Changes resume ${new Date(selectedProfile.strictUntil ?? "").toLocaleString()}` : "Lock edits during a focus block. Choose a duration to prevent changes to this profile."}
                  </p>
                </div>
              </div>

              {!locked && (
                <div className="strict-body">
                  <div className="strict-presets">
                    {STRICT_PRESETS.map((p) => (
                      <button
                        key={p.value}
                        className={`preset-btn ${strictLockMinutes === p.value ? "active" : ""}`}
                        onClick={() => setStrictLockMinutes(p.value)}
                        disabled={locked}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                  <div className="strict-custom-row">
                    <span className="muted">Custom:</span>
                    <div className="strict-custom-input">
                      <input
                        type="number"
                        min={0}
                        value={Math.floor(strictLockMinutes / 60).toString()}
                        disabled={locked}
                        onChange={(e) => {
                          const h = Math.max(0, Number(e.target.value) || 0);
                          const m = strictLockMinutes % 60;
                          setStrictLockMinutes(Math.max(1, h * 60 + m));
                        }}
                      />
                      <span>h</span>
                      <input
                        type="number"
                        min={0}
                        max={59}
                        value={(strictLockMinutes % 60).toString()}
                        disabled={locked}
                        onChange={(e) => {
                          let m = Number(e.target.value) || 0;
                          if (m > 59) m = 59;
                          if (m < 0) m = 0;
                          const h = Math.floor(strictLockMinutes / 60);
                          setStrictLockMinutes(Math.max(1, h * 60 + m));
                        }}
                      />
                      <span>m</span>
                    </div>
                  </div>
                </div>
              )}

              <div className="strict-footer" style={{ gap: "10px" }}>
                {locked && (
                  <BreakButton
                    profile={selectedProfile}
                    onTakeBreak={() => {
                      void window.focusApi.takeBreak(selectedProfile.id).then(async (nextState) => {
                        setState(nextState);
                        await refreshLight();
                      });
                    }}
                  />
                )}
                <button
                  className="primary lock-btn"
                  disabled={locked || strictLockMinutes <= 0}
                  onClick={() =>
                    void window.focusApi.lockProfile(selectedProfile.id, strictLockMinutes).then(async (nextState) => {
                      setState(nextState);
                      await refreshLight();
                    })
                  }
                >
                  <Lock size={14} style={{ marginRight: 6 }} />
                  {locked ? "Locked" : `Lock for ${strictLockMinutes >= 60 ? `${Math.floor(strictLockMinutes / 60)}h ${strictLockMinutes % 60 > 0 ? `${strictLockMinutes % 60}m` : ''}`.trim() : `${strictLockMinutes}m`}`}
                </button>
              </div>
            </div>
          </Panel>

          <Panel title="App Mode" icon={<Shield size={18} />}>
            <p className="muted">
              This profile uses <strong>{selectedProfile.appPolicy === "allowlist" ? "Allowlist" : "Blocklist"}</strong> mode.
              App mode is fixed after profile creation.
            </p>
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
                disabledUntil: site.disabledUntil,
                cooldownUntil: site.cooldownUntil,
                limitMinutes: site.limitMinutes,
                limitScope: site.limitScope,
                onSetLimit: locked ? undefined : () => {
                  setLimitPrompt({
                    targetName: site.normalizedHost,
                    defaultMinutes: site.limitMinutes,
                    defaultScope: site.limitScope,
                    onSave: (minutes, scope) => {
                      void window.focusApi.saveBlockedSite({ ...site, limitMinutes: minutes, limitScope: scope }).then(async (nextState) => {
                        setState(nextState);
                        await refreshLight();
                      });
                    }
                  });
                },
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
              onLockedToggle={({ main, cooldownUntil }) => {
                if (!cooldownUntil) return;
                const remainingMs = Math.max(0, new Date(cooldownUntil).getTime() - Date.now());
                const minutes = Math.floor(remainingMs / 60000);
                const seconds = Math.floor((remainingMs % 60000) / 1000);
                setToast(`${main} can be turned off again in ${minutes}:${seconds.toString().padStart(2, "0")}`);
                setTimeout(() => setToast(undefined), 2500);
              }}
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
                disabledUntil: appRule.disabledUntil,
                cooldownUntil: appRule.cooldownUntil,
                limitMinutes: appRule.limitMinutes,
                limitScope: appRule.limitScope,
                onSetLimit: locked ? undefined : () => {
                  setLimitPrompt({
                    targetName: appRule.displayName,
                    defaultMinutes: appRule.limitMinutes,
                    defaultScope: appRule.limitScope,
                    onSave: (minutes, scope) => {
                      void (selectedProfile.appPolicy === "allowlist"
                        ? window.focusApi.saveAllowedApp({ ...appRule, limitMinutes: minutes, limitScope: scope })
                        : window.focusApi.saveBlockedApp({ ...appRule, limitMinutes: minutes, limitScope: scope })
                      ).then(async (nextState) => {
                        setState(nextState);
                        await refreshLight();
                      });
                    }
                  });
                },
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
              onLockedToggle={({ main, cooldownUntil }) => {
                if (!cooldownUntil) return;
                const remainingMs = Math.max(0, new Date(cooldownUntil).getTime() - Date.now());
                const minutes = Math.floor(remainingMs / 60000);
                const seconds = Math.floor((remainingMs % 60000) / 1000);
                setToast(`${main} can be turned off again in ${minutes}:${seconds.toString().padStart(2, "0")}`);
                setTimeout(() => setToast(undefined), 2500);
              }}
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
              {profileSchedules.length === 0 && <p className="empty">Add a schedule to automate your focus blocks.</p>}
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
              {summary.topApps.length === 0 && <p className="empty">App usage will appear here as you work.</p>}
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
                    <div style={{ marginBottom: "6px" }}>
                      <div>Blocker check frequency (seconds)</div>
                      <div className="muted" style={{ fontSize: "12px", fontWeight: "normal", marginTop: "2px" }}>How often the app checks for running blocked apps.</div>
                    </div>
                    <input
                      type="number"
                      min={1}
                      max={60}
                      value={state.settings.helperPollSeconds}
                      onChange={(event) => void saveSettings({ ...state.settings, helperPollSeconds: Number(event.target.value) })}
                    />
                  </label>
                  <label>
                    <div style={{ marginBottom: "6px" }}>
                      <div>Local server port</div>
                      <div className="muted" style={{ fontSize: "12px", fontWeight: "normal", marginTop: "2px" }}>The port used to host the "Site Blocked" page in your browser.</div>
                    </div>
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

              <Panel title="App Updates" icon={<RefreshCcw size={18} />} className="span-2">
                <div className="update-panel-content">
                  <div className="update-info-row">
                    <div>
                      <strong>Current Version:</strong> v{updateStatus?.currentVersion || "0.1.0"}
                    </div>
                    {updateStatus?.version && (
                      <div>
                        <strong>Latest Available:</strong> v{updateStatus.version}
                      </div>
                    )}
                  </div>
                  <div className="update-status-row">
                    {updateStatus?.state === "checking" && <span>Checking GitHub Releases for updates...</span>}
                    {updateStatus?.state === "available" && (
                      <span className="text-warn">Update v{updateStatus.version} available. Downloading in background...</span>
                    )}
                    {updateStatus?.state === "downloading" && (
                      <div className="download-progress-container">
                        <span>Downloading update: {updateStatus.progress ?? 0}%</span>
                        <div className="progress-bar-bg">
                          <div className="progress-bar-fill" style={{ width: `${updateStatus.progress ?? 0}%` }} />
                        </div>
                      </div>
                    )}
                    {updateStatus?.state === "downloaded" && (
                      <div className="update-ready-box">
                        <span className="text-success">
                          Update v{updateStatus.version} is downloaded and ready to install!
                        </span>
                        <button
                          className="primary"
                          onClick={() => void window.focusApi.quitAndInstallUpdate()}
                        >
                          Restart & Install Update
                        </button>
                      </div>
                    )}
                    {updateStatus?.state === "not-available" && (
                      <span className="text-muted">You are running the latest version of Focus.</span>
                    )}
                    {updateStatus?.state === "error" && (
                      <span className="text-danger">
                        {updateStatus.error?.includes("404")
                          ? "GitHub repository or release not found (404). Please ensure the repository 'Ojo-chegbe/focus' is set to Public and has a published release."
                          : updateStatus.error || "Failed to check for updates."}
                      </span>
                    )}
                    {(!updateStatus || updateStatus.state === "idle") && (
                      <span className="text-muted">Automatic updates are enabled via GitHub Releases.</span>
                    )}
                  </div>
                  <div className="settings-actions">
                    <button
                      className="secondary"
                      disabled={isCheckingUpdate || updateStatus?.state === "downloading"}
                      onClick={() => void checkForUpdates()}
                    >
                      <RefreshCcw size={16} className={isCheckingUpdate ? "spin" : ""} />
                      {isCheckingUpdate ? "Checking..." : "Check for updates"}
                    </button>
                  </div>
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
      {limitPrompt && (
        <LimitPromptDialog
          targetName={limitPrompt.targetName}
          defaultMinutes={limitPrompt.defaultMinutes}
          defaultScope={limitPrompt.defaultScope}
          onCancel={() => setLimitPrompt(undefined)}
          onSave={(minutes, scope) => {
            limitPrompt.onSave(minutes, scope);
            setLimitPrompt(undefined);
          }}
        />
      )}
      {newProfileDraft && (
        <CreateProfileWizard
          draft={newProfileDraft}
          onChange={setNewProfileDraft}
          onCancel={() => setNewProfileDraft(undefined)}
          onCreate={() => void addProfile()}
          onPickRunningApps={() => void showRunningAppPicker()}
          onCloseRunningApps={() => setRunningApps([])}
          runningApps={runningApps}
        />
      )}
      {showFocusSetup && (
        <FocusSessionSetupDialog
          draft={focusSessionDraft}
          strictLocked={locked}
          presets={state.focusSessionPresets.filter((preset) => preset.profileId === selectedProfile.id)}
          onChange={setFocusSessionDraft}
          onCancel={() => setShowFocusSetup(false)}
          onStart={() => void startConfiguredFocusSession()}
          onSavePreset={() => void saveCurrentSessionPreset()}
          onApplyPreset={applyPresetToDraft}
          onDeletePreset={(id) =>
            void window.focusApi.deleteFocusSessionPreset(id).then(async (nextState) => {
              setState(nextState);
              await refreshLight();
            })
          }
          onPickCustomWallpaper={() => void pickCustomWallpaper()}
          onPickRunningApps={() => void showRunningAppPicker()}
          onCloseRunningApps={() => setRunningApps([])}
          runningApps={runningApps}
        />
      )}
      {toast && (
        <div className="toast">
          <CheckCircle2 size={16} />
          {toast}
        </div>
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

function LimitPromptDialog({
  targetName,
  defaultMinutes,
  defaultScope = "daily",
  onCancel,
  onSave
}: {
  targetName: string;
  defaultMinutes?: number;
  defaultScope?: "daily" | "hourly";
  onCancel: () => void;
  onSave: (minutes?: number, scope?: "daily" | "hourly") => void;
}) {
  const [minutes, setMinutes] = useState(defaultMinutes?.toString() || "");
  const [scope, setScope] = useState<"daily" | "hourly">(defaultScope);

  const presets = [
    { label: "15m", value: 15 },
    { label: "30m", value: 30 },
    { label: "1h", value: 60 },
    { label: "2h", value: 120 }
  ];

  return (
    <div className="confirm-backdrop" role="presentation">
      <section className="confirm-dialog limit-dialog" role="dialog" aria-modal="true">
        <div>
          <h2 style={{ marginBottom: "4px" }}>Set Usage Limit</h2>
          <p style={{ color: "var(--text-tertiary)", fontSize: "13px", marginBottom: "16px" }}>Limit time on <strong>{targetName}</strong>.</p>
          
          <div className="segmented-control" style={{ marginBottom: "16px", display: "flex", background: "var(--surface-sunken)", padding: "4px", borderRadius: "8px" }}>
            <button 
              className={scope === "daily" ? "segment active" : "segment"} 
              style={{ flex: 1, padding: "6px", border: "none", background: scope === "daily" ? "var(--surface)" : "transparent", borderRadius: "6px", boxShadow: scope === "daily" ? "var(--shadow-sm)" : "none", fontWeight: 600, fontSize: "13px" }}
              onClick={() => setScope("daily")}
            >
              Daily
            </button>
            <button 
              className={scope === "hourly" ? "segment active" : "segment"} 
              style={{ flex: 1, padding: "6px", border: "none", background: scope === "hourly" ? "var(--surface)" : "transparent", borderRadius: "6px", boxShadow: scope === "hourly" ? "var(--shadow-sm)" : "none", fontWeight: 600, fontSize: "13px" }}
              onClick={() => setScope("hourly")}
            >
              Hourly
            </button>
          </div>

          <div style={{ display: "flex", gap: "8px", marginBottom: "16px" }}>
            {presets.map(p => (
              <button 
                key={p.label} 
                className="secondary" 
                style={{ flex: 1, padding: "6px 0", fontSize: "13px" }}
                onClick={() => setMinutes(p.value.toString())}
              >
                {p.label}
              </button>
            ))}
          </div>

          <input 
            type="number" 
            min={1}
            value={minutes} 
            onChange={(e) => setMinutes(e.target.value)} 
            autoFocus 
            placeholder="Custom limit (minutes)"
            className="prompt-input"
            style={{ marginTop: 0 }}
            onKeyDown={(e) => { 
              if (e.key === "Enter") {
                const parsed = parseInt(minutes, 10);
                onSave(isNaN(parsed) ? undefined : parsed, scope);
              }
            }}
          />
        </div>
        <div className="confirm-actions" style={{ marginTop: "20px" }}>
          <button className="secondary" onClick={() => onSave(undefined, undefined)} style={{ marginRight: "auto", color: "var(--danger)" }}>
            Remove limit
          </button>
          <button className="secondary" onClick={onCancel}>Cancel</button>
          <button className="primary" onClick={() => {
            const parsed = parseInt(minutes, 10);
            onSave(isNaN(parsed) ? undefined : parsed, scope);
          }}>
            Save
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
  onCreate,
  onPickRunningApps,
  onCloseRunningApps,
  runningApps
}: {
  draft: NewProfileDraft;
  onChange: (draft: NewProfileDraft) => void;
  onCancel: () => void;
  onCreate: () => void;
  onPickRunningApps: () => void;
  onCloseRunningApps: () => void;
  runningApps: SelectedAppExecutable[];
}) {
  function addAppFromInput() {
    const trimmed = draft.appInput.trim();
    if (!trimmed) return;
    const fileName = trimmed.split(/[\\/]/).pop()?.trim() || trimmed;
    const executable = fileName.toLowerCase().endsWith(".exe") ? fileName.toLowerCase() : `${fileName.toLowerCase()}.exe`;
    const displayName = fileName.replace(/\.exe$/i, "").trim() || executable.replace(/\.exe$/i, "");
    const app: SelectedAppExecutable = {
      displayName,
      executable,
      path: trimmed.includes("\\") || trimmed.includes("/") ? trimmed : undefined
    };
    if (!draft.apps.some((a) => a.executable === app.executable)) {
      onChange({ ...draft, apps: [...draft.apps, app], appInput: "" });
    } else {
      onChange({ ...draft, appInput: "" });
    }
  }

  function toggleApp(app: SelectedAppExecutable) {
    const exists = draft.apps.some((a) => a.executable === app.executable && a.path === app.path);
    onChange({
      ...draft,
      apps: exists
        ? draft.apps.filter((a) => !(a.executable === app.executable && a.path === app.path))
        : [...draft.apps, app]
    });
  }

  function removeApp(app: SelectedAppExecutable) {
    onChange({ ...draft, apps: draft.apps.filter((a) => a.executable !== app.executable) });
  }
  const conditionOptions = [
    { value: "manual" as const, label: "Manual", desc: "Toggle on and off yourself" },
    { value: "schedule" as const, label: "Schedule", desc: "Runs on set days and times" },
    { value: "quick-block" as const, label: "Quick block", desc: "Block for a set duration" },
    { value: "usage-limit" as const, label: "Usage limit", desc: "Cap your daily or hourly use" }
  ];

  return (
    <div className="confirm-backdrop" role="presentation">
      <section className="confirm-dialog focus-dialog" role="dialog" aria-modal="true" aria-labelledby="profile-create-title">
        <div className="focus-dialog-header">
          <div>
            <p className="eyebrow">New profile</p>
            <h2 id="profile-create-title">Create profile</h2>
          </div>
          <button className="secondary icon-only" onClick={onCancel} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className="focus-form">
          <label className="focus-field">
            <span>Profile name</span>
            <input
              value={draft.name}
              placeholder="e.g. Deep work, Study time"
              autoFocus
              onChange={(event) => onChange({ ...draft, name: event.target.value })}
            />
          </label>
        </div>

        <div className="profile-condition-section">
          <span className="focus-apps-label">Activation</span>
          <div className="profile-condition-grid">
            {conditionOptions.map((opt) => (
              <button
                key={opt.value}
                className={`profile-condition-card ${draft.conditionType === opt.value ? "active" : ""}`}
                onClick={() => onChange({ ...draft, conditionType: opt.value })}
              >
                <strong>{opt.label}</strong>
                <span>{opt.desc}</span>
              </button>
            ))}
          </div>

          {draft.conditionType === "schedule" && (
            <div className="profile-condition-details">
              <label className="focus-field">
                <span>Label</span>
                <input value={draft.scheduleLabel} onChange={(event) => onChange({ ...draft, scheduleLabel: event.target.value })} />
              </label>
              <div className="focus-field">
                <span>Days</span>
                <div className="weekday-row">
                  {weekdays.map((day) => (
                    <button
                      key={day.value}
                      className={draft.scheduleDays.includes(day.value) ? "day active" : "day"}
                      onClick={() => {
                        const days = draft.scheduleDays.includes(day.value)
                          ? draft.scheduleDays.filter((d) => d !== day.value)
                          : [...draft.scheduleDays, day.value].sort();
                        onChange({ ...draft, scheduleDays: days });
                      }}
                    >
                      {day.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="focus-field-row">
                <label className="focus-field">
                  <span>Start</span>
                  <input type="time" value={draft.scheduleStart} onChange={(event) => onChange({ ...draft, scheduleStart: event.target.value })} />
                </label>
                <label className="focus-field">
                  <span>End</span>
                  <input type="time" value={draft.scheduleEnd} onChange={(event) => onChange({ ...draft, scheduleEnd: event.target.value })} />
                </label>
              </div>
            </div>
          )}

          {draft.conditionType === "quick-block" && (
            <div className="profile-condition-details">
              <label className="focus-field">
                <span>Duration</span>
                <div className="focus-input-row">
                  <input
                    type="number"
                    min={5}
                    max={720}
                    value={draft.quickBlockMinutes}
                    onChange={(event) => onChange({ ...draft, quickBlockMinutes: Number(event.target.value) || 60 })}
                  />
                  <span className="focus-unit">min</span>
                </div>
              </label>
            </div>
          )}

          {draft.conditionType === "usage-limit" && (
            <div className="profile-condition-details">
              <div className="focus-field-row">
                <label className="focus-field">
                  <span>Scope</span>
                  <select value={draft.usageLimitScope} onChange={(event) => onChange({ ...draft, usageLimitScope: event.target.value as "daily" | "hourly" })}>
                    <option value="daily">Daily</option>
                    <option value="hourly">Hourly</option>
                  </select>
                </label>
                <label className="focus-field">
                  <span>Limit</span>
                  <div className="focus-input-row">
                    <input
                      type="number"
                      min={5}
                      max={240}
                      value={draft.usageLimitMinutes}
                      onChange={(event) => onChange({ ...draft, usageLimitMinutes: Number(event.target.value) || 60 })}
                    />
                    <span className="focus-unit">min</span>
                  </div>
                </label>
              </div>
            </div>
          )}
        </div>

        <div className="focus-form">
          <div className="focus-field">
            <span>App mode</span>
            <div className="focus-mode-toggle">
              <button
                className={`focus-mode-btn ${draft.appPolicy === "blocklist" ? "active" : ""}`}
                onClick={() => onChange({ ...draft, appPolicy: "blocklist" })}
              >
                <Shield size={14} />
                Blocklist
              </button>
              <button
                className={`focus-mode-btn ${draft.appPolicy === "allowlist" ? "active" : ""}`}
                onClick={() => onChange({ ...draft, appPolicy: "allowlist" })}
              >
                <CheckCircle2 size={14} />
                Allowlist
              </button>
            </div>
            <span className="profile-mode-hint">
              {draft.appPolicy === "blocklist"
                ? "Only apps you add will be closed."
                : "Only apps you add will be allowed — everything else closes."}
            </span>
          </div>
        </div>

        <div className="focus-apps-section">
          <div className="focus-apps-header">
            <span className="focus-apps-label">
              {draft.appPolicy === "blocklist" ? "Blocked apps" : "Allowed apps"} · {draft.apps.length} added
            </span>
            <button className="secondary" onClick={onPickRunningApps}>
              <AppWindow size={14} />
              Running apps
            </button>
          </div>
          <div className="entry-row">
            <input
              value={draft.appInput}
              placeholder={draft.appPolicy === "blocklist" ? "e.g. discord.exe" : "e.g. code.exe"}
              onChange={(event) => onChange({ ...draft, appInput: event.target.value })}
              onKeyDown={(event) => { if (event.key === "Enter") addAppFromInput(); }}
            />
            <button className="primary" onClick={addAppFromInput}>
              <Plus size={14} />
              Add
            </button>
          </div>
          {runningApps.length > 0 && (
            <div className="running-app-list">
              <div className="running-app-list-header">
                <strong>Running apps</strong>
                <button className="secondary icon-only" onClick={onCloseRunningApps} aria-label="Close running apps">
                  <X size={14} />
                </button>
              </div>
              {runningApps.map((runningApp) => {
                const selected = draft.apps.some((a) => a.executable === runningApp.executable && a.path === runningApp.path);
                return (
                  <button
                    className={`running-app-row ${selected ? "selected" : ""}`}
                    key={`${runningApp.executable}-${runningApp.path ?? runningApp.displayName}`}
                    onClick={() => toggleApp(runningApp)}
                  >
                    <strong>{runningApp.displayName}</strong>
                    <span>{runningApp.executable}</span>
                    <small>{runningApp.path || runningApp.title || ""}</small>
                  </button>
                );
              })}
            </div>
          )}
          {draft.apps.length > 0 && (
            <div className="profile-app-chips">
              {draft.apps.map((app) => (
                <span className="profile-app-chip" key={app.executable}>
                  {app.displayName}
                  <button className="chip-remove" onClick={() => removeApp(app)} aria-label={`Remove ${app.displayName}`}>
                    <X size={12} />
                  </button>
                </span>
              ))}
            </div>
          )}
          {draft.apps.length === 0 && runningApps.length === 0 && (
            <p className="focus-apps-hint">
              {draft.appPolicy === "blocklist"
                ? "Type an app name or pick from running apps to block."
                : "Add apps you want to keep available during focus."}
            </p>
          )}
        </div>

        <div className="confirm-actions">
          <button className="secondary" onClick={onCancel}>
            Cancel
          </button>
          <button className="primary" onClick={onCreate}>
            Create profile
          </button>
        </div>
      </section>
    </div>
  );
}

function Countdown({ until }: { until: string }) {
  const [timeLeft, setTimeLeft] = useState(() => Math.max(0, new Date(until).getTime() - Date.now()));

  useEffect(() => {
    const interval = setInterval(() => {
      setTimeLeft(Math.max(0, new Date(until).getTime() - Date.now()));
    }, 1000);
    return () => clearInterval(interval);
  }, [until]);

  if (timeLeft <= 0) return null;
  const minutes = Math.floor(timeLeft / 60000);
  const seconds = Math.floor((timeLeft % 60000) / 1000);
  return <>{minutes}:{seconds.toString().padStart(2, "0")}</>;
}

function RuleTable({
  rows,
  empty,
  locked,
  onLockedToggle
}: {
  rows: Array<{
    id: string;
    main: string;
    meta: string;
    enabled: boolean;
    disabledUntil?: string;
    cooldownUntil?: string;
    limitMinutes?: number;
    limitScope?: "daily" | "hourly";
    onToggle: () => void;
    onDelete: () => void;
    onSetLimit?: () => void;
  }>;
  empty: string;
  locked: boolean;
  onLockedToggle?: (row: { main: string; cooldownUntil?: string }) => void;
}) {
  if (rows.length === 0) return <p className="empty">{empty}</p>;
  return (
    <div className="rule-table">
      {rows.map((row) => (
        <div className="rule-row" key={row.id}>
          {(() => {
            const cooldownLocked =
              row.enabled && typeof row.cooldownUntil === "string" && new Date(row.cooldownUntil).getTime() > Date.now();
            return (
              <>
          <div>
            <strong>{row.main}</strong>
            <span>{row.meta}</span>
          </div>
          <div className="rule-toggles">
            {row.onSetLimit && (
              <button 
                className="secondary" 
                style={{ padding: "4px 8px", fontSize: "0.8em", marginRight: "8px" }} 
                onClick={row.onSetLimit}
              >
                {row.limitMinutes ? `${row.limitMinutes}m ${row.limitScope || "daily"}` : "Set limit"}
              </button>
            )}
            {!row.enabled && row.disabledUntil && (
              <span className="countdown-text">
                <Countdown until={row.disabledUntil} />
              </span>
            )}
            {row.enabled &&
              cooldownLocked && (
                <span className="countdown-text lock">
                  Lock <Countdown until={row.cooldownUntil!} />
                </span>
              )}
            <button
              className={row.enabled ? "toggle on" : "toggle"}
              disabled={locked}
              onClick={() => {
                if (cooldownLocked) {
                  onLockedToggle?.({ main: row.main, cooldownUntil: row.cooldownUntil });
                  return;
                }
                row.onToggle();
              }}
            >
              {row.enabled ? "On" : "Off"}
            </button>
          </div>
          <button className="danger icon-only" disabled={locked} onClick={row.onDelete} aria-label="Delete rule">
            <Trash2 size={16} />
          </button>
              </>
            );
          })()}
        </div>
      ))}
    </div>
  );
}

function FocusSessionSetupDialog({
  draft,
  strictLocked,
  presets,
  runningApps,
  onChange,
  onCancel,
  onStart,
  onSavePreset,
  onApplyPreset,
  onDeletePreset,
  onPickCustomWallpaper,
  onPickRunningApps,
  onCloseRunningApps
}: {
  draft: FocusSessionDraft;
  strictLocked: boolean;
  presets: FocusSessionPreset[];
  runningApps: SelectedAppExecutable[];
  onChange: (draft: FocusSessionDraft) => void;
  onCancel: () => void;
  onStart: () => void;
  onSavePreset: () => void;
  onApplyPreset: (preset: FocusSessionPreset) => void;
  onDeletePreset: (id: string) => void;
  onPickCustomWallpaper: () => void;
  onPickRunningApps: () => void;
  onCloseRunningApps: () => void;
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
      <section className="confirm-dialog focus-dialog" role="dialog" aria-modal="true" aria-labelledby="focus-session-title">
        <div className="focus-dialog-header">
          <div>
            <p className="eyebrow">Focus session</p>
            <h2 id="focus-session-title">New session</h2>
          </div>
          <button className="secondary icon-only" onClick={onCancel} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className="focus-mode-toggle">
          <button className={`focus-mode-btn ${draft.mode === "duration" ? "active" : ""}`} onClick={() => onChange({ ...draft, mode: "duration" })}>
            <Clock3 size={14} />
            Duration
          </button>
          <button className={`focus-mode-btn ${draft.mode === "pomodoro" ? "active" : ""}`} onClick={() => onChange({ ...draft, mode: "pomodoro" })}>
            <RefreshCcw size={14} />
            Pomodoro
          </button>
        </div>

        <div className="focus-form">
          {draft.mode === "duration" ? (
            <label className="focus-field">
              <span>Duration</span>
              <div className="focus-input-row">
                <input
                  type="number"
                  min={5}
                  max={720}
                  value={draft.durationMinutes}
                  onChange={(event) => onChange({ ...draft, durationMinutes: Number(event.target.value) || 45 })}
                />
                <span className="focus-unit">min</span>
              </div>
            </label>
          ) : (
            <div className="focus-field-row">
              <label className="focus-field">
                <span>Focus</span>
                <div className="focus-input-row">
                  <input
                    type="number"
                    min={5}
                    max={120}
                    value={draft.focusMinutes}
                    onChange={(event) => onChange({ ...draft, focusMinutes: Number(event.target.value) || 25 })}
                  />
                  <span className="focus-unit">min</span>
                </div>
              </label>
              <label className="focus-field">
                <span>Break</span>
                <div className="focus-input-row">
                  <input
                    type="number"
                    min={1}
                    max={30}
                    value={draft.breakMinutes}
                    onChange={(event) => onChange({ ...draft, breakMinutes: Number(event.target.value) || 5 })}
                  />
                  <span className="focus-unit">min</span>
                </div>
              </label>
              <label className="focus-field">
                <span>Rounds</span>
                <input
                  type="number"
                  min={1}
                  max={12}
                  value={draft.rounds}
                  onChange={(event) => onChange({ ...draft, rounds: Number(event.target.value) || 4 })}
                />
              </label>
            </div>
          )}

          <div className="focus-options-row">
            <label className="focus-check">
              <input
                type="checkbox"
                checked={strictLocked ? false : draft.showPauseButton}
                disabled={strictLocked}
                onChange={(event) => onChange({ ...draft, showPauseButton: event.target.checked })}
              />
              Allow pausing
            </label>
            <label className="focus-field compact">
              <span>Wallpaper</span>
              <select
                value={draft.wallpaperType}
                onChange={(event) =>
                  onChange({
                    ...draft,
                    wallpaperType: event.target.value as "default" | "solid" | "custom"
                  })
                }
              >
                <option value="default">Default</option>
                <option value="solid">Solid color</option>
                <option value="custom">Custom image</option>
              </select>
            </label>
            {draft.wallpaperType === "solid" && (
              <label className="focus-field compact">
                <span>Color</span>
                <input
                  type="color"
                  value={draft.wallpaperValue}
                  onChange={(event) => onChange({ ...draft, wallpaperValue: event.target.value })}
                />
              </label>
            )}
            {draft.wallpaperType === "custom" && (
              <button className="secondary compact" onClick={onPickCustomWallpaper}>
                <FolderOpen size={14} />
                Choose image
              </button>
            )}
          </div>
          {draft.wallpaperType === "custom" && draft.wallpaperValue && (
            <p className="focus-apps-hint">Selected: {draft.wallpaperValue}</p>
          )}
        </div>

        <div className="focus-apps-section">
          <div className="focus-apps-header">
            <span className="focus-apps-label">Session presets</span>
          </div>
          <div className="entry-row">
            <input
              value={draft.presetName}
              placeholder="Preset name"
              onChange={(event) => onChange({ ...draft, presetName: event.target.value })}
            />
            <button className="secondary" onClick={onSavePreset}>
              <Plus size={14} />
              Save preset
            </button>
          </div>
          {presets.length > 0 && (
            <div className="rule-table">
              {presets.map((preset) => (
                <div className="rule-row" key={preset.id}>
                  <div>
                    <strong>{preset.name}</strong>
                    <span>{preset.mode === "pomodoro" ? "Pomodoro" : "Duration"} · {preset.allowedApps.length} app(s)</span>
                  </div>
                  <button className="secondary" onClick={() => onApplyPreset(preset)}>
                    Apply
                  </button>
                  <button className="danger icon-only" onClick={() => onDeletePreset(preset.id)} aria-label={`Delete ${preset.name}`}>
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="focus-apps-section">
          <div className="focus-apps-header">
            <span className="focus-apps-label">Allowed apps · {draft.allowedApps.length} selected</span>
            <button className="secondary" onClick={onPickRunningApps}>
              <AppWindow size={14} />
              Load running
            </button>
          </div>
          {runningApps.length > 0 && (
            <div className="running-app-list">
              <div className="running-app-list-header">
                <strong>Running apps</strong>
                <button className="secondary icon-only" onClick={onCloseRunningApps} aria-label="Close running apps">
                  <X size={14} />
                </button>
              </div>
              {runningApps.map((runningApp) => {
                const selected = draft.allowedApps.some(
                  (item) => item.executable === runningApp.executable && item.path === runningApp.path
                );
                return (
                  <button
                    className={`running-app-row ${selected ? "selected" : ""}`}
                    key={`${runningApp.executable}-${runningApp.path ?? runningApp.displayName}`}
                    onClick={() => toggleAllowedApp(runningApp)}
                  >
                    <strong>{runningApp.displayName}</strong>
                    <span>{runningApp.executable}</span>
                    <small>{runningApp.path || runningApp.title || ""}</small>
                  </button>
                );
              })}
            </div>
          )}
          {draft.allowedApps.length === 0 && runningApps.length === 0 && (
            <p className="focus-apps-hint">No apps selected — only the focus screen will be usable.</p>
          )}
        </div>

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
  if (events.length === 0) return <p className="empty">Your activity timeline will build up here.</p>;
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
