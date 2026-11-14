import React from 'react';
import {
  Bar,
  BarChart,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  CrewId,
  HAZARD_CATALOG,
  HRP_RISK_CATALOG,
  STATUS_DISPLAY,
  severityToStatus,
} from '../api/types';
import { useAegis } from '../api/useLiveSocket';
import { LimitBandChart } from '../components/LimitBandChart';
import { StatusRing } from '../components/StatusRing';

const BASELINE_SIGNALS: Array<{ key: string; label: string }> = [
  { key: 'heart_rate', label: 'Heart rate' },
  { key: 'hrv_rmssd', label: 'HRV (RMSSD)' },
  { key: 'spo2', label: 'SpO₂' },
  { key: 'resp_rate', label: 'Breathing rate' },
  { key: 'skin_temp', label: 'Skin temperature' },
  { key: 'bp_systolic', label: 'Systolic BP' },
  { key: 'bp_diastolic', label: 'Diastolic BP' },
];

/** 1 decimal, or '–' when the backend has no value yet. */
function num(v: number | null | undefined): string {
  return v === null || v === undefined || !Number.isFinite(v) ? '–' : String(Number(v.toFixed(1)));
}

export interface CrewDetailProps {
  selectedCrewId: CrewId;
  onSelectCrew: (crewId: CrewId) => void;
  onBackOverview: () => void;
}

