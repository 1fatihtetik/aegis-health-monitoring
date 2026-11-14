import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import {
  aegisApi,
  buildInitialSystemState,
  createSeededRng,
  deriveCrewStatus,
} from './client';
import {
  AegisSystemState,
  AlertItem,
  AlertState,
  CrewId,
  MissionPhaseName,
  RecommendationMessage,
  ScenarioName,
  Severity,
} from './types';
import {
  BackendAlert,
  BackendHistory,
  BackendMessage,
  BackendRecommendation,
  BackendSnapshot,
  applyGroundSnapshot,
  applyOnboardSnapshot,
  backendApi,
  extendHistory,
  fetchHistory,
  mapAlert,
  mapRecommendation,
  pendingUplinks,
} from './backend';
import { BUNDLED_LIMITS, formatLimit } from './limits';

/** Offline fallback only: evidence limit fields read from config/limits.yaml (never hardcoded). */
function lim(key: string, pick: 'value' | 'min' | 'max' = 'value', sign = 1) {
  const l = BUNDLED_LIMITS[key];
  const v = l?.[pick];
  return {
    limit: v === undefined ? Number.NaN : sign * v,
    limit_verified: l?.verified ?? false,
    source_ref: l?.source_ref ?? key,
  };
}

const limValue = (key: string): number => BUNDLED_LIMITS[key]?.value ?? Number.NaN;

/** Offline SPE peak: a simulator parameter set relative to the configured alert threshold. */
const OFFLINE_SPE_RATE = Number((limValue('radiation.spe_alert_dose_rate_uSv_h') * 1.6).toFixed(1));
const OFFLINE_SPE_NEUTRON = Number((OFFLINE_SPE_RATE * 0.32).toFixed(1));

/** Everything received from the backend, kept outside React state and mapped into it on each frame. */
interface BackendLinkState {
  generation: number;
  lastSnap: { onboard?: BackendSnapshot; ground?: BackendSnapshot };
  alerts: { onboard: Map<string, AlertItem>; ground: Map<string, AlertItem> };
  history: { onboard: BackendHistory; ground: BackendHistory };
  sentGround: BackendRecommendation[];
  deliveredOnboard: BackendRecommendation[];
  ackedRecs: Set<string>;
}

function emptyHistory(): BackendHistory {
  return { crew: {}, environment: {}, baselines: {} };
}

function emptyLinkState(): BackendLinkState {
  return {
    generation: 0,
    lastSnap: {},
    alerts: { onboard: new Map(), ground: new Map() },
    history: { onboard: emptyHistory(), ground: emptyHistory() },
    sentGround: [],
    deliveredOnboard: [],
    ackedRecs: new Set(),
  };
}

interface DownlinkSnapshotPacket {
  deliverSimMs: number;
  sentSimTs: string;
  crew: AegisSystemState['crew'];
  alerts: AlertItem[];
  radiation: AegisSystemState['radiation'];
  environment: AegisSystemState['environment'];
}

interface AegisContextValue {
  state: AegisSystemState;
  triggerScenario: (scenario: ScenarioName, customSeed?: number) => void;
  resetNominal: () => void;
  setSimSpeed: (speed: number) => void;
  toggleSimRunning: () => void;
  setMissionPhase: (phase: MissionPhaseName) => void;
  setSeed: (seed: number) => void;
  acknowledgeAlert: (alertId: string, note?: string) => void;
  setAlertInTreatment: (alertId: string, note?: string) => void;
  resolveAlert: (alertId: string, note?: string) => void;
  addAlertNote: (alertId: string, author: string, text: string) => void;
  toggleCrewShelter: (crewId: CrewId) => void;
  evacuateAllToShelter: () => void;
  toggleLinkBlackout: () => void;
  sendGroundRecommendation: (input: {
    crew_id: CrewId | 'ALL';
    priority: Severity;
    title: string;
    rationale: string;
    checklist: string[];
  }) => void;
  acknowledgeRecommendationOnboard: (recId: string) => void;
}

const AegisContext = createContext<AegisContextValue | null>(null);

const PHASE_PROFILES: Record<
  MissionPhaseName,
  { gravity_g: number; comm_delay_s: number; bg_dose_uSv_h: number }
> = {
  LEO: { gravity_g: 0.0, comm_delay_s: 2, bg_dose_uSv_h: 18.5 },
  TRANSIT: { gravity_g: 0.0, comm_delay_s: 6, bg_dose_uSv_h: 21.0 },
  LUNAR_SURFACE: { gravity_g: 0.16, comm_delay_s: 2, bg_dose_uSv_h: 16.2 },
  MARS_TRANSIT: { gravity_g: 0.0, comm_delay_s: 720, bg_dose_uSv_h: 22.4 },
  MARS_SURFACE: { gravity_g: 0.38, comm_delay_s: 720, bg_dose_uSv_h: 14.8 },
  RETURN: { gravity_g: 0.0, comm_delay_s: 480, bg_dose_uSv_h: 22.0 },
  POST_LANDING: { gravity_g: 1.0, comm_delay_s: 0, bg_dose_uSv_h: 0.3 },
};

