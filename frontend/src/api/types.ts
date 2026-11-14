export type Hazard =
  | 'RADIATION'
  | 'ISOLATION_CONFINEMENT'
  | 'DISTANCE_FROM_EARTH'
  | 'GRAVITY_FIELDS'
  | 'HOSTILE_CLOSED_ENV';

export type HrpRiskId =
  | 'HRP-01'
  | 'HRP-02'
  | 'HRP-03'
  | 'HRP-04'
  | 'HRP-05'
  | 'HRP-06'
  | 'HRP-07'
  | 'HRP-08'
  | 'HRP-09'
  | 'HRP-10'
  | 'HRP-11'
  | 'HRP-12'
  | 'HRP-13'
  | 'HRP-14'
  | 'HRP-15'
  | 'HRP-16'
  | 'HRP-17';

export type Severity = 'INFO' | 'CAUTION' | 'WARNING' | 'EMERGENCY';
export type OperationalStatus = 'NOMINAL' | 'CAUTION' | 'WARNING' | 'EMERGENCY';

export type AlertState =
  | 'RAISED'
  | 'ACKNOWLEDGED'
  | 'IN_TREATMENT'
  | 'RESOLVED'
  | 'SUPPRESSED'
  | 'FALSE_POSITIVE';

export type CrewId = 'C1' | 'C2' | 'C3' | 'C4';
export type CrewRole = 'CDR' | 'CMO' | 'MS' | 'PS';

export type MissionPhaseName =
  | 'LEO'
  | 'TRANSIT'
  | 'LUNAR_SURFACE'
  | 'MARS_TRANSIT'
  | 'MARS_SURFACE'
  | 'RETURN'
  | 'POST_LANDING';

export type ScenarioName =
  | 'demo_5min'
  | 'spe_event'
  | 'co2_scrubber_degradation'
  | 'insomnia_streak'
  | 'headache_branching'
  | 'orthostatic_intolerance'
  | 'leo_baseline'
  | 'lunar_surface';

export type ReadinessKind = 'OVERALL' | 'EVA' | 'COGNITIVE' | 'PHYSICAL';

export interface ConfigLimit {
  key: string;
  label: string;
  value?: number;
  min?: number;
  max?: number;
  unit: string;
  source_ref: string;
  verified: boolean;
}

export interface HazardMeta {
  id: Hazard;
  letter: 'R' | 'I' | 'D' | 'G' | 'E';
  shortName: string;
  fullName: string;
  summary: string;
  primaryRisks: HrpRiskId[];
}

export const HAZARD_CATALOG: Record<Hazard, HazardMeta> = {
  RADIATION: {
    id: 'RADIATION',
    letter: 'R',
    shortName: 'Radiation',
    fullName: 'Space Radiation (GCR & SPE)',
    summary: 'Galactic cosmic rays, solar particle events, and secondary neutron flux (~30% in LEO per CSA CANS).',
    primaryRisks: ['HRP-17', 'HRP-01', 'HRP-03', 'HRP-12'],
  },
  ISOLATION_CONFINEMENT: {
    id: 'ISOLATION_CONFINEMENT',
    letter: 'I',
    shortName: 'Isolation',
    fullName: 'Isolation & Confinement',
    summary: 'Body clock out of sync, sleep debt, stress and workload pressure.',
    primaryRisks: ['HRP-12', 'HRP-13', 'HRP-14', 'HRP-01'],
  },
  DISTANCE_FROM_EARTH: {
    id: 'DISTANCE_FROM_EARTH',
    letter: 'D',
    shortName: 'Distance',
    fullName: 'Distance from Earth',
    summary: 'Up to 20-minute one-way comm delay at Mars; autonomous onboard medical triage required.',
    primaryRisks: ['HRP-15', 'HRP-07', 'HRP-12'],
  },
  GRAVITY_FIELDS: {
    id: 'GRAVITY_FIELDS',
    letter: 'G',
    shortName: 'Gravity',
    fullName: 'Altered Gravity Fields',
    summary: '1–1.5%/mo bone mineral loss in 0g, cephalad fluid shift (SANS), and post-landing orthostatic intolerance.',
    primaryRisks: ['HRP-02', 'HRP-03', 'HRP-08', 'HRP-09', 'HRP-10', 'HRP-11', 'HRP-16'],
  },
  HOSTILE_CLOSED_ENV: {
    id: 'HOSTILE_CLOSED_ENV',
    letter: 'E',
    shortName: 'Hostile Env',
    fullName: 'Hostile / Closed Environments',
    summary: 'Cabin ppCO₂, ppO₂, pressure, temperature, humidity, acoustic noise, and microbial load.',
    primaryRisks: ['HRP-01', 'HRP-04', 'HRP-05', 'HRP-06', 'HRP-08', 'HRP-12', 'HRP-14'],
  },
};

