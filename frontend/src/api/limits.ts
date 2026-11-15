import { ConfigLimit, LimitSourceKind } from './types';
// The one source of truth for thresholds (AGENTS.md ground rule 2). Bundled raw so the offline fallback
// shows the same numbers as the backend; with the backend up, GET /api/v1/limits replaces it.
import limitsYaml from '../../../config/limits.yaml?raw';

/** A limits.yaml entry as the backend returns it: {value|min|max, source_ref, verified}. */
export interface RawLimit {
  value?: number;
  min?: number;
  max?: number;
  source_ref?: string;
  verified?: boolean;
  /** Block L: required on every verified: false entry (backend refuses the config otherwise). */
  source_kind?: LimitSourceKind;
}

export type LimitsTree = Record<string, Record<string, RawLimit>>;

/**
 * Presentation only: a readable label and a display unit per limit key. No numbers live here.
 * A key without an entry gets a label derived from the key and no unit.
 */
export type LimitOp = '<' | '<=' | '>' | '>=';

/** `op` says which side of a single value is normal or alerting, so "2000" reads "≥ 2000 mL". */
const LIMIT_META: Record<string, { label: string; unit: string; op?: LimitOp }> = {
  'radiation.career_effective_dose_mSv': { label: 'Career effective dose limit', unit: 'mSv' },
  'radiation.spe_alert_dose_rate_uSv_h': { label: 'SPE dose-rate alert threshold', unit: 'µSv/h' },
  'radiation.dose_24h_mSv_max': { label: '24 h dose limit', unit: 'mSv' },
  'environment.ppco2_mmHg_1h_max': { label: 'Cabin ppCO₂ 1 h max', unit: 'mmHg' },
  'environment.ppco2_mmHg_critical': { label: 'Cabin ppCO₂ critical', unit: 'mmHg' },
  'environment.ppo2_kPa_min': { label: 'Cabin ppO₂ minimum', unit: 'kPa' },
  'environment.pio2_mmHg_min': { label: 'Breathable O₂ (inspired), 1 h average min', unit: 'mmHg', op: '>=' },
  'environment.pio2_mmHg_floor': { label: 'Breathable O₂ (inspired), absolute floor', unit: 'mmHg', op: '>=' },
  'environment.cabin_temp_C': { label: 'Cabin temperature band', unit: '°C' },
  'environment.humidity_pct': { label: 'Cabin humidity band', unit: '%RH' },
  'environment.noise_dBA_sleep_max': { label: 'Cabin noise (sleep) max', unit: 'dBA' },
  'environment.noise_dose_24h_max': { label: 'Noise dose over 24 h (100 = limit)', unit: 'dose', op: '<=' },
  'environment.noise_dBA_hazardous_max': { label: 'Hazardous noise limit', unit: 'dBA' },
  'environment.cabin_pressure_kPa': { label: 'Cabin total pressure band', unit: 'kPa' },
  'radiation.spe_event_effective_dose_mSv': { label: 'SPE design event dose limit', unit: 'mSv' },
  'radiation.gcr_rate_free_space_mSv_day': { label: 'GCR design dose rate (free space)', unit: 'mSv/day' },
  'radiation.gcr_rate_surface_mSv_day': { label: 'GCR design dose rate (surface)', unit: 'mSv/day' },
  'physiology.spo2_pct_min': { label: 'SpO₂ minimum', unit: '%' },
  'physiology.hr_bpm': { label: 'Heart rate band', unit: 'bpm' },
  'physiology.hr_orthostatic_bpm': { label: 'Heart rate on standing', unit: 'bpm' },
  'physiology.bp_systolic_mmHg': { label: 'Systolic blood pressure band', unit: 'mmHg' },
  'physiology.baseline_z_alert': { label: 'Personal baseline deviation', unit: 'σ' },
  'physiology.hr_tachycardia_bpm': { label: 'Fast heart rate', unit: 'bpm' },
  'physiology.hrv_rmssd_ms_min': { label: 'HRV (RMSSD) minimum', unit: 'ms' },
  'symptoms.headache_report_min': { label: 'Headache self-report', unit: '0-3' },
  'sleep.min_sleep_h_24h': { label: 'Minimum sleep per 24 h', unit: 'h' },
  'bone.bmd_loss_pct_per_month_expected_0g': { label: 'Expected 0 g bone loss rate', unit: '%/month' },
  'bone.bmd_pct_of_baseline_min': { label: 'Bone density minimum', unit: '% of baseline' },
  'readiness.eva_go_min': { label: 'EVA GO minimum readiness', unit: 'score' },
  // Block T (F-010): self-test bands in plain words.
  'physiology.bp_diastolic_mmHg': { label: 'Diastolic blood pressure band', unit: 'mmHg' },
  'physiology.body_temp_C': { label: 'Body temperature band', unit: '°C' },
  'metabolic.glucose_mg_dL': { label: 'Blood glucose band', unit: 'mg/dL' },
  'nutrition.fluid_intake_mL_day_min': { label: 'Water per day (drinks + food)', unit: 'mL', op: '>=' },
  'nutrition.sodium_intake_mg_day_max': { label: 'Sodium per day', unit: 'mg', op: '<=' },
  'cognition.pvt_lapse_ms': { label: 'Lapse = a response slower than', unit: 'ms', op: '>' },
  'cognition.pvt_lapses_max': { label: 'Lapses per test', unit: 'lapses', op: '<=' },
  'questionnaire.kss_sleepy_min': { label: 'Sleepiness alert from', unit: 'on the 1-9 scale', op: '>=' },
  'questionnaire.tlx_workload_max': { label: 'High-workload note from', unit: 'on the 0-100 scale', op: '>=' },
  'questionnaire.motion_sickness_misc_min': { label: 'Nausea alert from', unit: 'on the 0-10 scale', op: '>=' },
  'questionnaire.mood_low_max': { label: 'Low-mood note at', unit: 'on the 1-5 scale', op: '<=' },
  'stand_test.sbp_drop_mmHg_min': { label: 'Alert if the top number falls by', unit: 'mmHg', op: '>=' },
  'stand_test.dbp_drop_mmHg_min': { label: 'Alert if the bottom number falls by', unit: 'mmHg', op: '>=' },
  'stand_test.hr_rise_bpm_min': { label: 'Alert if the pulse rises by (two readings in a row)', unit: 'bpm', op: '>=' },
  'stand_test.pulse_pressure_mmHg_min': { label: 'Alert if the gap between the two numbers is', unit: 'mmHg', op: '<' },
  'stand_test.pulse_pressure_pct_min': { label: 'Alert if that gap is', unit: '% of the top number', op: '<' },
  'stand_test.early_stop_flag': { label: 'Stopping early for symptoms', unit: '', op: '>=' },
  'sans.low_g_days_min': { label: 'Eye-change watch starts after this long below 1 g', unit: 'days', op: '>=' },
  'sans.ppco2_mmHg_24h_mean_max': { label: 'Eye-change watch: cabin CO₂ day average above', unit: 'mmHg', op: '>' },
  'eye.amsler_flag_min': { label: 'Eye check alert when any square is marked', unit: '', op: '>=' },
  // T-8 landing gate.
  'readiness.landing_go_min': { label: 'Landing GO minimum readiness', unit: 'score', op: '>=' },
  'landing.low_g_days_long': { label: 'Landing readiness: half score after this long below 1 g', unit: 'days' },
  // Block C countermeasure prescriptions and the early-warning cut.
  'countermeasures.exercise_min_day': { label: 'Exercise per day (ISS practice)', unit: 'min', op: '>=' },
  'countermeasures.exercise_session_min': { label: 'Exercise session length', unit: 'min', op: '>=' },
  'countermeasures.exercise_adherence_7d_min': { label: 'Exercise sessions done, 7-day mean, note below', unit: '% of planned', op: '<' },
  'countermeasures.thigh_cuff_session_min': { label: 'Thigh cuff session length', unit: 'min' },
  'countermeasures.light_dim_before_sleep_min': { label: 'Dim light before sleep', unit: 'min', op: '>=' },
  'countermeasures.fluid_loading_mL': { label: 'Extra water before landing', unit: 'mL' },
};

