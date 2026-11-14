/**
 * T-2 PVT-B logic (Basner, Mollicone & Dinges 2011): pure functions, unit-tested. The protocol parameters come from
 * the catalog (config/selftests.yaml `params`) and the lapse limit from config/limits.yaml; nothing is hardcoded here.
 */
import { SelfTestDef } from './types';

export interface PvtParams {
  duration_s: number;
  isi_min_s: number;
  isi_max_s: number;
  false_start_ms: number;
  timeout_ms: number;
}

export type TrialKind = 'ok' | 'lapse' | 'false_start' | 'timeout';

export interface Trial {
  /** Reaction time in ms; null for a tap before the counter appeared or for no tap at all. */
  rt_ms: number | null;
  kind: TrialKind;
}

export interface PvtSummary {
  mean_rt: number | null;
  lapses: number;
  false_starts: number;
  responses: number;
}

const KEYS: (keyof PvtParams)[] = ['duration_s', 'isi_min_s', 'isi_max_s', 'false_start_ms', 'timeout_ms'];

/** Reads the protocol parameters of a PVT catalog entry; throws if one is missing (config error, not user error). */
export function pvtParams(test: SelfTestDef): PvtParams {
  const p = test.params ?? {};
  for (const k of KEYS) {
    if (typeof p[k] !== 'number') throw new Error(`selftests.yaml ${test.id}: params.${k} is missing`);
  }
  if (p.isi_min_s > p.isi_max_s) throw new Error(`selftests.yaml ${test.id}: isi_min_s > isi_max_s`);
  return { duration_s: p.duration_s, isi_min_s: p.isi_min_s, isi_max_s: p.isi_max_s, false_start_ms: p.false_start_ms, timeout_ms: p.timeout_ms };
}

/** Random gap before the next counter, uniform in [isi_min_s, isi_max_s], in ms. `rand` returns [0, 1). */
export function nextIsiMs(rand: () => number, p: PvtParams): number {
  return Math.round((p.isi_min_s + rand() * (p.isi_max_s - p.isi_min_s)) * 1000);
}

/**
 * Classifies one response. rtMs null = tapped before the counter appeared (false start).
 * Faster than false_start_ms is also a false start (anticipation); slower than the lapse limit is a lapse.
 */
export function classify(rtMs: number | null, lapseMs: number, p: PvtParams): TrialKind {
  if (rtMs === null || rtMs < p.false_start_ms) return 'false_start';
  if (rtMs >= p.timeout_ms) return 'timeout';
  return rtMs > lapseMs ? 'lapse' : 'ok';
}

/** Mean RT over real responses (not false starts or timeouts); a timeout also counts as a lapse. */
export function summarize(trials: Trial[]): PvtSummary {
  const answered = trials.filter((t) => (t.kind === 'ok' || t.kind === 'lapse') && t.rt_ms !== null);
  const mean = answered.length ? answered.reduce((s, t) => s + (t.rt_ms ?? 0), 0) / answered.length : null;
  return {
    mean_rt: mean === null ? null : Math.round(mean * 10) / 10,
    lapses: trials.filter((t) => t.kind === 'lapse' || t.kind === 'timeout').length,
    false_starts: trials.filter((t) => t.kind === 'false_start').length,
    responses: answered.length,
  };
}
