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

  // Connect to backend WebSocket /ws/live if available
  useEffect(() => {
    let ws: WebSocket | null = null;
    let cancelled = false;

    const connectWs = async () => {
      const ok = await aegisApi.checkHealth();
      if (cancelled) return;
      if (ok) {
        setState((prev) => ({
          ...prev,
          sim: { ...prev.sim, backend_connected: true },
        }));
        try {
          const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
          ws = new WebSocket(`${proto}//${window.location.host}/ws/live`);
          ws.onmessage = (evt) => {
            try {
              const msg = JSON.parse(evt.data) as {
                type?: string;
                data?: Partial<AlertItem>;
                alert?: AlertItem;
              };
              if (msg.type === 'alert' && (msg.alert || msg.data)) {
                const incoming = (msg.alert ?? msg.data) as AlertItem;
                if (incoming && incoming.id && incoming.rule_id) {
                  setState((prev) => {
                    const exists = prev.alerts.some((a) => a.id === incoming.id);
                    if (exists) return prev;
                    return {
                      ...prev,
                      alerts: [
                        {
                          ...incoming,
                          title: incoming.title ?? incoming.rule_id,
                          rationale:
                            incoming.rationale ??
                            'Indicators consistent with configured threshold exceedance. Recommend CMO review.',
                          notes: incoming.notes ?? [],
                        },
                        ...prev.alerts,
                      ],
                    };
                  });
                }
              }
            } catch {
              // ignore malformed frame
            }
          };
          ws.onclose = () => {
            if (!cancelled) {
              setState((prev) => ({
                ...prev,
                sim: { ...prev.sim, backend_connected: false },
              }));
            }
          };
        } catch {
          // fallback to onboard deterministic engine
        }
      }
    };

    void connectWs();
    return () => {
      cancelled = true;
      if (ws) ws.close();
    };
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
            limit: 3.0,
            limit_verified: false,
            source_ref: 'NASA-STD-3001 Vol 2, VERIFY',
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
              limitLabel: '≥ 6.0 h/24h',
              limitVerified: false,
              sourceRef: 'Project heuristic',
              status: 'WARNING' as const,
            },
            {
              id: 'co2',
              label: 'Cabin ppCO₂ Cognitive Margin',
              score: next.environment.ppco2_mmHg > 3.0 ? 52 : 88,
              weight: 0.25,
              rawValue: `${next.environment.ppco2_mmHg.toFixed(2)} mmHg`,
              limitLabel: '≤ 3.0 mmHg (1h)',
              limitVerified: false,
              sourceRef: 'NASA-STD-3001 Vol 2, VERIFY',
              status:
                next.environment.ppco2_mmHg > 3.0 ? ('CAUTION' as const) : ('NOMINAL' as const),
            },
            {
              id: 'cardio',
              label: 'Autonomic / HRV Recovery (RMSSD)',
              score: 61,
              weight: 0.25,
              rawValue: '34 ms (-3.6σ baseline)',
              limitLabel: 'Within ±3.0σ personal baseline',
              limitVerified: false,
              sourceRef: 'Project heuristic',
              status: 'CAUTION' as const,
            },
            {
              id: 'dcs_rad',
              label: 'DCS Prebreathe & Radiation Margin',
              score: 88,
              weight: 0.2,
              rawValue: `${next.radiation.dose_rate_equivalent_uSv_h.toFixed(1)} µSv/h`,
              limitLabel: '< 100 µSv/h SPE limit',
              limitVerified: false,
              sourceRef: 'Project heuristic',
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
            limit: 6.0,
            limit_verified: false,
            source_ref: 'NASA-STD-3001 Vol 1/2 Compound Rule, VERIFY',
            window: '72h rolling',
            clauses: [
              {
                signal: 'sleep_hours_24h',
                label: 'C1 Sleep Duration (24h)',
                value: 4.4,
                unit: 'h',
                op: '<',
                limit: 6.0,
                limit_verified: false,
                source_ref: 'Project heuristic',
              },
              {
                signal: 'ppco2',
                label: 'Cabin ppCO₂ (1h mean)',
                value: next.environment.ppco2_mmHg,
                unit: 'mmHg',
                op: '>',
                limit: 3.0,
                limit_verified: false,
                source_ref: 'NASA-STD-3001 Vol 2, VERIFY',
              },
              {
                signal: 'hrv_rmssd',
                label: 'C1 HRV RMSSD Personal Z-Score',
                value: -3.6,
                unit: 'σ',
                op: '<',
                limit: -3.0,
                limit_verified: false,
                source_ref: 'Project heuristic (14d baseline)',
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
            limit: 95,
            limit_verified: false,
            source_ref: 'CSA BP Reg / Clinical Heuristic, VERIFY',
            window: '15m post-transition',
            z_score: 4.1,
            clauses: [
              {
                signal: 'bp_systolic',
                label: 'C3 Systolic Arterial Pressure',
                value: 86,
                unit: 'mmHg',
                op: '<',
                limit: 95,
                limit_verified: false,
                source_ref: 'Clinical heuristic',
              },
              {
                signal: 'heart_rate',
                label: 'C3 Compensatory Tachycardia (+6.9σ)',
                value: 128,
                unit: 'bpm',
                op: '>',
                limit: 115,
                limit_verified: false,
                source_ref: 'Personal baseline z-score > 3.0σ',
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
        next.radiation.dose_rate_equivalent_uSv_h = 215.0;
        next.radiation.neutron_dose_equivalent_rate_uSv_h = 68.8;
        next.radiation.neutron_fraction_pct = 32.0;
        next.radiation.history.push({
          ts: simTs,
          label: makeTimeLabel(simTs),
          value: 215.0,
          secondaryValue: 68.8,
        });
        next.radiation.history = next.radiation.history.slice(-24);

        next.crew.forEach((c) => {
          c.vitals.dose_rate_uSv_h = 215.0;
          c.vitals.neutron_dose_uSv_h = 68.8;
          c.sparklines.dose_rate_uSv_h = [...c.sparklines.dose_rate_uSv_h.slice(-13), 215.0];
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
            value: 215.0,
            unit: 'µSv/h',
            op: '>',
            limit: 100.0,
            limit_verified: false,
            source_ref: 'Project heuristic (SPE Shelter Trigger)',
            window: '5m rolling',
            clauses: [
              {
                signal: 'dose_rate_equivalent',
                label: 'Total Equivalent Dose Rate',
                value: 215.0,
                unit: 'µSv/h',
                op: '>',
                limit: 100.0,
                limit_verified: false,
                source_ref: 'Project heuristic (SPE Shelter Trigger)',
              },
              {
                signal: 'neutron_dose_equivalent_rate',
                label: 'CANS Secondary Neutron Dose Rate (32.0%)',
                value: 68.8,
                unit: 'µSv/h',
                op: '>',
                limit: 30.0,
                limit_verified: false,
                source_ref: 'CSA CANS Neutron Spectrometer Reference',
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
        if (!prev.sim.running) return prev;
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
          const rawSpeRate = 215 + (rng() - 0.5) * 18;
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
      void aegisApi.startScenario({
        name: scenario,
        speed: state.sim.speed,
        seed: customSeed ?? state.sim.seed,
      });
      setState((prev) => applyScenarioInjection(prev, scenario, customSeed));
    },
    [applyScenarioInjection, state.sim.seed, state.sim.speed]
  );

  const resetNominal = useCallback(() => {
    downlinkQueueRef.current = [];
    demoStepRef.current = 0;
    setState((prev) => buildInitialSystemState(prev.sim.seed));
  }, []);

  const setSimSpeed = useCallback((speed: number) => {
    void aegisApi.controlSim({ action: 'speed', speed });
    setState((prev) => ({
      ...prev,
      sim: { ...prev.sim, speed },
    }));
  }, []);

  const toggleSimRunning = useCallback(() => {
    setState((prev) => {
      const nextRunning = !prev.sim.running;
      void aegisApi.controlSim({ action: nextRunning ? 'resume' : 'pause' });
      return {
        ...prev,
        sim: { ...prev.sim, running: nextRunning },
      };
    });
  }, []);

  const setMissionPhase = useCallback((phase: MissionPhaseName) => {
    const prof = PHASE_PROFILES[phase];
    void aegisApi.controlSim({ action: 'phase', phase });
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
    setState((prev) => ({
      ...prev,
      sim: { ...prev.sim, seed },
    }));
  }, []);

  const transitionAlert = useCallback(
    (alertId: string, targetState: AlertState, note?: string) => {
      const apiAction =
        targetState === 'RESOLVED'
          ? 'resolve'
          : targetState === 'IN_TREATMENT'
          ? 'in_treatment'
          : 'ack';
      void aegisApi.updateAlertState(alertId, apiAction, note);

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
    []
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
    void aegisApi.addAlertNote(alertId, author, text);
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
  }, []);

  const toggleCrewShelter = useCallback((crewId: CrewId) => {
    setState((prev) => ({
      ...prev,
      crew: prev.crew.map((c) => (c.id === crewId ? { ...c, in_shelter: !c.in_shelter } : c)),
    }));
  }, []);

  const evacuateAllToShelter = useCallback(() => {
    setState((prev) => ({
      ...prev,
      crew: prev.crew.map((c) => ({ ...c, in_shelter: true })),
    }));
  }, []);

  const toggleLinkBlackout = useCallback(() => {
    setState((prev) => {
      const nextBlackout = !prev.link.blackout;
      void aegisApi.toggleBlackout(nextBlackout);
      return {
        ...prev,
        link: {
          ...prev.link,
          blackout: nextBlackout,
        },
      };
    });
  }, []);

  const sendGroundRecommendation = useCallback(
    (input: {
      crew_id: CrewId | 'ALL';
      priority: Severity;
      title: string;
      rationale: string;
      checklist: string[];
    }) => {
      void aegisApi.sendRecommendation(input);
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
