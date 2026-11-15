import React, { useCallback, useEffect, useState } from 'react';
import { backendApi, signalLabel } from '../api/backend';
import { buildCountermeasureObservations, countermeasureApi } from '../api/countermeasures';
import {
  CountermeasurePlanItem,
  CrewId,
  HAZARD_CATALOG,
  Hazard,
  ScheduleItem,
  SelfTestDef,
  SelfTestResult,
  SubmitOutcome,
} from '../api/types';
import { useAegis } from '../api/useLiveSocket';
import { AmslerGrid } from '../components/AmslerGrid';
import { DataSourceBadge } from '../components/DataSourceBadge';
import { MeasurementForm } from '../components/MeasurementForm';
import { PvtTest } from '../components/PvtTest';
import { OnboardOnlyBadge, Questionnaire } from '../components/Questionnaire';
import { ReadinessGate } from '../components/ReadinessGate';
import { LandingGateSummary } from './CrewOverview';
import { SelfTestExplainer } from '../components/SelfTestExplainer';
import { StandTest } from '../components/StandTest';
import { TodayList } from '../components/TodayList';

const HAZARDS = Object.keys(HAZARD_CATALOG) as Hazard[];
type Filter = Hazard | 'ALL' | 'COUNTERMEASURES';

/** Loads the self-test catalog from the onboard server (it never needs the Earth link). */
export function useSelfTestCatalog(connected: boolean): SelfTestDef[] | null {
  const [tests, setTests] = useState<SelfTestDef[] | null>(null);
  useEffect(() => {
    if (!connected) return;
    let live = true;
    void backendApi.selftests().then((t) => {
      if (live && t) setTests(t);
    });
    return () => {
      live = false;
    };
  }, [connected]);
  return tests;
}

/** One-tap fold (Block S, S-5): closed by default, ≥ 44 px toggle. */
export const Fold: React.FC<{ title: string; testId?: string; defaultOpen?: boolean; children: React.ReactNode }> = ({
  title,
  testId,
  defaultOpen = false,
  children,
}) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="space-y-2" data-testid={testId}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="min-h-[44px] w-full rounded-xl border border-slate-800 bg-space-900/80 px-4 text-left text-sm font-bold text-slate-100 hover:bg-space-800"
      >
        {open ? '▾' : '▸'} {title}
      </button>
      {open && children}
    </section>
  );
};

/**
 * Block S, S-2: the crew member's day. Self-tests and countermeasures in one list (Now / Later / Done); everything
 * else (landing gate, other tests, recent results, the hazard filter) folded until tapped. A test opens on its own
 * screen: one task per screen, numbered steps, the normal band with its marker. No points, streaks or scores.
 */
