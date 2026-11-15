import React, { useState } from 'react';
import { limitMarker } from '../api/limits';
import { CountermeasurePlanItem, HAZARD_CATALOG, ScheduleItem } from '../api/types';
import { DataSourceBadge } from './DataSourceBadge';

const hhmm = (ts: string | null): string => (ts ? ts.slice(11, 16) : '');

type Section = 'now' | 'later' | 'done';
const SECTIONS: { id: Section; title: string }[] = [
  { id: 'now', title: 'Now' },
  { id: 'later', title: 'Later' },
  { id: 'done', title: 'Done' },
];

/** Neutral chips on purpose: "not done yet" / "not logged" are information (INFO), never red, never counted. */
const CHIP = {
  now: 'border-cyan-400/70 bg-cyan-950/40 text-cyan-100',
  info: 'border-slate-500 bg-slate-800/70 text-slate-200',
  done: 'border-emerald-500/50 bg-emerald-950/30 text-emerald-200',
  later: 'border-slate-700 bg-space-950 text-slate-400',
};

export function testStatus(i: ScheduleItem): { icon: string; text: string; chip: string } {
  switch (i.status) {
    case 'DUE':
      return { icon: '●', text: `Due now, until ${hhmm(i.due_until)} UTC`, chip: CHIP.now };
    case 'OVERDUE':
      return { icon: 'ℹ', text: `Not done yet (was due by ${hhmm(i.due_until)} UTC) · info only`, chip: CHIP.info };
    case 'DONE':
      return { icon: '✓', text: `Done at ${hhmm(i.done_ts)} UTC`, chip: CHIP.done };
    default:
      return { icon: '○', text: `Next on ${i.next_due ? i.next_due.slice(5, 10) : ''} at ${hhmm(i.next_due)} UTC`, chip: CHIP.later };
  }
}

export function countermeasureStatus(i: CountermeasurePlanItem): { icon: string; text: string; chip: string } {
  switch (i.status) {
    case 'DUE':
      return { icon: '●', text: i.due_until ? `Now, until ${hhmm(i.due_until)} UTC` : 'On today’s plan', chip: CHIP.now };
    case 'NOT_LOGGED':
      return { icon: 'ℹ', text: 'Not logged yet · info only', chip: CHIP.info };
    case 'DONE':
      return { icon: '✓', text: `Done at ${hhmm(i.done_ts)} UTC`, chip: CHIP.done };
    default:
      return { icon: '○', text: `Later today at ${hhmm(i.slot_start)} UTC`, chip: CHIP.later };
  }
}

type Row =
  | { kind: 'test'; key: string; section: Section; time: string; item: ScheduleItem }
  | { kind: 'cm'; key: string; section: Section; time: string; item: CountermeasurePlanItem };

/** Pure: one time-ordered list from the self-test routine and today's countermeasures. */
export function todayRows(routine: ScheduleItem[], countermeasures: CountermeasurePlanItem[]): Row[] {
  const rows: Row[] = [
    ...routine.map((i): Row => {
      const section: Section = i.status === 'DONE' ? 'done' : i.status === 'UPCOMING' ? 'later' : 'now';
      const time = section === 'done' ? i.done_ts : section === 'later' ? i.next_due : i.due_until;
      return { kind: 'test', key: `t-${i.test_id}-${i.reason}`, section, time: time ?? '', item: i };
    }),
    ...countermeasures.map((i): Row => {
      const section: Section = i.status === 'DONE' ? 'done' : i.status === 'UPCOMING' ? 'later' : 'now';
      const time = section === 'done' ? i.done_ts : section === 'later' ? i.slot_start : i.due_until ?? i.slot_start;
      return { kind: 'cm', key: `c-${i.countermeasure_id}`, section, time: time ?? '', item: i };
    }),
  ];
  const order: Record<Section, number> = { now: 0, later: 1, done: 2 };
  return rows.sort((a, b) => order[a.section] - order[b.section] || (a.time || '9').localeCompare(b.time || '9'));
}

type DoneHandler = (item: CountermeasurePlanItem, minutes: number | null) => Promise<{ ok: boolean; message: string }>;

/**
 * Block S, S-2: today's self-tests and countermeasures in one list (Now / Later / Done). A row is a title, a status
 * and one big button: Start opens a test, Done logs a countermeasure (exercise logs the prescribed minutes). Why,
 * steps and prescriptions open on tap. No %, no score, no ranking; "not done" is neutral information.
 */