export interface HrpRiskMeta {
  id: HrpRiskId;
  name: string;
  category: 'Physiology' | 'Behavioral' | 'Radiation';
  primaryHazards: Hazard[];
}

export const HRP_RISK_CATALOG: Record<HrpRiskId, HrpRiskMeta> = {
  'HRP-01': {
    id: 'HRP-01',
    name: 'Altered immune system responses',
    category: 'Physiology',
    primaryHazards: ['HOSTILE_CLOSED_ENV', 'ISOLATION_CONFINEMENT', 'RADIATION'],
  },
  'HRP-02': {
    id: 'HRP-02',
    name: 'Altered sensorimotor/vestibular function',
    category: 'Physiology',
    primaryHazards: ['GRAVITY_FIELDS'],
  },
  'HRP-03': {
    id: 'HRP-03',
    name: 'Cardiovascular adaptations',
    category: 'Physiology',
    primaryHazards: ['GRAVITY_FIELDS', 'RADIATION'],
  },
  'HRP-04': {
    id: 'HRP-04',
    name: 'Decompression sickness',
    category: 'Physiology',
    primaryHazards: ['HOSTILE_CLOSED_ENV'],
  },
  'HRP-05': {
    id: 'HRP-05',
    name: 'Host–microorganism interactions',
    category: 'Physiology',
    primaryHazards: ['HOSTILE_CLOSED_ENV'],
  },
  'HRP-06': {
    id: 'HRP-06',
    name: 'Hypoxia',
    category: 'Physiology',
    primaryHazards: ['HOSTILE_CLOSED_ENV'],
  },
  'HRP-07': {
    id: 'HRP-07',
    name: 'Inadequate food & nutrition',
    category: 'Physiology',
    primaryHazards: ['DISTANCE_FROM_EARTH'],
  },
  'HRP-08': {
    id: 'HRP-08',
    name: 'EVA injury & compromised performance',
    category: 'Physiology',
    primaryHazards: ['HOSTILE_CLOSED_ENV', 'GRAVITY_FIELDS'],
  },
  'HRP-09': {
    id: 'HRP-09',
    name: 'Reduced cardiorespiratory & musculoskeletal fitness',
    category: 'Physiology',
    primaryHazards: ['GRAVITY_FIELDS'],
  },
  'HRP-10': {
    id: 'HRP-10',
    name: 'SANS (Spaceflight Associated Neuro-ocular Syndrome)',
    category: 'Physiology',
    primaryHazards: ['GRAVITY_FIELDS'],
  },
  'HRP-11': {
    id: 'HRP-11',
    name: 'Spaceflight-induced bone changes',
    category: 'Physiology',
    primaryHazards: ['GRAVITY_FIELDS'],
  },
  'HRP-12': {
    id: 'HRP-12',
    name: 'Behavioral changes & psychiatric disorders',
    category: 'Behavioral',
    primaryHazards: ['ISOLATION_CONFINEMENT', 'DISTANCE_FROM_EARTH', 'RADIATION'],
  },
  'HRP-13': {
    id: 'HRP-13',
    name: 'Inadequate teamwork',
    category: 'Behavioral',
    primaryHazards: ['ISOLATION_CONFINEMENT'],
  },
  'HRP-14': {
    id: 'HRP-14',
    name: 'Inadequate sleep & irregular schedules',
    category: 'Behavioral',
    primaryHazards: ['ISOLATION_CONFINEMENT', 'HOSTILE_CLOSED_ENV'],
  },
  'HRP-15': {
    id: 'HRP-15',
    name: 'Inadequate systems operations support',
    category: 'Behavioral',
    primaryHazards: ['DISTANCE_FROM_EARTH'],
  },
  'HRP-16': {
    id: 'HRP-16',
    name: 'Injury from dynamic loads',
    category: 'Behavioral',
    primaryHazards: ['GRAVITY_FIELDS'],
  },
  'HRP-17': {
    id: 'HRP-17',
    name: 'Radiation-induced cancers',
    category: 'Radiation',
    primaryHazards: ['RADIATION'],
  },
};

