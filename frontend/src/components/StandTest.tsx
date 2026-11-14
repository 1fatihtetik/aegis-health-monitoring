import React, { useCallback, useEffect, useRef, useState } from 'react';
import { parseEntry } from '../api/selftests';
import {
  Reading,
  StandingReading,
  clock,
  dueCheckpoint,
  protocolMinutes,
  realMs,
  standParams,
  summarizeStand,
} from '../api/standtest';
import { SelfTestDef, SelfTestField, SubmitOutcome } from '../api/types';

type Stage = 'setup' | 'supine' | 'standing' | 'stopped' | 'done';

export interface StandTestProps {
  test: SelfTestDef;
  /** Current gravity (g). The test needs gravity; in weightlessness standing does not load the circulation. */
  gravityG: number;
  connected: boolean;
  onSubmit: (values: Record<string, number>) => Promise<SubmitOutcome>;
  /** Injectable for tests; defaults to performance.now. */
  now?: () => number;
}

const READING_SIGNALS = ['heart_rate', 'bp_systolic', 'bp_diastolic'] as const;
type RawReading = Partial<Record<(typeof READING_SIGNALS)[number], string>>;

/** Parses the three numbers of one reading with the catalog's typing ranges. */
function parseReading(fields: SelfTestField[], raw: RawReading): { reading: Reading | null; error: string | null } {
  const values: Record<string, number> = {};
  for (const signal of READING_SIGNALS) {
    const f = fields.find((x) => x.signal === signal);
    if (!f) return { reading: null, error: `Catalog has no ${signal} field.` };
    const { value, error } = parseEntry(f, raw[signal] ?? '');
    if (error || value === null) return { reading: null, error };
    values[signal] = value;
  }
  if (values.bp_diastolic >= values.bp_systolic) {
    return { reading: null, error: 'The bottom number must be lower than the top number. Check the cuff display.' };
  }
  return { reading: { hr: values.heart_rate, sbp: values.bp_systolic, dbp: values.bp_diastolic }, error: null };
}

/**
 * T-5 10-minute stand test (protocol confirmed 2026-11-15): safety setup, 5 min lying down with a reading, then
 * standing against a wall with readings at 1, 3, 5 and 10 min. STOP is always on screen while standing: it saves
 * what was captured at once with the early-stop flag (never discarded) and shows what to do now. The criteria are
 * judged by the onboard rules from limits.yaml; this screen only measures time and collects the readings.
 */
