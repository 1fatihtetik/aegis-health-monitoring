import React, { useState } from 'react';
import { limitMarker } from '../api/limits';
import { CountermeasurePlanItem, CountermeasureStatus, HAZARD_CATALOG } from '../api/types';
import { DataSourceBadge } from './DataSourceBadge';

const hhmm = (ts: string | null): string => (ts ? ts.slice(11, 16) : '');

/** Neutral on purpose: "not logged" is information (INFO), never red and never counted. No %, no score. */
const STATUS: Record<CountermeasureStatus, { icon: string; className: string; text: (i: CountermeasurePlanItem) => string }> = {
  DUE: {
    icon: '●',
    className: 'border-cyan-400/70 bg-cyan-950/40 text-cyan-100',
    text: (i) => (i.due_until ? `Now, until ${hhmm(i.due_until)} UTC` : 'On today’s plan'),
  },
  NOT_LOGGED: {
    icon: 'ℹ',
    className: 'border-slate-500 bg-slate-800/70 text-slate-200',
    text: () => 'Not logged yet · info only',
  },
  DONE: {
    icon: '✓',
    className: 'border-emerald-500/50 bg-emerald-950/30 text-emerald-200',
    text: (i) => `Done at ${hhmm(i.done_ts)} UTC`,
  },
  UPCOMING: {
    icon: '○',
    className: 'border-slate-700 bg-space-950 text-slate-400',
    text: (i) => `Later today at ${hhmm(i.slot_start)} UTC`,
  },
};

export function countermeasureStatusText(item: CountermeasurePlanItem): string {
  return STATUS[item.status].text(item);
}

/**
 * C-1: today's countermeasures for one crew member, on the routine board. Each item says why (from the catalog),
 * the prescription with its marker ("✓ NASA" or "Not a NASA limit · <kind>"), and offers Start (steps) / Done.
 * Logging takes 2 taps from the Self-tests tab (Done, then the minutes are already filled in for exercise).
 */
export const CountermeasurePlan: React.FC<{
  items: CountermeasurePlanItem[];
  connected: boolean;
  onDone: (item: CountermeasurePlanItem, minutes: number | null) => Promise<{ ok: boolean; message: string }>;
}> = ({ items, connected, onDone }) => {
  if (items.length === 0) return null;
  return (
    <section className="rounded-xl border border-slate-800 bg-space-900/80 p-4" data-testid="countermeasure-plan">
      <h3 className="text-sm font-bold text-slate-100">Today's countermeasures</h3>
      <p className="mb-2 text-[11px] text-slate-400">
        What to do today to stay healthy, and why. Tap Done when finished; the log stays on board.
      </p>
      <ul className="space-y-2">
        {items.map((i) => (
          <PlanRow key={i.countermeasure_id} item={i} connected={connected} onDone={onDone} />
        ))}
      </ul>
    </section>
  );
};

const PlanRow: React.FC<{
  item: CountermeasurePlanItem;
  connected: boolean;
  onDone: (item: CountermeasurePlanItem, minutes: number | null) => Promise<{ ok: boolean; message: string }>;
}> = ({ item, connected, onDone }) => {
  const [open, setOpen] = useState(false);
  const session = item.prescription[0];
  const [minutes, setMinutes] = useState<string>(item.log_minutes && session ? String(session.value) : '');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const meta = STATUS[item.status];

  const parsedMinutes = (): number | null | 'bad' => {
    if (!item.log_minutes) return null;
    const v = Number(minutes.trim().replace(',', '.'));
    return Number.isFinite(v) && v >= 1 && v <= item.minutes_max ? v : 'bad';
  };
  const done = async (): Promise<void> => {
    const m = parsedMinutes();
    if (m === 'bad') {
      setMessage(`Enter the minutes (1–${item.minutes_max}).`);
      return;
    }
    setBusy(true);
    const res = await onDone(item, m);
    setBusy(false);
    setMessage(res.message);
  };

  return (
    <li
      data-testid={`cm-${item.countermeasure_id}`}
      data-status={item.status}
      className="space-y-2 rounded-lg border border-slate-800 bg-space-950/60 p-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex flex-wrap items-center gap-2 text-sm">
          <span className={`rounded-md border px-2 py-0.5 text-xs font-bold ${meta.className}`}>
            {meta.icon} {meta.text(item)}
          </span>
          <strong className="text-slate-100">{item.title}</strong>
          <span className="text-[11px] text-slate-500">
            {item.hazards.map((h) => HAZARD_CATALOG[h].shortName).join(' · ')} · {item.hrp_risks.join(', ')}
          </span>
        </span>
        <span className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            className="min-h-[44px] rounded-lg border border-slate-600 bg-space-900 px-4 text-sm font-bold text-slate-100"
          >
            {open ? 'Hide steps' : 'Start'}
          </button>
          {item.status !== 'DONE' && (
            <button
              type="button"
              data-testid={`cm-done-${item.countermeasure_id}`}
              disabled={!connected || busy}
              onClick={() => void done()}
              className="min-h-[44px] rounded-lg bg-cyan-500 px-4 text-sm font-black text-slate-950 hover:bg-cyan-400 disabled:opacity-50"
            >
              Done
            </button>
          )}
        </span>
      </div>

      {item.added_because.length > 0 && (
        <p className="text-xs text-violet-200" data-testid={`cm-added-${item.countermeasure_id}`}>
          Added because: {item.added_because.join('; ')}
        </p>
      )}
      <p className="text-xs text-slate-300">{item.why}</p>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-300">
        {item.prescription.map((p) => (
          <li key={p.ref}>
            {p.label}: <strong className="text-slate-100">{p.value}</strong>{' '}
            <span
              className={p.verified ? 'font-mono text-emerald-300' : 'font-mono text-amber-300'}
              title={p.source_ref}
              data-testid={p.verified ? undefined : 'not-nasa-limit'}
            >
              {limitMarker(p.verified, { kind: p.source_kind, ref: p.ref, sourceRef: p.source_ref })}
            </span>
          </li>
        ))}
      </ul>

      {item.log_minutes && item.status !== 'DONE' && (
        <label className="flex flex-wrap items-center gap-2 text-xs text-slate-300">
          Minutes done
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={item.minutes_max}
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
            className="min-h-[44px] w-24 rounded-lg border border-slate-600 bg-space-950 px-2 text-sm text-slate-100"
            aria-label={`Minutes of ${item.title}`}
          />
        </label>
      )}

      {open && (
        <div className="space-y-2 rounded-lg border border-slate-800 bg-space-900/80 p-3 text-xs text-slate-200">
          <p>
            <span className="font-bold text-slate-100">Equipment:</span> {item.equipment}
          </p>
          <ol className="list-decimal space-y-1 pl-5">
            {item.steps.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
          <p className="text-amber-100">
            <span className="font-bold">When to involve the CMO:</span> {item.escalation}
          </p>
        </div>
      )}

      {item.status === 'DONE' && item.done_provenance && (
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
          {item.done_minutes !== null && <span>{item.done_minutes} min</span>}
          <DataSourceBadge compact source={{ provenance: item.done_provenance, dataset_id: null, basis: item.done_basis ?? '' }} />
        </div>
      )}
      {message && (
        <p className="text-xs text-slate-300" role="status">
          {message}
        </p>
      )}
    </li>
  );
};
