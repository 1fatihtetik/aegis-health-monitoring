/**
 * Block T self-test helpers: pure functions, no thresholds of their own. Every number comes from the catalog
 * (GET /api/v1/selftests), which resolves limits from config/limits.yaml and rule limits from config/rules.yaml.
 */
import { CrewId, EntryMethod, SelfTestField, SelfTestRuleLimit, Severity } from './types';

const OPS: Record<string, (a: number, b: number) => boolean> = {
  '>': (a, b) => a > b,
  '>=': (a, b) => a >= b,
  '<': (a, b) => a < b,
  '<=': (a, b) => a <= b,
};

const SEVERITY_RANK: Record<Severity, number> = { INFO: 0, CAUTION: 1, WARNING: 2, EMERGENCY: 3 };

/** Parses what the crew typed. Refuses empty, non-numeric and implausible values with a plain message. */
export function parseEntry(field: SelfTestField, raw: string): { value: number | null; error: string | null } {
  const text = raw.trim().replace(',', '.');
  if (text === '') return { value: null, error: `Enter ${field.label.toLowerCase()}.` };
  const value = Number(text);
  if (!Number.isFinite(value)) return { value: null, error: `"${raw}" is not a number.` };
  if (value < field.input_min || value > field.input_max) {
    return {
      value: null,
      error: `${value} ${field.unit} is outside ${field.input_min}–${field.input_max} ${field.unit}. Check the reading and the unit.`,
    };
  }
  return { value, error: null };
}

/**
 * The single-value rules (THRESHOLD) this value would trip, worst first. Compound members are left out: one value
 * alone does not raise them.
 */
export function rulesTripped(field: SelfTestField, value: number): SelfTestRuleLimit[] {
  return field.rule_limits
    .filter((r) => r.rule_type === 'THRESHOLD' && OPS[r.op]?.(value, r.value))
    .sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);
}

/** WARNING or EMERGENCY: the form asks the crew to re-check and confirm before sending (supervisor note, Block T). */
export function needsConfirmation(tripped: SelfTestRuleLimit[]): boolean {
  return tripped.some((r) => SEVERITY_RANK[r.severity] >= SEVERITY_RANK.WARNING);
}

/** Plain text of the normal band of a field, from its single-value rule limits: "92 % or more", "90–160 mmHg". */
export function bandText(field: SelfTestField): string | null {
  const simple = field.rule_limits.filter((r) => r.rule_type === 'THRESHOLD');
  const low = simple.filter((r) => r.op === '<' || r.op === '<=').map((r) => r.value);
  const high = simple.filter((r) => r.op === '>' || r.op === '>=').map((r) => r.value);
  const lo = low.length ? Math.max(...low) : null;
  const hi = high.length ? Math.min(...high) : null;
  if (lo !== null && hi !== null) return `${lo}–${hi} ${field.unit}`;
  if (lo !== null) return `${lo} ${field.unit} or more`;
  if (hi !== null) return `up to ${hi} ${field.unit}`;
  return null;
}

/** True when any limit behind the band is unverified (the UI shows the ⚠ marker). */
export function bandUnverified(field: SelfTestField): boolean {
  return field.rule_limits.some((r) => r.rule_type === 'THRESHOLD' && !r.verified);
}

export interface ObservationPayload {
  id: string;
  ts: string;
  crew_id: CrewId;
  location: null;
  device_id: string;
  signal: string;
  value: number;
  unit: string;
  quality: 'GOOD';
  phase: string | null;
  provenance: 'CREW_ENTERED';
  entry_method: EntryMethod;
  test_id: string;
}

function newId(crewId: CrewId, signal: string): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `obs-${crewId}-${signal}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/**
 * One submission = one Observation per value, all with the same timestamp, labelled CREW_ENTERED (a person typed
 * or tapped it; no dataset) with the entry method. They go through POST /observations like every other value.
 */
export function buildObservations(input: {
  crewId: CrewId;
  testId: string;
  method: EntryMethod;
  values: Record<string, number>;
  units: Record<string, string>;
  ts: string;
  phase: string | null;
}): ObservationPayload[] {
  return Object.entries(input.values).map(([signal, value]) => ({
    id: newId(input.crewId, signal),
    ts: input.ts,
    crew_id: input.crewId,
    location: null,
    device_id: `tablet-${input.crewId}`,
    signal,
    value,
    unit: input.units[signal],
    quality: 'GOOD',
    phase: input.phase,
    provenance: 'CREW_ENTERED',
    entry_method: input.method,
    test_id: input.testId,
  }));
}
