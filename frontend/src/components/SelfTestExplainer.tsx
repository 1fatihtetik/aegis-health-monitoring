import React from 'react';
import { formatLimit } from '../api/limits';
import { ConfigLimit, HAZARD_CATALOG, HRP_RISK_CATALOG, SelfTestDef } from '../api/types';
import { LimitBadge } from './LimitBadge';

/** Base limit keys of a test ("physiology.bp_systolic_mmHg.min" -> "physiology.bp_systolic_mmHg"), in order. */
export function bandKeys(test: SelfTestDef): string[] {
  const keys = test.limit_refs.map((ref) => ref.split('.').slice(0, 2).join('.'));
  return [...new Set(keys)];
}

/**
 * Every self-test explains itself from the catalog (config/selftests.yaml): why it exists (RIDGE hazard + HRP
 * risk), what counts as normal (limits.yaml, with the unverified marker) and when to involve the CMO or the ground.
 * The numbered steps are shown by the test screen itself, next to the inputs.
 */
export const SelfTestExplainer: React.FC<{ test: SelfTestDef; limits: Record<string, ConfigLimit> }> = ({
  test,
  limits,
}) => {
  const keys = bandKeys(test);
  return (
    <div className="space-y-3" data-testid="selftest-explainer">
      <div className="flex flex-wrap gap-1.5">
        {test.hazards.map((hz) => (
          <span
            key={hz}
            className="rounded border border-slate-700 bg-slate-800/90 px-2 py-0.5 text-[11px] font-medium text-slate-200"
          >
            [{HAZARD_CATALOG[hz].letter}] {HAZARD_CATALOG[hz].shortName}
          </span>
        ))}
        {test.hrp_risks.map((r) => (
          <span
            key={r}
            title={HRP_RISK_CATALOG[r]?.name}
            className="rounded border border-cyan-500/40 bg-cyan-950/60 px-2 py-0.5 font-mono text-[11px] text-cyan-200"
          >
            {r}: {HRP_RISK_CATALOG[r]?.name}
          </span>
        ))}
      </div>

      <section>
        <h4 className="text-xs font-bold uppercase tracking-wide text-slate-400">Why this test</h4>
        <p className="text-sm text-slate-200" data-testid="selftest-why">
          {test.why}
        </p>
        {test.protocol && <p className="mt-1 text-xs text-slate-400">Method: {test.protocol}</p>}
      </section>

      <section data-testid="selftest-band">
        <h4 className="text-xs font-bold uppercase tracking-wide text-slate-400">What counts as normal</h4>
        {keys.length === 0 ? (
          <p className="text-sm text-slate-300">No fixed band. The CMO compares it with your own earlier values.</p>
        ) : (
          <ul className="space-y-0.5 text-sm text-slate-200">
            {keys.map((key) => {
              const limit = limits[key];
              return (
                <li key={key} className="flex flex-wrap items-center gap-2">
                  <span>{limit?.label ?? key}:</span>
                  <span className="font-mono">{limit ? formatLimit(limit) : 'see config'}</span>
                  <LimitBadge limit={limit} />
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="rounded-lg border border-amber-500/40 bg-amber-950/30 p-3">
        <h4 className="text-xs font-bold uppercase tracking-wide text-amber-200">When to call the CMO</h4>
        <p className="text-sm text-amber-50" data-testid="selftest-escalation">
          {test.escalation}
        </p>
      </section>
    </div>
  );
};
