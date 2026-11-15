import React, { useEffect, useState } from 'react';
import { formatDurationSeconds, formatOneWayDelay } from './api/client';
import { CrewId, STATUS_DISPLAY } from './api/types';
import { AegisProvider, useAegis } from './api/useLiveSocket';
import { AlertBanner } from './components/AlertBanner';
import { dataSourcesLine } from './components/DataSourceBadge';
import { DataSourcesPanel } from './components/DataSourcesPanel';
import { EmergencyTakeover } from './components/EmergencyTakeover';
import { ScenarioDock } from './components/ScenarioDock';
import { AlertCenter } from './views/AlertCenter';
import { CrewDetail } from './views/CrewDetail';
import { CrewOverview } from './views/CrewOverview';
import { GroundConsole } from './views/GroundConsole';
import { Radiation } from './views/Radiation';
import { Journal } from './views/Journal';
import { Today } from './views/Today';

/**
 * Block S (ROADMAP §0c): the app is organised by who is looking. A role is a view filter, not access control.
 * Crew: Today, My health, Journal. CMO: Crew, Crew member, Radiation. Ground: the ground console.
 */
export type Role = 'crew' | 'cmo' | 'ground';
type ActiveTab = 'today' | 'health' | 'journal' | 'overview' | 'detail' | 'radiation' | 'ground';
const CREW_IDS: CrewId[] = ['C1', 'C2', 'C3', 'C4'];
const DEFAULT_TAB: Record<Role, ActiveTab> = { crew: 'today', cmo: 'overview', ground: 'ground' };
const ROLE_LABEL: Record<Role, string> = { crew: 'Crew', cmo: 'CMO', ground: 'Ground' };

/** Per-viewer convenience only (which role and crew member this tablet shows); wrapped so it never throws. */
function remembered<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = typeof window !== 'undefined' ? window.localStorage.getItem(key) : null;
    return v && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
  } catch {
    return fallback;
  }
}
function remember(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // storage unavailable: the choice just is not remembered
  }
}

const tabClass = (active: boolean, alarm = false): string =>
  `min-h-[44px] rounded-xl px-3.5 py-2 text-xs font-bold transition-all ${
    active
      ? 'bg-cyan-500 text-slate-950 shadow'
      : alarm
      ? 'bg-red-600 text-white animate-pulse'
      : 'bg-space-900 text-slate-300 hover:bg-space-800 border border-slate-800'
  }`;