function makeTimeLabel(isoTs: string): string {
  const d = new Date(isoTs);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

export const AegisProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, setState] = useState<AegisSystemState>(() => buildInitialSystemState(42));
  const rngRef = useRef<() => number>(() => createSeededRng(42)());
  const downlinkQueueRef = useRef<DownlinkSnapshotPacket[]>([]);
  const demoStepRef = useRef<number>(0);

  useEffect(() => {
    rngRef.current = createSeededRng(state.sim.seed);
  }, [state.sim.seed]);

  // ---- backend connection (implementaionsandgoals.txt section 8) -----------------------------
  // When /ws/live is up, every view renders from backend snapshots and the local simulation stops.
  const connectedRef = useRef<boolean>(false);
  const linkRef = useRef<BackendLinkState>(emptyLinkState());
  const selectedSeedRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    let sockets: WebSocket[] = [];
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    const L = linkRef.current;

    const sortedAlerts = (m: Map<string, AlertItem>): AlertItem[] =>
      [...m.values()].sort((a, b) => b.raised_ts.localeCompare(a.raised_ts));

    const recommendationsView = (nowIso: string): RecommendationMessage[] => {
      const delivered = new Set(L.deliveredOnboard.map((r) => r.id));
      const byId = new Map<string, RecommendationMessage>();
      for (const r of L.sentGround) {
        byId.set(r.id, mapRecommendation(r, delivered.has(r.id), nowIso, L.ackedRecs.has(r.id)));
      }
      for (const r of L.deliveredOnboard) {
        byId.set(r.id, mapRecommendation(r, true, nowIso, L.ackedRecs.has(r.id)));
      }
      return [...byId.values()].sort((a, b) => b.sent_ts.localeCompare(a.sent_ts));
    };

    const render = (): void => {
      const onboard = L.lastSnap.onboard;
      if (!onboard || cancelled) return;
      const ground = L.lastSnap.ground;
      setState((prev) => {
        const delivered = new Set(L.deliveredOnboard.map((r) => r.id));
        let next = applyOnboardSnapshot({
          prev,
          snap: onboard,
          history: L.history.onboard,
          alerts: sortedAlerts(L.alerts.onboard),
        });
        next = {
          ...next,
          sim: { ...next.sim, seed: selectedSeedRef.current ?? next.sim.seed },
          recommendations: recommendationsView(onboard.now),
          link: { ...next.link, pending_packets: pendingUplinks(L.sentGround, delivered, onboard.now) },
        };
        if (ground) {
          next = applyGroundSnapshot({
            prev: next,
            snap: ground,
            history: L.history.ground,
            alerts: sortedAlerts(L.alerts.ground),
          });
        }
        return next;
      });
    };

    // A new World (scenario start, or the backend restarted): reload alerts, history, recommendations.
    const reload = async (snap: BackendSnapshot): Promise<void> => {
      const gen = ++L.generation;
      L.alerts.onboard.clear();
      L.alerts.ground.clear();
      L.history = { onboard: emptyHistory(), ground: emptyHistory() };
      L.sentGround = [];
      L.deliveredOnboard = [];
      const crewIds = (snap.crew ?? []).map((c) => c.id);
      const [aOn, aGr, hOn, hGr, rSent, rDel] = await Promise.all([
        backendApi.alerts('onboard'),
        backendApi.alerts('ground'),
        fetchHistory('onboard', crewIds, snap.now),
        fetchHistory('ground', crewIds, snap.now),
        backendApi.recommendations('ground'),
        backendApi.recommendations('onboard'),
      ]);
      if (cancelled || gen !== L.generation) return;
      for (const a of aOn) L.alerts.onboard.set(a.id, mapAlert(a));
      for (const a of aGr) L.alerts.ground.set(a.id, mapAlert(a));
      L.history = { onboard: hOn, ground: hGr };
      L.sentGround = rSent;
      L.deliveredOnboard = rDel;
      render();
    };

    const onMessage = (node: 'onboard' | 'ground', raw: string): void => {
      let msg: BackendMessage;
      try {
        msg = JSON.parse(raw) as BackendMessage;
      } catch {
        return;
      }
      if (msg.type === 'snapshot') {
        if (node === 'onboard') {
          const prev = L.lastSnap.onboard;
          const newWorld =
            !prev ||
            prev.sim.scenario !== msg.sim.scenario ||
            prev.sim.seed !== msg.sim.seed ||
            Date.parse(msg.now) < Date.parse(prev.now);
          L.lastSnap.onboard = msg;
          if (newWorld) void reload(msg);
          else extendHistory(L.history.onboard, msg);
        } else {
          L.lastSnap.ground = msg;
          extendHistory(L.history.ground, msg);
        }
        render();
      } else if (msg.type === 'alert') {
        L.alerts[node].set(msg.alert.id, mapAlert(msg.alert));
        render();
      } else if (msg.type === 'recommendation') {
        if (!L.deliveredOnboard.some((r) => r.id === msg.recommendation.id)) {
          L.deliveredOnboard.push(msg.recommendation);
        }
        render();
      }
    };

    const setConnected = (on: boolean): void => {
      connectedRef.current = on;
      setState((prev) => ({ ...prev, sim: { ...prev.sim, backend_connected: on } }));
    };

    const scheduleRetry = (): void => {
      if (cancelled || retryTimer) return;
      retryTimer = setTimeout(() => {
        retryTimer = null;
        void connect();
      }, 3000);
    };

    const connect = async (): Promise<void> => {
      const ok = await aegisApi.checkHealth();
      if (cancelled) return;
      if (!ok) {
        scheduleRetry();
        return;
      }
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const nodes: Array<'onboard' | 'ground'> = ['onboard', 'ground'];
      sockets = nodes.map((node) => {
        const ws = new WebSocket(`${proto}//${window.location.host}/ws/live?node=${node}`);
        ws.onmessage = (evt: MessageEvent<string>) => onMessage(node, evt.data);
        ws.onclose = () => {
          if (cancelled) return;
          sockets.forEach((s) => s.readyState === WebSocket.OPEN && s.close());
          sockets = [];
          L.lastSnap = {};
          if (connectedRef.current) setConnected(false);
          scheduleRetry();
        };
        return ws;
      });
      setConnected(true);
      // Thresholds come from the backend's config/limits.yaml (AGENTS.md ground rule 2).
      const limits = await backendApi.limits();
      if (limits && !cancelled) setState((prev) => ({ ...prev, limits }));
    };

    void connect();
    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      sockets.forEach((s) => s.close());
    };
  }, []);

  /** Upserts an alert returned by a REST action so the UI does not wait for the next WS frame. */
  const upsertBackendAlert = useCallback((a: BackendAlert | null) => {
    if (!a) return;
    const L = linkRef.current;
    L.alerts.onboard.set(a.id, mapAlert(a));
    setState((prev) => ({
      ...prev,
      alerts: [...L.alerts.onboard.values()].sort((x, y) => y.raised_ts.localeCompare(x.raised_ts)),
    }));
  }, []);

  const applyScenarioInjection = useCallback(
    (prev: AegisSystemState, scenario: ScenarioName, seedOverride?: number): AegisSystemState => {
      const activeSeed = seedOverride ?? prev.sim.seed;
      const rng = createSeededRng(activeSeed + scenario.length * 17);
      rngRef.current = rng;

      const simTs = prev.sim.sim_ts;
      const simMs = Date.parse(simTs);
      const next = structuredClone(prev);
      next.sim.seed = activeSeed;
      next.sim.active_scenario = scenario;
      next.sim.running = true;

      const upsertAlert = (alert: AlertItem) => {
        const idx = next.alerts.findIndex(
          (a) => a.rule_id === alert.rule_id && a.state !== 'RESOLVED'
        );
        if (idx >= 0) {
          next.alerts[idx] = alert;
        } else {
          next.alerts.unshift(alert);
        }
      };

      if (scenario === 'co2_scrubber_degradation' || scenario === 'demo_5min') {
        next.environment.ppco2_mmHg = 3.85;
        next.environment.status = 'CAUTION';
        next.environment.history.ppco2.push({
          ts: simTs,
          label: makeTimeLabel(simTs),
          value: 3.85,
        });
        next.environment.history.ppco2 = next.environment.history.ppco2.slice(-24);

        upsertAlert({
          id: `alert-co2-${activeSeed}`,
          rule_id: 'env.co2.high_1h',
          title: 'Elevated Cabin ppCO₂ — CDRA Scrubber Bed A Saturation',
          crew_id: null,
          severity: 'CAUTION',
          state: 'RAISED',
          raised_ts: simTs,
          hazards: ['HOSTILE_CLOSED_ENV'],
          hrp_risks: ['HRP-12', 'HRP-14', 'HRP-08'],
          evidence: {
            signal: 'ppco2',
            value: 3.85,
            unit: 'mmHg',
            op: '>',
            ...lim('environment.ppco2_mmHg_1h_max'),
            window: '1h mean',
          },
          rationale:
            'Indicators consistent with elevated cabin CO₂ partial pressure, linked to cephalalgia and reduced executive cognitive performance. Recommend CMO and ECLSS review.',
          action:
            'Switch CDRA desiccant/adsorbent bed to secondary channel; increase inter-module ventilation fan speed; monitor crew headache/fatigue symptoms.',
          checklist: [
            'Verify CDRA Bed A regeneration heater temperature',
            'Switch air revitalization valve to Bed B',
            'Boost cabin circulation fan to High (65 CFM)',
            'Administer CMO symptom check for C1–C4',
          ],
          notes: [],
          origin: 'ONBOARD',
        });
      }

      if (scenario === 'insomnia_streak' || scenario === 'demo_5min') {
        const cdr = next.crew.find((c) => c.id === 'C1');
        if (cdr) {
          cdr.vitals.sleep_hours_24h = 4.4;
          cdr.vitals.sleep_efficiency_pct = 68;
          cdr.vitals.hrv_rmssd = 34;
          cdr.vitals.heart_rate = 79;
          cdr.vitals.workload_score = 84;
          cdr.sleep_7d = [
            { dayLabel: 'D-6', hours: 6.8, efficiencyPct: 86, awakenings: 1 },
            { dayLabel: 'D-5', hours: 6.1, efficiencyPct: 81, awakenings: 2 },
            { dayLabel: 'D-4', hours: 5.5, efficiencyPct: 77, awakenings: 3 },
            { dayLabel: 'D-3', hours: 5.1, efficiencyPct: 74, awakenings: 3 },
            { dayLabel: 'D-2', hours: 4.8, efficiencyPct: 71, awakenings: 4 },
            { dayLabel: 'D-1', hours: 4.6, efficiencyPct: 69, awakenings: 4 },
            { dayLabel: 'Today', hours: 4.4, efficiencyPct: 68, awakenings: 5 },
          ];

          const evaComp = [
            {
              id: 'sleep',
              label: '24h Sleep Restorative Margin',
              score: 46,
              weight: 0.3,
              rawValue: '4.4 h (4-night deficit)',
              limitLabel: formatLimit(BUNDLED_LIMITS['sleep.min_sleep_h_24h'], '>='),
              limitVerified: lim('sleep.min_sleep_h_24h').limit_verified,
              sourceRef: lim('sleep.min_sleep_h_24h').source_ref,
              status: 'WARNING' as const,
            },
            {
              id: 'co2',
              label: 'Cabin ppCO₂ Cognitive Margin',
              score: next.environment.ppco2_mmHg > limValue('environment.ppco2_mmHg_1h_max') ? 52 : 88,
              weight: 0.25,
              rawValue: `${next.environment.ppco2_mmHg.toFixed(2)} mmHg`,
              limitLabel: `${formatLimit(BUNDLED_LIMITS['environment.ppco2_mmHg_1h_max'], '<=')} (1 h)`,
              limitVerified: lim('environment.ppco2_mmHg_1h_max').limit_verified,
              sourceRef: lim('environment.ppco2_mmHg_1h_max').source_ref,
              status:
                next.environment.ppco2_mmHg > limValue('environment.ppco2_mmHg_1h_max') ? ('CAUTION' as const) : ('NOMINAL' as const),
            },
            {
              id: 'cardio',
              label: 'Autonomic / HRV Recovery (RMSSD)',
              score: 61,
              weight: 0.25,
              rawValue: '34 ms (-3.6σ baseline)',
              limitLabel: `within ±${limValue('physiology.baseline_z_alert')}σ of personal baseline`,
              limitVerified: lim('physiology.baseline_z_alert').limit_verified,
              sourceRef: lim('physiology.baseline_z_alert').source_ref,
              status: 'CAUTION' as const,
            },
            {
              id: 'dcs_rad',
              label: 'DCS Prebreathe & Radiation Margin',
              score: 88,
              weight: 0.2,
              rawValue: `${next.radiation.dose_rate_equivalent_uSv_h.toFixed(1)} µSv/h`,
              limitLabel: `< ${formatLimit(BUNDLED_LIMITS['radiation.spe_alert_dose_rate_uSv_h'])} SPE threshold`,
              limitVerified: lim('radiation.spe_alert_dose_rate_uSv_h').limit_verified,
              sourceRef: lim('radiation.spe_alert_dose_rate_uSv_h').source_ref,
              status: 'NOMINAL' as const,
            },
          ];

          cdr.readiness.EVA = {
            crew_id: 'C1',
            ts: simTs,
            kind: 'EVA',
            value: 58,
            status: 'CAUTION',
            goForOp: false,
            summary:
              'NO-GO RECOMMENDATION: Compound sleep debt + cabin CO₂ exposure degrades EVA cognitive & psychomotor margin.',
            components: evaComp,
          };
          cdr.readiness.COGNITIVE = {
            ...cdr.readiness.COGNITIVE,
            value: 56,
            status: 'CAUTION',
            goForOp: false,
            summary: 'Indicators consistent with circadian & hypercapnic cognitive fatigue.',
            components: evaComp,
          };
          cdr.readiness.OVERALL = {
            ...cdr.readiness.OVERALL,
            value: 64,
            status: 'CAUTION',
            goForOp: false,
          };
        }

        upsertAlert({
          id: `alert-compound-cog-${activeSeed}`,
          rule_id: 'compound.cognitive_performance_risk',
          title: 'Compound Cognitive Performance Risk (Sleep Debt + Elevated ppCO₂ + High Workload)',
          crew_id: 'C1',
          severity: 'CAUTION',
          state: 'RAISED',
          raised_ts: simTs,
          hazards: ['ISOLATION_CONFINEMENT', 'HOSTILE_CLOSED_ENV'],
          hrp_risks: ['HRP-14', 'HRP-12', 'HRP-08'],
          evidence: {
            signal: 'compound(sleep_24h, ppco2, hrv_rmssd)',
            value: 4.4,
            unit: 'h sleep',
            op: '<',
            ...lim('sleep.min_sleep_h_24h'),
            window: '72h rolling',
            clauses: [
              {
                signal: 'sleep_hours_24h',
                label: 'C1 Sleep Duration (24h)',
                value: 4.4,
                unit: 'h',
                op: '<',
                ...lim('sleep.min_sleep_h_24h'),
              },
              {
                signal: 'ppco2',
                label: 'Cabin ppCO₂ (1h mean)',
                value: next.environment.ppco2_mmHg,
                unit: 'mmHg',
                op: '>',
                ...lim('environment.ppco2_mmHg_1h_max'),
              },
              {
                signal: 'hrv_rmssd',
                label: 'C1 HRV RMSSD Personal Z-Score',
                value: -3.6,
                unit: 'σ',
                op: '<',
                ...lim('physiology.baseline_z_alert', 'value', -1),
              },
            ],
          },
          rationale:
            'Indicators consistent with multi-hazard cognitive fatigue (circadian sleep restriction compounded by cabin CO₂ buildup). Context-branching analysis points to hypercapnic + circadian driver rather than dehydration. Recommend CMO review and EVA deferral.',
          action:
            'Reschedule C1 (CDR) EVA tasking; initiate 45-min blue-enriched circadian light therapy at wake; verify CDRA CO₂ scrubbing.',
          checklist: [
            'Place HOLD on C1 scheduled EVA maintenance',
            'Reassign critical robotics checklist to C3 (MS)',
            'Schedule uninterrupted 8.5h protected sleep block for C1',
            'Verify cabin ppCO₂ drops below 2.5 mmHg',
          ],
          notes: [],
          origin: 'ONBOARD',
        });
      }

      if (scenario === 'orthostatic_intolerance') {
        next.sim.phase = 'MARS_SURFACE';
        next.sim.gravity_g = 0.38;
        const ms = next.crew.find((c) => c.id === 'C3');
        if (ms) {
          ms.vitals.bp_systolic = 86;
          ms.vitals.bp_diastolic = 53;
          ms.vitals.heart_rate = 128;
          ms.vitals.hrv_rmssd = 24;
          ms.timeseries.bp.push({
            ts: simTs,
            label: makeTimeLabel(simTs),
            value: 86,
            secondaryValue: 53,
          });
          ms.timeseries.heart_rate.push({
            ts: simTs,
            label: makeTimeLabel(simTs),
            value: 128,
          });
          ms.sparklines.heart_rate = [...ms.sparklines.heart_rate.slice(-13), 128];
          ms.readiness.PHYSICAL.value = 51;
          ms.readiness.PHYSICAL.status = 'WARNING';
          ms.readiness.OVERALL.value = 59;
          ms.readiness.OVERALL.status = 'WARNING';
        }

        upsertAlert({
          id: `alert-ortho-${activeSeed}`,
          rule_id: 'phys.gravity_transition.orthostatic_intolerance',
          title: 'Post-Landing Orthostatic Intolerance Pattern (0g → 0.38g Transition)',
          crew_id: 'C3',
          severity: 'WARNING',
          state: 'RAISED',
          raised_ts: simTs,
          hazards: ['GRAVITY_FIELDS'],
          hrp_risks: ['HRP-02', 'HRP-03', 'HRP-16'],
          evidence: {
            signal: 'bp_systolic & heart_rate',
            value: 86,
            unit: 'mmHg',
            op: '<',
            ...lim('physiology.bp_systolic_mmHg', 'min'),
            window: '15m post-transition',
            z_score: 4.1,
            clauses: [
              {
                signal: 'bp_systolic',
                label: 'C3 Systolic Arterial Pressure',
                value: 86,
                unit: 'mmHg',
                op: '<',
                ...lim('physiology.bp_systolic_mmHg', 'min'),
              },
              {
                signal: 'heart_rate',
                label: 'C3 Compensatory Tachycardia (+6.9σ)',
                value: 128,
                unit: 'bpm',
                op: '>',
                ...lim('physiology.hr_orthostatic_bpm'),
              },
            ],
          },
          rationale:
            'Indicators consistent with hypovolemic baroreflex deconditioning upon entry into 0.38g Mars gravity field (presyncopal risk). Recommend immediate CMO assessment.',
          action:
            'Place C3 in supine/Trendelenburg posture; activate lower-body compression garment; administer oral isotonic fluid-loading protocol.',
          checklist: [
            'Assist C3 to seated/supine position immediately',
            'Engage lower-body gradient compression garment (40 mmHg)',
            'Administer 500 mL isotonic electrolyte solution',
            'Repeat blood pressure & ECG check at +5 min and +15 min',
          ],
          notes: [],
          origin: 'ONBOARD',
        });
      }

      if (scenario === 'spe_event') {
        next.radiation.spe_active = true;
        next.radiation.spe_started_ts = simTs;
        next.radiation.spe_elapsed_s = 12;
        next.radiation.status = 'EMERGENCY';
        next.radiation.dose_rate_absorbed_uGy_h = 74.2;
        next.radiation.dose_rate_equivalent_uSv_h = OFFLINE_SPE_RATE;
        next.radiation.neutron_dose_equivalent_rate_uSv_h = OFFLINE_SPE_NEUTRON;
        next.radiation.neutron_fraction_pct = 32.0;
        next.radiation.history.push({
          ts: simTs,
          label: makeTimeLabel(simTs),
          value: OFFLINE_SPE_RATE,
          secondaryValue: OFFLINE_SPE_NEUTRON,
        });
        next.radiation.history = next.radiation.history.slice(-24);

        next.crew.forEach((c) => {
          c.vitals.dose_rate_uSv_h = OFFLINE_SPE_RATE;
          c.vitals.neutron_dose_uSv_h = OFFLINE_SPE_NEUTRON;
          c.sparklines.dose_rate_uSv_h = [...c.sparklines.dose_rate_uSv_h.slice(-13), OFFLINE_SPE_RATE];
        });

        upsertAlert({
          id: `alert-spe-${activeSeed}`,
          rule_id: 'rad.spe.emergency_takeover',
          title: 'SOLAR PARTICLE EVENT (SPE) — Rapid Proton & Secondary Neutron Flux Surge',
          crew_id: null,
          severity: 'EMERGENCY',
          state: 'RAISED',
          raised_ts: simTs,
          hazards: ['RADIATION', 'DISTANCE_FROM_EARTH'],
          hrp_risks: ['HRP-17', 'HRP-01', 'HRP-03', 'HRP-12'],
          evidence: {
            signal: 'dose_rate_equivalent',
            value: OFFLINE_SPE_RATE,
            unit: 'µSv/h',
            op: '>',
            ...lim('radiation.spe_alert_dose_rate_uSv_h'),
            window: '5m rolling',
            clauses: [
              {
                signal: 'dose_rate_equivalent',
                label: 'Total Equivalent Dose Rate',
                value: OFFLINE_SPE_RATE,
                unit: 'µSv/h',
                op: '>',
                ...lim('radiation.spe_alert_dose_rate_uSv_h'),
              },
            ],
          },
          rationale:
            'Indicators consistent with a major Solar Particle Event (proton flux + secondary spacecraft-hull neutron cascade). With a 12-minute one-way Mars comm delay, crew must execute autonomous shelter protocol immediately without waiting for MCC-Houston.',
          action:
            'ALL CREW REPORT TO STORM SHELTER IMMEDIATELY. Verify 4/4 crew headcount, deploy water-wall polyethylene mass bags, and log personal dosimeter readings every 15 minutes.',
          checklist: [
            'Abort all non-essential module activities and EVAs immediately',
            'Relocate C1, C2, C3, C4 to Aft Water-Wall Storm Shelter',
            'Deploy stowage polyethylene mass bags around shelter perimeter',
            'Verify CANS neutron spectrometer & personal dosimeter telemetry every 15 min',
            'Await autonomous downlink sync to MCC-Houston (T+12m one-way delay)',
          ],
          notes: [],
          origin: 'ONBOARD',
        });
      }

      if (scenario === 'demo_5min') {
        next.sim.speed = 60;
        next.sim.demo_segment_label =
          'Segment 1/3: Insomnia Streak + CO₂ Creep → Compound Cognitive Caution (SPE triggers next)';
        demoStepRef.current = 1;
      } else {
        next.sim.demo_segment_label = undefined;
        demoStepRef.current = 0;
      }

      // Update crew statuses from active alerts
      next.crew.forEach((c) => {
        c.status = deriveCrewStatus(c.id, next.alerts, c.readiness.OVERALL.status);
      });

      // Queue downlink snapshot for Ground Console (arrives at simMs + comm_delay_s * 1000)
      if (!next.link.blackout) {
        const deliverSimMs = simMs + next.sim.comm_delay_s * 1000;
        downlinkQueueRef.current.push({
          deliverSimMs,
          sentSimTs: simTs,
          crew: structuredClone(next.crew),
          alerts: structuredClone(next.alerts),
          radiation: structuredClone(next.radiation),
          environment: structuredClone(next.environment),
        });
        next.link.pending_packets.unshift({
          id: `pkt-${Date.now()}`,
          direction: 'DOWNLINK',
          priority: next.alerts[0]?.severity ?? 'INFO',
          summary: `${scenario.toUpperCase()} telemetry & alert bundle`,
          sent_ts: simTs,
          deliver_ts: new Date(deliverSimMs).toISOString(),
          eta_s: next.sim.comm_delay_s,
        });
        next.link.queue_depth = next.link.pending_packets.length;
      }

      return next;
    },
    []
  );

  // Simulation tick loop (1 real second interval, advances simulated time by speed seconds)
  useEffect(() => {
    const interval = setInterval(() => {
      setState((prev) => {
        // Offline fallback only: with the backend connected, state comes from its snapshots.
        if (!prev.sim.running || prev.sim.backend_connected) return prev;
        const rng = rngRef.current;
        const deltaSimSec = prev.sim.speed;
        const prevSimMs = Date.parse(prev.sim.sim_ts);
        const nextSimMs = prevSimMs + deltaSimSec * 1000;
        const nextSimTs = new Date(nextSimMs).toISOString();
        const label = makeTimeLabel(nextSimTs);

        const next = structuredClone(prev);
        next.sim.sim_ts = nextSimTs;
        next.link.onboard_ts = nextSimTs;

        // If running demo_5min, progress automatically through SPE and Mars Landing segments
        if (next.sim.active_scenario === 'demo_5min') {
          if (demoStepRef.current === 1) {
            demoStepRef.current = 2;
          } else if (demoStepRef.current === 2) {
            demoStepRef.current = 3;
          } else if (demoStepRef.current === 3 && !next.radiation.spe_active) {
            demoStepRef.current = 4;
            next.sim.demo_segment_label =
              'Segment 2/3: Solar Particle Event (EMERGENCY) — Autonomous Shelter Protocol Active while Ground lags by 12m';
            return applyScenarioInjection(next, 'spe_event', next.sim.seed);
          }
        }

        // Update radiation telemetry
        if (next.radiation.spe_active) {
          next.radiation.spe_elapsed_s += deltaSimSec;
          const shelteredCount = next.crew.filter((c) => c.in_shelter).length;
          const shieldingFactor = shelteredCount === 4 ? 0.35 : 1 - shelteredCount * 0.14;
          const rawSpeRate = OFFLINE_SPE_RATE * (1 + (rng() - 0.5) * 0.08);
          const effectiveRate = Number((rawSpeRate * shieldingFactor).toFixed(1));
          const neutronRate = Number((effectiveRate * 0.32).toFixed(1));
          next.radiation.dose_rate_equivalent_uSv_h = effectiveRate;
          next.radiation.dose_rate_absorbed_uGy_h = Number((effectiveRate * 0.35).toFixed(1));
          next.radiation.neutron_dose_equivalent_rate_uSv_h = neutronRate;
          next.radiation.neutron_fraction_pct = 32.0;

          const doseAddedMSv = ((effectiveRate / 1000) * deltaSimSec) / 3600;
          const unshieldedAddedMSv = ((rawSpeRate / 1000) * deltaSimSec) / 3600;
          next.radiation.cumulative_24h_mSv = Number(
            (next.radiation.cumulative_24h_mSv + doseAddedMSv).toFixed(3)
          );
          next.radiation.cumulative_30d_mSv = Number(
            (next.radiation.cumulative_30d_mSv + doseAddedMSv).toFixed(2)
          );
          next.radiation.cumulative_mission_mSv = Number(
            (next.radiation.cumulative_mission_mSv + doseAddedMSv).toFixed(2)
          );
          next.radiation.shelter_dose_saved_mSv = Number(
            (
              next.radiation.shelter_dose_saved_mSv +
              Math.max(0, unshieldedAddedMSv - doseAddedMSv)
            ).toFixed(3)
          );
        } else {
          const baseDose = PHASE_PROFILES[next.sim.phase].bg_dose_uSv_h;
          const eqRate = Number((baseDose + (rng() - 0.5) * 1.6).toFixed(1));
          const nRate = Number((eqRate * 0.304).toFixed(1));
          next.radiation.dose_rate_equivalent_uSv_h = eqRate;
          next.radiation.dose_rate_absorbed_uGy_h = Number((eqRate * 0.4).toFixed(1));
          next.radiation.neutron_dose_equivalent_rate_uSv_h = nRate;
          next.radiation.neutron_fraction_pct = Number(((nRate / Math.max(0.1, eqRate)) * 100).toFixed(1));
        }

        next.radiation.history.push({
          ts: nextSimTs,
          label,
          value: next.radiation.dose_rate_equivalent_uSv_h,
          secondaryValue: next.radiation.neutron_dose_equivalent_rate_uSv_h,
        });
        next.radiation.history = next.radiation.history.slice(-24);

        // Update crew vitals slightly with deterministic jitter
        next.crew.forEach((c) => {
          const hrJitter = (rng() - 0.5) * 2.2;
          const nextHr = Number(
            Math.max(48, Math.min(148, c.vitals.heart_rate + hrJitter)).toFixed(0)
          );
          c.vitals.heart_rate = nextHr;
          c.vitals.dose_rate_uSv_h = next.radiation.dose_rate_equivalent_uSv_h;
          c.vitals.neutron_dose_uSv_h = next.radiation.neutron_dose_equivalent_rate_uSv_h;
          c.mission_dose_mSv = Number(
            (c.mission_dose_mSv + ((c.vitals.dose_rate_uSv_h / 1000) * deltaSimSec) / 3600).toFixed(3)
          );
          c.sparklines.heart_rate = [...c.sparklines.heart_rate.slice(-13), nextHr];
          c.sparklines.dose_rate_uSv_h = [
            ...c.sparklines.dose_rate_uSv_h.slice(-13),
            next.radiation.dose_rate_equivalent_uSv_h,
          ];
          c.timeseries.heart_rate = [
            ...c.timeseries.heart_rate.slice(-23),
            { ts: nextSimTs, label, value: nextHr },
          ];
          c.status = deriveCrewStatus(c.id, next.alerts, c.readiness.OVERALL.status);
        });

        // Process store-and-forward link delay queue if NOT blacked out (AGENTS.md §6)
        if (!next.link.blackout) {
          // Queue periodic telemetry rollup
          downlinkQueueRef.current.push({
            deliverSimMs: nextSimMs + next.sim.comm_delay_s * 1000,
            sentSimTs: nextSimTs,
            crew: structuredClone(next.crew),
            alerts: structuredClone(next.alerts),
            radiation: structuredClone(next.radiation),
            environment: structuredClone(next.environment),
          });

          // Deliver any packets whose deliverSimMs <= nextSimMs
          let latestDelivered: DownlinkSnapshotPacket | null = null;
          const remainingQueue: DownlinkSnapshotPacket[] = [];
          for (const pkt of downlinkQueueRef.current) {
            if (pkt.deliverSimMs <= nextSimMs) {
              latestDelivered = pkt;
            } else {
              remainingQueue.push(pkt);
            }
          }
          downlinkQueueRef.current = remainingQueue.slice(-40);

          if (latestDelivered) {
            next.groundSnapshot = {
              as_of_ts: latestDelivered.sentSimTs,
              lag_s: Math.max(
                0,
                Math.round((nextSimMs - Date.parse(latestDelivered.sentSimTs)) / 1000)
              ),
              crew: latestDelivered.crew,
              alerts: latestDelivered.alerts,
              radiation: latestDelivered.radiation,
              environment: latestDelivered.environment,
            };
            next.link.ground_as_of_ts = latestDelivered.sentSimTs;
          } else {
            next.groundSnapshot.lag_s = Math.max(
              0,
              Math.round((nextSimMs - Date.parse(next.groundSnapshot.as_of_ts)) / 1000)
            );
          }

          // Update pending packets & recommendations countdown
          next.link.pending_packets = next.link.pending_packets
            .map((p) => ({
              ...p,
              eta_s: Math.max(0, Math.round((Date.parse(p.deliver_ts) - nextSimMs) / 1000)),
            }))
            .filter((p) => p.eta_s > 0);

          next.recommendations = next.recommendations.map((rec) => {
            if (rec.delivered) return rec;
            const rem = Math.max(0, Math.round((Date.parse(rec.deliver_ts) - nextSimMs) / 1000));
            return {
              ...rec,
              remaining_delay_s: rem,
              delivered: rem === 0,
            };
          });
        } else {
          // Blackout is active: nothing moves across the link; ground lag grows
          next.groundSnapshot.lag_s = Math.max(
            0,
            Math.round((nextSimMs - Date.parse(next.groundSnapshot.as_of_ts)) / 1000)
          );
        }

        next.link.lag_seconds = next.groundSnapshot.lag_s;
        next.link.queue_depth = next.link.pending_packets.length;

        return next;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [applyScenarioInjection]);

  const triggerScenario = useCallback(
    (scenario: ScenarioName, customSeed?: number) => {
      if (connectedRef.current) {
        // The scenario sets its own speed (demo_5min changes it per segment).
        const seed = customSeed ?? selectedSeedRef.current ?? state.sim.seed;
        selectedSeedRef.current = null;
        void aegisApi.startScenario({ name: scenario, seed });
        return;
      }
      setState((prev) => applyScenarioInjection(prev, scenario, customSeed));
    },
    [applyScenarioInjection, state.sim.seed]
  );

  const resetNominal = useCallback(() => {
    if (connectedRef.current) {
      const seed = selectedSeedRef.current ?? state.sim.seed;
      selectedSeedRef.current = null;
      void aegisApi.startScenario({ name: 'nominal', seed });
      return;
    }
    downlinkQueueRef.current = [];
    demoStepRef.current = 0;
    setState((prev) => buildInitialSystemState(prev.sim.seed));
  }, [state.sim.seed]);

  const setSimSpeed = useCallback((speed: number) => {
    if (connectedRef.current) {
      void aegisApi.controlSim({ action: 'speed', speed });
      return;
    }
    setState((prev) => ({
      ...prev,
      sim: { ...prev.sim, speed },
    }));
  }, []);

  const toggleSimRunning = useCallback(() => {
    if (connectedRef.current) {
      void aegisApi.controlSim({ action: state.sim.running ? 'pause' : 'resume' });
      return;
    }
    setState((prev) => ({ ...prev, sim: { ...prev.sim, running: !prev.sim.running } }));
  }, [state.sim.running]);

  const setMissionPhase = useCallback((phase: MissionPhaseName) => {
    // The backend has no phase endpoint: phases change only through scenario events (work queue G3-5).
    if (connectedRef.current) return;
    const prof = PHASE_PROFILES[phase];
    setState((prev) => ({
      ...prev,
      sim: {
        ...prev.sim,
        phase,
        gravity_g: prof.gravity_g,
        comm_delay_s: prof.comm_delay_s,
      },
      link: {
        ...prev.link,
        one_way_delay_s: prof.comm_delay_s,
      },
    }));
  }, []);

  const setSeed = useCallback((seed: number) => {
    // Seed for the next scenario start; while connected the snapshot would otherwise overwrite it.
    if (connectedRef.current) selectedSeedRef.current = seed;
    setState((prev) => ({
      ...prev,
      sim: { ...prev.sim, seed },
    }));
  }, []);

  const transitionAlert = useCallback(
    (alertId: string, targetState: AlertState, note?: string) => {
      if (connectedRef.current) {
        const action =
          targetState === 'RESOLVED' ? 'resolve' : targetState === 'IN_TREATMENT' ? 'treat' : 'ack';
        void (async () => {
          if (note?.trim()) {
            await backendApi.postJson<BackendAlert>(`/alerts/${alertId}/note`, { text: note.trim() });
          }
          upsertBackendAlert(await backendApi.postJson<BackendAlert>(`/alerts/${alertId}/${action}`));
        })();
        return;
      }

      setState((prev) => {
        const nowTs = prev.sim.sim_ts;
        const nextAlerts = prev.alerts.map((a) => {
          if (a.id !== alertId) return a;
          const updatedNotes = note
            ? [...a.notes, { ts: nowTs, author: 'CMO (Onboard)', text: note }]
            : a.notes;
          return {
            ...a,
            state: targetState,
            ack_ts:
              targetState === 'ACKNOWLEDGED' || targetState === 'IN_TREATMENT'
                ? a.ack_ts ?? nowTs
                : a.ack_ts,
            resolved_ts: targetState === 'RESOLVED' ? nowTs : a.resolved_ts,
            notes: updatedNotes,
          };
        });

        // If SPE emergency alert is resolved, clear SPE active flag
        const speStillActive = nextAlerts.some(
          (a) =>
            a.rule_id === 'rad.spe.emergency_takeover' &&
            a.state !== 'RESOLVED' &&
            a.state !== 'SUPPRESSED'
        );

        const nextCrew = prev.crew.map((c) => ({
          ...c,
          status: deriveCrewStatus(c.id, nextAlerts, c.readiness.OVERALL.status),
        }));

        return {
          ...prev,
          alerts: nextAlerts,
          crew: nextCrew,
          radiation: {
            ...prev.radiation,
            spe_active: speStillActive,
            status: speStillActive ? 'EMERGENCY' : 'NOMINAL',
          },
        };
      });
    },
    [upsertBackendAlert]
  );

  const acknowledgeAlert = useCallback(
    (alertId: string, note?: string) => transitionAlert(alertId, 'ACKNOWLEDGED', note),
    [transitionAlert]
  );

  const setAlertInTreatment = useCallback(
    (alertId: string, note?: string) => transitionAlert(alertId, 'IN_TREATMENT', note),
    [transitionAlert]
  );

  const resolveAlert = useCallback(
    (alertId: string, note?: string) => transitionAlert(alertId, 'RESOLVED', note),
    [transitionAlert]
  );

  const addAlertNote = useCallback((alertId: string, author: string, text: string) => {
    if (!text.trim()) return;
    if (connectedRef.current) {
      // The backend note has no author field; the author goes into the text.
      void backendApi
        .postJson<BackendAlert>(`/alerts/${alertId}/note`, { text: `${author}: ${text.trim()}` })
        .then(upsertBackendAlert);
      return;
    }
    setState((prev) => ({
      ...prev,
      alerts: prev.alerts.map((a) =>
        a.id === alertId
          ? {
              ...a,
              notes: [...a.notes, { ts: prev.sim.sim_ts, author, text: text.trim() }],
            }
          : a
      ),
    }));
  }, [upsertBackendAlert]);

  const toggleCrewShelter = useCallback(
    (crewId: CrewId) => {
      if (connectedRef.current) {
        const member = state.crew.find((c) => c.id === crewId);
        void backendApi.postJson('/radiation/shelter', {
          crew_id: crewId,
          sheltered: !(member?.in_shelter ?? false),
        });
        return;
      }
      setState((prev) => ({
        ...prev,
        crew: prev.crew.map((c) => (c.id === crewId ? { ...c, in_shelter: !c.in_shelter } : c)),
      }));
    },
    [state.crew]
  );

  const evacuateAllToShelter = useCallback(() => {
    if (connectedRef.current) {
      for (const c of state.crew) {
        void backendApi.postJson('/radiation/shelter', { crew_id: c.id, sheltered: true });
      }
      return;
    }
    setState((prev) => ({
      ...prev,
      crew: prev.crew.map((c) => ({ ...c, in_shelter: true })),
    }));
  }, [state.crew]);

  const toggleLinkBlackout = useCallback(() => {
    if (connectedRef.current) {
      void backendApi.postJson('/link/blackout', { on: !state.link.blackout });
      return;
    }
    setState((prev) => ({ ...prev, link: { ...prev.link, blackout: !prev.link.blackout } }));
  }, [state.link.blackout]);

  const sendGroundRecommendation = useCallback(
    (input: {
      crew_id: CrewId | 'ALL';
      priority: Severity;
      title: string;
      rationale: string;
      checklist: string[];
    }) => {
      if (connectedRef.current) {
        const text = input.rationale.trim() ? `${input.title}: ${input.rationale.trim()}` : input.title;
        void backendApi
          .postJson<BackendRecommendation>('/link/recommendation', {
            text,
            checklist: input.checklist,
            crew_id: input.crew_id === 'ALL' ? null : input.crew_id,
          })
          .then((rec) => {
            if (rec) linkRef.current.sentGround.push(rec);
          });
        return;
      }
      setState((prev) => {
        const sentSimMs = Date.parse(prev.sim.sim_ts);
        const delaySec = prev.sim.comm_delay_s;
        const deliverSimMs = sentSimMs + delaySec * 1000;
        const sentTs = prev.sim.sim_ts;
        const deliverTs = new Date(deliverSimMs).toISOString();
        const immediate = delaySec === 0 && !prev.link.blackout;

        const newRec: RecommendationMessage = {
          id: `rec-${Date.now()}`,
          crew_id: input.crew_id,
          priority: input.priority,
          author: 'Flight Surgeon (MCC-Houston)',
          title: input.title,
          rationale: input.rationale,
          checklist: input.checklist,
          sent_ts: sentTs,
          deliver_ts: deliverTs,
          remaining_delay_s: immediate ? 0 : delaySec,
          delivered: immediate,
          acknowledged_onboard: false,
        };

        const nextPending = immediate
          ? prev.link.pending_packets
          : [
              {
                id: `uplink-${Date.now()}`,
                direction: 'UPLINK' as const,
                priority: input.priority,
                summary: `Flight Surgeon Rec → ${input.crew_id}: ${input.title}`,
                sent_ts: sentTs,
                deliver_ts: deliverTs,
                eta_s: delaySec,
              },
              ...prev.link.pending_packets,
            ];

        return {
          ...prev,
          recommendations: [newRec, ...prev.recommendations],
          link: {
            ...prev.link,
            pending_packets: nextPending,
            queue_depth: nextPending.length,
          },
        };
      });
    },
    []
  );

  const acknowledgeRecommendationOnboard = useCallback((recId: string) => {
    // No backend endpoint: the onboard acknowledgement is kept in this browser only.
    linkRef.current.ackedRecs.add(recId);
    setState((prev) => ({
      ...prev,
      recommendations: prev.recommendations.map((r) =>
        r.id === recId ? { ...r, acknowledged_onboard: true } : r
      ),
    }));
  }, []);

  return React.createElement(
    AegisContext.Provider,
    {
      value: {
        state,
        triggerScenario,
        resetNominal,
        setSimSpeed,
        toggleSimRunning,
        setMissionPhase,
        setSeed,
        acknowledgeAlert,
        setAlertInTreatment,
        resolveAlert,
        addAlertNote,
        toggleCrewShelter,
        evacuateAllToShelter,
        toggleLinkBlackout,
        sendGroundRecommendation,
        acknowledgeRecommendationOnboard,
      },
    },
    children
  );
};

export function useAegis(): AegisContextValue {
  const ctx = useContext(AegisContext);
  if (!ctx) {
    throw new Error('useAegis must be used within an AegisProvider');
  }
  return ctx;
}
