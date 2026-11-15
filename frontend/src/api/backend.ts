/**
 * Wire types for the AEGIS backend (implementationsandgoals.txt section 7) and the adapter that turns
 * backend payloads into the view model (AegisSystemState) the views render.
 *
 * When the backend is connected, everything the views show comes from here. The in-browser simulation in
 * useLiveSocket.ts is only the offline fallback.
 */
import {
  AegisSystemState,
  AlertEvidence,
  AlertEvidenceClause,
  AlertItem,
  AlertState,
  BaselineStat,
  ConfigLimit,
  CrewBaseline,
  CrewId,
  CrewMemberSummary,
  DelaySource,
  CrewRole,
  DatasetMeta,
  EnvironmentState,
  GravityEffect,
  Hazard,
  HrpRiskId,
  Inspiration4Panel,
  LinkStatus,
  LongTermTrendPoint,
  MissionPhaseName,
  OperationalStatus,
  Provenance,
  RadiationSummary,
  ReadinessComponent,
  ReadinessKind,
  RadReplayInfo,
  ReadinessScore,
  RecommendationMessage,
  ScheduleItem,
  SelfTestDef,
  SelfTestResult,
  Severity,
  SignalSource,
  SleepNightRecord,
  SpaceWeatherEvent,
  TimeSeriesPoint,
} from './types';
import { LimitsTree, flattenLimits } from './limits';

// ---- wire types ------------------------------------------------------------------------------

export type BackendStatus = 'NOMINAL' | 'INFO' | 'CAUTION' | 'WARNING' | 'EMERGENCY';

export interface BackendEvidence {
  signal: string;
  value: number;
  unit?: string;
  op?: string;
  limit: number;
  limit_ref?: string;
  limit_verified?: boolean;
  limit_source_ref?: string;
  window?: string;
  agg?: string;
  hysteresis_hold?: boolean;
  firing?: boolean;
  negated?: boolean;
  rule_id?: string;
  logic?: { all?: unknown[]; any?: unknown[]; none?: unknown[] };
  members?: BackendEvidence[];
  context?: { group: string; branch: string };
  /** T-4: an onboard-only questionnaire member, replaced before the alert left the spacecraft. */
  redacted?: string;
  provenance?: Provenance;
  dataset_id?: string | null;
  basis?: string;
  dataset?: DatasetMeta | null;
}

export interface BackendAlert {
  id: string;
  rule_id: string;
  title: string;
  crew_id: string | null;
  severity: Severity;
  state: AlertState;
  raised_ts: string;
  ack_ts: string | null;
  resolved_ts: string | null;
  hazards: Hazard[];
  hrp_risks: HrpRiskId[];
  evidence: BackendEvidence;
  rationale: string;
  action: string;
  checklist: string[];
  notes: Array<{ ts: string; text: string; author?: string }>;
  origin: 'ONBOARD' | 'GROUND';
}

export interface BackendReadinessComponent {
  signal: string;
  value: number | null;
  unit: string;
  good: number;
  limit: number;
  limit_ref: string;
  limit_verified: boolean;
  limit_source_ref: string;
  window: string;
  score: number | null;
  weight: number;
}

export interface BackendReadiness {
  value: number;
  base: number;
  alert_penalty: number;
  alert_ids: string[];
  components: Record<string, BackendReadinessComponent>;
  hazards: Hazard[];
  hrp_risks: HrpRiskId[];
  formula: string;
  go?: boolean;
  go_min?: number;
  go_min_verified?: boolean;
}

export interface BackendCrew {
  id: CrewId;
  callsign: string;
  name?: string;
  role: CrewRole;
  status: BackendStatus;
  top_alert: { id: string; title: string; severity: Severity } | null;
  alert_count: number;
  vitals: Record<string, number>;
  trends: Record<string, number>;
  readiness: Record<string, number>;
  eva_go: boolean | null;
}

export interface BackendRadiationCrew {
  dose_rate_uSv_h: number;
  dose_24h_mSv: number;
  dose_30d_mSv: number;
  dose_mission_mSv: number;
  dose_career_mSv: number;
  career_pct_of_limit: number;
  sheltered: boolean;
  event_dose_mSv: number;
  event_dose_saved_mSv?: number;
}

export interface BackendRadiation {
  crew: Record<string, BackendRadiationCrew>;
  area: {
    dose_rate_uSv_h: number;
    dose_rate_absorbed_uGy_h?: number | null;
    neutron_rate_uSv_h: number;
    neutron_fraction: number;
    neutron_spectrum?: Array<{
      energy_range: string;
      flux_fraction: number;
      quality_factor: number;
      dose_rate_uSv_h: number;
    }>;
    neutron_spectrum_note?: string;
  };
  spe: {
    active: boolean;
    alert_id: string | null;
    since: string | null;
    ended: string | null;
    elapsed_s: number;
    checklist: string[];
    headcount: Record<string, boolean>;
    all_sheltered: boolean;
  };
  replay?: RadReplayInfo | null;
}

