import React, { useState } from 'react';
import { signalLabel } from '../api/backend';
import { formatDurationSeconds } from '../api/client';
import { CrewId, LandingComponent, LandingGate, NextGravityIncrease } from '../api/types';
import { DataSourceBadge } from './DataSourceBadge';
import { SeveritySublabel } from './SeveritySublabel';

const CREW: CrewId[] = ['C1', 'C2', 'C3', 'C4'];

/** "Mars surface" from "MARS_SURFACE" (UI copy only). */
function phaseWords(name: string): string {
  const s = name.replace(/_/g, ' ').toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function round(v: number, digits = 0): string {
  return v.toFixed(digits);
}

/** A component needs a crew step when it has no value yet or scores below 100 (100 = at or better than `good`). */
export function needsAction(c: LandingComponent): boolean {
  return c.score === null || c.score < 100;
}

/** One line for the gate header: when the next landing is, or that none is scheduled. */
export function landingLine(next: NextGravityIncrease | null | undefined): string {
  if (!next) return 'No gravity increase is scheduled in this scenario. The gate still updates, so it can be checked any time.';
  const when = next.in_s > 0 ? `in ${formatDurationSeconds(next.in_s)} (mission time)` : 'now';
  return `Next gravity increase: ${phaseWords(next.to_phase)}, ${next.from_g} g → ${next.to_g} g, ${when}.`;
}

const GateRow: React.FC<{ crewId: CrewId; gate: LandingGate; onStartTest?: (testId: string) => void }> = ({
  crewId,
  gate,
  onStartTest,
}) => {
  const [open, setOpen] = useState(!gate.go);
  const comps = Object.entries(gate.components);
  return (
    <li
      className={`rounded-xl border p-3 ${gate.go ? 'border-emerald-600/60 bg-emerald-950/20' : 'border-amber-500/70 bg-amber-950/25'}`}
      data-testid={`landing-gate-${crewId}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <span className="font-mono text-sm font-bold text-slate-200">{crewId}</span>
          <span
            className={`rounded-lg px-2.5 py-1 text-sm font-black ${gate.go ? 'bg-emerald-500 text-slate-950' : 'bg-amber-400 text-slate-950'}`}
            data-testid={`landing-verdict-${crewId}`}
          >
            {gate.go ? '✓ GO' : '▲ HOLD'}
          </span>
          <span className="text-xs text-slate-300">
            Score {round(gate.value)} (Go at {gate.go_min} or more
            {!gate.go_min_verified && (
              <span className="ml-1 font-mono text-amber-300" title={`Unverified: ${gate.go_min_source_ref ?? 'project heuristic'}`}>
                ⚠ unverified
              </span>
            )}
            ){gate.alert_penalty > 0 ? ` · open-alert penalty −${gate.alert_penalty}` : ''}
          </span>
        </div>
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="min-h-[44px] rounded-lg border border-slate-600 bg-space-950 px-3 text-xs font-bold text-slate-100"
        >
          {open ? 'Hide details' : 'Show details'}
        </button>
      </div>

      {gate.hold_alerts.length > 0 && (
        <ul className="mt-2 space-y-1" data-testid={`landing-hold-alerts-${crewId}`}>
          {gate.hold_alerts.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-2 text-xs text-amber-100">
              <span>■ Open alert holds the landing:</span>
              <strong>{a.title}</strong>
              <span className="font-mono text-slate-300">{a.severity}</span>
              <SeveritySublabel severity={a.severity} />
            </li>
          ))}
        </ul>
      )}

      {open && (
        <div className="mt-3 space-y-3">
          <ul className="space-y-1.5">
            {comps.map(([id, c]) => (
              <li key={id} className="flex flex-wrap items-start justify-between gap-2 text-xs" data-testid={`landing-comp-${crewId}-${id}`}>
                <div className="min-w-0 flex-1">
                  <span className="font-semibold text-slate-100">{signalLabel(c.signal)}</span>{' '}
                  {c.value === null ? (
                    <span className="text-slate-400">no result yet, left out of the score</span>
                  ) : (
                    <span className="text-slate-300">
                      {round(c.value, c.value < 10 ? 1 : 0)} {c.unit} · part score {round(c.score ?? 0)}
                    </span>
                  )}
                  {!c.limit_verified && (
                    <span className="ml-1 font-mono text-amber-300" title={`Unverified: ${c.limit_source_ref}`}>
                      ⚠ unverified
                    </span>
                  )}
                  {needsAction(c) && c.action && <p className="mt-0.5 text-amber-200">▸ {c.action}</p>}
                </div>
                {c.source && <DataSourceBadge compact source={c.source} />}
              </li>
            ))}
          </ul>
          {!gate.go && gate.hold_actions.length > 0 && (
            <div className="rounded-lg border border-amber-500/50 bg-space-950/60 p-3" data-testid={`landing-hold-actions-${crewId}`}>
              <p className="mb-1 text-xs font-bold text-amber-100">What to do on Hold</p>
              <ol className="list-decimal space-y-0.5 pl-5 text-xs text-slate-200">
                {gate.hold_actions.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            </div>
          )}
          {onStartTest && (
            <div className="flex flex-wrap gap-2">
              {[
                ['pvt_b', 'Start PVT-B'],
                ['stand_test', 'Start stand test'],
                ['intake', 'Log fluid'],
                ['bp_spo2', 'Check SpO₂'],
              ].map(([testId, label]) => (
                <button
                  key={testId}
                  type="button"
                  onClick={() => onStartTest(testId)}
                  className="min-h-[44px] rounded-lg bg-cyan-500 px-3 text-xs font-black text-slate-950 hover:bg-cyan-400"
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </li>
  );
};

/**
 * T-8: landing readiness gate (Go / Hold) before a gravity increase. Every component is shown with its unverified
 * marker and source; Hold lists plain onboard steps. Needs only the onboard server, never the Earth link.
 * Decision support, not a diagnosis: the CMO decides.
 */
export const ReadinessGate: React.FC<{
  gates: Partial<Record<CrewId, LandingGate>> | undefined;
  next: NextGravityIncrease | null | undefined;
  connected: boolean;
  onStartTest?: (crewId: CrewId, testId: string) => void;
}> = ({ gates, next, connected, onStartTest }) => {
  const rows = CREW.flatMap((id) => {
    const gate = gates?.[id];
    return gate ? [{ id, gate }] : [];
  });
  return (
    <section className="space-y-3 rounded-2xl border border-slate-800 bg-space-900/90 p-4" data-testid="readiness-gate">
      <div>
        <h3 className="text-sm font-black text-white">Landing readiness gate (Go / Hold)</h3>
        <p className="text-xs text-slate-300" data-testid="landing-next">
          {landingLine(next)}
        </p>
      </div>
      {!connected || rows.length === 0 ? (
        <p className="text-xs text-amber-100">
          ▲ The landing gate is computed by the onboard server, which is not reachable. It never needs the Earth link.
        </p>
      ) : (
        <ul className="space-y-2">
          {rows.map(({ id, gate }) => (
            <GateRow key={id} crewId={id} gate={gate} onStartTest={onStartTest ? (t) => onStartTest(id, t) : undefined} />
          ))}
        </ul>
      )}
      <p className="text-[11px] text-slate-500">
        Score = weighted reaction test, stand test, fluid, SpO₂ and time below 1 g, minus open-alert penalties. Weights
        are project heuristics. Decision support only, not a medical diagnosis: the CMO decides.
      </p>
    </section>
  );
};
