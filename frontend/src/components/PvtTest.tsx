import React, { useCallback, useEffect, useRef, useState } from 'react';
import { classify, nextIsiMs, pvtParams, summarize, Trial } from '../api/pvt';
import { SelfTestDef, SubmitOutcome } from '../api/types';

type Phase = 'ready' | 'running' | 'done';

export interface PvtTestProps {
  test: SelfTestDef;
  /** Lapse limit in ms, from config/limits.yaml (cognition.pvt_lapse_ms). */
  lapseMs: number;
  connected: boolean;
  onSubmit: (values: Record<string, number>) => Promise<SubmitOutcome>;
  /** Injectable for tests; defaults to performance.now / Math.random. */
  now?: () => number;
  rand?: () => number;
}

/**
 * T-2 PVT-B reaction-time test. A counter appears after a random 1-4 s gap; tap the box or press Space as fast as
 * possible. Lapses, false starts and timeouts follow the catalog parameters and the lapse limit from limits.yaml.
 * The crew can stop at any time. A demo-length variant always shows that it is not the real protocol.
 */
export const PvtTest: React.FC<PvtTestProps> = ({
  test,
  lapseMs,
  connected,
  onSubmit,
  now = () => performance.now(),
  rand = Math.random,
}) => {
  const params = pvtParams(test);
  const [phase, setPhase] = useState<Phase>('ready');
  const [trials, setTrials] = useState<Trial[]>([]);
  const [shownAt, setShownAt] = useState<number | null>(null);
  const [counter, setCounter] = useState(0);
  const [remaining, setRemaining] = useState(params.duration_s);
  const [outcome, setOutcome] = useState<SubmitOutcome | null>(null);
  const [busy, setBusy] = useState(false);

  const startRef = useRef(0);
  const shownRef = useRef<number | null>(null);
  const timers = useRef<number[]>([]);

  const clearTimers = (): void => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  };

  const finish = useCallback((): void => {
    clearTimers();
    shownRef.current = null;
    setShownAt(null);
    setPhase('done');
  }, []);

  const scheduleNext = useCallback((): void => {
    const elapsed = now() - startRef.current;
    const left = params.duration_s * 1000 - elapsed;
    const gap = nextIsiMs(rand, params);
    if (gap >= left) return; // no time for another counter; the end timer finishes the test
    timers.current.push(
      window.setTimeout(() => {
        const t = now();
        shownRef.current = t;
        setShownAt(t);
        timers.current.push(
          window.setTimeout(() => {
            if (shownRef.current !== t) return;
            shownRef.current = null;
            setShownAt(null);
            setTrials((prev) => [...prev, { rt_ms: null, kind: 'timeout' }]);
            scheduleNext();
          }, params.timeout_ms)
        );
      }, gap)
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.duration_s, params.isi_min_s, params.isi_max_s, params.timeout_ms]);

  const start = (): void => {
    clearTimers();
    setTrials([]);
    setOutcome(null);
    setPhase('running');
    startRef.current = now();
    setRemaining(params.duration_s);
    timers.current.push(window.setTimeout(finish, params.duration_s * 1000));
    scheduleNext();
  };

  const stop = (): void => {
    clearTimers();
    shownRef.current = null;
    setShownAt(null);
    setTrials([]);
    setPhase('ready');
  };

  const respond = useCallback((): void => {
    if (phase !== 'running') return;
    const shown = shownRef.current;
    if (shown === null) {
      // Tapped before the counter: a false start. The next counter is rescheduled so taps cannot be timed.
      setTrials((prev) => [...prev, { rt_ms: null, kind: 'false_start' }]);
      timers.current.forEach((t) => window.clearTimeout(t));
      timers.current = [window.setTimeout(finish, Math.max(0, params.duration_s * 1000 - (now() - startRef.current)))];
      scheduleNext();
      return;
    }
    const rt = now() - shown;
    shownRef.current = null;
    setShownAt(null);
    setTrials((prev) => [...prev, { rt_ms: Math.round(rt), kind: classify(rt, lapseMs, params) }]);
    scheduleNext();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, lapseMs, finish, scheduleNext]);

  // Space bar responds too (keyboard users, AGENTS.md section 8).
  useEffect(() => {
    if (phase !== 'running') return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.code === 'Space' || e.key === ' ') {
        e.preventDefault();
        respond();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, respond]);

  // Running counter (ms since the counter appeared) and time left.
  useEffect(() => {
    if (phase !== 'running') return;
    const id = window.setInterval(() => {
      const t = now();
      setRemaining(Math.max(0, Math.ceil(params.duration_s - (t - startRef.current) / 1000)));
      if (shownRef.current !== null) setCounter(Math.round(t - shownRef.current));
    }, 31);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, params.duration_s]);

  useEffect(() => () => clearTimers(), []);

  const summary = summarize(trials);

  const save = async (): Promise<void> => {
    if (summary.mean_rt === null) return;
    setBusy(true);
    const res = await onSubmit({
      pvt_mean_rt: summary.mean_rt,
      pvt_lapses: summary.lapses,
      pvt_false_starts: summary.false_starts,
    });
    setBusy(false);
    setOutcome(res);
  };

  return (
    <div className="space-y-4" data-testid={`pvt-test-${test.id}`}>
      {test.short_mode_note && (
        <p
          data-testid="pvt-short-note"
          className="rounded-lg border border-violet-400/70 bg-violet-950/40 p-2 text-sm font-bold text-violet-100"
        >
          ◐ {test.short_mode_note}
        </p>
      )}
      <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-100" data-testid="selftest-steps">
        {test.steps.map((s, i) => (
          <li key={i}>{s}</li>
        ))}
      </ol>

      {phase === 'ready' && (
        <button
          type="button"
          data-testid="pvt-start"
          onClick={start}
          className="min-h-[56px] w-full rounded-xl bg-cyan-500 px-6 text-base font-black text-slate-950 hover:bg-cyan-400"
        >
          Start ({params.duration_s >= 60 ? `${params.duration_s / 60} min` : `${params.duration_s} s`})
        </button>
      )}

      {phase === 'running' && (
        <div className="space-y-2">
          <button
            type="button"
            data-testid="pvt-target"
            aria-label={shownAt !== null ? 'Counter showing: tap now' : 'Wait for the counter'}
            onPointerDown={(e) => {
              e.preventDefault();
              respond();
            }}
            className={`flex h-56 w-full select-none items-center justify-center rounded-2xl border-4 font-mono text-5xl font-black ${
              shownAt !== null ? 'border-amber-300 bg-amber-950/60 text-amber-200' : 'border-slate-700 bg-space-950 text-slate-600'
            }`}
          >
            {shownAt !== null ? counter : 'Wait…'}
          </button>
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span data-testid="pvt-remaining">{remaining} s left</span>
            <button
              type="button"
              onClick={stop}
              className="min-h-[44px] rounded-lg border border-slate-600 bg-space-900 px-4 text-sm font-bold text-slate-200"
            >
              Stop test (no result)
            </button>
          </div>
        </div>
      )}

      {phase === 'done' && (
        <div className="space-y-3 rounded-xl border border-slate-700 bg-space-950/70 p-4" data-testid="pvt-summary">
          <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-xs text-slate-400">Mean reaction time</dt>
              <dd className="font-mono text-lg text-white">{summary.mean_rt ?? '–'} ms</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-400">Lapses (slower than {lapseMs} ms)</dt>
              <dd className="font-mono text-lg text-white">{summary.lapses}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-400">False starts</dt>
              <dd className="font-mono text-lg text-white">{summary.false_starts}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-400">Responses</dt>
              <dd className="font-mono text-lg text-white">{summary.responses}</dd>
            </div>
          </dl>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              data-testid="pvt-save"
              disabled={!connected || busy || summary.mean_rt === null || outcome?.ok === true}
              onClick={() => void save()}
              className="min-h-[48px] rounded-xl bg-cyan-500 px-5 text-sm font-black text-slate-950 disabled:opacity-40"
            >
              Save result
            </button>
            <button
              type="button"
              onClick={start}
              className="min-h-[48px] rounded-xl border border-slate-600 bg-space-900 px-5 text-sm font-bold text-slate-100"
            >
              Run again
            </button>
          </div>
          {summary.mean_rt === null && <p className="text-xs text-amber-300">▲ No responses recorded; run the test again.</p>}
          {outcome && (
            <p role="status" className={`text-sm font-semibold ${outcome.ok ? 'text-emerald-300' : 'text-amber-300'}`}>
              {outcome.ok ? '✓ ' : '▲ '}
              {outcome.message}
            </p>
          )}
        </div>
      )}
    </div>
  );
};