export interface BackendLink {
  delay_s: number;
  blackout: boolean;
  queue_down: number;
  queue_up: number;
  last_delivery_ts?: string | null;
  ground_as_of: string;
  ground_age_s: number;
  delay_source?: DelaySource;
}

export interface BackendSim {
  scenario: string;
  description?: string;
  seed: number;
  speed: number;
  paused: boolean;
  tick_s: number;
}

export interface BackendSnapshot {
  type: 'snapshot';
  node: 'onboard' | 'ground';
  now: string;
  as_of: string;
  age_s: number;
  sim: BackendSim;
  link: BackendLink;
  ts?: string;
  scenario?: string;
  seed?: number;
  mission_day?: number;
  phase?: { name: string; gravity_g: number; comm_delay_s: number; gravity?: GravityEffect };
  crew?: BackendCrew[];
  environment?: Record<string, number>;
  hazards?: Record<string, { status: BackendStatus; alert_ids: string[] }>;
  readiness?: Record<string, Record<string, BackendReadiness>>;
  radiation?: BackendRadiation;
  provenance?: Record<string, SignalSource>;
}

export interface BackendRecommendation {
  id: string;
  text: string;
  checklist: string[];
  crew_id: string | null;
  origin?: string;
  sent_ts: string;
  deliver_ts: string;
}

export type BackendMessage =
  | BackendSnapshot
  | { type: 'alert'; node: 'onboard' | 'ground'; alert: BackendAlert }
  | { type: 'recommendation'; node: 'onboard'; recommendation: BackendRecommendation };

/** One series from GET .../timeseries: points are [iso ts, value]. */
export type SeriesPoints = Array<[string, number]>;

export type BackendBaseline = BaselineStat;

/** History pulled once per world (scenario start / reconnect), then extended from snapshots. */
export interface BackendHistory {
  crew: Record<string, Record<string, SeriesPoints>>;
  environment: Record<string, SeriesPoints>;
  baselines: Record<string, Record<string, BackendBaseline>>;
}

// ---- REST ------------------------------------------------------------------------------------

const API = '/api/v1';

async function getJson<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${API}${path}`);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

async function postJson<T>(path: string, body?: unknown): Promise<T | null> {
  try {
    const res = await fetch(`${API}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** POST that keeps the server's refusal reason (FastAPI `detail`), for forms that must explain a 422 in plain words. */