export interface StatusDisplayMeta {
  symbol: '✓' | '▲' | '■' | '✖';
  label: string;
  pyramidImpact: string;
  badgeClass: string;
  ringColor: string;
  textClass: string;
  borderClass: string;
}

export const STATUS_DISPLAY: Record<OperationalStatus, StatusDisplayMeta> = {
  NOMINAL: {
    symbol: '✓',
    label: '✓ nominal',
    pyramidImpact: 'Within configured operational envelope',
    badgeClass: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40',
    ringColor: '#10b981',
    textClass: 'text-emerald-400',
    borderClass: 'border-emerald-500/40',
  },
  CAUTION: {
    symbol: '▲',
    label: '▲ caution',
    pyramidImpact: 'Level 3 — May affect mission objectives',
    badgeClass: 'bg-amber-500/20 text-amber-200 border-amber-400/50',
    ringColor: '#f59e0b',
    textClass: 'text-amber-300',
    borderClass: 'border-amber-400/50',
  },
  WARNING: {
    symbol: '■',
    label: '■ warning',
    pyramidImpact: 'Level 2 — May cause loss of mission or major health impact',
    badgeClass: 'bg-orange-500/25 text-orange-200 border-orange-400/60',
    ringColor: '#f97316',
    textClass: 'text-orange-300',
    borderClass: 'border-orange-400/60',
  },
  EMERGENCY: {
    symbol: '✖',
    label: '✖ emergency',
    pyramidImpact: 'Level 1 — Immediate threat to crew life (Loss of Crew)',
    badgeClass: 'bg-red-600/30 text-red-100 border-red-400 animate-pulse',
    ringColor: '#ef4444',
    textClass: 'text-red-400',
    borderClass: 'border-red-500',
  },
};

export function severityToStatus(severity: Severity): OperationalStatus {
  if (severity === 'INFO') return 'NOMINAL';
  return severity;
}

/** NASA loss category per severity (PRD §7.4, Block T): shown as a small sublabel, never changes the engine. */
export const SEVERITY_LOSS_CATEGORY: Record<Severity, { code: string; meaning: string } | null> = {
  INFO: null,
  CAUTION: { code: 'LOMO', meaning: 'Loss of mission objectives' },
  WARNING: { code: 'LOM', meaning: 'Loss of mission' },
  EMERGENCY: { code: 'LOC', meaning: 'Loss of crew' },
};

/**
 * Where a value comes from (PRD §6 M0). Ordered from least to most real. Block T adds CREW_ENTERED:
 * typed or tapped by a person on the tablet, no dataset, kept in memory only.
 */
export type Provenance =
  | 'SYNTHETIC'
  | 'SYNTHETIC_CALIBRATED'
  | 'CREW_ENTERED'
  | 'MEASURED_OTHER'
  | 'NASA_DERIVED'
  | 'NASA_MEASURED';

/** Current source of one signal, from snapshot.provenance (GET /api/v1/datasets has the full list). */
export interface SignalSource {
  provenance: Provenance;
  dataset_id: string | null;
  basis: string;
  /** Manifest entry of the dataset (data/nasa/MANIFEST.yaml), shown when the badge is tapped. */
  dataset?: DatasetMeta | null;
}

/** Where the one-way comm delay comes from (R-4): JPL Horizons light time by date, or a fixed value. */
export interface DelaySource {
  delay_s: number;
  provenance: Provenance;
  dataset_id: string | null;
  basis: string;
  /** Ephemeris date (UTC) for NASA_DERIVED values, e.g. "2026-11-14". */
  date: string | null;
  dataset?: DatasetMeta | null;
}

/** One bundled NASA dataset, as listed in data/nasa/MANIFEST.yaml. */
export interface DatasetMeta {
  id: string;
  label: string;
  title: string;
  source_url: string;
  retrieved: string;
  terms: string;
  transform: string;
  /** Who measured the data (P-0): "NASA", or e.g. "EPA" for MEASURED_OTHER datasets. Older payloads omit it. */
  agency?: string;
}

