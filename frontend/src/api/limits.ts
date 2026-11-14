import { ConfigLimit } from './types';
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
}

export type LimitsTree = Record<string, Record<string, RawLimit>>;

/**
 * Presentation only: a readable label and a display unit per limit key. No numbers live here.
 * A key without an entry gets a label derived from the key and no unit.
 */
const LIMIT_META: Record<string, { label: string; unit: string }> = {
  'radiation.career_effective_dose_mSv': { label: 'Career effective dose limit', unit: 'mSv' },
  'radiation.spe_alert_dose_rate_uSv_h': { label: 'SPE dose-rate alert threshold', unit: 'µSv/h' },
  'radiation.dose_24h_mSv_max': { label: '24 h dose limit', unit: 'mSv' },
  'environment.ppco2_mmHg_1h_max': { label: 'Cabin ppCO₂ 1 h max', unit: 'mmHg' },
  'environment.ppco2_mmHg_critical': { label: 'Cabin ppCO₂ critical', unit: 'mmHg' },
  'environment.ppo2_kPa_min': { label: 'Cabin ppO₂ minimum', unit: 'kPa' },
  'environment.cabin_temp_C': { label: 'Cabin temperature band', unit: '°C' },
  'environment.humidity_pct': { label: 'Cabin humidity band', unit: '%RH' },
  'environment.noise_dBA_sleep_max': { label: 'Cabin noise (sleep) max', unit: 'dBA' },
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
};

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
        value: raw.value,
        min: raw.min,
        max: raw.max,
        source_ref: raw.source_ref ?? 'config/limits.yaml',
        verified: raw.verified === true,
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

/** Short display of a limit: "≤ 3 mmHg", "≥ 92 %", "40–140 bpm". Empty when the key is missing. */
export function formatLimit(limit: ConfigLimit | undefined, op?: '<=' | '>='): string {
  if (!limit) return '';
  const unit = limit.unit ? ` ${limit.unit}` : '';
  if (limit.min !== undefined && limit.max !== undefined) return `${limit.min}–${limit.max}${unit}`;
  if (limit.value === undefined) return '';
  const sign = op === '>=' ? '≥ ' : op === '<=' ? '≤ ' : '';
  return `${sign}${limit.value}${unit}`;
}
