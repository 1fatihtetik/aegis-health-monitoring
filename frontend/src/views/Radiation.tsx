import React from 'react';
import { formatDurationSeconds } from '../api/client';
import { RadReplayInfo, STATUS_DISPLAY } from '../api/types';
import { useAegis } from '../api/useLiveSocket';
import { clauseId, formatLimit } from '../api/limits';
import { DataSourceBadge } from '../components/DataSourceBadge';
import { LimitBandChart } from '../components/LimitBandChart';

export interface RadiationProps {
  onOpenEmergencyModal: () => void;
}

function utcMinute(iso: string): string {
  return `${iso.slice(0, 16).replace('T', ' ')} UTC`;
}

/** Which NASA measurement is playing right now, and how it maps onto mission time (AGENTS.md §2a). */
export const ReplayLine: React.FC<{ replay?: RadReplayInfo | null }> = ({ replay }) => {
  if (!replay) {
    return (
      <p className="text-xs text-slate-400" data-testid="rad-replay-line">
        Radiation source: synthetic background (no NASA RAD replay for this mission phase).
      </p>
    );
  }
  const speed = replay.compression === 1 ? 'replayed in real time' : `replayed ×${replay.compression}`;
  return (
    <p className="flex flex-wrap items-center gap-2 text-xs text-sky-100" data-testid="rad-replay-line">
      <span className="rounded border border-sky-400/60 bg-sky-950/60 px-2 py-0.5 font-bold">◆ {replay.label}</span>
      <span>
        Curiosity RAD measurement from {utcMinute(replay.observation_ts)}, {speed}. Dose equivalent = RAD tissue dose ×
        Q {replay.quality_factor}.
      </span>
      {replay.quality === 'SUSPECT' && (
        <span
          className="rounded border border-amber-300/60 bg-amber-950/50 px-2 py-0.5 font-semibold text-amber-100"
          data-testid="rad-replay-held"
        >
          ▲ data gap: holding last good RAD value
        </span>
      )}
      {replay.synthetic_spe_overlay && (
        <span className="rounded border border-slate-500 bg-slate-800/70 px-2 py-0.5 font-semibold text-slate-100">
          · SPE profile is synthetic (real RAD SPE replay pending)
        </span>
      )}
    </p>
  );
};