/** The dose-rate replay feeding the radiation signals right now (R-2 MSL/RAD; P-1..P-3 ISS, CRaTER, RadNet). */
export interface RadReplayInfo {
  replay_id: string;
  dataset_id: string;
  label: string;
  /** Dataset time the simulated clock maps to. */
  dataset_ts: string;
  /** Start of the RAD observation whose value is shown. */
  observation_ts: string;
  compression: number;
  /** SUSPECT = a data gap filled by holding the last good value. */
  quality: 'GOOD' | 'SUSPECT' | 'BAD';
  quality_factor: number;
  quality_factor_ref: string;
  absorbed_uGy_h: number;
  /** A synthetic SPE profile is multiplied onto the replay (fallback when rad_spe is inactive). */
  synthetic_spe_overlay: boolean;
  event_date?: string | null;
  donki_id?: string | null;
  /** P-1..P-3: what the replayed value is (older payloads omit it; they were MSL/RAD). */
  instrument?: string;
  /** absorbed: equivalent = value × Q; equivalent: the dataset already reports a dose equivalent rate. */
  measures?: 'absorbed' | 'equivalent';
  measured_provenance?: Provenance;
  /** Who measured the data: "NASA", or e.g. "EPA". */
  agency?: string;
  /** LEO only: the station is inside the South Atlantic Anomaly box (null elsewhere). */
  saa?: boolean | null;
}

/** R-5: bundled DONKI + OMNI2 record for the replayed SPE (GET /api/v1/spaceweather/event). */
export interface SpaceWeatherFlare {
  id: string;
  class: string;
  begin: string | null;
  peak: string | null;
  location: string | null;
  region: number | null;
  link: string | null;
}

export interface SpaceWeatherCme {
  id: string;
  start: string | null;
  speed_km_s: number | null;
  type: string | null;
  half_angle_deg: number | null;
  linked: string[];
  link: string | null;
}

export interface SpaceWeatherSep {
  id: string;
  time: string | null;
  instruments: string[];
  linked: string[];
  link: string | null;
}

export interface SpaceWeatherScaleLevel {
  level: string;
  ref: string;
  value: number;
  source_ref: string;
  verified: boolean;
}

export interface SpaceWeatherEvent {
  available: boolean;
  event_date: string | null;
  title: string;
  provenance: Provenance;
  sep: SpaceWeatherSep[];
  flares: SpaceWeatherFlare[];
  cmes: SpaceWeatherCme[];
  flux: {
    label: string;
    unit: string;
    /** [utc, pfu | null] hourly points. */
    points: Array<[string, number | null]>;
    suspect: string[];
    peak_pfu: number | null;
    peak_utc: string | null;
    peak_level: string | null;
  } | null;
  s_scale: SpaceWeatherScaleLevel[];
  sources: Partial<Record<'sep' | 'events' | 'flux', DatasetMeta | null>>;
  problems: string[];
  primary?: { sep: SpaceWeatherSep | null; flare: SpaceWeatherFlare | null; cme: SpaceWeatherCme | null };
}

export interface AlertEvidenceClause {
  signal: string;
  label: string;
  value: number;
  unit: string;
  limit: number;
  op: string;
  limit_verified: boolean;
  source_ref: string;
  /** Compound members: whether this condition is currently met. */
  firing?: boolean;
  /** A `none:` member: the alert needs this condition to be NOT met. */
  negated?: boolean;
  /** Still counted as met only because of hysteresis (value already back inside the limit). */
  hysteresis_hold?: boolean;
  provenance?: Provenance;
  dataset_id?: string | null;
  basis?: string;
  dataset?: DatasetMeta | null;
  /** T-4: set when an onboard-only questionnaire member was removed before the alert reached the ground. */
  redacted?: string;
}

/** Context-branching rules: same symptoms, different likely cause (e.g. CO2 vs hydration). */
export interface AlertContext {
  group: string;
  branch: string;
}

export interface AlertEvidence {
  signal: string;
  value: number;
  unit?: string;
  limit: number;
  op?: string;
  limit_verified: boolean;
  source_ref?: string;
  window: string;
  z_score?: number;
  clauses?: AlertEvidenceClause[];
  context?: AlertContext;
  hysteresis_hold?: boolean;
  provenance?: Provenance;
  dataset_id?: string | null;
  basis?: string;
  dataset?: DatasetMeta | null;
}

