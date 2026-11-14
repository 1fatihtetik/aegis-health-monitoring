import {
  AegisSystemState,
  AlertItem,
  AlertState,
  ConfigLimit,
  CrewId,
  CrewMemberSummary,
  EnvironmentState,
  LongTermTrendPoint,
  OperationalStatus,
  RadiationSummary,
  ReadinessKind,
  ReadinessScore,
  ScenarioName,
  TimeSeriesPoint,
} from './types';

/**
 * Config-driven limits mirroring config/limits.yaml (PRD §9).
 * Every limit carries source_ref and verified flag. Never present unverified numbers as NASA values.
 */
export const DEFAULT_CONFIG_LIMITS: Record<string, ConfigLimit> = {
  'radiation.career_effective_dose_mSv': {
    key: 'radiation.career_effective_dose_mSv',
    label: 'Career Effective Dose Limit',
    value: 600,
    unit: 'mSv',
    source_ref: 'NASA-STD-3001 Vol 1 (career limit), VERIFY',
    verified: false,
  },
  'radiation.mission_dose_mSv': {
    key: 'radiation.mission_dose_mSv',
    label: 'Mission Dose Advisory Limit',
    value: 250,
    unit: 'mSv',
    source_ref: 'Project heuristic (Mars DRM reference), VERIFY',
    verified: false,
  },
  'radiation.dose_30d_mSv': {
    key: 'radiation.dose_30d_mSv',
    label: '30-Day Dose Limit',
    value: 250,
    unit: 'mSv',
    source_ref: 'NASA-STD-3001 Vol 1 Short-Term Limit, VERIFY',
    verified: false,
  },
  'radiation.spe_alert_dose_rate_uSv_h': {
    key: 'radiation.spe_alert_dose_rate_uSv_h',
    label: 'SPE Emergency Dose Rate Threshold',
    value: 100,
    unit: 'µSv/h',
    source_ref: 'Project heuristic (SPE Shelter Trigger)',
    verified: false,
  },
  'radiation.daily_background_LEO_uSv': {
    key: 'radiation.daily_background_LEO_uSv',
    label: 'Daily Background LEO Reference',
    value: 500,
    unit: 'µSv/d',
    source_ref: 'Typical ISS order of magnitude, VERIFY',
    verified: false,
  },
  'environment.ppco2_mmHg_1h_max': {
    key: 'environment.ppco2_mmHg_1h_max',
    label: 'Cabin ppCO₂ 1-Hour Max',
    value: 3.0,
    max: 3.0,
    min: 0.0,
    unit: 'mmHg',
    source_ref: 'NASA-STD-3001 Vol 2, VERIFY',
    verified: false,
  },
  'environment.ppo2_kPa_min': {
    key: 'environment.ppo2_kPa_min',
    label: 'Cabin ppO₂ Minimum',
    value: 19.5,
    min: 19.5,
    max: 23.1,
    unit: 'kPa',
    source_ref: 'NASA-STD-3001 Vol 2, VERIFY',
    verified: false,
  },
  'environment.cabin_temp_C': {
    key: 'environment.cabin_temp_C',
    label: 'Cabin Temperature Envelope',
    min: 18,
    max: 27,
    unit: '°C',
    source_ref: 'NASA-STD-3001 Vol 2, VERIFY',
    verified: false,
  },
  'environment.humidity_pct': {
    key: 'environment.humidity_pct',
    label: 'Cabin Relative Humidity Envelope',
    min: 25,
    max: 75,
    unit: '%RH',
    source_ref: 'NASA-STD-3001 Vol 2, VERIFY',
    verified: false,
  },
  'environment.noise_dBA_sleep_max': {
    key: 'environment.noise_dBA_sleep_max',
    label: 'Cabin Acoustic Limit (Sleep/Continuous)',
    value: 50,
    max: 50,
    min: 30,
    unit: 'dBA',
    source_ref: 'NASA-STD-3001 Vol 2, VERIFY',
    verified: false,
  },
  'physiology.spo2_pct_min': {
    key: 'physiology.spo2_pct_min',
    label: 'Arterial Oxygen Saturation (SpO₂) Min',
    value: 92,
    min: 92,
    max: 100,
    unit: '%',
    source_ref: 'Clinical heuristic',
    verified: false,
  },
  'physiology.hr_bpm': {
    key: 'physiology.hr_bpm',
    label: 'Resting Heart Rate Envelope',
    min: 45,
    max: 115,
    unit: 'bpm',
    source_ref: 'Clinical heuristic',
    verified: false,
  },
  'physiology.bp_systolic_mmHg': {
    key: 'physiology.bp_systolic_mmHg',
    label: 'Systolic Blood Pressure Envelope',
    min: 95,
    max: 138,
    unit: 'mmHg',
    source_ref: 'Clinical heuristic',
    verified: false,
  },
  'physiology.baseline_z_alert': {
    key: 'physiology.baseline_z_alert',
    label: 'Personal Baseline Z-Score Deviation',
    value: 3.0,
    unit: 'σ',
    source_ref: 'Project heuristic (14-day rolling window)',
    verified: false,
  },
  'bone.bmd_loss_pct_per_month_expected_0g': {
    key: 'bone.bmd_loss_pct_per_month_expected_0g',
    label: 'Expected 0g Bone Mineral Density Loss Rate',
    min: 1.0,
    max: 1.5,
    unit: '%/month',
    source_ref: 'NASA HRP Gravity Fields page',
    verified: true,
  },
  'sleep.min_sleep_h_24h': {
    key: 'sleep.min_sleep_h_24h',
    label: 'Minimum Sleep Duration per 24h',
    value: 6.0,
    min: 6.0,
    max: 9.0,
    unit: 'h/24h',
    source_ref: 'Project heuristic',
    verified: false,
  },
};

