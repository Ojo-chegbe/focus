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
  AppState,
  BlockedApp,
  BlockedKeyword,
  BlockedSite,
  HelperStatus,
  Profile,
  Schedule,
  UsageEvent,
  UsageSummary,
  Weekday
} from "../shared/models";
import type { SelectedAppExecutable } from "../shared/ipc";
import { createId, isStrictLocked, normalizeDomain } from "../shared/rules";
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

function App() {
  const [view, setView] = useState<"dashboard" | "settings">("dashboard");
  const [state, setState] = useState<AppState>();
  const [summary, setSummary] = useState<UsageSummary>();
  const [status, setStatus] = useState<HelperStatus>();
  const [selectedProfileId, setSelectedProfileId] = useState<string>();
  const [siteInput, setSiteInput] = useState("");
  const [appInput, setAppInput] = useState("");
  const [keywordInput, setKeywordInput] = useState("");
  const [error, setError] = useState<string>();
  const [confirmation, setConfirmation] = useState<Confirmation>();
  const [runningApps, setRunningApps] = useState<SelectedAppExecutable[]>([]);
  const [showRunningApps, setShowRunningApps] = useState(false);

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
    const profile: Profile = {
      id: createId("profile"),
      name: `Profile ${(state?.profiles.length ?? 0) + 1}`,
      color: "#0f766e",
      icon: "target",
      enabled: true,
      strictMode: "off",
      createdAt: new Date().toISOString()
    };
    setSelectedProfileId(profile.id);
    await saveProfile(profile);
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
    const appRule = createBlockedAppFromInput(selectedProfile.id, appInput);
    if (!appRule) return;
    setAppInput("");
    setState(await window.focusApi.saveBlockedApp(appRule));
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
    const appRule: BlockedApp = {
      id: createId("app"),
      profileId: selectedProfile.id,
      displayName: selectedApp.displayName,
      executable: selectedApp.executable,
      path: selectedApp.path,
      enabled: true
    };
    setState(await window.focusApi.saveBlockedApp(appRule));
    setShowRunningApps(false);
    await refreshLight();
  }

  async function addKeyword() {
    if (!selectedProfile || !keywordInput.trim()) return;
    const keyword: BlockedKeyword = {
      id: createId("keyword"),
      profileId: selectedProfile.id,
      phrase: keywordInput.trim(),
      enabled: true
    };
    setKeywordInput("");
    setState(await window.focusApi.saveBlockedKeyword(keyword));
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
      message: `This removes "${selectedProfile.name}" and every rule, schedule, and keyword inside it.`,
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
  const profileApps = state.blockedApps.filter((app) => app.profileId === selectedProfile.id);
  const profileSites = state.blockedSites.filter((site) => site.profileId === selectedProfile.id);
  const profileKeywords = state.blockedKeywords.filter((keyword) => keyword.profileId === selectedProfile.id);
  const profileSchedules = state.schedules.filter((schedule) => schedule.profileId === selectedProfile.id);
  const profileSessions = state.focusSessions.filter((session) => session.profileId === selectedProfile.id && session.active);

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

        <nav className="profile-list">
          {state.profiles.map((profile) => (
            <button
              className={`profile-button ${profile.id === selectedProfile.id ? "active" : ""}`}
              key={profile.id}
              onClick={() => setSelectedProfileId(profile.id)}
            >
              <span className="profile-dot" style={{ background: profile.color }} />
              <span>{profile.name}</span>
              {isStrictLocked(profile.strictUntil) && <Lock size={14} />}
            </button>
          ))}
        </nav>

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

        <button className="secondary wide" onClick={addProfile}>
          <Plus size={16} />
          Profile
        </button>

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
          <Panel title="Focus Sessions" icon={<Clock3 size={18} />}>
            <div className="quick-buttons">
              {[15, 30, 60, 120].map((minutes) => (
                <button
                  className="secondary"
                  key={minutes}
                  onClick={() => void window.focusApi.startFocusSession(selectedProfile.id, minutes).then(setState)}
                >
                  {minutes}m
                </button>
              ))}
            </div>
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
              <button className="primary" disabled={locked} onClick={() => void window.focusApi.lockProfile(selectedProfile.id, 60).then(setState)}>
                Lock 1h
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
                onToggle: () => void window.focusApi.saveBlockedSite({ ...site, enabled: !site.enabled }).then(setState),
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

          <Panel title="App Blocking" icon={<AppWindow size={18} />} className="span-2">
            <div className="entry-row">
              <input
                value={appInput}
                disabled={locked}
                placeholder="discord.exe"
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
              empty="No blocked apps yet."
              rows={profileApps.map((appRule) => ({
                id: appRule.id,
                main: appRule.displayName,
                meta: appRule.executable,
                enabled: appRule.enabled,
                onToggle: () => void window.focusApi.saveBlockedApp({ ...appRule, enabled: !appRule.enabled }).then(setState),
                onDelete: () =>
                  confirmAction({
                    title: "Delete app rule?",
                    message: `Remove "${appRule.displayName}" from app blocking.`,
                    confirmLabel: "Delete rule",
                    onConfirm: async () => {
                      setState(await window.focusApi.deleteBlockedApp(appRule.id));
                      await refreshLight();
                    }
                  })
              }))}
              locked={locked}
            />
          </Panel>

          <Panel title="Schedules" icon={<CalendarClock size={18} />} className="span-2">
            <button className="secondary compact" disabled={locked} onClick={() => void addSchedule()}>
              <Plus size={16} />
              Schedule
            </button>
            <div className="schedule-list">
              {profileSchedules.map((schedule) => (
                <ScheduleEditor
                  key={schedule.id}
                  schedule={schedule}
                  locked={locked}
                  onSave={(next) => void window.focusApi.saveSchedule(next).then(setState)}
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

          <Panel title="Keyword Blocking" icon={<Shield size={18} />}>
            <div className="entry-row">
              <input
                value={keywordInput}
                disabled={locked}
                placeholder="keyword or phrase"
                onChange={(event) => setKeywordInput(event.target.value)}
              />
              <button className="primary icon-only" disabled={locked} onClick={() => void addKeyword()} aria-label="Add keyword">
                <Plus size={16} />
              </button>
            </div>
            <p className="muted">
              Stored for the browser-extension/proxy phase. Hosts blocking cannot inspect page text.
            </p>
            <div className="keyword-list">
              {profileKeywords.map((keyword) => (
                <div key={keyword.id} className="keyword-row">
                  <span className={keyword.enabled ? "chip" : "chip muted-chip"}>{keyword.phrase}</span>
                  <button
                    className={keyword.enabled ? "toggle on" : "toggle"}
                    disabled={locked}
                    onClick={() => void window.focusApi.saveBlockedKeyword({ ...keyword, enabled: !keyword.enabled }).then(setState)}
                  >
                    {keyword.enabled ? "On" : "Off"}
                  </button>
                  <button
                    className="danger icon-only"
                    disabled={locked}
                    onClick={() =>
                      confirmAction({
                        title: "Delete keyword?",
                        message: `Remove "${keyword.phrase}" from keyword blocking.`,
                        confirmLabel: "Delete keyword",
                        onConfirm: async () => {
                          setState(await window.focusApi.deleteBlockedKeyword(keyword.id));
                          await refreshLight();
                        }
                      })
                    }
                    aria-label="Delete keyword"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
              {profileKeywords.length === 0 && <p className="empty">No keyword rules yet.</p>}
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

function ScheduleEditor({
  schedule,
  locked,
  onSave,
  onDelete
}: {
  schedule: Schedule;
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

function createBlockedAppFromInput(profileId: string, input: string): BlockedApp | undefined {
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

createRoot(document.getElementById("root")!).render(<App />);