export interface AlertNote {
  ts: string;
  author: string;
  text: string;
}

export interface AlertItem {
  id: string;
  rule_id: string;
  title: string;
  crew_id: CrewId | null;
  severity: Severity;
  state: AlertState;
  raised_ts: string;
  ack_ts?: string | null;
  resolved_ts?: string | null;
  hazards: Hazard[];
  hrp_risks: HrpRiskId[];
  evidence: AlertEvidence;
  rationale: string;
  action: string;
  checklist?: string[];
  notes: AlertNote[];
  origin: 'ONBOARD' | 'GROUND';
}

export interface ReadinessComponent {
  id: string;
  label: string;
  score: number;
  weight: number;
  rawValue: string;
  limitLabel: string;
  limitVerified: boolean;
  sourceRef: string;
  status: OperationalStatus;
}

export interface ReadinessScore {
  crew_id: CrewId;
  ts: string;
  kind: ReadinessKind;
  value: number;
  status: OperationalStatus;
  goForOp: boolean;
  summary: string;
  components: ReadinessComponent[];
}

export interface TimeSeriesPoint {
  ts: string;
  label: string;
  value: number;
  secondaryValue?: number;
}

/** One signal's personal baseline from GET /crew/{id}/baselines (window from mission.yaml, 48 h). */
export interface BaselineStat {
  unit: string;
  n: number;
  mean: number | null;
  sd: number | null;
  current: number | null;
  z: number | null;
  outside: boolean;
}

export interface CrewBaseline {
  hr_rest: number;
  hr_std: number;
  hrv_rmssd: number;
  hrv_std: number;
  spo2: number;
  bp_systolic: number;
  bp_diastolic: number;
  skin_temp_c: number;
  body_mass_kg: number;
  bmd_pct: number;
  vo2max_proxy: number;
}

export interface CrewVitalsSnapshot {
  heart_rate: number;
  hrv_rmssd: number;
  spo2: number;
  resp_rate: number;
  skin_temp: number;
  bp_systolic: number;
  bp_diastolic: number;
  activity_counts: number;
  sleep_hours_24h: number;
  dose_rate_uSv_h: number;
  neutron_dose_uSv_h: number;
  bmd_estimate_pct: number;
  body_mass_kg: number;
}

export interface SleepNightRecord {
  dayLabel: string;
  hours: number;
}

export interface LongTermTrendPoint {
  missionDay: number;
  label: string;
  bmdPct: number;
  bodyMassKg: number;
  vo2MaxProxy: number;
  cumulativeDoseMSv: number;
  exerciseAdherencePct: number;
}

export interface CrewMemberSummary {
  id: CrewId;
  callsign: string;
  name: string;
  role: CrewRole;
  status: OperationalStatus;
  career_dose_prior_mSv: number;
  mission_dose_mSv: number;
  baseline: CrewBaseline;
  /** Backend baseline stats per signal (connected, onboard only). Offline: undefined. */
  baseline_stats?: Record<string, BaselineStat>;
  vitals: CrewVitalsSnapshot;
  readiness: Record<ReadinessKind, ReadinessScore>;
  sparklines: {
    heart_rate: number[];
    hrv_rmssd: number[];
    spo2: number[];
    dose_rate_uSv_h: number[];
  };
  timeseries: {
    heart_rate: TimeSeriesPoint[];
    hrv_rmssd: TimeSeriesPoint[];
    spo2: TimeSeriesPoint[];
    bp: TimeSeriesPoint[];
    skin_temp: TimeSeriesPoint[];
  };
  sleep_7d: SleepNightRecord[];
  trends_180d: LongTermTrendPoint[];
  in_shelter: boolean;
}

export interface EnvironmentState {
  ts: string;
  status: OperationalStatus;
  ppco2_mmHg: number;
  ppo2_kPa: number;
  cabin_pressure_kPa: number;
  cabin_temp_c: number;
  humidity_pct: number;
  noise_dBA: number;
  history: {
    ppco2: TimeSeriesPoint[];
    ppo2: TimeSeriesPoint[];
    cabin_temp: TimeSeriesPoint[];
    noise_dBA: TimeSeriesPoint[];
  };
}