/**
 * Mulberry32 deterministic seeded PRNG (AGENTS.md §1 Rule 7: Determinism)
 */
export function createSeededRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildLongTermTrends(
  rng: () => number,
  adherenceBase: number,
  priorDose: number
): LongTermTrendPoint[] {
  const points: LongTermTrendPoint[] = [];
  let bmd = 100.0;
  let mass = 74.5;
  let vo2 = 46.0;
  let dose = priorDose;

  for (let day = 0; day <= 180; day += 15) {
    const adherence = Math.min(100, Math.max(55, Math.round(adherenceBase + (rng() - 0.5) * 8)));
    if (day > 0) {
      // 1.0 to 1.5% BMD loss per 30 days in 0g, scaled down by exercise adherence
      const monthlyLossRate = 1.35 * (1 - (adherence - 50) * 0.006);
      bmd = Number((bmd - monthlyLossRate * 0.5).toFixed(2));
      mass = Number((mass - (0.12 - (adherence / 100) * 0.08) + (rng() - 0.5) * 0.15).toFixed(1));
      vo2 = Number((vo2 - (0.35 - (adherence / 100) * 0.22)).toFixed(1));
      dose = Number((dose + 7.2 + rng() * 1.1).toFixed(1));
    }
    points.push({
      missionDay: day,
      label: `MD-${day}`,
      bmdPct: bmd,
      bodyMassKg: mass,
      vo2MaxProxy: vo2,
      cumulativeDoseMSv: dose,
      exerciseAdherencePct: adherence,
    });
  }
  return points;
}

function generateTimeSeries(
  baseTimeMs: number,
  count: number,
  baseVal: number,
  amplitude: number,
  rng: () => number,
  secondaryBase?: number
): TimeSeriesPoint[] {
  const arr: TimeSeriesPoint[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const tsMs = baseTimeMs - i * 60_000;
    const d = new Date(tsMs);
    const hh = String(d.getUTCHours()).padStart(2, '0');
    const mm = String(d.getUTCMinutes()).padStart(2, '0');
    const wave = Math.sin((count - i) * 0.35) * (amplitude * 0.55);
    const noise = (rng() - 0.5) * amplitude;
    const value = Number((baseVal + wave + noise).toFixed(2));
    const secondaryValue =
      secondaryBase !== undefined
        ? Number((secondaryBase + wave * 0.6 + (rng() - 0.5) * (amplitude * 0.6)).toFixed(1))
        : undefined;
    arr.push({
      ts: d.toISOString(),
      label: `${hh}:${mm}`,
      value,
      secondaryValue,
    });
  }
  return arr;
}

