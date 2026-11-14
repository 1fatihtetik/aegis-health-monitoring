import React from 'react';
import { HAZARD_CATALOG, ScheduleItem, ScheduleStatus } from '../api/types';

const hhmm = (ts: string | null): string => (ts ? ts.slice(11, 16) : '');

/** Neutral styling on purpose: overdue is information (INFO), never red, never counted (no gamification). */
const STATUS: Record<ScheduleStatus, { icon: string; className: string; text: (i: ScheduleItem) => string }> = {
  DUE: {
    icon: '●',
    className: 'border-cyan-400/70 bg-cyan-950/40 text-cyan-100',
    text: (i) => `Due now, until ${hhmm(i.due_until)} UTC`,
  },
  OVERDUE: {
    icon: 'ℹ',
    className: 'border-slate-500 bg-slate-800/70 text-slate-200',
    text: (i) => `Not done yet (was due by ${hhmm(i.due_until)} UTC) · info only`,
  },
  DONE: {
    icon: '✓',
    className: 'border-emerald-500/50 bg-emerald-950/30 text-emerald-200',
    text: (i) => `Done at ${hhmm(i.done_ts)} UTC`,
  },
  UPCOMING: {
    icon: '○',
    className: 'border-slate-700 bg-space-950 text-slate-400',
    text: (i) => `Next on ${i.next_due ? i.next_due.slice(5, 10) : ''} at ${hhmm(i.next_due)} UTC`,
  },
};

export function statusText(item: ScheduleItem): string {
  return STATUS[item.status].text(item);
}

/**
 * T-1 routine: what is due, done or not done yet for one crew member, from the simulation clock. Overdue never
 * raises an alert or lowers readiness. "Start" opens the test (tab -> Start: 2 taps).
 */
export const RoutineBoard: React.FC<{ items: ScheduleItem[]; onStart: (testId: string) => void }> = ({
  items,
  onStart,
}) => {
  if (items.length === 0) return null;
  return (
    <section className="rounded-xl border border-slate-800 bg-space-900/80 p-4" data-testid="routine-board">
      <h3 className="mb-2 text-sm font-bold text-slate-100">Today's routine</h3>
      <ul className="space-y-2">
        {items.map((i) => {
          const meta = STATUS[i.status];
          return (
            <li
              key={`${i.test_id}-${i.reason}`}
              data-testid={`routine-${i.test_id}${i.reason === 'routine' ? '' : '-gravity'}`}
              data-status={i.status}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-800 bg-space-950/60 p-2"
            >
              <span className="flex flex-wrap items-center gap-2 text-sm">
                <span className={`rounded-md border px-2 py-0.5 text-xs font-bold ${meta.className}`}>
                  {meta.icon} {meta.text(i)}
                </span>
                <strong className="text-slate-100">{i.title}</strong>
                {i.reason !== 'routine' && (
                  <span className="rounded border border-violet-400/50 px-1.5 py-0.5 text-[11px] text-violet-200">
                    Extra check after a gravity increase
                  </span>
                )}
                <span className="text-[11px] text-slate-500">
                  {i.hazards.map((h) => HAZARD_CATALOG[h].shortName).join(' · ')}
                </span>
              </span>
              {(i.status === 'DUE' || i.status === 'OVERDUE') && (
                <button
                  type="button"
                  onClick={() => onStart(i.test_id)}
                  className="min-h-[44px] rounded-lg bg-cyan-500 px-4 text-sm font-black text-slate-950 hover:bg-cyan-400"
                >
                  Start
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
};