export const Radiation: React.FC<RadiationProps> = ({ onOpenEmergencyModal }) => {
  const { state, triggerScenario, toggleCrewShelter, evacuateAllToShelter } = useAegis();
  const { radiation, crew, limits } = state;

  const careerLimit = limits['radiation.career_effective_dose_mSv'];
  const speLimit = limits['radiation.spe_alert_dose_rate_uSv_h'];
  const gcrDesign = limits['radiation.gcr_rate_free_space_mSv_day'];
  const speEventLimit = limits['radiation.spe_event_effective_dose_mSv'];
  const statusMeta = STATUS_DISPLAY[radiation.status];
  const shelteredCount = crew.filter((c) => c.in_shelter).length;

  return (
    <div className="space-y-6" data-testid="radiation-view">
      {/* Header Banner */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 rounded-2xl border border-slate-800 bg-space-900/95 p-5">
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-md border px-2.5 py-0.5 text-xs font-bold ${statusMeta.badgeClass}`}>
              {statusMeta.label}
            </span>
            <span className="rounded bg-purple-500/20 border border-purple-400/40 px-2.5 py-0.5 text-xs font-mono font-bold text-purple-200">
              CSA CANS NEUTRON SPECTROMETER MODULE (M6)
            </span>
            <span className="rounded bg-cyan-950 border border-cyan-500/40 px-2 py-0.5 text-xs font-mono text-cyan-300">
              HAZARD [R] · HRP-17 · HRP-01 · HRP-03 · HRP-12
            </span>
          </div>
          <h1 className="text-xl font-black text-white">
            Autonomous Radiation & CANS Active Neutron Dosimetry
          </h1>
          <p className="text-xs text-slate-300 max-w-3xl">
            Continuous separation of primary proton/GCR ionizing flux and secondary spacecraft-hull neutron radiation (~30% of biological dose equivalent per Canadian Space Agency CANS heritage).
          </p>
          <ReplayLine replay={radiation.replay} />
          {radiation.replay && (
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-300">
              <span>
                Cabin absorbed dose rate (RAD, measured):{' '}
                <strong className="font-mono text-sky-100">{radiation.area_dose_rate_absorbed_uGy_h} µGy/h</strong>
              </span>
              <DataSourceBadge compact source={state.provenance.area_dose_rate_absorbed} />
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {radiation.spe_active ? (
            <button
              type="button"
              onClick={onOpenEmergencyModal}
              className="min-h-[44px] rounded-xl bg-red-600 px-4 py-2.5 text-xs font-black uppercase tracking-wider text-white shadow-lg animate-pulse hover:bg-red-500"
            >
              ✖ Open SPE Storm Shelter Takeover ({formatDurationSeconds(radiation.spe_elapsed_s)})
            </button>
          ) : (
            <button
              type="button"
              onClick={() => triggerScenario('spe_event')}
              className="min-h-[44px] rounded-xl border border-red-500/70 bg-red-500/20 px-4 py-2.5 text-xs font-bold text-red-100 hover:bg-red-500/30"
            >
              ✖ Simulate Solar Particle Event (SPE)
            </button>
          )}
        </div>
      </div>

      {/* 4 Live Radiation Dosimetry KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-xl border border-slate-800 bg-space-900/90 p-4">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Total Dose-Equivalent Rate</span>
            {speLimit && !speLimit.verified && (
              <span className="text-amber-300 font-mono text-[10px]">⚠ unverified limit</span>
            )}
          </div>
          <div className="mt-1">
            <DataSourceBadge compact source={state.provenance.area_dose_rate_equivalent} />
          </div>
          <div className="mt-1.5 flex items-baseline gap-1.5">
            <span
              className={`text-2xl font-black font-mono ${
                radiation.spe_active ? 'text-red-400' : 'text-white'
              }`}
            >
              {radiation.dose_rate_equivalent_uSv_h}
            </span>
            <span className="text-xs text-slate-400">µSv/h</span>
          </div>
          <div className="mt-1 text-[11px] font-mono text-slate-400">
            SPE trigger: &gt; {formatLimit(speLimit)} ({speLimit?.source_ref ?? 'no limit configured'})
          </div>
        </div>

        <div className="rounded-xl border border-purple-500/40 bg-purple-950/25 p-4">
          <div className="flex items-center justify-between text-xs text-purple-200">
            <span>CANS Secondary Neutron Rate</span>
            <span className="rounded bg-purple-500/20 px-1.5 py-0.5 font-mono text-[10px] text-purple-200">
              CSA CANS
            </span>
          </div>
          <div className="mt-1">
            <DataSourceBadge compact source={state.provenance.neutron_dose_equivalent_rate} />
          </div>
          <div className="mt-1.5 flex items-baseline gap-1.5">
            <span className="text-2xl font-black font-mono text-purple-200">
              {radiation.neutron_dose_equivalent_rate_uSv_h}
            </span>
            <span className="text-xs text-purple-300">µSv/h</span>
          </div>
          <div className="mt-1 text-[11px] font-mono text-purple-300">
            Neutron Share: <strong>{radiation.neutron_fraction_pct}%</strong> of total dose equivalent
          </div>
        </div>

        <div className="rounded-xl border border-slate-800 bg-space-900/90 p-4">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Absorbed Tissue Dose Rate</span>
            <span className="font-mono text-[10px] text-slate-400">Personal Dosimeter</span>
          </div>
          <div className="mt-1">
            <DataSourceBadge compact source={state.provenance.dose_rate_absorbed} />
          </div>
          <div className="mt-1.5 flex items-baseline gap-1.5">
            <span className="text-2xl font-black font-mono text-cyan-300">
              {radiation.dose_rate_absorbed_uGy_h}
            </span>
            <span className="text-xs text-slate-400">µGy/h</span>
          </div>
          <div className="mt-1 text-[11px] font-mono text-slate-400">
            {radiation.replay ? (
              <>
                Mean quality factor Q = {radiation.replay.quality_factor} (published RAD value)
                {radiation.area_dose_rate_absorbed_uGy_h !== undefined && (
                  <> · cabin RAD {radiation.area_dose_rate_absorbed_uGy_h} µGy/h</>
                )}
              </>
            ) : (
              <>
                Mean quality factor Q ≈{' '}
                {(radiation.dose_rate_equivalent_uSv_h / Math.max(0.1, radiation.dose_rate_absorbed_uGy_h)).toFixed(1)}
              </>
            )}
          </div>
          <div className="mt-0.5 text-[10px] text-cyan-200" data-testid="hint-quality-factor">
            Q = how much more biological damage this radiation mix does per unit of energy absorbed.
          </div>
        </div>

        <div className="rounded-xl border border-slate-800 bg-space-900/90 p-4">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Highest Crew Mission Dose</span>
          </div>
          <div className="mt-1">
            <DataSourceBadge compact source={state.provenance.dose_mission} />
          </div>
          <div className="mt-1.5 flex items-baseline gap-1.5">
            <span className="text-2xl font-black font-mono text-emerald-300">
              {radiation.cumulative_mission_mSv}
            </span>
            <span className="text-xs text-slate-400">mSv</span>
          </div>
          <div className="mt-1 text-[11px] font-mono text-slate-400">
            24h: {radiation.cumulative_24h_mSv} mSv · 30d: {radiation.cumulative_30d_mSv} mSv
          </div>
          {gcrDesign && (
            <div className="mt-0.5 text-[10px] text-slate-400" title={gcrDesign.source_ref}>
              Habitat design target (deep space): &lt; {gcrDesign.value} {gcrDesign.unit}{' '}
              {gcrDesign.verified ? `✓ NASA ${clauseId(gcrDesign.source_ref) ?? ''}` : '⚠ unverified'}
            </div>
          )}
        </div>
      </div>

      {/* Main Chart + CANS Neutron Energy Spectrum */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-7">
          <LimitBandChart
            title="Total Equivalent Dose Rate vs. CANS Neutron Component (µSv/h)"
            subtitle={
              radiation.replay
                ? `Area dose equivalent from ${radiation.replay.label} vs neutron share (heuristic 30% split)`
                : 'Area dose rate (synthetic GCR/SPE) vs neutron share (heuristic 30% split)'
            }
            data={radiation.history}
            unit="µSv/h"
            limit={speLimit}
            secondaryLabel="CANS Neutron Rate (µSv/h)"
            hrpRisks={['HRP-17', 'HRP-01', 'HRP-03']}
            color="#ef4444"
            secondaryColor="#a855f7"
            height={250}
            source={state.provenance.area_dose_rate_equivalent}
          />
        </div>

        {/* CSA CANS Neutron Energy Spectrum Breakdown */}
        <div className="lg:col-span-5 rounded-xl border border-slate-800 bg-space-900/90 p-4 flex flex-col justify-between">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-slate-100">
                CANS Neutron Energy Spectrum Bins
              </h2>
              <span className="rounded bg-purple-500/20 border border-purple-400/40 px-2 py-0.5 text-[10px] font-mono text-purple-200">
                Neutron Fraction: {radiation.neutron_fraction_pct}%
              </span>
            </div>
            <p className="text-xs text-slate-400">
              Fast neutrons (0.1–20 MeV) carry radiation weighting factors up to Q=20, making autonomous continuous neutron spectrometry vital during deep-space SPEs.
            </p>

            <div className="space-y-2.5 pt-1">
              {radiation.spectrum_bins.map((bin) => (
                <div key={bin.energyRange} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-slate-200">{bin.energyRange}</span>
                    <span className="font-mono text-purple-300">
                      {bin.fluxPct}% flux · Q={bin.qualityFactor}
                    </span>
                  </div>
                  <div className="h-2.5 w-full overflow-hidden rounded-full bg-space-950 border border-slate-800">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-purple-500 to-cyan-400"
                      style={{ width: `${Math.min(100, bin.fluxPct * 2.2)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-4 rounded-lg border border-slate-800 bg-space-950/90 p-3 text-xs text-slate-300">
            <strong>Storm Shelter Shielding Status:</strong> {shelteredCount}/4 crew currently in Aft Water-Wall Shelter (dose avoided by sheltering this event: {radiation.shelter_dose_saved_mSv} mSv, all crew).
          </div>
        </div>
      </div>

      {/* Crew Career & Mission Cumulative Dose Table + Shelter Headcount */}
      <div className="rounded-2xl border border-slate-800 bg-space-900/95 p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-bold uppercase tracking-wider text-slate-200">
              Crew Cumulative Effective Dose vs. Configured Career Limit
            </h2>
            <p className="text-xs text-slate-400">
              Integrates prior career dose + current mission dose against configured career threshold.
            </p>
          </div>

          <div className="flex items-center gap-2">
            {careerLimit && !careerLimit.verified && (
              <span className="rounded bg-amber-500/20 border border-amber-400/50 px-2.5 py-1 text-xs font-semibold text-amber-200">
                ⚠ unverified limit: {careerLimit.value} {careerLimit.unit} ({careerLimit.source_ref})
              </span>
            )}
            {careerLimit?.verified && (
              <span
                className="rounded bg-emerald-500/15 border border-emerald-400/50 px-2.5 py-1 text-xs font-semibold text-emerald-200"
                title={careerLimit.source_ref}
                data-testid="career-limit-verified"
              >
                ✓ NASA limit {clauseId(careerLimit.source_ref)}: career &lt; {careerLimit.value} {careerLimit.unit}
                {speEventLimit?.verified ? ` · SPE design event < ${speEventLimit.value} ${speEventLimit.unit}` : ''}
              </span>
            )}
            <button
              type="button"
              onClick={evacuateAllToShelter}
              className="min-h-[44px] rounded-lg bg-emerald-600/25 border border-emerald-500/50 px-3.5 py-1.5 text-xs font-bold text-emerald-200 hover:bg-emerald-600/35"
            >
              ✓ Mark All 4 Crew in Storm Shelter
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          {crew.map((member) => {
            // Each crew member's own mission dose (F-001): sheltering makes them diverge during an SPE.
            const totalCareer = Number(
              (member.career_dose_prior_mSv + member.mission_dose_mSv).toFixed(1)
            );
            const limitVal = careerLimit?.value;
            const pct =
              limitVal !== undefined ? Number(((totalCareer / limitVal) * 100).toFixed(1)) : null;

            return (
              <div
                key={member.id}
                className="rounded-xl border border-slate-800 bg-space-950/85 p-4 space-y-2.5"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold font-mono text-cyan-300">
                    {member.id} · {member.role}
                  </span>
                  <button
                    type="button"
                    onClick={() => toggleCrewShelter(member.id)}
                    className={`min-h-[44px] rounded-md border px-3 py-1 text-xs font-bold ${
                      member.in_shelter
                        ? 'border-emerald-400/60 bg-emerald-950/70 text-emerald-200'
                        : 'border-slate-700 bg-space-900 text-slate-300'
                    }`}
                  >
                    {member.in_shelter ? '✓ Sheltered' : 'Cabin Deck'}
                  </button>
                </div>

                <div className="text-sm font-bold text-white">{member.name}</div>

                <div className="space-y-1">
                  <div className="flex justify-between text-xs font-mono">
                    <span className="text-slate-400">Career Total:</span>
                    <span className="text-slate-100 font-bold">
                      {totalCareer}
                      {limitVal !== undefined ? ` / ${limitVal} mSv (${pct}%)` : ' mSv (no limit configured)'}
                    </span>
                  </div>
                  <div className="h-2.5 w-full overflow-hidden rounded-full bg-space-900 border border-slate-800">
                    <div
                      className="h-full rounded-full bg-cyan-400"
                      style={{ width: `${Math.min(100, pct ?? 0)}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-[11px] text-slate-400 font-mono">
                    <span>Prior: {member.career_dose_prior_mSv} mSv</span>
                    <span>Mission: +{member.mission_dose_mSv} mSv</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