export const CrewDetail: React.FC<CrewDetailProps> = ({
  selectedCrewId,
  onSelectCrew,
  onBackOverview,
}) => {
  const { state, acknowledgeAlert, resolveAlert } = useAegis();
  const { crew, alerts, limits } = state;

  const member = crew.find((c) => c.id === selectedCrewId) ?? crew[0];
  const memberAlerts = alerts.filter(
    (a) => (a.crew_id === member.id || a.crew_id === null) && a.state !== 'RESOLVED'
  );

  const hrZScore = (
    (member.vitals.heart_rate - member.baseline.hr_rest) /
    member.baseline.hr_std
  ).toFixed(1);
  const hrvZScore = (
    (member.vitals.hrv_rmssd - member.baseline.hrv_rmssd) /
    member.baseline.hrv_std
  ).toFixed(1);

  const bmdLimit = limits['bone.bmd_loss_pct_per_month_expected_0g'];
  const zLimit = limits['physiology.baseline_z_alert'];
  const stats = member.baseline_stats && Object.keys(member.baseline_stats).length ? member.baseline_stats : null;
  const sleepLimit = limits['sleep.min_sleep_h_24h'];

  return (
    <div className="space-y-6" data-testid="crew-detail-view">
      {/* Top Crew Selector & Back Button */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-800 bg-space-900/90 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onBackOverview}
            className="min-h-[44px] rounded-lg border border-slate-700 bg-space-800 px-3.5 py-1.5 text-xs font-semibold text-slate-200 hover:bg-space-700"
          >
            ← Overview
          </button>
          <span className="text-xs font-bold uppercase tracking-wider text-slate-400 ml-1">
            Select Crew Member:
          </span>
          {crew.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => onSelectCrew(c.id)}
              className={`min-h-[44px] rounded-lg border px-3.5 py-1.5 text-xs font-bold font-mono transition-all ${
                c.id === member.id
                  ? 'border-cyan-400 bg-cyan-500/20 text-cyan-100'
                  : 'border-slate-700 bg-space-950 text-slate-300 hover:bg-space-800'
              }`}
            >
              {c.id} · {c.role} ({c.callsign}) {STATUS_DISPLAY[c.status].symbol}
            </button>
          ))}
        </div>

        <div className="text-xs font-mono text-slate-400">
          Prior Career Dose: <strong className="text-slate-200">{member.career_dose_prior_mSv} mSv</strong> ·
          Mission Dose: <strong className="text-cyan-300">{member.mission_dose_mSv} mSv</strong>
        </div>
      </div>

      {/* Crew Profile & Personal Baseline Z-Score Card */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-5 rounded-2xl border border-slate-800 bg-space-900/95 p-5 flex items-center justify-between gap-4">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="rounded bg-cyan-500/20 border border-cyan-400/40 px-2.5 py-0.5 text-xs font-mono font-bold text-cyan-200">
                {member.id} · {member.role}
              </span>
              <span className="text-xs font-mono text-slate-400">
                Callsign: {member.callsign}
              </span>
            </div>
            <h1 className="text-xl font-black text-white">{member.name}</h1>
            <p className="text-xs text-slate-300">{member.readiness.OVERALL.summary}</p>
            <div className="flex flex-wrap gap-2 pt-1 text-xs font-mono">
              <span className="rounded bg-space-950 border border-slate-800 px-2.5 py-1 text-slate-300">
                EVA: <strong>{member.readiness.EVA.value}%</strong>
              </span>
              <span className="rounded bg-space-950 border border-slate-800 px-2.5 py-1 text-slate-300">
                Cognitive: <strong>{member.readiness.COGNITIVE.value}%</strong>
              </span>
              <span className="rounded bg-space-950 border border-slate-800 px-2.5 py-1 text-slate-300">
                Physical: <strong>{member.readiness.PHYSICAL.value}%</strong>
              </span>
            </div>
          </div>

          <StatusRing
            status={member.status}
            score={member.readiness.OVERALL.value}
            size={96}
            sublabel="OVERALL"
          />
        </div>

        {/* Personal baseline comparison: z-scores from GET /crew/{id}/baselines (48 h window) */}
        <div className="lg:col-span-7 rounded-2xl border border-slate-800 bg-space-900/95 p-5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-bold uppercase tracking-wider text-slate-200">
                48 h Personal Baseline Deviation (Z-Score Watch)
              </h2>
              <p className="text-xs text-slate-400">
                Compares the last 10 minutes with this crew member&apos;s own normal, before population limits are crossed.
              </p>
            </div>
            {zLimit && (
              <span
                className={`rounded border px-2 py-0.5 text-[11px] font-semibold ${
                  zLimit.verified
                    ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                    : 'bg-amber-500/20 border-amber-400/50 text-amber-200'
                }`}
              >
                {zLimit.verified ? '✓' : '⚠ unverified'} limit: |z| &gt; {zLimit.value}σ ({zLimit.source_ref})
              </span>
            )}
          </div>

          {stats ? (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3" data-testid="baseline-cards">
              {BASELINE_SIGNALS.map(({ key, label }) => {
                const b = stats[key];
                if (!b) return null;
                return (
                  <div
                    key={key}
                    className={`rounded-xl border p-3 ${
                      b.outside ? 'border-amber-400 bg-amber-950/30' : 'border-slate-800 bg-space-950/90'
                    }`}
                  >
                    <div className="flex items-center justify-between text-[11px] text-slate-400">
                      <span>{label}</span>
                      <span className={b.outside ? 'text-amber-300 font-bold' : 'text-emerald-300'}>
                        {b.outside ? '▲ outside' : '✓ normal'}
                      </span>
                    </div>
                    <div className="mt-1 text-base font-bold font-mono text-white">
                      {num(b.current)} <span className="text-xs text-slate-400">{b.unit}</span>
                    </div>
                    <div className="text-[11px] font-mono text-cyan-300">
                      Base {num(b.mean)} ± {num(b.sd)} · z {b.z === null ? '–' : `${b.z >= 0 ? '+' : ''}${b.z.toFixed(1)}`}σ
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="rounded-xl border border-slate-800 bg-space-950/90 p-3">
                <div className="text-[11px] text-slate-400">Heart Rate vs Baseline</div>
                <div className="mt-1 text-base font-bold font-mono text-white">
                  {member.vitals.heart_rate} <span className="text-xs text-slate-400">bpm</span>
                </div>
                <div className="text-[11px] font-mono text-cyan-300">
                  Base {num(member.baseline.hr_rest)} bpm ({Number(hrZScore) >= 0 ? `+${hrZScore}` : hrZScore}σ)
                </div>
              </div>
              <div className="rounded-xl border border-slate-800 bg-space-950/90 p-3">
                <div className="text-[11px] text-slate-400">HRV RMSSD vs Baseline</div>
                <div className="mt-1 text-base font-bold font-mono text-white">
                  {member.vitals.hrv_rmssd} <span className="text-xs text-slate-400">ms</span>
                </div>
                <div className="text-[11px] font-mono text-purple-300">
                  Base {num(member.baseline.hrv_rmssd)} ms ({Number(hrvZScore) >= 0 ? `+${hrvZScore}` : hrvZScore}σ)
                </div>
              </div>
              <div className="rounded-xl border border-slate-800 bg-space-950/90 p-3">
                <div className="text-[11px] text-slate-400">Blood Pressure</div>
                <div className="mt-1 text-base font-bold font-mono text-white">
                  {member.vitals.bp_systolic}/{member.vitals.bp_diastolic}{' '}
                  <span className="text-xs text-slate-400">mmHg</span>
                </div>
                <div className="text-[11px] font-mono text-slate-400">
                  Base {num(member.baseline.bp_systolic)}/{num(member.baseline.bp_diastolic)} mmHg
                </div>
              </div>
              <div className="rounded-xl border border-slate-800 bg-space-950/90 p-3">
                <div className="text-[11px] text-slate-400">BMD / Body Mass</div>
                <div className="mt-1 text-base font-bold font-mono text-white">
                  {member.vitals.bmd_estimate_pct}% · {member.vitals.body_mass_kg} kg
                </div>
                <div className="text-[11px] font-mono text-emerald-300">
                  Base 100% · {num(member.baseline.body_mass_kg)} kg
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Active Alerts for this Crew Member */}
      {memberAlerts.length > 0 && (
        <div className="rounded-2xl border border-amber-500/50 bg-amber-950/25 p-4 space-y-3">
          <h2 className="text-sm font-bold uppercase tracking-wider text-amber-200">
            Active Alerts Affecting {member.id} ({memberAlerts.length})
          </h2>
          <div className="space-y-2.5">
            {memberAlerts.map((alert) => {
              const st = STATUS_DISPLAY[severityToStatus(alert.severity)];
              return (
                <div
                  key={alert.id}
                  className="flex flex-col md:flex-row md:items-center justify-between gap-3 rounded-xl border border-slate-700/80 bg-space-950/90 p-3.5"
                >
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded border px-2 py-0.5 text-xs font-bold ${st.badgeClass}`}>
                        {st.label}
                      </span>
                      {alert.hazards.map((hz) => (
                        <span
                          key={hz}
                          className="rounded bg-slate-800 px-2 py-0.5 text-[11px] text-slate-200"
                        >
                          [{HAZARD_CATALOG[hz].letter}] {HAZARD_CATALOG[hz].shortName}
                        </span>
                      ))}
                      {alert.hrp_risks.map((rId) => (
                        <span
                          key={rId}
                          className="rounded bg-cyan-950 border border-cyan-500/40 px-2 py-0.5 text-[11px] font-mono text-cyan-300"
                        >
                          {rId}: {HRP_RISK_CATALOG[rId]?.name}
                        </span>
                      ))}
                    </div>
                    <div className="text-sm font-bold text-white">{alert.title}</div>
                    <div className="text-xs text-slate-300">{alert.rationale}</div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {alert.state === 'RAISED' && (
                      <button
                        type="button"
                        onClick={() => acknowledgeAlert(alert.id)}
                        className="min-h-[44px] rounded-lg bg-amber-500 px-3.5 py-2 text-xs font-bold text-slate-950 hover:bg-amber-400"
                      >
                        Acknowledge
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => resolveAlert(alert.id)}
                      className="min-h-[44px] rounded-lg border border-emerald-500/50 bg-emerald-600/20 px-3.5 py-2 text-xs font-bold text-emerald-200 hover:bg-emerald-600/30"
                    >
                      ✓ Resolve
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Limit-Band Physiological Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <LimitBandChart
          title="Heart Rate (Biomonitor ECG)"
          subtitle={`Personal 48 h baseline: ${num(member.baseline.hr_rest)} bpm`}
          data={member.timeseries.heart_rate}
          unit="bpm"
          limit={limits['physiology.hr_bpm']}
          hrpRisks={['HRP-03', 'HRP-09', 'HRP-12']}
          color="#38bdf8"
        />

        <LimitBandChart
          title="Arterial Blood Pressure (Systolic / Diastolic)"
          subtitle="Cardiovascular & post-landing orthostatic stability watch (SANS / BP Reg)"
          data={member.timeseries.bp}
          unit="mmHg"
          limit={limits['physiology.bp_systolic_mmHg']}
          secondaryLabel="Diastolic (mmHg)"
          hrpRisks={['HRP-03', 'HRP-02', 'HRP-10']}
          color="#f97316"
          secondaryColor="#38bdf8"
        />

        <LimitBandChart
          title="Heart Rate Variability (RMSSD Autonomic Recovery)"
          subtitle={`Personal 48 h baseline: ${num(member.baseline.hrv_rmssd)} ms`}
          data={member.timeseries.hrv_rmssd}
          unit="ms"
          hrpRisks={['HRP-03', 'HRP-12', 'HRP-14']}
          color="#a855f7"
        />

        <LimitBandChart
          title="Arterial Oxygen Saturation (SpO₂)"
          subtitle="Continuous pulse oximetry · Hypoxia & EVA prebreathe margin"
          data={member.timeseries.spo2}
          unit="%"
          limit={limits['physiology.spo2_pct_min']}
          hrpRisks={['HRP-06', 'HRP-08']}
          color="#10b981"
        />
      </div>

      {/* Sleep 7-Night Actigraphy & 180-Day Bone Mineral Density / Fitness Trends (US-6) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* 7-Night Sleep Actigraphy */}
        <div className="rounded-xl border border-slate-800 bg-space-900/90 p-4 space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-slate-100">
                  7-Night Sleep Duration (Wrist Actigraphy)
                </h3>
                <span className="rounded bg-cyan-500/10 border border-cyan-500/30 px-1.5 py-0.5 text-[10px] font-mono text-cyan-300">
                  HRP-14
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Artemis II ARCHeR / Actigraphy modality · Tracks cumulative circadian sleep debt
              </p>
            </div>
            {sleepLimit && (
              <span className="rounded bg-amber-500/20 border border-amber-400/50 px-2 py-0.5 text-[10px] font-semibold text-amber-200">
                {sleepLimit.verified ? '✓' : '⚠ unverified'} limit: ≥ {sleepLimit.value} h ({sleepLimit.source_ref})
              </span>
            )}
          </div>

          <div style={{ width: '100%', height: 210 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={member.sleep_7d} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
                <XAxis dataKey="dayLabel" stroke="#64748b" fontSize={11} />
                <YAxis domain={[0, 10]} stroke="#64748b" fontSize={11} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#0b101d',
                    borderColor: '#334155',
                    borderRadius: '0.5rem',
                    fontSize: '12px',
                  }}
                />
                {sleepLimit?.value !== undefined && (
                <ReferenceLine
                  y={sleepLimit.value}
                  stroke="#f59e0b"
                  strokeDasharray="4 4"
                  label={{
                    value: `Min ${sleepLimit.value} h${sleepLimit.verified ? '' : ' (⚠ unverified)'}`,
                    position: 'insideTopRight',
                    fill: '#fcd34d',
                    fontSize: 10,
                  }}
                />
                )}
                <Bar
                  dataKey="hours"
                  name="Sleep Hours"
                  fill="#38bdf8"
                  radius={[4, 4, 0, 0]}
                  isAnimationActive={false}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* 180-Day Bone Mineral Density (BMD) & Exercise Adherence Trend (US-6) */}
        <div className="rounded-xl border border-slate-800 bg-space-900/90 p-4 space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-slate-100">
                  180-Day Bone Mineral Density (BMD) & Exercise Adherence (US-6)
                </h3>
                <span className="rounded bg-cyan-500/10 border border-cyan-500/30 px-1.5 py-0.5 text-[10px] font-mono text-cyan-300">
                  HRP-11 · HRP-09
                </span>
              </div>
              <p className="text-xs text-slate-400">
                0g trabecular bone loss (-1.0 to -1.5%/mo) mitigated by ARED resistive exercise adherence
              </p>
            </div>
            {bmdLimit && (
              <span className="rounded bg-emerald-500/15 border border-emerald-500/40 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
                ✓ verified rate: {bmdLimit.min}–{bmdLimit.max} {bmdLimit.unit} ({bmdLimit.source_ref})
              </span>
            )}
          </div>

          <div style={{ width: '100%', height: 210 }}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={member.trends_180d}
                margin={{ top: 8, right: 12, left: -12, bottom: 0 }}
              >
                <XAxis dataKey="label" stroke="#64748b" fontSize={11} />
                <YAxis domain={[85, 102]} stroke="#64748b" fontSize={11} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#0b101d',
                    borderColor: '#334155',
                    borderRadius: '0.5rem',
                    fontSize: '12px',
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="bmdPct"
                  name="BMD (% of Baseline)"
                  stroke="#10b981"
                  strokeWidth={2.5}
                  isAnimationActive={false}
                />
                <Line
                  type="monotone"
                  dataKey="exerciseAdherencePct"
                  name="Exercise Adherence (%)"
                  stroke="#38bdf8"
                  strokeDasharray="3 3"
                  strokeWidth={1.5}
                  isAnimationActive={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
};