export function buildInitialSystemState(seed = 42): AegisSystemState {
  const rng = createSeededRng(seed);
  const baseTimeMs = Date.parse('2026-11-14T12:00:00Z');
  const simTs = new Date(baseTimeMs).toISOString();

  const crewProfiles: Array<{
    id: CrewId;
    callsign: string;
    name: string;
    role: 'CDR' | 'CMO' | 'MS' | 'PS';
    career_dose_prior_mSv: number;
    hr_rest: number;
    hrv_rmssd: number;
    bp_sys: number;
    bp_dia: number;
    mass: number;
    adherence: number;
  }> = [
    {
      id: 'C1',
      callsign: 'VALKYRIE',
      name: 'Cmdr. Elena Vance',
      role: 'CDR',
      career_dose_prior_mSv: 142.0,
      hr_rest: 62,
      hrv_rmssd: 54,
      bp_sys: 116,
      bp_dia: 74,
      mass: 68.4,
      adherence: 92,
    },
    {
      id: 'C2',
      callsign: 'AESCULAPIUS',
      name: 'Dr. Marcus Chen',
      role: 'CMO',
      career_dose_prior_mSv: 88.5,
      hr_rest: 66,
      hrv_rmssd: 49,
      bp_sys: 118,
      bp_dia: 76,
      mass: 76.2,
      adherence: 95,
    },
    {
      id: 'C3',
      callsign: 'ORION',
      name: 'Tariq Al-Mansoor',
      role: 'MS',
      career_dose_prior_mSv: 110.2,
      hr_rest: 59,
      hrv_rmssd: 58,
      bp_sys: 114,
      bp_dia: 72,
      mass: 81.0,
      adherence: 86,
    },
    {
      id: 'C4',
      callsign: 'BOREALIS',
      name: 'Dr. Chloe Tremblay',
      role: 'PS',
      career_dose_prior_mSv: 64.0,
      hr_rest: 64,
      hrv_rmssd: 52,
      bp_sys: 112,
      bp_dia: 71,
      mass: 63.8,
      adherence: 90,
    },
  ];

  const crew: CrewMemberSummary[] = crewProfiles.map((p) => {
    const hrSeries = generateTimeSeries(baseTimeMs, 24, p.hr_rest + 4, 5, rng);
    const hrvSeries = generateTimeSeries(baseTimeMs, 24, p.hrv_rmssd, 6, rng);
    const spo2Series = generateTimeSeries(baseTimeMs, 24, 98.1, 0.8, rng);
    const bpSeries = generateTimeSeries(baseTimeMs, 24, p.bp_sys, 4, rng, p.bp_dia);
    const tempSeries = generateTimeSeries(baseTimeMs, 24, 36.6, 0.2, rng);
    const doseSpark = generateTimeSeries(baseTimeMs, 16, 22.4, 2.2, rng).map((d) => d.value);
    const trends = buildLongTermTrends(rng, p.adherence, p.career_dose_prior_mSv);
    const latestTrend = trends[trends.length - 1];

    const sleep7d = ['D-6', 'D-5', 'D-4', 'D-3', 'D-2', 'D-1', 'Today'].map((dayLabel) => ({
      dayLabel,
      hours: Number((7.1 + (rng() - 0.45) * 1.1).toFixed(1)),
      efficiencyPct: Math.round(88 + (rng() - 0.45) * 8),
      awakenings: Math.max(0, Math.round(1 + (rng() - 0.5) * 2)),
    }));

    const buildReadiness = (kind: ReadinessKind, scoreVal: number): ReadinessScore => ({
      crew_id: p.id,
      ts: simTs,
      kind,
      value: scoreVal,
      status: scoreVal >= 80 ? 'NOMINAL' : scoreVal >= 65 ? 'CAUTION' : 'WARNING',
      goForOp: scoreVal >= 75,
      summary:
        scoreVal >= 80
          ? 'Indicators within nominal operational limits'
          : 'Reduced margin — recommend CMO review before critical tasking',
      components: [
        {
          id: 'sleep',
          label: '24h Sleep Restorative Margin',
          score: 91,
          weight: 0.3,
          rawValue: `${sleep7d[6].hours} h`,
          limitLabel: '≥ 6.0 h/24h',
          limitVerified: false,
          sourceRef: 'Project heuristic',
          status: 'NOMINAL',
        },
        {
          id: 'co2',
          label: 'Cabin ppCO₂ Cognitive Margin',
          score: 94,
          weight: 0.25,
          rawValue: '2.1 mmHg',
          limitLabel: '≤ 3.0 mmHg (1h)',
          limitVerified: false,
          sourceRef: 'NASA-STD-3001 Vol 2, VERIFY',
          status: 'NOMINAL',
        },
        {
          id: 'cardio',
          label: 'Autonomic / HRV Recovery (RMSSD)',
          score: 89,
          weight: 0.25,
          rawValue: `${p.hrv_rmssd} ms`,
          limitLabel: 'Within ±2.0σ personal baseline',
          limitVerified: false,
          sourceRef: 'Project heuristic',
          status: 'NOMINAL',
        },
        {
          id: 'dcs_rad',
          label: 'DCS Prebreathe & Radiation Margin',
          score: 95,
          weight: 0.2,
          rawValue: '22.4 µSv/h',
          limitLabel: '< 100 µSv/h SPE limit',
          limitVerified: false,
          sourceRef: 'Project heuristic',
          status: 'NOMINAL',
        },
      ],
    });

    return {
      id: p.id,
      callsign: p.callsign,
      name: p.name,
      role: p.role,
      status: 'NOMINAL',
      career_dose_prior_mSv: p.career_dose_prior_mSv,
      mission_dose_mSv: 48.6,
      baseline: {
        hr_rest: p.hr_rest,
        hr_std: 4.2,
        hrv_rmssd: p.hrv_rmssd,
        hrv_std: 5.5,
        spo2: 98.2,
        bp_systolic: p.bp_sys,
        bp_diastolic: p.bp_dia,
        skin_temp_c: 36.6,
        body_mass_kg: p.mass,
        bmd_pct: 100.0,
        vo2max_proxy: 46.5,
      },
      vitals: {
        heart_rate: hrSeries[hrSeries.length - 1].value,
        hrv_rmssd: hrvSeries[hrvSeries.length - 1].value,
        spo2: spo2Series[spo2Series.length - 1].value,
        resp_rate: 14.2,
        skin_temp: tempSeries[tempSeries.length - 1].value,
        bp_systolic: bpSeries[bpSeries.length - 1].value,
        bp_diastolic: bpSeries[bpSeries.length - 1].secondaryValue ?? p.bp_dia,
        activity_counts: 142,
        sleep_hours_24h: sleep7d[6].hours,
        sleep_efficiency_pct: sleep7d[6].efficiencyPct,
        dose_rate_uSv_h: 22.4,
        neutron_dose_uSv_h: 6.8,
        bmd_estimate_pct: latestTrend.bmdPct,
        body_mass_kg: latestTrend.bodyMassKg,
        exercise_minutes_today: 55,
        workload_score: 42,
      },
      readiness: {
        OVERALL: buildReadiness('OVERALL', 92),
        EVA: buildReadiness('EVA', 93),
        COGNITIVE: buildReadiness('COGNITIVE', 91),
        PHYSICAL: buildReadiness('PHYSICAL', 90),
      },
      sparklines: {
        heart_rate: hrSeries.slice(-14).map((d) => d.value),
        hrv_rmssd: hrvSeries.slice(-14).map((d) => d.value),
        spo2: spo2Series.slice(-14).map((d) => d.value),
        dose_rate_uSv_h: doseSpark,
      },
      timeseries: {
        heart_rate: hrSeries,
        hrv_rmssd: hrvSeries,
        spo2: spo2Series,
        bp: bpSeries,
        skin_temp: tempSeries,
      },
      sleep_7d: sleep7d,
      trends_180d: trends,
      in_shelter: false,
    };
  });

  const environment: EnvironmentState = {
    ts: simTs,
    status: 'NOMINAL',
    ppco2_mmHg: 2.1,
    ppo2_kPa: 21.1,
    cabin_pressure_kPa: 101.3,
    cabin_temp_c: 21.8,
    humidity_pct: 46.0,
    noise_dBA: 44.5,
    history: {
      ppco2: generateTimeSeries(baseTimeMs, 24, 2.1, 0.25, rng),
      ppo2: generateTimeSeries(baseTimeMs, 24, 21.1, 0.2, rng),
      cabin_temp: generateTimeSeries(baseTimeMs, 24, 21.8, 0.5, rng),
      noise_dBA: generateTimeSeries(baseTimeMs, 24, 44.5, 2.0, rng),
    },
  };

  const radHistory = generateTimeSeries(baseTimeMs, 24, 22.4, 2.4, rng, 6.8);

  const radiation: RadiationSummary = {
    ts: simTs,
    status: 'NOMINAL',
    dose_rate_absorbed_uGy_h: 8.9,
    dose_rate_equivalent_uSv_h: 22.4,
    neutron_dose_equivalent_rate_uSv_h: 6.8,
    neutron_fraction_pct: 30.4,
    cumulative_24h_mSv: 0.54,
    cumulative_30d_mSv: 16.2,
    cumulative_mission_mSv: 48.6,
    cumulative_career_leader_mSv: 190.6,
    spe_active: false,
    spe_started_ts: null,
    spe_elapsed_s: 0,
    shelter_dose_saved_mSv: 0,
    spectrum_bins: [
      { energyRange: 'Thermal (<0.5 eV)', fluxPct: 12, qualityFactor: 2.5 },
      { energyRange: 'Epithermal (0.5 eV–100 keV)', fluxPct: 19, qualityFactor: 5.0 },
      { energyRange: 'Fast (0.1–2 MeV)', fluxPct: 34, qualityFactor: 20.0 },
      { energyRange: 'Relativistic (2–20 MeV)', fluxPct: 23, qualityFactor: 10.0 },
      { energyRange: 'High-Energy (>20 MeV)', fluxPct: 12, qualityFactor: 5.0 },
    ],
    history: radHistory,
  };

  const groundAsOfTs = new Date(baseTimeMs - 720 * 1000).toISOString();

  return {
    sim: {
      running: true,
      speed: 1,
      seed,
      sim_ts: simTs,
      mission_day: 105,
      phase: 'MARS_TRANSIT',
      gravity_g: 0.0,
      comm_delay_s: 720, // 12 min one-way Mars transit delay
      active_scenario: null,
      backend_connected: false,
    },
    limits: DEFAULT_CONFIG_LIMITS,
    crew,
    alerts: [],
    environment,
    radiation,
    link: {
      one_way_delay_s: 720,
      queue_depth: 0,
      blackout: false,
      bandwidth_kbps: 128,
      onboard_ts: simTs,
      ground_as_of_ts: groundAsOfTs,
      lag_seconds: 720,
      pending_packets: [],
    },
    recommendations: [
      {
        id: 'rec-initial-1',
        crew_id: 'C1',
        priority: 'INFO',
        author: 'Flight Surgeon (MCC-Houston)',
        title: 'Maintain ARED resistive load protocol during Mars Transit Week 15',
        rationale:
          'Indicators consistent with expected 0g trabecular bone remodeling (-1.1%/mo). Current exercise adherence (92%) is mitigating steeper decline.',
        checklist: [
          'Continue ARED squat + deadlift series 6x/week',
          'Log daily Vitamin D3 + calcium intake',
          'Complete weekly OCT visual acuity check',
        ],
        sent_ts: new Date(baseTimeMs - 3600_000).toISOString(),
        deliver_ts: new Date(baseTimeMs - 2880_000).toISOString(),
        remaining_delay_s: 0,
        delivered: true,
        acknowledged_onboard: true,
      },
    ],
    groundSnapshot: {
      as_of_ts: groundAsOfTs,
      lag_s: 720,
      crew: structuredClone(crew),
      alerts: [],
      radiation: structuredClone(radiation),
      environment: structuredClone(environment),
    },
  };
}