export const TodayList: React.FC<{
  routine: ScheduleItem[];
  countermeasures: CountermeasurePlanItem[];
  connected: boolean;
  onStart: (testId: string) => void;
  onDone: DoneHandler;
}> = ({ routine, countermeasures, connected, onStart, onDone }) => {
  const rows = todayRows(routine, countermeasures);
  if (rows.length === 0) return null;
  return (
    <section className="space-y-3 rounded-xl border border-slate-800 bg-space-900/80 p-4" data-testid="today-list">
      {SECTIONS.map(({ id, title }) => {
        const mine = rows.filter((r) => r.section === id);
        if (mine.length === 0) return null;
        return (
          <div key={id} className="space-y-2" data-testid={`today-${id}`}>
            <h3 className="text-sm font-bold text-slate-100">{title}</h3>
            <ul className="space-y-2">
              {mine.map((r) =>
                r.kind === 'test' ? (
                  <TestRow key={r.key} item={r.item} onStart={onStart} />
                ) : (
                  <CountermeasureRow key={r.key} item={r.item} connected={connected} onDone={onDone} />
                )
              )}
            </ul>
          </div>
        );
      })}
    </section>
  );
};

const rowClass = 'rounded-lg border border-slate-800 bg-space-950/60 p-2';
const bigButton =
  'min-h-[44px] rounded-lg bg-cyan-500 px-4 text-sm font-black text-slate-950 hover:bg-cyan-400 disabled:opacity-50';

const TestRow: React.FC<{ item: ScheduleItem; onStart: (testId: string) => void }> = ({ item, onStart }) => {
  const st = testStatus(item);
  return (
    <li
      data-testid={`routine-${item.test_id}${item.reason === 'routine' ? '' : '-gravity'}`}
      data-status={item.status}
      className={`flex flex-wrap items-center justify-between gap-2 ${rowClass}`}
    >
      <span className="flex flex-wrap items-center gap-2 text-sm">
        <span className={`rounded-md border px-2 py-0.5 text-xs font-bold ${st.chip}`}>
          {st.icon} {st.text}
        </span>
        <strong className="text-slate-100">{item.title}</strong>
        {item.reason !== 'routine' && (
          <span className="rounded border border-violet-400/50 px-1.5 py-0.5 text-[11px] text-violet-200">
            Extra check after a gravity increase
          </span>
        )}
      </span>
      {(item.status === 'DUE' || item.status === 'OVERDUE') && (
        <button type="button" onClick={() => onStart(item.test_id)} className={bigButton}>
          Start
        </button>
      )}
    </li>
  );
};

const CountermeasureRow: React.FC<{ item: CountermeasurePlanItem; connected: boolean; onDone: DoneHandler }> = ({
  item,
  connected,
  onDone,
}) => {
  const [open, setOpen] = useState(false);
  const session = item.prescription[0];
  const [minutes, setMinutes] = useState<string>(item.log_minutes && session ? String(session.value) : '');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const st = countermeasureStatus(item);

  const done = async (): Promise<void> => {
    let m: number | null = null;
    if (item.log_minutes) {
      m = Number(minutes.trim().replace(',', '.'));
      if (!Number.isFinite(m) || m < 1 || m > item.minutes_max) {
        setOpen(true);
        setMessage(`Enter the minutes (1–${item.minutes_max}).`);
        return;
      }
    }
    setBusy(true);
    const res = await onDone(item, m);
    setBusy(false);
    setMessage(res.message);
  };

  return (
    <li data-testid={`cm-${item.countermeasure_id}`} data-status={item.status} className={`space-y-2 ${rowClass}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex flex-wrap items-center gap-2 text-sm">
          <span className={`rounded-md border px-2 py-0.5 text-xs font-bold ${st.chip}`}>
            {st.icon} {st.text}
          </span>
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            className="min-h-[44px] rounded-lg px-1 text-left font-bold text-slate-100 underline-offset-2 hover:underline"
          >
            {open ? '▾' : '▸'} {item.title}
          </button>
          <span className="rounded border border-slate-600 px-1.5 py-0.5 text-[11px] text-slate-300">Countermeasure</span>
        </span>
        {item.status !== 'DONE' && (
          <button
            type="button"
            data-testid={`cm-done-${item.countermeasure_id}`}
            disabled={!connected || busy}
            onClick={() => void done()}
            className={bigButton}
          >
            Done
          </button>
        )}
      </div>

      {item.added_because.length > 0 && (
        <p className="text-xs text-violet-200" data-testid={`cm-added-${item.countermeasure_id}`}>
          Added because: {item.added_because.join('; ')}
        </p>
      )}

      {open && (
        <div className="space-y-2 rounded-lg border border-slate-800 bg-space-900/80 p-3 text-xs text-slate-200" data-testid={`cm-details-${item.countermeasure_id}`}>
          <p>{item.why}</p>
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
          <p className="text-[11px] text-slate-400">
            {item.hazards.map((h) => HAZARD_CATALOG[h].shortName).join(' · ')} · {item.hrp_risks.join(', ')}
          </p>
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