export const StandTest: React.FC<StandTestProps> = ({ test, gravityG, connected, onSubmit, now = () => performance.now() }) => {
  const params = standParams(test);
  const [stage, setStage] = useState<Stage>('setup');
  const [elapsed, setElapsed] = useState(0);
  const [supine, setSupine] = useState<Reading | null>(null);
  const [standing, setStanding] = useState<StandingReading[]>([]);
  const [missed, setMissed] = useState<number[]>([]);
  const [raw, setRaw] = useState<RawReading>({});
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<SubmitOutcome | null>(null);
  const [summary, setSummary] = useState<Record<string, number> | null>(null);
  const [busy, setBusy] = useState(false);
  const startRef = useRef(0);
  const sentRef = useRef(false);

  const enoughGravity = gravityG >= params.min_gravity_g;
  const supineMs = realMs(params.supine_s, params);
  const checkpointMs = params.checkpoints_min.map((m) => realMs(m * 60, params));

  useEffect(() => {
    if (stage !== 'supine' && stage !== 'standing') return;
    const id = window.setInterval(() => setElapsed(now() - startRef.current), 250);
    return () => window.clearInterval(id);
  }, [stage, now]);

  const begin = (next: Stage): void => {
    startRef.current = now();
    setElapsed(0);
    setRaw({});
    setError(null);
    setStage(next);
  };

  const finish = useCallback(
    async (stoppedEarly: boolean, readings: StandingReading[], minutes: number): Promise<void> => {
      if (sentRef.current || !supine) return;
      sentRef.current = true; // one submission per test, also if STOP is tapped twice
      const values = summarizeStand(supine, readings, stoppedEarly, minutes);
      setSummary(values);
      setStage(stoppedEarly ? 'stopped' : 'done');
      setBusy(true);
      const res = await onSubmit(values);
      setBusy(false);
      setOutcome(res);
    },
    [supine, onSubmit],
  );

  // Standing: the newest due checkpoint is open; one that was never entered when the next came due is missed.
  const due = stage === 'standing' ? dueCheckpoint(elapsed, params) : -1;
  const recorded = new Set(standing.map((r) => r.minute));
  const openIdx = due >= 0 && !recorded.has(params.checkpoints_min[due]) && !missed.includes(due) ? due : -1;
  useEffect(() => {
    if (stage !== 'standing' || due < 1) return;
    const prev = due - 1;
    if (!recorded.has(params.checkpoints_min[prev]) && !missed.includes(prev)) setMissed((m) => [...m, prev]);
  }, [due, stage, recorded, missed, params.checkpoints_min]);

  const saveSupine = (): void => {
    const { reading, error: err } = parseReading(test.fields, raw);
    setError(err);
    if (!reading) return;
    setSupine(reading);
    begin('standing');
  };

  const lastIdx = params.checkpoints_min.length - 1;
  const saveStanding = (): void => {
    const { reading, error: err } = parseReading(test.fields, raw);
    setError(err);
    if (!reading || openIdx < 0) return;
    const next = [...standing, { ...reading, minute: params.checkpoints_min[openIdx] }];
    setStanding(next);
    setRaw({});
    if (openIdx === lastIdx) void finish(false, next, params.stand_s / 60);
  };
  const skipLast = (): void => {
    setMissed((m) => [...m, lastIdx]);
    void finish(false, standing, params.stand_s / 60);
  };

  const stop = (symptoms: boolean): void => {
    void finish(symptoms, standing, protocolMinutes(elapsed, params));
  };

  const inputs = (
    <div className="grid gap-2 sm:grid-cols-3">
      {READING_SIGNALS.map((signal) => {
        const f = test.fields.find((x) => x.signal === signal);
        if (!f) return null;
        return (
          <label key={signal} className="block space-y-1 rounded-lg border border-slate-800 bg-space-950/80 p-2">
            <span className="block text-xs font-semibold text-slate-100">{f.label}</span>
            <span className="flex items-center gap-2">
              <input
                type="text"
                inputMode="decimal"
                aria-label={`${f.label} (${f.unit})`}
                data-testid={`stand-${signal}`}
                value={raw[signal] ?? ''}
                onChange={(e) => setRaw((prev) => ({ ...prev, [signal]: e.target.value }))}
                className="min-h-[44px] w-24 rounded-lg border border-slate-600 bg-space-900 px-2 font-mono text-lg text-white"
              />
              <span className="font-mono text-xs text-slate-300">{f.unit}</span>
            </span>
          </label>
        );
      })}
    </div>
  );

  return (
    <div className="space-y-4" data-testid={`stand-test-${test.id}`}>
      {test.short_mode_note && (
        <p data-testid="stand-short-note" className="rounded-lg border border-violet-400/70 bg-violet-950/40 p-2 text-sm font-bold text-violet-100">
          ◐ {test.short_mode_note}
        </p>
      )}

      {stage === 'setup' && (
        <>
          <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-100" data-testid="selftest-steps">
            {test.steps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
          {!enoughGravity && (
            <p data-testid="stand-needs-gravity" className="rounded-lg border border-amber-500/60 bg-amber-950/40 p-3 text-sm font-semibold text-amber-100">
              ▲ Needs gravity: now {gravityG} g. In weightlessness standing does not load the heart and blood vessels, so
              this test only runs on a planet or moon surface (at least {params.min_gravity_g} g).
            </p>
          )}
          <button
            type="button"
            data-testid="stand-start"
            disabled={!connected || !enoughGravity}
            onClick={() => begin('supine')}
            className="min-h-[56px] w-full rounded-xl bg-cyan-500 px-6 text-base font-black text-slate-950 hover:bg-cyan-400 disabled:opacity-40"
          >
            Area is safe: start lying down ({clock(supineMs)})
          </button>
        </>
      )}

      {stage === 'supine' && (
        <section className="space-y-3 rounded-xl border border-slate-700 bg-space-950/80 p-4" data-testid="stand-supine">
          <h4 className="text-sm font-black text-white">Step 1 of 2: lie flat and still</h4>
          {elapsed < supineMs ? (
            <p className="font-mono text-4xl font-black text-cyan-200" data-testid="stand-countdown">
              {clock(supineMs - elapsed)}
            </p>
          ) : (
            <>
              <p className="text-sm text-slate-100">Still lying down: measure your pulse and blood pressure now and enter them.</p>
              {inputs}
              <button
                type="button"
                data-testid="stand-save-supine"
                onClick={saveSupine}
                className="min-h-[56px] w-full rounded-xl bg-cyan-500 px-6 text-base font-black text-slate-950"
              >
                Save lying-down reading, then stand up against the wall
              </button>
            </>
          )}
        </section>
      )}

      {stage === 'standing' && (
        <section className="space-y-3 rounded-xl border border-slate-700 bg-space-950/80 p-4" data-testid="stand-standing">
          <button
            type="button"
            data-testid="stand-stop"
            onClick={() => stop(true)}
            className="min-h-[64px] w-full rounded-xl border-2 border-red-300 bg-red-600 px-6 text-lg font-black text-white hover:bg-red-500"
          >
            ✖ STOP: dizzy / feeling faint
          </button>
          <h4 className="text-sm font-black text-white">
            Step 2 of 2: standing, leaning lightly on the wall ·{' '}
            <span className="font-mono">{clock(elapsed)}</span> of {clock(realMs(params.stand_s, params))}
          </h4>
          {openIdx >= 0 ? (
            <div className="space-y-2" data-testid={`stand-checkpoint-${params.checkpoints_min[openIdx]}`}>
              <p className="text-sm font-bold text-amber-100">
                ▲ Minute {params.checkpoints_min[openIdx]}: measure pulse and blood pressure now (keep standing still).
              </p>
              {inputs}
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  data-testid="stand-save-reading"
                  onClick={saveStanding}
                  className="min-h-[48px] rounded-xl bg-cyan-500 px-5 text-sm font-black text-slate-950"
                >
                  Save minute {params.checkpoints_min[openIdx]} reading
                </button>
                {openIdx === lastIdx && (
                  <button
                    type="button"
                    onClick={skipLast}
                    className="min-h-[48px] rounded-xl border border-slate-500 px-4 text-sm font-bold text-slate-100"
                  >
                    No reading, end the test
                  </button>
                )}
              </div>
            </div>
          ) : (
            <p className="text-sm text-slate-200">
              Stand still, legs relaxed.{' '}
              {due + 1 < checkpointMs.length && (
                <>
                  Next reading at minute {params.checkpoints_min[due + 1]} (in{' '}
                  <span className="font-mono">{clock(checkpointMs[due + 1] - elapsed)}</span>).
                </>
              )}
            </p>
          )}
          {standing.length > 0 && (
            <p className="text-xs text-slate-400" data-testid="stand-captured">
              Saved: {standing.map((r) => `min ${r.minute} ${r.sbp}/${r.dbp} mmHg, ${r.hr} bpm`).join(' · ')}
              {missed.length > 0 && ` · missed: min ${missed.map((i) => params.checkpoints_min[i]).join(', ')}`}
            </p>
          )}
          <button
            type="button"
            onClick={() => stop(false)}
            className="min-h-[44px] rounded-lg border border-slate-600 px-4 text-xs font-bold text-slate-300"
          >
            End early for another reason (I feel fine)
          </button>
        </section>
      )}

      {stage === 'stopped' && (
        <section role="alert" className="space-y-2 rounded-xl border-2 border-red-400 bg-red-950/60 p-4" data-testid="stand-stopped">
          <h4 className="text-lg font-black text-white">✖ Lie down now</h4>
          <ol className="list-decimal space-y-1 pl-5 text-base font-semibold text-red-50">
            {(test.stop_steps ?? []).map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
          <p className="text-xs text-red-100">
            Your readings so far and the early stop are being saved on board for the CMO. Stopping early is never a
            failed test: it is a result.
          </p>
        </section>
      )}

      {(stage === 'stopped' || stage === 'done') && summary && (
        <section className="rounded-xl border border-slate-700 bg-space-950/80 p-3 text-xs text-slate-200" data-testid="stand-summary">
          <p className="font-bold text-slate-100">What was recorded</p>
          <p>
            Lying down: {supine ? `${supine.sbp}/${supine.dbp} mmHg, ${supine.hr} bpm` : '–'} · Stood{' '}
            {summary.stand_minutes} min · Standing readings: {standing.length}
            {summary.stand_sbp_drop !== undefined &&
              ` · top number fell by ${summary.stand_sbp_drop} mmHg, bottom by ${summary.stand_dbp_drop} mmHg, pulse rose by ${summary.stand_hr_rise} bpm`}
          </p>
          <p className="mt-1 text-slate-400">The onboard rules compare these with the stand-test criteria above. Decision support only.</p>
        </section>
      )}

      {error && (
        <p role="alert" className="text-xs font-semibold text-red-300">
          {error}
        </p>
      )}
      {!connected && stage !== 'setup' && (
        <p className="text-xs font-semibold text-amber-300">
          ▲ Onboard server not reachable: write the readings down and tell the CMO. The Earth link is not needed.
        </p>
      )}
      {busy && <p className="text-xs text-slate-400">Saving on board…</p>}
      {outcome && (
        <p role="status" data-testid="selftest-outcome" className={`text-sm font-semibold ${outcome.ok ? 'text-emerald-300' : 'text-amber-300'}`}>
          {outcome.ok ? '✓ ' : '▲ '}
          {outcome.message}
        </p>
      )}
    </div>
  );
};