async function postJsonDetailed<T>(path: string, body: unknown): Promise<{ data: T | null; detail: string | null }> {
  try {
    const res = await fetch(`${API}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.ok) return { data: (await res.json()) as T, detail: null };
    let detail = `Refused by the onboard server (${res.status}).`;
    try {
      const err = (await res.json()) as { detail?: unknown };
      if (typeof err.detail === 'string') detail = err.detail;
    } catch {
      // keep the generic message
    }
    return { data: null, detail };
  } catch {
    return { data: null, detail: 'Onboard server not reachable.' };
  }
}

export const backendApi = {
  getJson,
  postJson,
  postJsonDetailed,
  async selftests(): Promise<SelfTestDef[] | null> {
    const res = await getJson<{ tests: SelfTestDef[] }>('/selftests?node=onboard');
    return res?.tests ?? null;
  },
  async selftestSchedule(crewId: CrewId): Promise<ScheduleItem[] | null> {
    const res = await getJson<{ schedule: Record<string, ScheduleItem[]> }>(`/selftests/schedule?crew_id=${crewId}`);
    return res?.schedule[crewId] ?? null;
  },
  async selftestResults(crewId: CrewId): Promise<SelfTestResult[]> {
    const res = await getJson<{ results: SelfTestResult[] }>(`/selftests/results?crew_id=${crewId}`);
    return res?.results ?? [];
  },
  async alerts(node: 'onboard' | 'ground'): Promise<BackendAlert[]> {
    const res = await getJson<{ alerts: BackendAlert[] }>(`/alerts?node=${node}`);
    return res?.alerts ?? [];
  },
  async inspiration4(): Promise<Inspiration4Panel | null> {
    const res = await getJson<{ panel: Inspiration4Panel }>('/reference/inspiration4?node=onboard');
    return res?.panel ?? null;
  },
  async spaceWeather(): Promise<SpaceWeatherEvent | null> {
    const res = await getJson<{ event: SpaceWeatherEvent }>('/spaceweather/event?node=ground');
    return res?.event ?? null;
  },
  async recommendations(node: 'onboard' | 'ground'): Promise<BackendRecommendation[]> {
    const res = await getJson<{ recommendations: BackendRecommendation[] }>(
      `/link/recommendations?node=${node}`
    );
    return res?.recommendations ?? [];
  },
  async series(
    path: string,
    signal: string,
    node: 'onboard' | 'ground',
    fromIso: string | null,
    maxPoints: number
  ): Promise<SeriesPoints> {
    const from = fromIso ? `&from=${encodeURIComponent(fromIso)}` : '';
    const res = await getJson<{ points: SeriesPoints }>(
      `${path}?signal=${signal}&node=${node}${from}&max_points=${maxPoints}`
    );
    return res?.points ?? [];
  },
  async baselines(crewId: string): Promise<Record<string, BackendBaseline>> {
    const res = await getJson<{ baselines: Record<string, BackendBaseline> }>(
      `/crew/${crewId}/baselines`
    );
    return res?.baselines ?? {};
  },
  /** GET /limits: the config/limits.yaml tree as the backend loaded it (null if unreachable). */
  async limits(): Promise<Record<string, ConfigLimit> | null> {
    const res = await getJson<{ limits: LimitsTree }>('/limits');
    return res?.limits ? flattenLimits(res.limits) : null;
  },
};

/** Intraday signals charted per crew member (1-minute data, last hour). */
export const CREW_INTRADAY_SIGNALS = [
  'heart_rate',
  'hrv_rmssd',
  'spo2',
  'bp_systolic',
  'bp_diastolic',
  'skin_temp',
  'dose_rate_equivalent',
] as const;
/** Daily signals (about 140 days of history). */
export const CREW_DAILY_SIGNALS = [
  'sleep_night_h',
  'bmd_estimate',
  'body_mass',
  'vo2max_proxy',
  'exercise_adherence_pct',
  'dose_mission',
] as const;
export const ENV_SIGNALS = [
  'ppco2',
  'ppo2',
  'cabin_temp',
  'noise_level',
  'area_dose_rate_equivalent',
  'neutron_dose_equivalent_rate',
] as const;

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const INTRADAY_POINTS = 60;
const HISTORY_CAP = 120;

export async function fetchHistory(
  node: 'onboard' | 'ground',
  crewIds: string[],
  nowIso: string
): Promise<BackendHistory> {
  const nowMs = Date.parse(nowIso);
  const hourAgo = new Date(nowMs - HOUR_MS).toISOString();
  const crew: BackendHistory['crew'] = {};
  const baselines: BackendHistory['baselines'] = {};
  const jobs: Array<Promise<void>> = [];
  for (const cid of crewIds) {
    crew[cid] = {};
    for (const sig of CREW_INTRADAY_SIGNALS) {
      jobs.push(
        backendApi
          .series(`/crew/${cid}/timeseries`, sig, node, hourAgo, INTRADAY_POINTS)
          .then((p) => {
            crew[cid][sig] = p;
          })
      );
    }
    for (const sig of CREW_DAILY_SIGNALS) {
      jobs.push(
        backendApi
          .series(`/crew/${cid}/timeseries`, sig, node, null, 400)
          .then((p) => {
            crew[cid][sig] = p;
          })
      );
    }
    if (node === 'onboard') {
      jobs.push(
        backendApi.baselines(cid).then((b) => {
          baselines[cid] = b;
        })
      );
    }
  }
  const environment: BackendHistory['environment'] = {};
  for (const sig of ENV_SIGNALS) {
    jobs.push(
      backendApi
        .series('/environment/timeseries', sig, node, hourAgo, INTRADAY_POINTS)
        .then((p) => {
          environment[sig] = p;
        })
    );
  }
  await Promise.all(jobs);
  return { crew, environment, baselines };
}

/** Appends the snapshot's latest values to the history (only when simulated time moved on). */
export function extendHistory(history: BackendHistory, snap: BackendSnapshot): void {
  const ts = snap.ts ?? snap.as_of;
  const push = (series: SeriesPoints | undefined, value: number | undefined): SeriesPoints | undefined => {
    if (value === undefined || !Number.isFinite(value)) return series;
    const arr = series ?? [];
    const last = arr[arr.length - 1];
    if (last && Date.parse(last[0]) >= Date.parse(ts)) return arr;
    arr.push([ts, value]);
    if (arr.length > HISTORY_CAP) arr.splice(0, arr.length - HISTORY_CAP);
    return arr;
  };
  for (const c of snap.crew ?? []) {
    const h = (history.crew[c.id] ??= {});
    for (const sig of CREW_INTRADAY_SIGNALS) {
      const v = c.vitals[sig];
      const s = push(h[sig], v);
      if (s) h[sig] = s;
    }
  }
  for (const sig of ENV_SIGNALS) {
    const s = push(history.environment[sig], snap.environment?.[sig]);
    if (s) history.environment[sig] = s;
  }
}

// ---- mapping helpers -------------------------------------------------------------------------

export function toStatus(s: BackendStatus | undefined): OperationalStatus {
  if (!s || s === 'INFO' || s === 'NOMINAL') return 'NOMINAL';
  return s;
}

function label(isoTs: string): string {
  return isoTs.slice(11, 16);
}

function toPoints(series: SeriesPoints | undefined, secondary?: SeriesPoints): TimeSeriesPoint[] {
  if (!series) return [];
  const sec = new Map((secondary ?? []).map(([t, v]) => [t, v]));
  return series.map(([ts, value]) => ({
    ts,
    label: label(ts),
    value,
    secondaryValue: sec.get(ts),
  }));
}

function last(series: SeriesPoints | undefined, n: number): number[] {
  return (series ?? []).slice(-n).map(([, v]) => v);
}

function round(v: number, digits = 1): number {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

const PRETTY: Record<string, string> = {
  sleep: 'Sleep (24 h)',
  co2: 'Cabin ppCO₂',
  spo2: 'SpO₂',
  heart_rate: 'Heart rate',
  hrv: 'HRV (RMSSD)',
  bone: 'Bone density estimate',
  dose: 'Radiation dose rate',
};

function prettyName(id: string): string {
  return PRETTY[id] ?? id.replace(/_/g, ' ');
}

/** The readiness formula puts 50 at the configured limit: below it the component is past its limit. */
function componentStatus(score: number | null): OperationalStatus {
  if (score === null) return 'NOMINAL';
  if (score < 50) return 'WARNING';
  if (score < 100) return 'CAUTION';
  return 'NOMINAL';
}

function mapReadiness(
  crewId: CrewId,
  kind: ReadinessKind,
  r: BackendReadiness | undefined,
  crewStatus: OperationalStatus,
  ts: string
): ReadinessScore {
  if (!r) {
    return {
      crew_id: crewId,
      ts,
      kind,
      value: 0,
      status: crewStatus,
      goForOp: false,
      summary: 'No readiness data yet.',
      components: [],
    };
  }
  const components: ReadinessComponent[] = Object.entries(r.components).map(([id, c]) => ({
    id,
    label: prettyName(id),
    score: c.score ?? 0,
    weight: c.weight,
    rawValue: c.value === null ? 'no data' : `${round(c.value, 2)} ${c.unit}`,
    limitLabel: `limit ${c.limit} ${c.unit} (good ${c.good})`,
    limitVerified: c.limit_verified,
    sourceRef: c.limit_source_ref,
    status: componentStatus(c.score),
  }));
  const go = r.go ?? (r.go_min !== undefined ? r.value >= r.go_min : r.alert_penalty === 0);
  const penalty = r.alert_penalty > 0 ? ` Open-alert penalty −${r.alert_penalty}.` : '';
  const summary =
    r.go === undefined
      ? `Score ${round(r.value)} (base ${round(r.base)}).${penalty}`
      : r.go
      ? `GO: score ${round(r.value)} ≥ ${r.go_min}.${penalty}`
      : `NO-GO recommendation: score ${round(r.value)} < ${r.go_min}.${penalty} Recommend CMO review.`;
  return {
    crew_id: crewId,
    ts,
    kind,
    value: round(r.value),
    status: crewStatus,
    goForOp: go,
    summary,
    components,
  };
}

/** Plain names for evidence signals (UI copy only). */
const SIGNAL_LABEL: Record<string, string> = {
  ppco2: 'Cabin CO₂',
  kss: 'Sleepiness (KSS 1–9)',
  tlx_workload: 'Workload (NASA-TLX)',
  motion_sickness: 'Motion sickness (MISC 0–10)',
  mood: 'Mood (1–5)',
  pvt_mean_rt: 'Reaction time (PVT-B mean)',
  pvt_lapses: 'Reaction-time lapses',
  pvt_false_starts: 'Reaction-time false starts',
  body_temp: 'Body temperature',
  glucose: 'Blood sugar (glucose)',
  fluid_intake: 'Fluid drunk today',
  sodium_intake: 'Sodium eaten today',
  body_mass: 'Body mass',
  ppo2: 'Cabin O₂',
  heart_rate: 'Heart rate',
  hrv_rmssd: 'Heart rate variability',
  spo2: 'Blood oxygen (SpO₂)',
  skin_temp: 'Skin temperature',
  bp_systolic: 'Blood pressure (top number)',
  sleep_hours_24h: 'Sleep in last 24 h',
  symptom_headache: 'Headache report (0–3)',
  dose_rate_equivalent: 'Personal radiation dose rate',
  dose_rate_absorbed: 'Personal absorbed dose rate',
  dose_mission: 'Mission radiation dose',
  area_dose_rate_absorbed: 'Cabin absorbed dose rate (RAD)',
  area_dose_rate_equivalent: 'Cabin radiation dose rate',
  neutron_dose_equivalent_rate: 'Neutron dose rate',
  dose_24h: 'Radiation dose, last 24 h',
  cabin_pressure: 'Cabin pressure',
  cabin_temp: 'Cabin temperature',
  humidity: 'Cabin humidity',
  noise_level: 'Cabin noise',
  resp_rate: 'Breathing rate',
  bp_diastolic: 'Blood pressure (bottom number)',
  sleep_night_h: 'Sleep last night',
  bmd_estimate: 'Bone density estimate',
  exercise_adherence_pct: 'Exercise sessions done',
  stand_sbp_drop: 'Stand test: drop in top blood pressure number',
  stand_dbp_drop: 'Stand test: drop in bottom blood pressure number',
  stand_hr_rise: 'Stand test: rise in heart rate',
  stand_pulse_pressure_min: 'Stand test: smallest gap between BP numbers',
  stand_pulse_pressure_pct: 'Stand test: BP gap as % of top number',
  stand_early_stop: 'Stand test: stopped early (dizzy / faint)',
  stand_minutes: 'Stand test: minutes standing',
  low_g_days: 'Days below 1 g',
  compound: 'Combined indicators',
};

export function signalLabel(signal: string): string {
  return SIGNAL_LABEL[signal] ?? signal.replace(/_/g, ' ');
}

const OP_WORD: Record<string, string> = { '>': 'above', '>=': 'at or above', '<': 'below', '<=': 'at or below' };

function mapClause(m: BackendEvidence): AlertEvidenceClause {
  const what = `${signalLabel(m.signal)} ${OP_WORD[m.op ?? ''] ?? m.op ?? ''} limit`.trim();
  if (m.redacted) {
    return {
      signal: m.signal,
      label: 'Onboard-only answer',
      value: NaN,
      unit: '',
      op: '',
      limit: NaN,
      limit_verified: false,
      source_ref: '',
      redacted: m.redacted,
    };
  }
  return {
    signal: m.signal,
    label: m.negated ? `${what}: must NOT be true` : what,
    firing: m.firing,
    negated: m.negated,
    hysteresis_hold: m.hysteresis_hold,
    value: m.value,
    unit: m.unit ?? '',
    op: m.op ?? '',
    limit: m.limit,
    limit_verified: m.limit_verified ?? false,
    source_ref: m.limit_source_ref ?? '',
    provenance: m.provenance,
    dataset_id: m.dataset_id,
    basis: m.basis,
    dataset: m.dataset,
  };
}

export function mapAlert(a: BackendAlert): AlertItem {
  const e = a.evidence;
  const evidence: AlertEvidence = {
    signal: e.signal,
    value: e.value,
    unit: e.unit,
    limit: e.limit,
    op: e.op,
    limit_verified: e.limit_verified ?? (e.members ?? []).every((m) => m.limit_verified !== false),
    source_ref: e.limit_source_ref ?? (e.members ? 'see members' : undefined),
    window: e.window ?? '',
    clauses: e.members?.map(mapClause),
    context: e.context,
    hysteresis_hold: e.hysteresis_hold,
    provenance: e.provenance,
    dataset_id: e.dataset_id,
    basis: e.basis,
    dataset: e.dataset,
  };
  if (e.signal === 'compound') {
    evidence.unit = 'conditions';
    evidence.op = '≥';
  }
  return {
    id: a.id,
    rule_id: a.rule_id,
    title: a.title,
    crew_id: (a.crew_id as CrewId | null) ?? null,
    severity: a.severity,
    state: a.state,
    raised_ts: a.raised_ts,
    ack_ts: a.ack_ts,
    resolved_ts: a.resolved_ts,
    hazards: a.hazards,
    hrp_risks: a.hrp_risks,
    evidence,
    rationale: a.rationale,
    action: a.action,
    checklist: a.checklist,
    notes: a.notes.map((n) => ({ ts: n.ts, author: n.author ?? 'Onboard', text: n.text })),
    origin: a.origin,
  };
}

export function mapRecommendation(
  r: BackendRecommendation,
  delivered: boolean,
  nowIso: string,
  acknowledged: boolean
): RecommendationMessage {
  return {
    id: r.id,
    crew_id: (r.crew_id as CrewId | null) ?? 'ALL',
    priority: 'INFO',
    author: 'Ground (flight surgeon)',
    title: r.text,
    rationale: '',
    checklist: r.checklist ?? [],
    sent_ts: r.sent_ts,
    deliver_ts: r.deliver_ts,
    remaining_delay_s: delivered
      ? 0
      : Math.max(0, Math.round((Date.parse(r.deliver_ts) - Date.parse(nowIso)) / 1000)),
    delivered,
    acknowledged_onboard: acknowledged,
  };
}

const PHASES: MissionPhaseName[] = [
  'LEO',
  'TRANSIT',
  'LUNAR_SURFACE',
  'MARS_TRANSIT',
  'MARS_SURFACE',
  'RETURN',
  'POST_LANDING',
];

function toPhase(name: string | undefined, fallback: MissionPhaseName): MissionPhaseName {
  return PHASES.find((p) => p === name) ?? fallback;
}

function mapBaseline(
  b: Record<string, BackendBaseline> | undefined,
  trends: Record<string, number>,
  prev: CrewBaseline
): CrewBaseline {
  const mean = (k: string, fb: number): number => b?.[k]?.mean ?? fb;
  const sd = (k: string, fb: number): number => b?.[k]?.sd ?? fb;
  return {
    hr_rest: mean('heart_rate', prev.hr_rest),
    hr_std: sd('heart_rate', prev.hr_std),
    hrv_rmssd: mean('hrv_rmssd', prev.hrv_rmssd),
    hrv_std: sd('hrv_rmssd', prev.hrv_std),
    spo2: mean('spo2', prev.spo2),
    bp_systolic: mean('bp_systolic', prev.bp_systolic),
    bp_diastolic: mean('bp_diastolic', prev.bp_diastolic),
    skin_temp_c: mean('skin_temp', prev.skin_temp_c),
    body_mass_kg: trends.body_mass ?? prev.body_mass_kg,
    bmd_pct: 100,
    vo2max_proxy: trends.vo2max_proxy ?? prev.vo2max_proxy,
  };
}

function sleepNights(series: SeriesPoints | undefined): SleepNightRecord[] {
  const nights = (series ?? []).slice(-7);
  return nights.map(([ts, hours], i) => ({
    dayLabel: i === nights.length - 1 ? 'Last night' : ts.slice(5, 10),
    hours: round(hours),
  }));
}

function longTermTrends(
  h: Record<string, SeriesPoints> | undefined,
  missionDay: number,
  nowIso: string
): LongTermTrendPoint[] {
  const bmd = h?.bmd_estimate ?? [];
  if (bmd.length === 0) return [];
  const byTs = (sig: string): Map<string, number> => new Map((h?.[sig] ?? []).map(([t, v]) => [t.slice(0, 10), v]));
  const mass = byTs('body_mass');
  const vo2 = byTs('vo2max_proxy');
  const adh = byTs('exercise_adherence_pct');
  const dose = byTs('dose_mission');
  const nowMs = Date.parse(nowIso);
  const stride = Math.max(1, Math.ceil(bmd.length / 13));
  return bmd
    .filter((_, i) => i % stride === 0 || i === bmd.length - 1)
    .map(([ts, v]) => {
      const day = ts.slice(0, 10);
      const md = Math.round(missionDay - (nowMs - Date.parse(ts)) / DAY_MS);
      return {
        missionDay: md,
        label: `MD-${md}`,
        bmdPct: round(v, 2),
        bodyMassKg: round(mass.get(day) ?? NaN),
        vo2MaxProxy: round(vo2.get(day) ?? NaN),
        cumulativeDoseMSv: round(dose.get(day) ?? NaN),
        exerciseAdherencePct: Math.round(adh.get(day) ?? NaN),
      };
    });
}

// ---- snapshot -> view model ------------------------------------------------------------------

export interface MapInput {
  prev: AegisSystemState;
  snap: BackendSnapshot;
  history: BackendHistory;
  alerts: AlertItem[];
}

function mapCrew(input: MapInput): CrewMemberSummary[] {
  const { prev, snap, history } = input;
  const ts = snap.ts ?? snap.as_of;
  const rad = snap.radiation;
  const neutronFraction = rad?.area.neutron_fraction ?? 0;
  return (snap.crew ?? []).map((c) => {
    const before = prev.crew.find((p) => p.id === c.id) ?? prev.crew[0];
    const h = history.crew[c.id] ?? {};
    const rc = rad?.crew[c.id];
    const status = toStatus(c.status);
    const kinds: ReadinessKind[] = ['OVERALL', 'EVA', 'COGNITIVE', 'PHYSICAL'];
    const readiness = Object.fromEntries(
      kinds.map((k) => [k, mapReadiness(c.id, k, snap.readiness?.[c.id]?.[k], status, ts)])
    ) as Record<ReadinessKind, ReadinessScore>;
    const v = c.vitals;
    const doseRate = rc?.dose_rate_uSv_h ?? v.dose_rate_equivalent ?? 0;
    return {
      id: c.id,
      callsign: c.callsign,
      name: c.name ?? c.callsign,
      role: c.role,
      status,
      career_dose_prior_mSv: rc ? round(rc.dose_career_mSv - rc.dose_mission_mSv, 1) : 0,
      mission_dose_mSv: rc ? round(rc.dose_mission_mSv, 2) : 0,
      baseline: mapBaseline(history.baselines[c.id], c.trends, before.baseline),
      baseline_stats: history.baselines[c.id],
      vitals: {
        heart_rate: round(v.heart_rate ?? 0, 0),
        hrv_rmssd: round(v.hrv_rmssd ?? 0),
        spo2: round(v.spo2 ?? 0),
        resp_rate: round(v.resp_rate ?? 0),
        skin_temp: round(v.skin_temp ?? 0, 2),
        bp_systolic: round(v.bp_systolic ?? 0, 0),
        bp_diastolic: round(v.bp_diastolic ?? 0, 0),
        activity_counts: round(v.activity_counts ?? 0),
        sleep_hours_24h: round(v.sleep_hours_24h ?? 0),
        dose_rate_uSv_h: round(doseRate),
        neutron_dose_uSv_h: round(doseRate * neutronFraction),
        bmd_estimate_pct: round(c.trends.bmd_estimate ?? 0, 2),
        body_mass_kg: round(c.trends.body_mass ?? 0),
      },
      readiness,
      sparklines: {
        heart_rate: last(h.heart_rate, 14),
        hrv_rmssd: last(h.hrv_rmssd, 14),
        spo2: last(h.spo2, 14),
        dose_rate_uSv_h: last(h.dose_rate_equivalent, 14),
      },
      timeseries: {
        heart_rate: toPoints(h.heart_rate),
        hrv_rmssd: toPoints(h.hrv_rmssd),
        spo2: toPoints(h.spo2),
        bp: toPoints(h.bp_systolic, h.bp_diastolic),
        skin_temp: toPoints(h.skin_temp),
      },
      sleep_7d: sleepNights(h.sleep_night_h),
      trends_180d: longTermTrends(h, snap.mission_day ?? prev.sim.mission_day, ts),
      in_shelter: rc?.sheltered ?? false,
    };
  });
}

function mapEnvironment(snap: BackendSnapshot, history: BackendHistory): EnvironmentState {
  const e = snap.environment ?? {};
  const h = history.environment;
  return {
    ts: snap.ts ?? snap.as_of,
    status: toStatus(snap.hazards?.HOSTILE_CLOSED_ENV?.status),
    ppco2_mmHg: round(e.ppco2 ?? 0, 2),
    ppo2_kPa: round(e.ppo2 ?? 0, 2),
    cabin_pressure_kPa: round(e.cabin_pressure ?? 0, 1),
    cabin_temp_c: round(e.cabin_temp ?? 0, 1),
    humidity_pct: round(e.humidity ?? 0, 1),
    noise_dBA: round(e.noise_level ?? 0, 1),
    history: {
      ppco2: toPoints(h.ppco2),
      ppo2: toPoints(h.ppo2),
      cabin_temp: toPoints(h.cabin_temp),
      noise_dBA: toPoints(h.noise_level),
    },
  };
}

function mapRadiation(snap: BackendSnapshot, history: BackendHistory): RadiationSummary {
  const r = snap.radiation;
  const ts = snap.ts ?? snap.as_of;
  const crew = Object.values(r?.crew ?? {});
  const maxOf = (f: (c: BackendRadiationCrew) => number): number =>
    crew.length ? Math.max(...crew.map(f)) : 0;
  const absorbed = (snap.crew ?? []).map((c) => c.vitals.dose_rate_absorbed ?? 0);
  return {
    ts,
    status: toStatus(snap.hazards?.RADIATION?.status),
    dose_rate_absorbed_uGy_h: round(absorbed.length ? Math.max(...absorbed) : 0),
    dose_rate_equivalent_uSv_h: round(r?.area.dose_rate_uSv_h ?? 0),
    neutron_dose_equivalent_rate_uSv_h: round(r?.area.neutron_rate_uSv_h ?? 0),
    neutron_fraction_pct: round((r?.area.neutron_fraction ?? 0) * 100),
    cumulative_24h_mSv: round(maxOf((c) => c.dose_24h_mSv), 3),
    cumulative_30d_mSv: round(maxOf((c) => c.dose_30d_mSv), 2),
    cumulative_mission_mSv: round(maxOf((c) => c.dose_mission_mSv), 2),
    cumulative_career_leader_mSv: round(maxOf((c) => c.dose_career_mSv), 1),
    spe_active: r?.spe.active ?? false,
    spe_started_ts: r?.spe.since ?? null,
    spe_elapsed_s: r?.spe.elapsed_s ?? 0,
    // Crew total of (area dose - personal dose) since the last SPE was raised.
    shelter_dose_saved_mSv: round(crew.reduce((sum, c) => sum + (c.event_dose_saved_mSv ?? 0), 0), 3),
    spectrum_bins: (r?.area.neutron_spectrum ?? []).map((b) => ({
      energyRange: b.energy_range,
      fluxPct: round(b.flux_fraction * 100),
      qualityFactor: b.quality_factor,
    })),
    history: toPoints(history.environment.area_dose_rate_equivalent, history.environment.neutron_dose_equivalent_rate),
    area_dose_rate_absorbed_uGy_h: r?.area.dose_rate_absorbed_uGy_h ?? undefined,
    replay: r?.replay ?? null,
  };
}

function mapLink(snap: BackendSnapshot, pending: LinkStatus['pending_packets'], prev: LinkStatus): LinkStatus {
  const l = snap.link;
  return {
    one_way_delay_s: l.delay_s,
    delay_source: l.delay_source ?? null,
    queue_depth: l.queue_down + l.queue_up,
    blackout: l.blackout,
    bandwidth_kbps: prev.bandwidth_kbps,
    onboard_ts: snap.now,
    ground_as_of_ts: l.ground_as_of,
    lag_seconds: Math.round(l.ground_age_s),
    pending_packets: pending,
  };
}

/** Onboard snapshot -> the onboard part of the view model. */
export function applyOnboardSnapshot(input: MapInput): AegisSystemState {
  const { prev, snap } = input;
  return {
    ...prev,
    sim: {
      ...prev.sim,
      running: !snap.sim.paused,
      speed: snap.sim.speed,
      seed: snap.sim.seed,
      sim_ts: snap.now,
      mission_day: snap.mission_day ?? prev.sim.mission_day,
      phase: toPhase(snap.phase?.name, prev.sim.phase),
      gravity_g: snap.phase?.gravity_g ?? prev.sim.gravity_g,
      gravity: snap.phase?.gravity ?? prev.sim.gravity ?? null,
      comm_delay_s: snap.link.delay_s,
      active_scenario: snap.sim.scenario,
      demo_segment_label: undefined,
      backend_connected: true,
    },
    crew: mapCrew(input),
    alerts: input.alerts,
    environment: mapEnvironment(snap, input.history),
    radiation: mapRadiation(snap, input.history),
    link: mapLink(snap, prev.link.pending_packets, prev.link),
    provenance: snap.provenance ?? prev.provenance,
  };
}

/** Ground snapshot -> groundSnapshot (what the ground store has received over the link). */
export function applyGroundSnapshot(input: MapInput): AegisSystemState {
  const { prev, snap } = input;
  if (!snap.crew) return prev;
  return {
    ...prev,
    groundSnapshot: {
      as_of_ts: snap.as_of,
      lag_s: Math.round(snap.age_s),
      crew: mapCrew(input),
      alerts: input.alerts,
      radiation: mapRadiation(snap, input.history),
      environment: mapEnvironment(snap, input.history),
      provenance: snap.provenance ?? prev.groundSnapshot.provenance,
    },
  };
}

/** Ground-sent recommendations not yet delivered become uplink entries in the link queue view. */
export function pendingUplinks(
  sent: BackendRecommendation[],
  deliveredIds: Set<string>,
  nowIso: string
): LinkStatus['pending_packets'] {
  const nowMs = Date.parse(nowIso);
  return sent
    .filter((r) => !deliveredIds.has(r.id))
    .map((r) => ({
      id: r.id,
      direction: 'UPLINK' as const,
      priority: 'INFO' as const,
      summary: `Recommendation → ${r.crew_id ?? 'ALL'}: ${r.text}`,
      sent_ts: r.sent_ts,
      deliver_ts: r.deliver_ts,
      eta_s: Math.max(0, Math.round((Date.parse(r.deliver_ts) - nowMs) / 1000)),
    }));
}