export interface NeutronEnergyBin {
  energyRange: string;
  fluxPct: number;
  qualityFactor: number;
}

export interface RadiationSummary {
  ts: string;
  status: OperationalStatus;
  dose_rate_absorbed_uGy_h: number;
  dose_rate_equivalent_uSv_h: number;
  neutron_dose_equivalent_rate_uSv_h: number;
  neutron_fraction_pct: number;
  cumulative_24h_mSv: number;
  cumulative_30d_mSv: number;
  cumulative_mission_mSv: number;
  cumulative_career_leader_mSv: number;
  spe_active: boolean;
  spe_started_ts: string | null;
  spe_elapsed_s: number;
  shelter_dose_saved_mSv: number;
  spectrum_bins: NeutronEnergyBin[];
  history: TimeSeriesPoint[];
  /** Cabin (area) absorbed dose rate: the RAD measurement when a replay is active. */
  area_dose_rate_absorbed_uGy_h?: number;
  /** Active MSL/RAD replay; null/undefined when radiation is synthetic. */
  replay?: RadReplayInfo | null;
}

export interface RecommendationMessage {
  id: string;
  crew_id: CrewId | 'ALL';
  priority: Severity;
  author: string;
  title: string;
  rationale: string;
  checklist: string[];
  sent_ts: string;
  deliver_ts: string;
  remaining_delay_s: number;
  delivered: boolean;
  acknowledged_onboard: boolean;
}

export interface LinkStatus {
  one_way_delay_s: number;
  /** Source of one_way_delay_s; null in the browser-only fallback. */
  delay_source?: DelaySource | null;
  queue_depth: number;
  blackout: boolean;
  bandwidth_kbps: number;
  onboard_ts: string;
  ground_as_of_ts: string;
  lag_seconds: number;
  pending_packets: Array<{
    id: string;
    direction: 'DOWNLINK' | 'UPLINK';
    priority: Severity;
    summary: string;
    sent_ts: string;
    deliver_ts: string;
    eta_s: number;
  }>;
}

/** P-5: what the current gravity does to the body (model A, linear; synthetic physiology). */
export interface GravityEffect {
  model: 'LINEAR';
  gravity_g: number;
  /** Share of the 0 g drift rate at this gravity: 1 - g. */
  load_factor: number;
  bmd_loss_pct_month: number;
  bmd_loss_pct_month_0g: number;
  /** [systolic, diastolic] added to the in-flight baseline (Norsk 2015 x g). */
  bp_offset_mmHg: [number, number];
  hr_offset_bpm: number;
  unloaded_days: number;
  days_at_low_g: number;
  /** Last gravity increase (a landing) and the fainting-on-standing risk it carries (Meck 2001). */
  transition: {
    ts: string;
    from_g: number;
    to_g: number;
    days_at_low_g: number;
    presyncope_fraction: number;
    risk: number;
  } | null;
  basis: string;
}

export interface SimState {
  running: boolean;
  speed: number;
  seed: number;
  sim_ts: string;
  mission_day: number;
  phase: MissionPhaseName;
  gravity_g: number;
  /** P-5 gravity effect from the backend; absent offline. */
  gravity?: GravityEffect | null;
  comm_delay_s: number;
  /** Backend scenarios include some the dock has no button for (nominal, headache_branching). */
  active_scenario: ScenarioName | string | null;
  demo_segment_label?: string;
  backend_connected: boolean;
}

export interface AegisSystemState {
  sim: SimState;
  limits: Record<string, ConfigLimit>;
  crew: CrewMemberSummary[];
  alerts: AlertItem[];
  environment: EnvironmentState;
  radiation: RadiationSummary;
  link: LinkStatus;
  recommendations: RecommendationMessage[];
  /** Source of every signal. Empty while the browser-only fallback runs (all synthetic). */
  provenance: Record<string, SignalSource>;
  groundSnapshot: {
    as_of_ts: string;
    lag_s: number;
    crew: CrewMemberSummary[];
    alerts: AlertItem[];
    radiation: RadiationSummary;
    environment: EnvironmentState;
    provenance: Record<string, SignalSource>;
  };
}

/** P-6: one time point of an Inspiration4 aggregate analyte (crew mean and SD, never one person). */
export interface ReferencePoint {
  timepoint: string;
  n: number;
  mean: number | null;
  sd: number | null;
}

