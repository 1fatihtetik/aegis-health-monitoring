import React from 'react';
import { AlertEvidence } from '../api/types';
import { signalLabel } from '../api/backend';
import { DataSourceBadge } from './DataSourceBadge';

/** Plain-language name for a context branch (rules.yaml `branch:`). */
const BRANCH_LABEL: Record<string, string> = {
  co2: 'cabin CO₂',
  hydration: 'low fluid intake / other non-environment cause',
};

function fmt(v: number): string {
  return Number.isFinite(v) ? String(Number(v.toFixed(2))) : '–';
}

/** Context badge for context-branching rules (same symptoms, different likely cause). */
export const ContextBadge: React.FC<{ evidence: AlertEvidence }> = ({ evidence }) => {
  if (!evidence.context) return null;
  const branch = BRANCH_LABEL[evidence.context.branch] ?? evidence.context.branch;
  return (
    <span
      className="rounded-md border border-fuchsia-400/60 bg-fuchsia-950/40 px-2.5 py-1 text-xs font-semibold text-fuchsia-100"
      data-testid="context-badge"
      title={`Context group: ${evidence.context.group}`}
    >
      ⇄ Same symptoms, likely cause: {branch}
    </span>
  );
};

/** Evidence rows: the primary comparison plus one card per compound member. */
export const EvidenceDetails: React.FC<{ evidence: AlertEvidence }> = ({ evidence }) => {
  const isCompound = evidence.signal === 'compound';
  return (
    <div className="space-y-2">
      <div className="text-xs font-mono text-slate-200">
        {isCompound ? (
          <>
            Conditions met: <strong className="text-amber-300">{evidence.value}</strong> of{' '}
            <strong>{evidence.limit}</strong> needed
          </>
        ) : (
          <>
            {signalLabel(evidence.signal)} ={' '}
            <strong className="text-amber-300">
              {fmt(evidence.value)} {evidence.unit ?? ''}
            </strong>{' '}
            | Limit: <strong>
              {evidence.op ?? ''} {fmt(evidence.limit)} {evidence.unit ?? ''}
            </strong>
          </>
        )}
        {evidence.window && (
          <>
            {' '}
            | Window: <strong>{evidence.window}</strong>
          </>
        )}
        {evidence.hysteresis_hold && (
          <span
            className="ml-2 rounded bg-slate-700 px-1.5 py-0.5 text-[10px] text-slate-100"
            title="Value is back inside the limit; the alert clears once it passes the clear margin."
          >
            ↺ hysteresis hold
          </span>
        )}
        <span className="ml-2 align-middle">
          <DataSourceBadge
            source={{ provenance: evidence.provenance, dataset_id: evidence.dataset_id ?? null, basis: evidence.basis, dataset: evidence.dataset }}
            compact
          />
        </span>
      </div>

      {evidence.clauses && evidence.clauses.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          {evidence.clauses.map((cl, idx) => {
            // A negated member counts toward the alert when it is NOT firing.
            const ok = cl.negated ? cl.firing === false : cl.firing !== false;
            return (
              <div
                key={idx}
                data-testid="evidence-clause"
                className={`rounded-lg border p-2.5 text-xs font-mono ${
                  ok ? 'border-amber-400/50 bg-amber-950/20' : 'border-slate-800 bg-space-900'
                }`}
              >
                <div className="flex items-center justify-between gap-2 font-sans font-semibold text-slate-200">
                  <span>{cl.label}</span>
                  <span className={ok ? 'text-amber-300' : 'text-slate-400'}>
                    {cl.negated
                      ? cl.firing
                        ? '✖ is true'
                        : '✓ not true'
                      : cl.firing === false
                        ? '○ not met'
                        : '● met'}
                  </span>
                </div>
                <div className="mt-0.5 text-amber-200">
                  {fmt(cl.value)} {cl.unit} ({cl.op} {fmt(cl.limit)} {cl.unit})
                </div>
                <div className="mt-0.5 text-[10px] text-slate-400">
                  {cl.limit_verified ? '✓ verified' : '⚠ unverified'} · {cl.source_ref}
                  {cl.hysteresis_hold ? ' · ↺ hysteresis hold' : ''}
                </div>
                <div className="mt-1">
                  <DataSourceBadge source={{ provenance: cl.provenance, dataset_id: cl.dataset_id ?? null, basis: cl.basis, dataset: cl.dataset }} compact />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
