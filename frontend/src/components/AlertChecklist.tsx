import React, { useState } from 'react';

/**
 * Step-by-step crew actions for an alert (F-003). Steps come from the rule's `checklist:` in
 * config/rules.yaml. Ticks are local to this screen: a memory aid, not a record sent anywhere.
 */
const ticksByAlert = new Map<string, Set<number>>();

export const AlertChecklist: React.FC<{ alertId: string; steps: string[] | undefined; compact?: boolean }> = ({
  alertId,
  steps,
  compact = false,
}) => {
  const [done, setDone] = useState<Set<number>>(() => new Set(ticksByAlert.get(alertId) ?? []));
  if (!steps || steps.length === 0) return null;

  const toggle = (i: number): void => {
    const next = new Set(done);
    if (next.has(i)) next.delete(i);
    else next.add(i);
    ticksByAlert.set(alertId, next);
    setDone(next);
  };

  return (
    <div
      className="rounded-lg border border-cyan-500/30 bg-cyan-950/20 p-3 space-y-2"
      data-testid={`checklist-${alertId}`}
    >
      <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-cyan-200">
        <span>What to do now</span>
        <span className="font-mono text-cyan-300">
          {done.size}/{steps.length} done
        </span>
      </div>
      <ol className="space-y-1.5">
        {steps.map((step, i) => {
          const checked = done.has(i);
          return (
            <li key={i}>
              <label
                className={`flex min-h-[44px] cursor-pointer items-center gap-3 rounded-md border px-3 py-2 ${
                  compact ? 'text-xs' : 'text-sm'
                } ${
                  checked
                    ? 'border-emerald-500/50 bg-emerald-950/40 text-emerald-200 line-through'
                    : 'border-slate-700 bg-space-950 text-slate-100'
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(i)}
                  aria-label={`Step ${i + 1}: ${step}`}
                  className="h-5 w-5 shrink-0 accent-emerald-500"
                />
                <span className="font-mono text-cyan-300">{i + 1}.</span>
                <span>{step}</span>
              </label>
            </li>
          );
        })}
      </ol>
    </div>
  );
};
