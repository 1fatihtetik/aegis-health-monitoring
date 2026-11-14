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
  | 'orthostatic_intolerance';

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
    summary: 'Circadian desynchronization, sleep debt, behavioral stress, and workload pressure.',
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

export interface AlertEvidenceClause {
  signal: string;
  label: string;
  value: number;
  unit: string;
  limit: number;
  op: string;
  limit_verified: boolean;
  source_ref: string;
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

export interface SimState {
  running: boolean;
  speed: number;
  seed: number;
  sim_ts: string;
  mission_day: number;
  phase: MissionPhaseName;
  gravity_g: number;
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
  groundSnapshot: {
    as_of_ts: string;
    lag_s: number;
    crew: CrewMemberSummary[];
    alerts: AlertItem[];
    radiation: RadiationSummary;
    environment: EnvironmentState;
  };
}
