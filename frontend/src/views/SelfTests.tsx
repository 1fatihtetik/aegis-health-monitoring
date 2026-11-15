import React, { useCallback, useEffect, useState } from 'react';
import { backendApi, signalLabel } from '../api/backend';
import {
  CrewId,
  HAZARD_CATALOG,
  Hazard,
  ScheduleItem,
  SelfTestDef,
  SelfTestResult,
  SubmitOutcome,
} from '../api/types';
import { useAegis } from '../api/useLiveSocket';
import { DataSourceBadge } from '../components/DataSourceBadge';
import { MeasurementForm } from '../components/MeasurementForm';
import { PvtTest } from '../components/PvtTest';
import { OnboardOnlyBadge, Questionnaire } from '../components/Questionnaire';
import { ReadinessGate } from '../components/ReadinessGate';
import { RoutineBoard } from '../components/RoutineBoard';
import { StandTest } from '../components/StandTest';
import { SelfTestExplainer } from '../components/SelfTestExplainer';

const CREW: CrewId[] = ['C1', 'C2', 'C3', 'C4'];
const HAZARDS = Object.keys(HAZARD_CATALOG) as Hazard[];

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

/**
 * Block T: the crew takes tests and measurements themselves. One task per screen, numbered steps, big Done
 * buttons, the normal band and the unverified marker visible while entering. No points, streaks or scores.
 */
export const SelfTests: React.FC<{ initialCrewId?: CrewId }> = ({ initialCrewId = 'C1' }) => {
  const { state, submitSelfTest } = useAegis();
  const connected = state.sim.backend_connected;
  const tests = useSelfTestCatalog(connected);
  const [crewId, setCrewId] = useState<CrewId>(initialCrewId);
  const [hazard, setHazard] = useState<Hazard | 'ALL'>('ALL');
  const [openId, setOpenId] = useState<string | null>(null);
  const [results, setResults] = useState<SelfTestResult[]>([]);
  const [routine, setRoutine] = useState<ScheduleItem[]>([]);

  const refresh = useCallback(() => {
    if (!connected) return;
    void backendApi.selftestResults(crewId).then(setResults);
    void backendApi.selftestSchedule(crewId).then((items) => setRoutine(items ?? []));
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
  const shown = (tests ?? []).filter((t) => hazard === 'ALL' || t.hazards.includes(hazard));

  return (
    <section className="space-y-4" data-testid="selftests-view">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-black text-white">Self-tests</h2>
          <p className="text-xs text-slate-400">
            Take a test, follow the steps, enter the result. Results stay on board and feed the same rules as the sensors.
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Crew member">
          {CREW.map((id) => (
            <button
              key={id}
              type="button"
              aria-pressed={crewId === id}
              onClick={() => setCrewId(id)}
              className={`min-h-[44px] min-w-[56px] rounded-xl px-3 text-sm font-bold ${
                crewId === id ? 'bg-cyan-500 text-slate-950' : 'border border-slate-700 bg-space-900 text-slate-200'
              }`}
            >
              {id}
            </button>
          ))}
        </div>
      </div>

      {!connected && (
        <p className="rounded-lg border border-amber-500/50 bg-amber-950/30 p-3 text-sm text-amber-100">
          ▲ The onboard server is not reachable, so the test catalog cannot load. Self-tests need only the onboard
          server, never the Earth link.
        </p>
      )}

      {open ? (
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
              ← All tests
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
            <StandTest
              key={`${open.id}-${crewId}`}
              test={open}
              gravityG={state.sim.gravity_g}
              connected={connected}
              onSubmit={onSubmit}
            />
          ) : (
            <MeasurementForm key={`${open.id}-${crewId}`} test={open} connected={connected} onSubmit={onSubmit} />
          )}
        </article>
      ) : (
        <>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by RIDGE hazard">
            {(['ALL', ...HAZARDS] as const).map((hz) => (
              <button
                key={hz}
                type="button"
                aria-pressed={hazard === hz}
                onClick={() => setHazard(hz)}
                className={`min-h-[44px] rounded-full px-3 text-xs font-bold ${
                  hazard === hz ? 'bg-slate-100 text-slate-950' : 'border border-slate-700 bg-space-900 text-slate-300'
                }`}
              >
                {hz === 'ALL' ? 'All hazards' : `[${HAZARD_CATALOG[hz].letter}] ${HAZARD_CATALOG[hz].shortName}`}
              </button>
            ))}
          </div>
          <ReadinessGate
            gates={state.landing}
            next={state.sim.next_gravity_increase}
            connected={connected}
            onStartTest={(id, testId) => {
              setCrewId(id);
              setOpenId(testId);
            }}
          />
          <RoutineBoard
            items={routine.filter((i) => hazard === 'ALL' || i.hazards.includes(hazard))}
            onStart={setOpenId}
          />
          <h3 className="text-sm font-bold text-slate-100">All tests</h3>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {shown.map((t) => (
              <article key={t.id} className="flex flex-col justify-between gap-3 rounded-xl border border-slate-800 bg-space-900/90 p-4" data-testid={`selftest-card-${t.id}`}>
                <div className="space-y-1">
                  <h3 className="text-sm font-bold text-slate-100">{t.title}</h3>
                  {t.onboard_only && <OnboardOnlyBadge />}
                  <p className="text-xs text-slate-400">{t.why}</p>
                  <p className="text-[11px] text-slate-500">
                    {t.hazards.map((h) => HAZARD_CATALOG[h].shortName).join(' · ')} · {t.hrp_risks.join(', ')}
                  </p>
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
        </>
      )}

      <RecentResults results={results} tests={tests ?? []} />
    </section>
  );
};

const RecentResults: React.FC<{ results: SelfTestResult[]; tests: SelfTestDef[] }> = ({ results, tests }) => {
  if (results.length === 0) return null;
  const units = Object.fromEntries(tests.flatMap((t) => t.fields.map((f) => [f.signal, f.unit])));
  return (
    <section className="rounded-xl border border-slate-800 bg-space-900/80 p-4" data-testid="selftest-results">
      <h3 className="mb-2 text-sm font-bold text-slate-100">Recent results</h3>
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
