import React, { useState } from 'react';
import { formatDurationSeconds } from '../api/client';
import {
  AlertItem,
  CrewId,
  CrewMemberSummary,
  HAZARD_CATALOG,
  HRP_RISK_CATALOG,
  RadiationSummary,
} from '../api/types';

export interface EmergencyTakeoverProps {
  alert: AlertItem | null;
  crew: CrewMemberSummary[];
  radiation: RadiationSummary;
  commDelaySeconds: number;
  groundLagSeconds: number;
  onToggleCrewShelter: (crewId: CrewId) => void;
  onEvacuateAll: () => void;
  onAcknowledge: (alertId: string) => void;
  onResolve: (alertId: string) => void;
  onMinimize?: () => void;
}

export const EmergencyTakeover: React.FC<EmergencyTakeoverProps> = ({
  alert,
  crew,
  radiation,
  commDelaySeconds,
  groundLagSeconds,
  onToggleCrewShelter,
  onEvacuateAll,
  onAcknowledge,
  onResolve,
  onMinimize,
}) => {
  const [checkedSteps, setCheckedSteps] = useState<Record<number, boolean>>({});
  const [alarmMuted, setAlarmMuted] = useState<boolean>(false);

  if (!alert || alert.severity !== 'EMERGENCY') {
    return null;
  }

  const shelteredCount = crew.filter((c) => c.in_shelter).length;
  const allSheltered = shelteredCount === crew.length;
  const checklist = alert.checklist ?? [
    'Abort all non-essential module activities and EVAs immediately',
    'Relocate C1, C2, C3, C4 to Aft Water-Wall Storm Shelter',
    'Deploy stowage polyethylene mass bags around shelter perimeter',
    'Verify CANS neutron spectrometer & personal dosimeter telemetry every 15 min',
  ];

  const toggleStep = (index: number) => {
    setCheckedSteps((prev) => ({ ...prev, [index]: !prev[index] }));
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="emergency-takeover-title"
      data-testid="emergency-takeover"
      className="fixed inset-0 z-50 flex flex-col justify-between overflow-y-auto bg-red-950/95 backdrop-blur-md p-4 md:p-6 text-slate-100 border-4 border-red-500"
    >
      {/* Top Emergency Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-red-500/50 pb-4">
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3.5 py-2 text-sm font-black uppercase tracking-wider text-white shadow-lg animate-pulse">
            ✖ EMERGENCY — LEVEL 1 (LOSS OF CREW THREAT)
          </span>
          <span className="rounded-md bg-red-900/70 border border-red-400/50 px-3 py-1.5 text-xs font-mono text-red-100">
            AUTONOMOUS ONBOARD TRIGGER · MCC-HOUSTON LAGS BY{' '}
            {formatDurationSeconds(groundLagSeconds ?? commDelaySeconds)}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setAlarmMuted((m) => !m)}
            className="min-h-[44px] rounded-lg border border-red-400/60 bg-red-900/60 px-3.5 py-2 text-xs font-bold uppercase tracking-wide text-red-100 hover:bg-red-800"
          >
            {alarmMuted ? '🔇 Alarm Muted' : '🔊 Mute Klaxon Alarm'}
          </button>
          {onMinimize && (
            <button
              type="button"
              onClick={onMinimize}
              className="min-h-[44px] rounded-lg border border-slate-500 bg-space-900/80 px-3.5 py-2 text-xs font-semibold text-slate-200 hover:bg-space-800"
            >
              Minimize to Dashboard
            </button>
          )}
        </div>
      </div>

      {/* Main Content Grid */}
      <div className="my-4 grid grid-cols-1 lg:grid-cols-12 gap-5 flex-1">
        {/* Left column: Alert Evidence, Dosimetry, and Traceability */}
        <div className="lg:col-span-7 flex flex-col justify-between space-y-4 rounded-2xl border border-red-500/50 bg-space-950/90 p-5">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              {alert.hazards.map((hz) => (
                <span
                  key={hz}
                  className="rounded bg-red-900/60 border border-red-400/50 px-2.5 py-1 text-xs font-bold text-red-100"
                >
                  Hazard [{HAZARD_CATALOG[hz].letter}]: {HAZARD_CATALOG[hz].fullName}
                </span>
              ))}
              {alert.hrp_risks.map((riskId) => (
                <span
                  key={riskId}
                  className="rounded bg-cyan-950 border border-cyan-500/50 px-2.5 py-1 text-xs font-mono text-cyan-200"
                >
                  {riskId}: {HRP_RISK_CATALOG[riskId]?.name}
                </span>
              ))}
            </div>

            <h1
              id="emergency-takeover-title"
              className="text-xl md:text-2xl font-black tracking-tight text-white"
            >
              {alert.title}
            </h1>

            <p className="text-sm text-red-100/90 leading-relaxed">{alert.rationale}</p>

            {/* Explainability Evidence Box */}
            <div className="rounded-xl border border-amber-400/50 bg-amber-950/40 p-3.5 space-y-1.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-bold uppercase tracking-wider text-amber-200">
                  Rule Evidence ({alert.rule_id})
                </span>
                {!alert.evidence.limit_verified && (
                  <span className="rounded bg-amber-500/25 border border-amber-300/60 px-2 py-0.5 text-xs font-bold text-amber-100">
                    ⚠ unverified limit · {alert.evidence.source_ref ?? 'config/limits.yaml'}
                  </span>
                )}
              </div>
              <p className="text-sm font-mono text-white">
                Signal: <strong>{alert.evidence.signal}</strong> ={' '}
                <strong className="text-red-300">
                  {radiation.dose_rate_equivalent_uSv_h} µSv/h
                </strong>{' '}
                (Threshold {alert.evidence.op ?? '>'} {alert.evidence.limit} µSv/h over{' '}
                {alert.evidence.window})
              </p>
            </div>

            {/* Live SPE Radiation & CANS Neutron Counters */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
              <div className="rounded-xl border border-red-500/40 bg-red-950/50 p-3">
                <div className="text-[11px] uppercase text-red-200">SPE Elapsed Timer</div>
                <div className="mt-1 text-xl font-black font-mono text-white">
                  {formatDurationSeconds(radiation.spe_elapsed_s)}
                </div>
                <div className="text-[11px] text-red-200/80">Continuous storm watch</div>
              </div>

              <div className="rounded-xl border border-red-500/40 bg-red-950/50 p-3">
                <div className="text-[11px] uppercase text-red-200">Total Dose Rate</div>
                <div className="mt-1 text-xl font-black font-mono text-red-300">
                  {radiation.dose_rate_equivalent_uSv_h} <span className="text-xs">µSv/h</span>
                </div>
                <div className="text-[11px] text-red-200/80">
                  {allSheltered ? '✓ Attenuated by shelter' : '⚠ Unshielded cabin flux'}
                </div>
              </div>

              <div className="rounded-xl border border-purple-400/50 bg-purple-950/50 p-3">
                <div className="text-[11px] uppercase text-purple-200">CANS Neutron Rate</div>
                <div className="mt-1 text-xl font-black font-mono text-purple-200">
                  {radiation.neutron_dose_equivalent_rate_uSv_h}{' '}
                  <span className="text-xs">µSv/h</span>
                </div>
                <div className="text-[11px] text-purple-300">
                  {radiation.neutron_fraction_pct}% neutron share
                </div>
              </div>

              <div className="rounded-xl border border-emerald-500/40 bg-emerald-950/40 p-3">
                <div className="text-[11px] uppercase text-emerald-200">24h Cumulative Dose</div>
                <div className="mt-1 text-xl font-black font-mono text-emerald-300">
                  {radiation.cumulative_24h_mSv} <span className="text-xs">mSv</span>
                </div>
                <div className="text-[11px] text-emerald-200/80">
                  Saved by shelter: {radiation.shelter_dose_saved_mSv} mSv
                </div>
              </div>
            </div>
          </div>

          {/* Storm Shelter Crew Headcount */}
          <div className="space-y-2.5 pt-2 border-t border-slate-800">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-bold uppercase tracking-wider text-white">
                  Aft Water-Wall Storm Shelter Headcount ({shelteredCount}/{crew.length} Accounted)
                </h2>
                <p className="text-xs text-slate-300">
                  Tap each astronaut badge as they enter the polyethylene-shielded storm shelter.
                </p>
              </div>
              <button
                type="button"
                onClick={onEvacuateAll}
                className="min-h-[44px] rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold uppercase tracking-wider text-white hover:bg-emerald-500"
              >
                ✓ Confirm All 4 Crew in Shelter
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              {crew.map((member) => (
                <button
                  key={member.id}
                  type="button"
                  onClick={() => onToggleCrewShelter(member.id)}
                  className={`min-h-[56px] flex flex-col items-start justify-between rounded-xl border p-3 text-left transition-all ${
                    member.in_shelter
                      ? 'border-emerald-400 bg-emerald-950/70 text-emerald-100'
                      : 'border-red-400/70 bg-red-900/40 text-red-100 hover:bg-red-900/60'
                  }`}
                >
                  <div className="flex w-full items-center justify-between">
                    <span className="text-xs font-black font-mono">
                      {member.id} · {member.role}
                    </span>
                    <span className="text-xs font-bold">
                      {member.in_shelter ? '✓ IN SHELTER' : '✖ TRANSIT'}
                    </span>
                  </div>
                  <span className="text-xs truncate w-full opacity-90">{member.name}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Right column: Action Checklist & Triage Controls */}
        <div className="lg:col-span-5 flex flex-col justify-between rounded-2xl border border-red-500/50 bg-space-950/90 p-5 space-y-4">
          <div className="space-y-3">
            <h2 className="text-sm font-bold uppercase tracking-wider text-red-200">
              Mandatory Autonomous SPE Protocol Checklist
            </h2>
            <p className="text-xs text-slate-300">{alert.action}</p>

            <div className="space-y-2 pt-1">
              {checklist.map((step, idx) => {
                const done = Boolean(checkedSteps[idx]);
                return (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => toggleStep(idx)}
                    className={`w-full min-h-[48px] flex items-center gap-3 rounded-xl border px-3.5 py-2.5 text-left text-xs font-medium transition-all ${
                      done
                        ? 'border-emerald-500/60 bg-emerald-950/50 text-emerald-200 line-through'
                        : 'border-slate-700 bg-space-900 text-slate-100 hover:border-slate-500'
                    }`}
                  >
                    <span
                      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md border text-xs font-bold ${
                        done
                          ? 'border-emerald-400 bg-emerald-500 text-slate-950'
                          : 'border-slate-500 bg-space-950 text-slate-300'
                      }`}
                    >
                      {done ? '✓' : idx + 1}
                    </span>
                    <span>{step}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-2.5 border-t border-slate-800 pt-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => {
                  onAcknowledge(alert.id);
                  if (onMinimize) onMinimize();
                }}
                className="min-h-[48px] rounded-xl bg-amber-500 px-4 py-2.5 text-xs font-black uppercase tracking-wider text-slate-950 hover:bg-amber-400"
              >
                Acknowledge & Monitor on Deck
              </button>

              <button
                type="button"
                onClick={() => onResolve(alert.id)}
                className="min-h-[48px] rounded-xl border border-emerald-400/70 bg-emerald-700/80 px-4 py-2.5 text-xs font-black uppercase tracking-wider text-white hover:bg-emerald-600"
              >
                ✓ Resolve SPE Event (Flux Subsided)
              </button>
            </div>
            <p className="text-[11px] text-center text-slate-400">
              Decision support only, not a medical diagnosis. Each value shows its data source.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
