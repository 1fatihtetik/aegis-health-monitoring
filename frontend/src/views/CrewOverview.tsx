import React, { useState } from 'react';
import { formatDurationSeconds } from '../api/client';
import {
  CrewId,
  HAZARD_CATALOG,
  HRP_RISK_CATALOG,
  Hazard,
  OperationalStatus,
  STATUS_DISPLAY,
} from '../api/types';
import { useAegis } from '../api/useLiveSocket';
import { formatLimit } from '../api/limits';
import { signalLabel } from '../api/backend';
import { LimitBadge } from '../components/LimitBadge';
import { LimitBandChart } from '../components/LimitBandChart';
import { Sparkline } from '../components/Sparkline';
import { StatusRing } from '../components/StatusRing';

export interface CrewOverviewProps {
  onSelectCrew: (crewId: CrewId) => void;
  onNavigateView: (view: 'radiation' | 'alerts' | 'ground') => void;
}

export const CrewOverview: React.FC<CrewOverviewProps> = ({
  onSelectCrew,
  onNavigateView,
}) => {
  const { state, acknowledgeRecommendationOnboard } = useAegis();
  const { crew, alerts, environment, radiation, limits, sim, link, recommendations } = state;

  const [envDrilldownOpen, setEnvDrilldownOpen] = useState<boolean>(false);
  const [selectedEvaCrew, setSelectedEvaCrew] = useState<CrewId>('C1');

  const activeAlerts = alerts.filter(
    (a) => a.state === 'RAISED' || a.state === 'ACKNOWLEDGED' || a.state === 'IN_TREATMENT'
  );

  const getHazardStatus = (hazard: Hazard): OperationalStatus => {
    const matching = activeAlerts.filter((a) => a.hazards.includes(hazard));
    if (matching.some((a) => a.severity === 'EMERGENCY')) return 'EMERGENCY';
    if (matching.some((a) => a.severity === 'WARNING')) return 'WARNING';
    if (matching.some((a) => a.severity === 'CAUTION')) return 'CAUTION';
    if (hazard === 'HOSTILE_CLOSED_ENV' && environment.status !== 'NOMINAL') {
      return environment.status;
    }
    if (hazard === 'RADIATION' && radiation.status !== 'NOMINAL') {
      return radiation.status;
    }
    return 'NOMINAL';
  };

  const getHazardTelemetryLine = (hazard: Hazard): string => {
    switch (hazard) {
      case 'RADIATION':
        return `${radiation.dose_rate_equivalent_uSv_h} µSv/h (${radiation.neutron_fraction_pct}% CANS neutron)`;
      case 'ISOLATION_CONFINEMENT': {
        const minSleep = Math.min(...crew.map((c) => c.vitals.sleep_hours_24h));
        return `Min crew sleep: ${minSleep} h/24h · Circadian sync watch`;
      }
      case 'DISTANCE_FROM_EARTH':
        return `One-way delay: ${formatDurationSeconds(sim.comm_delay_s)} · ${
          link.blackout ? 'BLACKOUT (Autonomous)' : 'Store-and-forward active'
        }`;
      case 'GRAVITY_FIELDS':
        return `Field: ${sim.gravity_g} g (${sim.phase}) · Mean BMD: ${crew[0]?.vitals.bmd_estimate_pct ?? 95}%`;
      case 'HOSTILE_CLOSED_ENV':
        return `ppCO₂: ${environment.ppco2_mmHg} mmHg · ppO₂: ${environment.ppo2_kPa} kPa · ${environment.noise_dBA} dBA`;
    }
  };

  const handleHazardClick = (hazard: Hazard) => {
    if (hazard === 'HOSTILE_CLOSED_ENV') {
      setEnvDrilldownOpen((prev) => !prev);
    } else if (hazard === 'RADIATION') {
      onNavigateView('radiation');
    } else if (hazard === 'DISTANCE_FROM_EARTH') {
      onNavigateView('ground');
    } else if (hazard === 'ISOLATION_CONFINEMENT') {
      onSelectCrew('C1');
    } else if (hazard === 'GRAVITY_FIELDS') {
      onSelectCrew('C3');
    }
  };

  const evaTarget = crew.find((c) => c.id === selectedEvaCrew) ?? crew[0];
  const evaScore = evaTarget.readiness.EVA;
  const deliveredRecs = recommendations.filter((r) => r.delivered && !r.acknowledged_onboard);

  return (
    <div className="space-y-6" data-testid="crew-overview-view">
      {/* Delivered Flight Surgeon Recommendations Banner (if any unread) */}
      {deliveredRecs.length > 0 && (
        <div className="rounded-xl border border-cyan-500/50 bg-cyan-950/35 p-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="rounded bg-cyan-500/20 border border-cyan-400/50 px-2 py-0.5 text-xs font-bold text-cyan-200">
                  📡 UPLINK DELIVERED FROM MCC-HOUSTON
                </span>
                <span className="text-xs font-mono text-slate-300">
                  Target: {deliveredRecs[0].crew_id} · Sent {deliveredRecs[0].sent_ts.slice(11, 19)} UTC
                </span>
              </div>
              <h3 className="text-sm font-bold text-white">{deliveredRecs[0].title}</h3>
              <p className="text-xs text-slate-200">{deliveredRecs[0].rationale}</p>
            </div>
            <button
              type="button"
              onClick={() => acknowledgeRecommendationOnboard(deliveredRecs[0].id)}
              className="min-h-[44px] shrink-0 rounded-lg bg-cyan-500 px-4 py-2 text-xs font-bold text-slate-950 hover:bg-cyan-400"
            >
              ✓ Acknowledge Flight Surgeon Advisory
            </button>
          </div>
        </div>
      )}

      {/* 1. NASA HRP 5 Hazards (RIDGE) Tiles */}
      <section aria-label="NASA HRP 5 Spaceflight Hazards (RIDGE)">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <div>
            <h2 className="text-sm font-bold uppercase tracking-wider text-slate-300">
              RIDGE Spaceflight Hazard Matrix (NASA HRP Traceability)
            </h2>
            <p className="text-xs text-slate-400">
              Tap any hazard tile for drill-down. Hostile Closed Environment (E) toggles live cabin ECLSS & compound risk analysis.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setEnvDrilldownOpen((o) => !o)}
            className={`min-h-[44px] rounded-lg border px-3.5 py-1.5 text-xs font-semibold transition-all ${
              envDrilldownOpen
                ? 'border-cyan-400 bg-cyan-500/20 text-cyan-100'
                : 'border-slate-700 bg-space-800 text-slate-200 hover:bg-space-700'
            }`}
          >
            {envDrilldownOpen
              ? '▼ Hide Cabin Environment (E) Drill-Down'
              : '▶ Open Cabin Environment (E) Drill-Down'}
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {(Object.keys(HAZARD_CATALOG) as Hazard[]).map((hzKey) => {
            const hz = HAZARD_CATALOG[hzKey];
            const status = getHazardStatus(hzKey);
            const sMeta = STATUS_DISPLAY[status];
            const isSelected = hzKey === 'HOSTILE_CLOSED_ENV' && envDrilldownOpen;

            return (
              <button
                key={hz.id}
                type="button"
                onClick={() => handleHazardClick(hz.id)}
                className={`min-h-[128px] flex flex-col justify-between rounded-xl border p-3.5 text-left transition-all hover:bg-space-800/90 ${
                  isSelected
                    ? 'border-cyan-400 bg-space-800 ring-2 ring-cyan-400/50'
                    : `${sMeta.borderClass} bg-space-900/90`
                }`}
              >
                <div className="space-y-1.5 w-full">
                  <div className="flex items-center justify-between gap-1">
                    <span className="inline-flex items-center gap-1.5 text-xs font-black tracking-wide text-slate-100">
                      <span className="flex h-6 w-6 items-center justify-center rounded bg-slate-800 font-mono text-cyan-300 border border-slate-700">
                        {hz.letter}
                      </span>
                      <span>{hz.shortName}</span>
                    </span>
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[11px] font-bold ${sMeta.badgeClass}`}
                    >
                      {sMeta.label}
                    </span>
                  </div>

                  <p className="text-xs font-mono text-slate-200">{getHazardTelemetryLine(hz.id)}</p>
                </div>

                <div className="pt-2.5 flex flex-wrap items-center justify-between gap-1 border-t border-slate-800/80 w-full mt-2">
                  <div className="flex flex-wrap gap-1">
                    {hz.primaryRisks.slice(0, 3).map((rId) => (
                      <span
                        key={rId}
                        title={HRP_RISK_CATALOG[rId]?.name}
                        className="rounded bg-space-950 px-1.5 py-0.5 text-[10px] font-mono text-slate-400 border border-slate-800"
                      >
                        {rId}
                      </span>
                    ))}
                  </div>
                  <span className="text-[10px] font-semibold text-cyan-400">
                    {hz.id === 'HOSTILE_CLOSED_ENV'
                      ? envDrilldownOpen
                        ? 'Hide ▲'
                        : 'ECLSS ▼'
                      : 'Inspect →'}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {/* Hostile-Closed Environment (E) Drill-Down Panel */}
      {(envDrilldownOpen || environment.status !== 'NOMINAL') && (
        <section
          aria-label="Hostile Closed Environment Cabin Drill-Down"
          data-testid="environment-drilldown"
          className="rounded-2xl border border-cyan-500/40 bg-space-900/95 p-5 space-y-4 shadow-xl"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="rounded bg-cyan-500/20 border border-cyan-400/40 px-2 py-0.5 text-xs font-mono font-bold text-cyan-200">
                  HAZARD [E] DRILL-DOWN
                </span>
                <h3 className="text-base font-bold text-white">
                  Cabin Environment & ECLSS Life Support Telemetry
                </h3>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Traceability: HRP-06 (Hypoxia), HRP-08 (EVA Performance), HRP-12 (Behavioral), HRP-14 (Sleep/Circadian).
              </p>
            </div>
            <button
              type="button"
              onClick={() => setEnvDrilldownOpen(false)}
              className="min-h-[44px] rounded-lg border border-slate-700 bg-space-800 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:bg-space-700"
            >
              Close Drill-Down
            </button>
          </div>

          {/* 6 Cabin Environment KPI Cards with Config Limits & Unverified Badges */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <div
              className={`rounded-xl border p-3 ${
                environment.ppco2_mmHg > (limits['environment.ppco2_mmHg_1h_max']?.value ?? Infinity)
                  ? 'border-amber-400 bg-amber-950/30'
                  : 'border-slate-800 bg-space-950/80'
              }`}
            >
              <div className="flex items-center justify-between text-[11px] text-slate-400">
                <span>Cabin ppCO₂</span>
                <LimitBadge limit={limits['environment.ppco2_mmHg_1h_max']} />
              </div>
              <div className="mt-1 text-lg font-bold font-mono text-white">
                {environment.ppco2_mmHg} <span className="text-xs font-normal">mmHg</span>
              </div>
              <div className="text-[10px] text-slate-400 font-mono">
                1 h max: {formatLimit(limits['environment.ppco2_mmHg_1h_max'], '<=') || 'no limit configured'}
              </div>
            </div>

            <div className="rounded-xl border border-slate-800 bg-space-950/80 p-3">
              <div className="flex items-center justify-between text-[11px] text-slate-400">
                <span>Cabin ppO₂</span>
                <LimitBadge limit={limits['environment.ppo2_kPa_min']} />
              </div>
              <div className="mt-1 text-lg font-bold font-mono text-white">
                {environment.ppo2_kPa} <span className="text-xs font-normal">kPa</span>
              </div>
              <div className="text-[10px] text-slate-400 font-mono">
                Min: {formatLimit(limits['environment.ppo2_kPa_min'], '>=') || 'no limit configured'}
              </div>
            </div>

            <div className="rounded-xl border border-slate-800 bg-space-950/80 p-3">
              <div className="flex items-center justify-between text-[11px] text-slate-400">
                <span>Total Pressure</span>
                <LimitBadge limit={limits['environment.cabin_pressure_kPa']} />
              </div>
              <div className="mt-1 text-lg font-bold font-mono text-white">
                {environment.cabin_pressure_kPa} <span className="text-xs font-normal">kPa</span>
              </div>
              <div className="text-[10px] text-slate-400 font-mono">
                Band: {formatLimit(limits['environment.cabin_pressure_kPa']) || 'no limit configured'}
              </div>
            </div>

            <div className="rounded-xl border border-slate-800 bg-space-950/80 p-3">
              <div className="flex items-center justify-between text-[11px] text-slate-400">
                <span>Temperature</span>
                <LimitBadge limit={limits['environment.cabin_temp_C']} />
              </div>
              <div className="mt-1 text-lg font-bold font-mono text-white">
                {environment.cabin_temp_c} <span className="text-xs font-normal">°C</span>
              </div>
              <div className="text-[10px] text-slate-400 font-mono">
                Band: {formatLimit(limits['environment.cabin_temp_C']) || 'no limit configured'}
              </div>
            </div>

            <div className="rounded-xl border border-slate-800 bg-space-950/80 p-3">
              <div className="flex items-center justify-between text-[11px] text-slate-400">
                <span>Rel. Humidity</span>
                <LimitBadge limit={limits['environment.humidity_pct']} />
              </div>
              <div className="mt-1 text-lg font-bold font-mono text-white">
                {environment.humidity_pct} <span className="text-xs font-normal">%RH</span>
              </div>
              <div className="text-[10px] text-slate-400 font-mono">
                Band: {formatLimit(limits['environment.humidity_pct']) || 'no limit configured'}
              </div>
            </div>

            <div className="rounded-xl border border-slate-800 bg-space-950/80 p-3">
              <div className="flex items-center justify-between text-[11px] text-slate-400">
                <span>Acoustic Noise</span>
                <LimitBadge limit={limits['environment.noise_dBA_sleep_max']} />
              </div>
              <div className="mt-1 text-lg font-bold font-mono text-white">
                {environment.noise_dBA} <span className="text-xs font-normal">dBA</span>
              </div>
              <div className="text-[10px] text-slate-400 font-mono">
                Sleep max: {formatLimit(limits['environment.noise_dBA_sleep_max'], '<=') || 'no limit configured'}
              </div>
              <div className="flex items-center justify-between text-[10px] text-slate-400 font-mono">
                <span>Hazard max: &lt; {formatLimit(limits['environment.noise_dBA_hazardous_max']) || '–'}</span>
                <LimitBadge limit={limits['environment.noise_dBA_hazardous_max']} />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <LimitBandChart
              title="Cabin Carbon Dioxide Partial Pressure (ppCO₂)"
              subtitle="CO₂ scrubber (CDRA) performance · High CO₂ can cause headache and slow thinking"
              data={environment.history.ppco2}
              unit="mmHg"
              limit={limits['environment.ppco2_mmHg_1h_max']}
              hrpRisks={['HRP-12', 'HRP-14', 'HRP-08']}
              color="#f59e0b"
              source={state.provenance.ppco2}
            />
            <LimitBandChart
              title="Cabin Acoustic Noise Level (dBA)"
              subtitle="Continuous habitat fan & pump acoustic load vs sleep limit"
              data={environment.history.noise_dBA}
              unit="dBA"
              limit={limits['environment.noise_dBA_sleep_max']}
              hrpRisks={['HRP-14']}
              color="#38bdf8"
              source={state.provenance.noise_level}
            />
          </div>
        </section>
      )}

      {/* 2. Four Crew Member Cards */}
      <section aria-label="Crew Health Status Cards">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold uppercase tracking-wider text-slate-300">
            Crew Health Picture (4 Onboard Astronauts · Synthetic Profiles)
          </h2>
          <span className="text-xs text-slate-400">
            Tap any crew card to open full physiological charts & 180-day BMD trends
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          {crew.map((member) => {
            const memberAlerts = activeAlerts.filter(
              (a) => a.crew_id === member.id || a.crew_id === null
            );
            const topAlert = memberAlerts[0];

            return (
              <div
                key={member.id}
                data-testid={`crew-card-${member.id}`}
                className="flex flex-col justify-between rounded-2xl border border-slate-800 bg-space-900/95 p-4 shadow-md transition-all hover:border-slate-600"
              >
                <div className="space-y-3">
                  {/* Card Header: Callsign + StatusRing */}
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="rounded bg-cyan-500/15 border border-cyan-500/40 px-2 py-0.5 text-xs font-mono font-bold text-cyan-300">
                          {member.id} · {member.role}
                        </span>
                        <span className="text-xs font-mono text-slate-400">
                          {member.callsign}
                        </span>
                      </div>
                      <h3 className="mt-1 text-base font-bold text-slate-100">{member.name}</h3>
                      <p className="text-xs text-slate-400">
                        Sleep (24h): <strong className="text-slate-200">{member.vitals.sleep_hours_24h} h</strong> ·
                        BMD: <strong className="text-slate-200">{member.vitals.bmd_estimate_pct}%</strong>
                      </p>
                    </div>

                    <StatusRing
                      status={member.status}
                      score={member.readiness.OVERALL.value}
                      size={78}
                      sublabel="READY"
                    />
                  </div>

                  {/* Readiness sub-pills */}
                  <div className="grid grid-cols-3 gap-1.5 text-center">
                    {(['EVA', 'COGNITIVE', 'PHYSICAL'] as const).map((k) => {
                      const r = member.readiness[k];
                      // Same GO threshold as the backend (config/limits.yaml readiness.eva_go_min).
                      const low = r.value < (limits['readiness.eva_go_min']?.value ?? -Infinity);
                      return (
                        <div
                          key={k}
                          className="rounded-lg border border-slate-800 bg-space-950/80 px-2 py-1"
                        >
                          <div className="text-[10px] font-semibold uppercase text-slate-400">
                            {k}
                          </div>
                          <div
                            className={`text-xs font-bold font-mono ${
                              low ? 'text-amber-300' : 'text-emerald-300'
                            }`}
                          >
                            {r.value}% {low ? '▲' : '✓'}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Vitals Sparklines */}
                  <div className="space-y-1.5">
                    <Sparkline
                      label="Heart Rate"
                      unit="bpm"
                      currentValue={member.vitals.heart_rate}
                      data={member.sparklines.heart_rate}
                      limitMin={limits['physiology.hr_bpm']?.min}
                      limitMax={limits['physiology.hr_bpm']?.max}
                      limitVerified={limits['physiology.hr_bpm']?.verified}
                      warn={
                        member.vitals.heart_rate > (limits['physiology.hr_bpm']?.max ?? Infinity) ||
                        member.vitals.heart_rate < (limits['physiology.hr_bpm']?.min ?? -Infinity)
                      }
                    />
                    <Sparkline
                      label="HRV (RMSSD)"
                      unit="ms"
                      currentValue={member.vitals.hrv_rmssd}
                      data={member.sparklines.hrv_rmssd}
                      color="#a855f7"
                      limitMin={limits['physiology.hrv_rmssd_ms_min']?.value}
                      limitVerified={limits['physiology.hrv_rmssd_ms_min']?.verified}
                      warn={member.vitals.hrv_rmssd < (limits['physiology.hrv_rmssd_ms_min']?.value ?? -Infinity)}
                    />
                    <Sparkline
                      label="SpO₂"
                      unit="%"
                      currentValue={member.vitals.spo2}
                      data={member.sparklines.spo2}
                      limitMin={limits['physiology.spo2_pct_min']?.value}
                      limitVerified={limits['physiology.spo2_pct_min']?.verified}
                      color="#10b981"
                    />
                  </div>

                  {/* Active Alert indicator on card */}
                  {topAlert ? (
                    <div className="rounded-lg border border-amber-500/40 bg-amber-950/30 px-2.5 py-1.5 text-xs">
                      <div className="font-semibold text-amber-200 truncate">
                        {STATUS_DISPLAY[member.status].symbol} {topAlert.title}
                      </div>
                      <div className="text-[11px] font-mono text-slate-300 truncate">
                        {signalLabel(topAlert.evidence.signal)}: {topAlert.evidence.value}{' '}
                        {topAlert.evidence.unit ?? ''} ({topAlert.hrp_risks.join(', ')})
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-lg border border-emerald-500/20 bg-emerald-950/15 px-2.5 py-1.5 text-xs text-emerald-300">
                      ✓ All monitored vitals within personal baseline
                    </div>
                  )}
                </div>

                <div className="mt-3 pt-2.5 border-t border-slate-800/80 flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedEvaCrew(member.id)}
                    className="min-h-[44px] flex-1 rounded-lg border border-slate-700 bg-space-800 px-2.5 py-1.5 text-xs font-semibold text-slate-200 hover:bg-space-700"
                  >
                    EVA Breakdown
                  </button>
                  <button
                    type="button"
                    onClick={() => onSelectCrew(member.id)}
                    className="min-h-[44px] flex-1 rounded-lg bg-cyan-500/20 border border-cyan-500/50 px-2.5 py-1.5 text-xs font-bold text-cyan-200 hover:bg-cyan-500/30"
                  >
                    CMO Detail →
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* 3. Commander's EVA Go / No-Go Readiness Inspector (US-4) */}
      <section
        aria-label="Commander EVA Go No-Go Readiness Inspector"
        className="rounded-2xl border border-slate-800 bg-space-900/95 p-5"
      >
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 border-b border-slate-800 pb-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="rounded bg-purple-500/20 border border-purple-400/40 px-2 py-0.5 text-xs font-mono font-bold text-purple-200">
                COMMANDER EVA READINESS (US-4)
              </span>
              <span className="rounded bg-cyan-950 border border-cyan-500/40 px-2 py-0.5 text-xs font-mono text-cyan-300">
                HRP-08 · HRP-14 · HRP-04
              </span>
            </div>
            <h2 className="mt-1 text-base font-bold text-white">
              Transparent Weighted EVA Readiness Score — {evaTarget.id} ({evaTarget.name})
            </h2>
            <p className="text-xs text-slate-400">{evaScore.summary}</p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {crew.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setSelectedEvaCrew(c.id)}
                className={`min-h-[44px] rounded-lg border px-3 py-1.5 text-xs font-bold font-mono transition-all ${
                  selectedEvaCrew === c.id
                    ? 'border-cyan-400 bg-cyan-500/25 text-white'
                    : 'border-slate-700 bg-space-950 text-slate-300 hover:bg-space-800'
                }`}
              >
                {c.id} ({c.readiness.EVA.value}%{' '}
                {c.readiness.EVA.goForOp ? '✓ GO' : '▲ HOLD'})
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {evaScore.components.map((comp) => {
            const st = STATUS_DISPLAY[comp.status];
            return (
              <div
                key={comp.id}
                className={`rounded-xl border p-3.5 ${st.borderClass} bg-space-950/80 space-y-1.5`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-200">{comp.label}</span>
                  <span className="text-xs font-mono text-slate-400">
                    Weight {Math.round(comp.weight * 100)}%
                  </span>
                </div>
                <div className="flex items-baseline justify-between">
                  <span className={`text-lg font-black font-mono ${st.textClass}`}>
                    {comp.score}/100 ({st.symbol})
                  </span>
                  <span className="text-xs font-mono text-slate-200">{comp.rawValue}</span>
                </div>
                <div className="flex items-center justify-between text-[10px] text-slate-400 pt-1 border-t border-slate-800/80">
                  <span>Target: {comp.limitLabel}</span>
                  {!comp.limitVerified && (
                    <span className="text-amber-300 font-mono">⚠ unverified</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
};