const AegisShell: React.FC = () => {
  const {
    state,
    acknowledgeAlert,
    resolveAlert,
    toggleCrewShelter,
    evacuateAllToShelter,
  } = useAegis();

  const [role, setRoleState] = useState<Role>(() => remembered<Role>('aegis.role', ['crew', 'cmo', 'ground'], 'crew'));
  const [me, setMeState] = useState<CrewId>(() => remembered<CrewId>('aegis.me', CREW_IDS, 'C1'));
  const [activeTab, setActiveTab] = useState<ActiveTab>(() => DEFAULT_TAB[role]);
  const [selectedCrewId, setSelectedCrewId] = useState<CrewId>('C1');
  const [demoOpen, setDemoOpen] = useState(false);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const setRole = (r: Role): void => {
    setRoleState(r);
    setActiveTab(DEFAULT_TAB[r]);
    remember('aegis.role', r);
  };
  const setMe = (id: CrewId): void => {
    setMeState(id);
    remember('aegis.me', id);
  };
  // T-6 / S-1: a Start on the body map or the landing gate hands the tablet to that crew member's Today screen
  const [startTest, setStartTest] = useState<{ crewId: CrewId; testId: string; n: number } | null>(null);
  const handleStartTest = (crewId: CrewId, testId: string): void => {
    setRoleState('crew');
    remember('aegis.role', 'crew');
    setMe(crewId);
    setStartTest((prev) => ({ crewId, testId, n: (prev?.n ?? 0) + 1 }));
    setActiveTab('today');
  };
  const [emergencyModalDismissed, setEmergencyModalDismissed] = useState<boolean>(false);
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('aegis-theme') === 'light' ? 'light' : 'dark';
    }
    return 'dark';
  });

  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove('dark', 'light');
    root.classList.add(theme);
    try {
      localStorage.setItem('aegis-theme', theme);
    } catch {
      // ignore storage errors
    }
  }, [theme]);

  const { sim, crew, alerts, radiation, link } = state;

  const activeEmergencyAlert =
    alerts.find(
      (a) =>
        a.severity === 'EMERGENCY' &&
        (a.state === 'RAISED' || a.state === 'ACKNOWLEDGED' || a.state === 'IN_TREATMENT')
    ) ?? null;

  // Automatically re-open full-screen takeover whenever a new EMERGENCY is RAISED
  useEffect(() => {
    if (activeEmergencyAlert?.state === 'RAISED') {
      setEmergencyModalDismissed(false);
    }
  }, [activeEmergencyAlert?.id, activeEmergencyAlert?.state]);

  const activeAlertsCount = alerts.filter(
    (a) => a.state === 'RAISED' || a.state === 'ACKNOWLEDGED' || a.state === 'IN_TREATMENT'
  ).length;

  const overallSystemStatus = activeEmergencyAlert
    ? 'EMERGENCY'
    : alerts.some((a) => a.severity === 'WARNING' && a.state !== 'RESOLVED')
    ? 'WARNING'
    : alerts.some((a) => a.severity === 'CAUTION' && a.state !== 'RESOLVED')
    ? 'CAUTION'
    : 'NOMINAL';

  const sysMeta = STATUS_DISPLAY[overallSystemStatus];

  const handleSelectCrew = (crewId: CrewId) => {
    setSelectedCrewId(crewId);
    setActiveTab('detail');
  };
  const onboardRole = role !== 'ground';
  const tabs: Array<{ id: ActiveTab; label: string; alarm?: boolean; testId?: string }> =
    role === 'crew'
      ? [
          { id: 'today', label: 'Today', testId: 'tab-today' },
          { id: 'health', label: 'My health' },
          { id: 'journal', label: 'Journal', testId: 'tab-journal' },
        ]
      : role === 'cmo'
      ? [
          { id: 'overview', label: 'Crew' },
          { id: 'detail', label: `Crew member (${selectedCrewId})` },
          { id: 'radiation', label: 'Radiation', alarm: radiation.spe_active },
        ]
      : [];

  return (
    <div className="min-h-screen flex flex-col justify-between bg-space-950 text-slate-100">
      {/* Full-Screen EMERGENCY Takeover (PRD §7.4 / AGENTS.md §4) */}
      {onboardRole && activeEmergencyAlert && !emergencyModalDismissed && (
        <EmergencyTakeover
          alert={activeEmergencyAlert}
          crew={crew}
          radiation={radiation}
          commDelaySeconds={sim.comm_delay_s}
          groundLagSeconds={link.lag_seconds}
          linkBlackout={link.blackout}
          onToggleCrewShelter={toggleCrewShelter}
          onEvacuateAll={evacuateAllToShelter}
          onAcknowledge={acknowledgeAlert}
          onResolve={resolveAlert}
          onMinimize={() => setEmergencyModalDismissed(true)}
        />
      )}

      {/* Top Navigation & Mission Telemetry Header */}
      <header className="sticky top-0 z-30 border-b border-slate-800/90 bg-space-950/95 backdrop-blur">
        <div className="mx-auto max-w-[1440px] px-4 py-2.5 flex flex-col xl:flex-row xl:items-center justify-between gap-3">
          {/* Brand + Mission Phase + System Status */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-400 to-blue-600 font-mono text-base font-black text-slate-950 shadow">
                Æ
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-base font-black tracking-tight text-white">AEGIS</span>
                  <span
                    className={`rounded-full border px-2.5 py-0.5 text-xs font-bold ${sysMeta.badgeClass}`}
                  >
                    {sysMeta.label}
                  </span>
                  <span className="rounded bg-space-800 border border-slate-700 px-2 py-0.5 text-[11px] font-mono text-cyan-300">
                    {sim.phase} ({sim.gravity_g}g)
                  </span>
                </div>
                <p className="text-[11px] text-slate-400">
                  Autonomous Exploration Guardian for Integrated Crew Health &amp; Safety
                </p>
              </div>
            </div>

            {/* Simulated Clock, Link Status & Theme Toggle */}
            <div className="flex items-center gap-2 text-xs font-mono">
              <span className="rounded-lg border border-slate-800 bg-space-900 px-2.5 py-1.5 text-slate-200">
                MD-{sim.mission_day} · {sim.sim_ts.slice(11, 19)} UTC ({sim.speed}×)
              </span>
              <span
                className={`rounded-lg border px-2.5 py-1.5 font-semibold ${
                  link.blackout
                    ? 'border-red-500/60 bg-red-950/50 text-red-200'
                    : 'border-slate-800 bg-space-900 text-emerald-300'
                }`}
              >
                {link.blackout
                  ? '⚡ LINK BLACKOUT (ONBOARD AUTONOMOUS)'
                  : `One-Way Delay: ${formatOneWayDelay(sim.comm_delay_s, link.delay_source)}`}
              </span>
              {onboardRole && (
                <button
                  type="button"
                  data-testid="alerts-chip"
                  aria-expanded={alertsOpen}
                  onClick={() => setAlertsOpen((v) => !v)}
                  className={`min-h-[44px] rounded-xl border px-3 text-xs font-sans font-bold ${
                    activeAlertsCount ? sysMeta.badgeClass : 'border-slate-700 bg-space-900 text-slate-200'
                  }`}
                >
                  {sysMeta.symbol} Alerts ({activeAlertsCount})
                </button>
              )}
              <button
                type="button"
                onClick={() => setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'))}
                aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
                data-testid="theme-toggle-btn"
                className="min-h-[44px] inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-space-900 px-3 py-1.5 text-xs font-sans font-bold text-slate-200 hover:bg-space-800 transition-colors"
                title={`Switch to ${theme === 'dark' ? 'Light' : 'Dark'} Mode`}
              >
                <span aria-hidden="true">{theme === 'dark' ? '☀️' : '🌙'}</span>
                <span>{theme === 'dark' ? 'Light' : 'Dark'}</span>
              </button>
            </div>
          </div>

          {/* Block S: role switch, then only that role's tabs (≥ 44 px targets for the tablet) */}
          <nav aria-label="Main Views" className="flex flex-wrap items-center gap-1.5">
            <div role="group" aria-label="Who is looking" className="flex rounded-xl border border-slate-700 p-0.5">
              {(['crew', 'cmo', 'ground'] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  data-testid={`role-${r}`}
                  aria-pressed={role === r}
                  onClick={() => setRole(r)}
                  className={`min-h-[44px] rounded-lg px-3 text-xs font-black ${
                    role === r ? 'bg-slate-100 text-slate-950' : 'text-slate-300 hover:bg-space-800'
                  }`}
                >
                  {r === 'ground' ? `${ROLE_LABEL[r]} (T−${formatDurationSeconds(link.lag_seconds)})` : ROLE_LABEL[r]}
                </button>
              ))}
            </div>
            {role === 'crew' && (
              <div role="group" aria-label="I am" className="flex items-center gap-1">
                <span className="text-[11px] text-slate-400">I am</span>
                {CREW_IDS.map((id) => (
                  <button
                    key={id}
                    type="button"
                    aria-pressed={me === id}
                    onClick={() => setMe(id)}
                    className={`min-h-[44px] min-w-[44px] rounded-lg text-xs font-bold ${
                      me === id ? 'bg-cyan-500 text-slate-950' : 'border border-slate-700 bg-space-900 text-slate-300'
                    }`}
                  >
                    {id}
                  </button>
                ))}
              </div>
            )}
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                data-testid={t.testId}
                onClick={() => {
                  if (t.id === 'today') setStartTest(null);
                  setActiveTab(t.id);
                }}
                className={tabClass(activeTab === t.id, t.alarm)}
              >
                {t.label}
              </button>
            ))}
            <button
              type="button"
              data-testid="demo-controls-toggle"
              aria-expanded={demoOpen}
              onClick={() => setDemoOpen((v) => !v)}
              className="min-h-[44px] rounded-xl border border-dashed border-slate-600 px-3 text-xs font-bold text-slate-400 hover:bg-space-800"
            >
              {demoOpen ? '▾ Demo controls' : '▸ Demo controls'}
            </button>
          </nav>
        </div>
      </header>

      {/* Main Content Workspace */}
      <main className="mx-auto w-full max-w-[1440px] flex-1 px-4 py-5 space-y-5">
        {/* Demo controls (scenario, speed, seed): closed by default, not part of any crew or CMO screen */}
        {demoOpen && <ScenarioDock />}

        {/* Active Onboard Alert Banner; its details open the one alert panel (S-3) */}
        {onboardRole && (
          <AlertBanner
            alerts={alerts}
            onAcknowledge={acknowledgeAlert}
            onInspectAlert={() => setAlertsOpen(true)}
            onOpenEmergencyModal={() => setEmergencyModalDismissed(false)}
            linkBlackout={link.blackout}
            commDelaySeconds={link.one_way_delay_s}
          />
        )}

        {onboardRole && alertsOpen && (
          <section className="space-y-3 rounded-2xl border border-slate-700 bg-space-900/95 p-4" data-testid="alerts-panel" aria-label="Alerts">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-base font-black text-white">Alerts</h2>
              <button
                type="button"
                onClick={() => setAlertsOpen(false)}
                className="min-h-[44px] rounded-lg border border-slate-600 px-4 text-sm font-bold text-slate-100"
              >
                Close alerts
              </button>
            </div>
            <AlertCenter />
          </section>
        )}

        {/* Active View */}
        {role === 'crew' && activeTab === 'today' && (
          <Today
            key={`${me}-${startTest ? startTest.n : 0}`}
            crewId={me}
            initialTestId={startTest?.crewId === me ? startTest.testId : null}
            onStartTest={handleStartTest}
          />
        )}

        {role === 'crew' && activeTab === 'health' && (
          <CrewDetail
            mode="crew"
            selectedCrewId={me}
            onSelectCrew={setMe}
            onBackOverview={() => setActiveTab('today')}
            onStartTest={handleStartTest}
          />
        )}

        {role === 'crew' && activeTab === 'journal' && <Journal key={me} initialCrewId={me} />}

        {role === 'cmo' && activeTab === 'overview' && (
          <CrewOverview
            onSelectCrew={handleSelectCrew}
            onNavigateView={(v) => (v === 'alerts' ? setAlertsOpen(true) : v === 'ground' ? setRole('ground') : setActiveTab(v))}
            onStartTest={handleStartTest}
          />
        )}

        {role === 'cmo' && activeTab === 'detail' && (
          <CrewDetail
            mode="cmo"
            selectedCrewId={selectedCrewId}
            onSelectCrew={(id) => setSelectedCrewId(id)}
            onBackOverview={() => setActiveTab('overview')}
            onStartTest={handleStartTest}
          />
        )}

        {role === 'cmo' && activeTab === 'radiation' && (
          <Radiation onOpenEmergencyModal={() => setEmergencyModalDismissed(false)} />
        )}

        {role === 'ground' && <GroundConsole />}
      </main>

      {/* Mandatory Persistent Footer (AGENTS.md §8) */}
      <footer
        role="contentinfo"
        data-testid="persistent-disclaimer-footer"
        className="border-t border-slate-800/90 bg-space-950 py-3 px-4 text-center text-xs text-slate-400"
      >
        <div className="mx-auto max-w-[1440px] flex flex-col sm:flex-row items-center justify-between gap-2">
          <span className="font-semibold text-slate-300">
            Decision support only, not a medical diagnosis.{' '}
            <span data-testid="data-sources-line">{dataSourcesLine(state.provenance, state.limits)}</span>
          </span>
          <span className="font-mono text-[11px] text-slate-400">
            AEGIS Onboard-First Architecture · NASA-STD-3001 &amp; HRP-01..17 Traceable · Other limits marked &quot;Not a NASA limit&quot;
          </span>
        </div>
        <div className="mx-auto mt-2 max-w-[1440px] text-left">
          <DataSourcesPanel provenance={state.provenance} limits={state.limits} />
        </div>
      </footer>
    </div>
  );
};

export const App: React.FC = () => (
  <AegisProvider>
    <AegisShell />
  </AegisProvider>
);

export default App;