/**
 * Typed REST client with graceful fallback when the FastAPI backend is not reachable.
 */
async function tryFetchJson<T>(url: string, init?: RequestInit): Promise<T | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1200);
    const res = await fetch(url, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(init?.headers ?? {}),
      },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export const aegisApi = {
  async checkHealth(): Promise<boolean> {
    const data = await tryFetchJson<{ status?: string }>('/api/v1/health');
    if (data) return true;
    const rootHealth = await tryFetchJson<{ status?: string }>('/health');
    return Boolean(rootHealth);
  },

  async startScenario(payload: { name: ScenarioName | 'nominal'; speed?: number; seed: number }): Promise<boolean> {
    const res = await tryFetchJson('/api/v1/sim/scenario', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    return res !== null;
  },

  async controlSim(payload: { action: 'pause' | 'resume' | 'speed'; speed?: number }): Promise<boolean> {
    const res = await tryFetchJson('/api/v1/sim/control', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    return res !== null;
  },

  // Alert actions, notes, shelter, blackout and recommendations go through backendApi (backend.ts).
};

/**
 * Helper to compute crew status from active alerts and readiness
 */
export function deriveCrewStatus(
  crewId: CrewId,
  alerts: AlertItem[],
  fallback: OperationalStatus = 'NOMINAL'
): OperationalStatus {
  const active = alerts.filter(
    (a) =>
      (a.crew_id === crewId || a.crew_id === null) &&
      (a.state === 'RAISED' || a.state === 'ACKNOWLEDGED' || a.state === 'IN_TREATMENT')
  );
  if (active.some((a) => a.severity === 'EMERGENCY')) return 'EMERGENCY';
  if (active.some((a) => a.severity === 'WARNING')) return 'WARNING';
  if (active.some((a) => a.severity === 'CAUTION')) return 'CAUTION';
  return fallback;
}

export function formatDurationSeconds(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const mins = Math.floor(s / 60);
  const secs = s % 60;
  return `${mins}m ${String(secs).padStart(2, '0')}s`;
}

export type { AlertState };
