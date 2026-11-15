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
import { SelfTests } from './views/SelfTests';
import { Journal } from './views/Journal';

type ActiveTab = 'overview' | 'detail' | 'selftests' | 'journal' | 'radiation' | 'alerts' | 'ground';

const AegisShell: React.FC = () => {
  const {
    state,
    acknowledgeAlert,
    resolveAlert,
    toggleCrewShelter,
    evacuateAllToShelter,
  } = useAegis();

  const [activeTab, setActiveTab] = useState<ActiveTab>('overview');
  const [selectedCrewId, setSelectedCrewId] = useState<CrewId>('C1');
  // T-6: a Start button on the body map opens that self-test for that crew member
  const [startTest, setStartTest] = useState<{ crewId: CrewId; testId: string; n: number } | null>(null);
  const handleStartTest = (crewId: CrewId, testId: string): void => {
    setSelectedCrewId(crewId);
    setStartTest((prev) => ({ crewId, testId, n: (prev?.n ?? 0) + 1 }));
    setActiveTab('selftests');
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

  return (
    <div className="min-h-screen flex flex-col justify-between bg-space-950 text-slate-100">
      {/* Full-Screen EMERGENCY Takeover (PRD §7.4 / AGENTS.md §4) */}
      {activeEmergencyAlert && !emergencyModalDismissed && (
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

          {/* Primary View Tabs (Large ≥44px Touch Targets for Tablet) */}
          <nav aria-label="Main Views" className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => setActiveTab('overview')}
              className={`min-h-[44px] rounded-xl px-3.5 py-2 text-xs font-bold transition-all ${
                activeTab === 'overview'
                  ? 'bg-cyan-500 text-slate-950 shadow'
                  : 'bg-space-900 text-slate-300 hover:bg-space-800 border border-slate-800'
              }`}
            >
              Crew Overview &amp; RIDGE
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('detail')}
              className={`min-h-[44px] rounded-xl px-3.5 py-2 text-xs font-bold transition-all ${
                activeTab === 'detail'
                  ? 'bg-cyan-500 text-slate-950 shadow'
                  : 'bg-space-900 text-slate-300 hover:bg-space-800 border border-slate-800'
              }`}
            >
              Crew Detail ({selectedCrewId})
            </button>

            <button
              type="button"
              data-testid="tab-selftests"
              onClick={() => {
                setStartTest(null);
                setActiveTab('selftests');
              }}
              className={`min-h-[44px] rounded-xl px-3.5 py-2 text-xs font-bold transition-all ${
                activeTab === 'selftests'
                  ? 'bg-cyan-500 text-slate-950 shadow'
                  : 'bg-space-900 text-slate-300 hover:bg-space-800 border border-slate-800'
              }`}
            >
              Self-Tests
            </button>

            <button
              type="button"
              data-testid="tab-journal"
              onClick={() => setActiveTab('journal')}
              className={`min-h-[44px] rounded-xl px-3.5 py-2 text-xs font-bold transition-all ${
                activeTab === 'journal'
                  ? 'bg-cyan-500 text-slate-950 shadow'
                  : 'bg-space-900 text-slate-300 hover:bg-space-800 border border-slate-800'
              }`}
            >
              Journal
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('radiation')}
              className={`min-h-[44px] rounded-xl px-3.5 py-2 text-xs font-bold transition-all ${
                activeTab === 'radiation'
                  ? 'bg-cyan-500 text-slate-950 shadow'
                  : radiation.spe_active
                  ? 'bg-red-600 text-white animate-pulse'
                  : 'bg-space-900 text-slate-300 hover:bg-space-800 border border-slate-800'
              }`}
            >
              Radiation &amp; CANS ({radiation.neutron_fraction_pct}% n)
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('alerts')}
              className={`min-h-[44px] rounded-xl px-3.5 py-2 text-xs font-bold transition-all ${
                activeTab === 'alerts'
                  ? 'bg-cyan-500 text-slate-950 shadow'
                  : 'bg-space-900 text-slate-300 hover:bg-space-800 border border-slate-800'
              }`}
            >
              Alert Center ({activeAlertsCount})
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('ground')}
              className={`min-h-[44px] rounded-xl px-3.5 py-2 text-xs font-bold transition-all ${
                activeTab === 'ground'
                  ? 'bg-cyan-500 text-slate-950 shadow'
                  : 'bg-space-900 text-slate-300 hover:bg-space-800 border border-slate-800'
              }`}
            >
              Ground Console (T−{formatDurationSeconds(link.lag_seconds)})
            </button>
          </nav>
        </div>
      </header>

      {/* Main Content Workspace */}
      <main className="mx-auto w-full max-w-[1440px] flex-1 px-4 py-5 space-y-5">
        {/* Scenario Dock at top for 1-tap demo & testing */}
        <ScenarioDock />

        {/* Active Onboard Alert Banner */}
        <AlertBanner
          alerts={alerts}
          onAcknowledge={acknowledgeAlert}
          onInspectAlert={() => setActiveTab('alerts')}
          onOpenEmergencyModal={() => setEmergencyModalDismissed(false)}
          linkBlackout={link.blackout}
          commDelaySeconds={link.one_way_delay_s}
        />

        {/* Active View */}
        {activeTab === 'overview' && (
          <CrewOverview
            onSelectCrew={handleSelectCrew}
            onNavigateView={(v) => setActiveTab(v)}
            onStartTest={handleStartTest}
          />
        )}

        {activeTab === 'detail' && (
          <CrewDetail
            selectedCrewId={selectedCrewId}
            onSelectCrew={(id) => setSelectedCrewId(id)}
            onBackOverview={() => setActiveTab('overview')}
            onStartTest={handleStartTest}
          />
        )}

        {activeTab === 'selftests' && (
          <SelfTests
            key={startTest ? `start-${startTest.n}` : 'selftests'}
            initialCrewId={startTest?.crewId ?? selectedCrewId}
            initialTestId={startTest?.testId ?? null}
          />
        )}

        {activeTab === 'journal' && <Journal initialCrewId={selectedCrewId} />}

        {activeTab === 'radiation' && (
          <Radiation onOpenEmergencyModal={() => setEmergencyModalDismissed(false)} />
        )}

        {activeTab === 'alerts' && <AlertCenter />}

        {activeTab === 'ground' && <GroundConsole />}
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