/** P-6: one analyte of the Inspiration4 CBC/CMP aggregate reference (NASA OSDR OSD-569 / OSD-575). */
export interface ReferenceAnalyte {
  panel: 'CBC' | 'CMP' | string;
  analyte: string;
  unit: string;
  ref_low: number | null;
  ref_high: number | null;
  /** Per-sex lab interval when the sexes differ, e.g. "F 11.7-15.5; M 13.2-17.1". */
  ref_note: string;
  points: ReferencePoint[];
}

/** P-6: GET /api/v1/reference/inspiration4 -> panel. Reference only; never feeds rules or alerts. */
export interface Inspiration4Panel {
  available: boolean;
  title: string;
  provenance: Provenance;
  dataset_id: string | null;
  dataset: DatasetMeta | null;
  basis: string;
  timepoints: string[];
  crew_n: number | null;
  min_cell_n: number;
  analytes: ReferenceAnalyte[];
  problem: string;
}

// ---- Block T: crew self-tests (GET /api/v1/selftests, config/selftests.yaml) ----------------------------------------
/** A rule limit the entered value is judged against (from the rules that use the signal). */
export interface SelfTestRuleLimit {
  rule_id: string;
  rule_type: string;
  severity: Severity;
  op: string;
  window: string;
  ref: string;
  value: number;
  source_ref: string;
  verified: boolean;
}

export interface SelfTestField {
  signal: string;
  label: string;
  /** Typing plausibility range (rejects typos), not a medical limit. */
  input_min: number;
  input_max: number;
  step: number;
  hint: string;
  unit: string;
  rule_limits: SelfTestRuleLimit[];
}

export interface SelfTestLimit {
  ref: string;
  value: number;
  source_ref: string;
  verified: boolean;
}

export interface SelfTestSchedule {
  every: string;
  at: string;
  due_window: string;
}

export type SelfTestKind = 'measurement' | 'report' | 'pvt' | 'questionnaire' | 'stand_test' | 'amsler';
export type EntryMethod = 'form' | 'tap' | 'pvt' | 'questionnaire' | 'stand_test' | 'amsler';

/** One catalog entry: why / steps / normal band / escalation all come from config, never from a component. */
export interface SelfTestDef {
  id: string;
  title: string;
  kind: SelfTestKind;
  entry_method: EntryMethod;
  fields: SelfTestField[];
  why: string;
  hazards: Hazard[];
  hrp_risks: HrpRiskId[];
  steps: string[];
  limit_refs: string[];
  limits: SelfTestLimit[];
  escalation: string;
  protocol: string;
  /** Protocol parameters the test screen runs with (e.g. PVT-B duration and gaps). */
  params: Record<string, number>;
  /** Set on demo-length variants: shown so nobody mistakes them for the real protocol. */
  short_mode_note: string;
  schedule: SelfTestSchedule | null;
  after_gravity_increase: boolean;
  onboard_only: boolean;
  /** T-4 questionnaire items; their answers combine into the single field by `score`. */
  items?: QuestionnaireItem[];
  score?: 'mean' | null;
}

export interface QuestionnaireItem {
  label: string;
  min: number;
  max: number;
  step: number;
  /** Verbal labels at some scale points (keys are scale values). */
  anchors: Record<string, string>;
}

export interface SelfTestResult {
  test_id: string;
  crew_id: CrewId;
  ts: string;
  values: Record<string, number>;
  provenance: Provenance;
  entry_method: EntryMethod | null;
  basis: string;
}

export interface SubmitOutcome {
  ok: boolean;
  /** Plain message for the crew (the server's reason when refused). */
  message: string;
}

/** T-1 routine board item (GET /api/v1/selftests/schedule). OVERDUE is information only, never scored. */
export type ScheduleStatus = 'DUE' | 'DONE' | 'OVERDUE' | 'UPCOMING';

export interface ScheduleItem {
  test_id: string;
  title: string;
  kind: SelfTestKind;
  hazards: Hazard[];
  reason: 'routine' | 'after gravity increase';
  status: ScheduleStatus;
  level: 'INFO' | null;
  slot_start: string | null;
  due_until: string | null;
  next_due: string | null;
  done_ts: string | null;
  done_provenance: Provenance | null;
}