/** Pulls the NASA-STD-3001 clause id ("[V2 6004]") out of a source_ref, if there is one. */
export function clauseId(sourceRef: string | undefined): string | null {
  const m = /\[V[12] \d{4,5}\]/.exec(sourceRef ?? '');
  return m ? m[0] : null;
}

function labelFromKey(key: string): string {
  const leaf = key.split('.').pop() ?? key;
  const text = leaf.replace(/_/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Flattens the limits tree into `section.key` -> ConfigLimit. */
export function flattenLimits(tree: LimitsTree): Record<string, ConfigLimit> {
  const out: Record<string, ConfigLimit> = {};
  for (const [section, entries] of Object.entries(tree)) {
    if (!entries || typeof entries !== 'object') continue;
    for (const [name, raw] of Object.entries(entries)) {
      const key = `${section}.${name}`;
      const meta = LIMIT_META[key];
      out[key] = {
        key,
        label: meta?.label ?? labelFromKey(key),
        unit: meta?.unit ?? '',
        op: meta?.op,
        value: raw.value,
        min: raw.min,
        max: raw.max,
        source_ref: raw.source_ref ?? 'config/limits.yaml',
        verified: raw.verified === true,
        source_kind: raw.verified === true ? undefined : raw.source_kind,
      };
    }
  }
  return out;
}

function parseScalar(token: string): string | number | boolean {
  const t = token.trim();
  if (t.startsWith('"') && t.endsWith('"')) return t.slice(1, -1);
  if (t.startsWith("'") && t.endsWith("'")) return t.slice(1, -1);
  if (t === 'true') return true;
  if (t === 'false') return false;
  const n = Number(t);
  return Number.isFinite(n) && t !== '' ? n : t;
}

/** Splits `a: 1, b: "x, y"` on commas outside quotes. */
function splitFlow(body: string): string[] {
  const parts: string[] = [];
  let quote: string | null = null;
  let cur = '';
  for (const ch of body) {
    if (quote) {
      if (ch === quote) quote = null;
      cur += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      cur += ch;
    } else if (ch === ',') {
      parts.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) parts.push(cur);
  return parts;
}

/**
 * Parses the limits.yaml layout: top-level sections, each entry an inline map on one line
 * (`  key: { value: 3.0, source_ref: "...", verified: false }`). Throws on anything else so a
 * format change is caught by the tests instead of silently dropping a limit.
 */
export function parseLimitsYaml(text: string): LimitsTree {
  const tree: LimitsTree = {};
  let section: string | null = null;
  text.split(/\r?\n/).forEach((line, i) => {
    const noComment = line.replace(/\s+#.*$/, '').replace(/^#.*$/, '');
    if (!noComment.trim()) return;
    const top = /^([A-Za-z0-9_]+):\s*$/.exec(noComment);
    if (top) {
      section = top[1];
      tree[section] = {};
      return;
    }
    const entry = /^\s+([A-Za-z0-9_]+):\s*\{(.*)\}\s*$/.exec(noComment);
    if (!entry || !section) throw new Error(`limits.yaml line ${i + 1} not understood: ${line}`);
    const raw: Record<string, string | number | boolean> = {};
    for (const part of splitFlow(entry[2])) {
      const idx = part.indexOf(':');
      if (idx < 0) throw new Error(`limits.yaml line ${i + 1}: bad field "${part}"`);
      raw[part.slice(0, idx).trim()] = parseScalar(part.slice(idx + 1));
    }
    tree[section][entry[1]] = raw as RawLimit;
  });
  return tree;
}

/** Limits bundled from config/limits.yaml, used until the backend answers GET /api/v1/limits. */
export const BUNDLED_LIMITS: Record<string, ConfigLimit> = flattenLimits(parseLimitsYaml(limitsYaml));

/** Block L (ROADMAP §0a): what an unverified number IS, in plain words. */
export const SOURCE_KIND_LABEL: Record<LimitSourceKind, string> = {
  published: 'Published source',
  clinical: 'Clinical guideline',
  design: 'AEGIS design setting',
  nasa_reference: 'NASA reference, not a standard',
};

export const NOT_NASA = 'Not a NASA limit';

/**
 * Marker text for a `verified: false` limit: "Not a NASA limit · Clinical guideline". It may change words but never
 * disappears and never claims NASA (AGENTS.md ground rule 2). Without a known kind it reads "Not a NASA limit".
 */
export function notNasaLabel(kind?: LimitSourceKind | string | null): string {
  const label = kind && kind in SOURCE_KIND_LABEL ? SOURCE_KIND_LABEL[kind as LimitSourceKind] : null;
  return label ? `${NOT_NASA} · ${label}` : NOT_NASA;
}

/**
 * Finds the kind of an unverified limit: the explicit field first, then the limit ref, then a bundled entry with
 * the same source_ref (all from config/limits.yaml, so it also works offline).
 */
export function limitKindOf(
  hint: { kind?: LimitSourceKind | string | null; ref?: string | null; sourceRef?: string | null },
  limits: Record<string, ConfigLimit> = BUNDLED_LIMITS,
): LimitSourceKind | undefined {
  if (hint.kind && hint.kind in SOURCE_KIND_LABEL) return hint.kind as LimitSourceKind;
  if (hint.ref) {
    const base = hint.ref.replace(/\.(min|max|value)$/, '');
    const byRef = limits[base] ?? limits[hint.ref];
    if (byRef?.source_kind) return byRef.source_kind;
  }
  if (hint.sourceRef) {
    const match = Object.values(limits).find((l) => !l.verified && l.source_ref === hint.sourceRef);
    if (match?.source_kind) return match.source_kind;
  }
  return undefined;
}

/** The whole marker for a limit-like value: "✓ NASA [V2 6004]" or "Not a NASA limit · <kind>". */
export function limitMarker(
  verified: boolean,
  hint: { kind?: LimitSourceKind | string | null; ref?: string | null; sourceRef?: string | null },
): string {
  if (verified) return `✓ NASA ${clauseId(hint.sourceRef ?? undefined) ?? 'standard'}`;
  return notNasaLabel(limitKindOf(hint));
}

/** Marker for an alert's evidence (or one compound member): uses the kind the backend sent, else the bundled one. */
export function evidenceMarker(ev: {
  limit_source_kind?: LimitSourceKind | string | null;
  limit_ref?: string | null;
  source_ref?: string | null;
}): string {
  return notNasaLabel(limitKindOf({ kind: ev.limit_source_kind, ref: ev.limit_ref, sourceRef: ev.source_ref }));
}

/** Block L / L-2: how many limits come from each kind of source, counted from the limits tree (never typed). */
export function limitCounts(limits: Record<string, ConfigLimit> = BUNDLED_LIMITS): {
  nasa: number;
  byKind: Record<LimitSourceKind, number>;
  total: number;
} {
  const byKind: Record<LimitSourceKind, number> = { published: 0, clinical: 0, design: 0, nasa_reference: 0 };
  let nasa = 0;
  const all = Object.values(limits);
  for (const l of all) {
    if (l.verified) nasa += 1;
    else if (l.source_kind) byKind[l.source_kind] += 1;
  }
  return { nasa, byKind, total: all.length };
}

const SIGN: Record<string, string> = { '>=': '≥ ', '<=': '≤ ', '>': '> ', '<': '< ' };

/** Short display of a limit: "≤ 3 mmHg", "≥ 92 %", "40–140 bpm". Empty when the key is missing. */
export function formatLimit(limit: ConfigLimit | undefined, op?: LimitOp): string {
  if (!limit) return '';
  const unit = limit.unit ? ` ${limit.unit}` : '';
  if (limit.min !== undefined && limit.max !== undefined) return `${limit.min}–${limit.max}${unit}`;
  if (limit.value === undefined) return '';
  const sign = SIGN[op ?? limit.op ?? ''] ?? '';
  return `${sign}${limit.value}${unit}`;
}