export const Today: React.FC<{
  crewId: CrewId;
  initialTestId?: string | null;
  /** A Start on the landing gate for another crew member hands the tablet to them (App switches the identity). */
  onStartTest?: (crewId: CrewId, testId: string) => void;
}> = ({ crewId, initialTestId = null, onStartTest }) => {
  const { state, submitSelfTest } = useAegis();
  const connected = state.sim.backend_connected;
  const tests = useSelfTestCatalog(connected);
  const [filter, setFilter] = useState<Filter>('ALL');
  const [filterOpen, setFilterOpen] = useState(false);
  const [gateOpen, setGateOpen] = useState(false);
  const [openId, setOpenId] = useState<string | null>(initialTestId);
  const [results, setResults] = useState<SelfTestResult[]>([]);
  const [routine, setRoutine] = useState<ScheduleItem[]>([]);
  const [plan, setPlan] = useState<CountermeasurePlanItem[]>([]);

  const refresh = useCallback(() => {
    if (!connected) return;
    void backendApi.selftestResults(crewId).then(setResults);
    void backendApi.selftestSchedule(crewId).then((items) => setRoutine(items ?? []));
    void countermeasureApi.plan(crewId).then((items) => setPlan(items ?? []));
  }, [connected, crewId]);
  useEffect(refresh, [refresh]);
  // The routine follows the simulation clock, so refresh it every few seconds while the view is open.
  useEffect(() => {
    if (!connected) return;
    const id = window.setInterval(refresh, 3000);
    return () => window.clearInterval(id);
  }, [connected, refresh]);

  const open = tests?.find((t) => t.id === openId) ?? null;
  const onSubmit = async (values: Record<string, number>): Promise<SubmitOutcome> => {
    if (!open) return { ok: false, message: 'No test open.' };
    const res = await submitSelfTest(crewId, open, values);
    refresh();
    return res;
  };
  const onCountermeasureDone = async (
    item: CountermeasurePlanItem,
    minutes: number | null
  ): Promise<{ ok: boolean; message: string }> => {
    if (!connected) return { ok: false, message: 'Not logged: the onboard server is not reachable.' };
    const res = await countermeasureApi.log(
      buildCountermeasureObservations({ crewId, item, minutes, ts: state.sim.sim_ts, phase: state.sim.phase })
    );
    refresh();
    return res;
  };
  const byHazard = <T extends { hazards: Hazard[] }>(items: T[]): T[] =>
    items.filter((i) => filter === 'ALL' || filter === 'COUNTERMEASURES' || i.hazards.includes(filter));

  if (open) {
    return (
      <article className="space-y-4 rounded-2xl border border-slate-800 bg-space-900/95 p-5" data-testid={`selftest-screen-${open.id}`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-base font-black text-white">
            {open.title} · {crewId}
          </h3>
          <button
            type="button"
            onClick={() => {
              setOpenId(null);
              refresh();
            }}
            className="min-h-[44px] rounded-lg border border-slate-600 bg-space-950 px-4 text-sm font-bold text-slate-100"
          >
            ← Back to today
          </button>
        </div>
        <SelfTestExplainer test={open} limits={state.limits} />
        {open.kind === 'questionnaire' ? (
          <Questionnaire key={`${open.id}-${crewId}`} test={open} connected={connected} onSubmit={onSubmit} />
        ) : open.kind === 'pvt' ? (
          <PvtTest
            key={`${open.id}-${crewId}`}
            test={open}
            lapseMs={state.limits['cognition.pvt_lapse_ms']?.value ?? NaN}
            connected={connected}
            onSubmit={onSubmit}
          />
        ) : open.kind === 'stand_test' ? (
          <StandTest key={`${open.id}-${crewId}`} test={open} gravityG={state.sim.gravity_g} connected={connected} onSubmit={onSubmit} />
        ) : open.kind === 'amsler' ? (
          <AmslerGrid key={`${open.id}-${crewId}`} test={open} connected={connected} onSubmit={onSubmit} />
        ) : (
          <MeasurementForm key={`${open.id}-${crewId}`} test={open} connected={connected} onSubmit={onSubmit} />
        )}
      </article>
    );
  }

  const shownTests = filter === 'COUNTERMEASURES' ? [] : byHazard(tests ?? []);
  return (
    <section className="space-y-4" data-testid="today-view">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-black text-white">Today · {crewId}</h2>
          <p className="text-xs text-slate-400">Your tests and countermeasures. Results stay on board.</p>
        </div>
        <button
          type="button"
          aria-expanded={filterOpen}
          onClick={() => setFilterOpen((v) => !v)}
          className="min-h-[44px] rounded-xl border border-slate-700 bg-space-900 px-3 text-xs font-bold text-slate-200"
        >
          {filterOpen ? 'Hide filter' : filter === 'ALL' ? 'Filter' : 'Filter (on)'}
        </button>
      </div>

      {filterOpen && (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by RIDGE hazard">
          {(['ALL', 'COUNTERMEASURES', ...HAZARDS] as const).map((hz) => (
            <button
              key={hz}
              type="button"
              aria-pressed={filter === hz}
              onClick={() => setFilter(hz)}
              className={`min-h-[44px] rounded-full px-3 text-xs font-bold ${
                filter === hz ? 'bg-slate-100 text-slate-950' : 'border border-slate-700 bg-space-900 text-slate-300'
              }`}
            >
              {hz === 'ALL'
                ? 'Everything'
                : hz === 'COUNTERMEASURES'
                ? 'Countermeasures only'
                : `[${HAZARD_CATALOG[hz].letter}] ${HAZARD_CATALOG[hz].shortName}`}
            </button>
          ))}
        </div>
      )}

      {!connected && (
        <p className="rounded-lg border border-amber-500/50 bg-amber-950/30 p-3 text-sm text-amber-100">
          ▲ The onboard server is not reachable, so today&apos;s list cannot load. It needs only the onboard server, never
          the Earth link.
        </p>
      )}

      {gateOpen ? (
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => setGateOpen(false)}
            className="min-h-[44px] rounded-lg border border-slate-600 px-3 text-xs font-bold text-slate-200"
          >
            ▾ Hide landing gate
          </button>
          <ReadinessGate
            gates={state.landing}
            next={state.sim.next_gravity_increase}
            connected={connected}
            onStartTest={(id, testId) => (id === crewId ? setOpenId(testId) : onStartTest?.(id, testId))}
          />
        </div>
      ) : (
        <LandingGateSummary gates={state.landing} next={state.sim.next_gravity_increase} onOpen={() => setGateOpen(true)} />
      )}

      <TodayList
        routine={filter === 'COUNTERMEASURES' ? [] : byHazard(routine)}
        countermeasures={byHazard(plan)}
        connected={connected}
        onStart={setOpenId}
        onDone={onCountermeasureDone}
      />

      {shownTests.length > 0 && (
        <Fold title="Other tests (any time)" testId="other-tests">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {shownTests.map((t) => (
              <article key={t.id} className="flex flex-col justify-between gap-3 rounded-xl border border-slate-800 bg-space-900/90 p-4" data-testid={`selftest-card-${t.id}`}>
                <div className="space-y-1">
                  <h3 className="text-sm font-bold text-slate-100">{t.title}</h3>
                  {t.onboard_only && <OnboardOnlyBadge />}
                  <p className="text-xs text-slate-400">{t.why}</p>
                </div>
                <button
                  type="button"
                  data-testid={`start-${t.id}`}
                  onClick={() => setOpenId(t.id)}
                  className="min-h-[48px] rounded-xl bg-cyan-500 px-4 text-sm font-black text-slate-950 hover:bg-cyan-400"
                >
                  Start
                </button>
              </article>
            ))}
          </div>
        </Fold>
      )}

      {results.length > 0 && (
        <Fold title={`Recent results (${Math.min(results.length, 8)})`} testId="recent-results">
          <RecentResults results={results} tests={tests ?? []} />
        </Fold>
      )}
    </section>
  );
};

const RecentResults: React.FC<{ results: SelfTestResult[]; tests: SelfTestDef[] }> = ({ results, tests }) => {
  const units = Object.fromEntries(tests.flatMap((t) => t.fields.map((f) => [f.signal, f.unit])));
  return (
    <section className="rounded-xl border border-slate-800 bg-space-900/80 p-4" data-testid="selftest-results">
      <ul className="space-y-2">
        {[...results].reverse().slice(0, 8).map((r) => (
          <li key={`${r.test_id}-${r.ts}`} className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="text-slate-200">
              <span className="font-mono text-slate-400">{r.ts.slice(11, 16)}</span>{' '}
              <strong>{tests.find((t) => t.id === r.test_id)?.title ?? r.test_id}</strong>:{' '}
              {Object.entries(r.values)
                .map(([s, v]) => `${signalLabel(s)} ${v} ${units[s] ?? ''}`.trim())
                .join(' · ')}
            </span>
            <DataSourceBadge compact source={{ provenance: r.provenance, dataset_id: null, basis: r.basis }} />
          </li>
        ))}
      </ul>
    </section>
  );
};
