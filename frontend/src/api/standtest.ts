/**
 * T-5 stand test helpers: pure functions, no thresholds of their own. Timing comes from the catalog
 * (config/selftests.yaml stand_test params + checkpoints_min); the criteria stay in limits.yaml and rules.yaml and
 * are judged by the backend rules, never here.
 */
import { SelfTestDef } from './types';

export interface StandParams {
  supine_s: number;
  stand_s: number;
  min_gravity_g: number;
  /** 1 = real protocol; below 1 = labelled demo timing. */
  time_scale: number;
  checkpoints_min: number[];
}

export interface Reading {
  hr: number;
  sbp: number;
  dbp: number;
}

export interface StandingReading extends Reading {
  /** Protocol minute of the checkpoint (1, 3, 5, 10). */
  minute: number;
}

export function standParams(test: SelfTestDef): StandParams {
  const p = test.params;
  return {
    supine_s: p.supine_s,
    stand_s: p.stand_s,
    min_gravity_g: p.min_gravity_g,
    time_scale: p.time_scale,
    checkpoints_min: test.checkpoints_min ?? [],
  };
}

/** Real milliseconds for a protocol duration in seconds. */
export function realMs(seconds: number, params: StandParams): number {
  return seconds * 1000 * params.time_scale;
}

/** Protocol minutes for real elapsed milliseconds (a demo run reports the minutes it stands in for). */
export function protocolMinutes(elapsedMs: number, params: StandParams): number {
  const min = elapsedMs / params.time_scale / 60000;
  return Math.round(Math.min(min, params.stand_s / 60) * 10) / 10;
}

/** Index of the newest checkpoint that has come due at this point of the stand, or -1 before the first. */
export function dueCheckpoint(elapsedMs: number, params: StandParams): number {
  let idx = -1;
  params.checkpoints_min.forEach((m, i) => {
    if (elapsedMs >= realMs(m * 60, params)) idx = i;
  });
  return idx;
}

/**
 * Heart-rate rise "seen on two readings in a row": the largest rise that held on two consecutive standing
 * readings. With only one standing reading (stopped early) that reading's rise is used.
 */
export function sustainedRise(rises: number[]): number {
  if (rises.length === 1) return rises[0];
  let best = -Infinity;
  for (let i = 0; i + 1 < rises.length; i += 1) best = Math.max(best, Math.min(rises[i], rises[i + 1]));
  return best;
}

const r1 = (v: number): number => Math.round(v * 10) / 10;

/**
 * Summary the tablet sends as one submission (all CREW_ENTERED): falls are lying-down minus the lowest standing
 * value, the pulse-pressure values are the smallest while standing, and the last standing reading also goes in as
 * a hand value of heart_rate / bp_systolic / bp_diastolic so the existing orthostatic rule judges it.
 * Stopping early never discards readings: whatever was captured is summarised and the stop is flagged.
 */
export function summarizeStand(
  supine: Reading,
  standing: StandingReading[],
  stoppedEarly: boolean,
  minutesStood: number,
): Record<string, number> {
  const out: Record<string, number> = {
    stand_early_stop: stoppedEarly ? 1 : 0,
    stand_minutes: r1(minutesStood),
  };
  if (standing.length === 0) return out;
  const pp = standing.map((r) => r.sbp - r.dbp);
  const last = standing[standing.length - 1];
  return {
    ...out,
    stand_sbp_drop: supine.sbp - Math.min(...standing.map((r) => r.sbp)),
    stand_dbp_drop: supine.dbp - Math.min(...standing.map((r) => r.dbp)),
    stand_hr_rise: sustainedRise(standing.map((r) => r.hr - supine.hr)),
    stand_pulse_pressure_min: Math.min(...pp),
    stand_pulse_pressure_pct: r1(Math.min(...standing.map((r, i) => (pp[i] / r.sbp) * 100))),
    heart_rate: last.hr,
    bp_systolic: last.sbp,
    bp_diastolic: last.dbp,
  };
}

/** "4:05" for a countdown in milliseconds. */
export function clock(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
