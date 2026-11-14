import React, { useState } from 'react';
import { formatDurationSeconds } from '../api/client';
import {
  CrewId,
  STATUS_DISPLAY,
  Severity,
  severityToStatus,
} from '../api/types';
import { useAegis } from '../api/useLiveSocket';
import { StatusRing } from '../components/StatusRing';

export const GroundConsole: React.FC = () => {
  const { state, sendGroundRecommendation, toggleLinkBlackout } = useAegis();
  const { groundSnapshot, link, sim, recommendations, alerts: onboardAlerts, radiation: onboardRad } =
    state;

  const [targetCrew, setTargetCrew] = useState<CrewId | 'ALL'>('C1');
  const [priority, setPriority] = useState<Severity>('CAUTION');
  const [recTitle, setRecTitle] = useState<string>(
    'CMO Advisory: Defer C1 EVA & Switch CDRA to Secondary Bed'
  );
  const [recRationale, setRecRationale] = useState<string>(
    'Ground telemetry review notes compound sleep restriction + rising cabin ppCO₂. Recommend postponing non-critical EVA and initiating 8h protected sleep window.'
  );
  const [recChecklistText, setRecChecklistText] = useState<string>(
    'Verify CDRA Bed B regeneration status\nSchedule 8.5h sleep block for C1\nRepeat cognitive readiness check at +12h'
  );

  const handleSendRecommendation = (e: React.FormEvent) => {
    e.preventDefault();
    if (!recTitle.trim()) return;
    const checklist = recChecklistText
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    sendGroundRecommendation({
      crew_id: targetCrew,
      priority,
      title: recTitle.trim(),
      rationale: recRationale.trim(),
      checklist,
    });
  };

  const lagFormatted = formatDurationSeconds(groundSnapshot.lag_s ?? sim.comm_delay_s);
  const onboardHasEmergency = onboardAlerts.some(
    (a) => a.severity === 'EMERGENCY' && a.state !== 'RESOLVED'
  );
  const groundHasEmergency = groundSnapshot.alerts.some(
    (a) => a.severity === 'EMERGENCY' && a.state !== 'RESOLVED'
  );

  return (
    <div className="space-y-6" data-testid="ground-console-view">
      {/* Mandatory Ground Console Delay Header Banner (AGENTS.md §6) */}
      <div
        className={`rounded-2xl border p-5 shadow-lg ${
          link.blackout
            ? 'border-red-500 bg-red-950/50'
            : 'border-cyan-500/50 bg-space-900/95'
        }`}
      >
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <span
                data-testid="ground-delay-banner"
                className="rounded-lg bg-cyan-500 px-3 py-1 text-sm font-black font-mono uppercase text-slate-950"
              >
                Data as of T−{lagFormatted}
              </span>

              <span className="rounded bg-space-950 border border-slate-700 px-2.5 py-1 text-xs font-mono text-slate-200">
                Ground Store UTC: {groundSnapshot.as_of_ts.slice(11, 19)} (Onboard UTC:{' '}
                {sim.sim_ts.slice(11, 19)})
              </span>

              <span className="rounded bg-space-950 border border-slate-700 px-2.5 py-1 text-xs font-mono text-purple-300">
                Queue Depth: {link.queue_depth} packets
              </span>

              {link.blackout && (
                <span className="rounded bg-red-600 px-2.5 py-1 text-xs font-black uppercase text-white animate-pulse">
                  ⚡ SOLAR CONJUNCTION / LINK BLACKOUT ACTIVE — NO PACKETS DELIVERED
                </span>
              )}
            </div>

            <h1 className="text-xl font-black text-white">
              MCC-Houston Flight Surgeon Console (Delayed Ground Store · Read-Only Telemetry)
            </h1>
            <p className="text-xs text-slate-300">
              Ground never reads onboard memory directly; this view renders only packets delivered through the store-and-forward comm-link delay queue (`deliver_ts = sent_ts + delay`).
            </p>
          </div>

          <button
            type="button"
            onClick={toggleLinkBlackout}
            className={`min-h-[44px] shrink-0 rounded-xl border px-4 py-2 text-xs font-bold uppercase tracking-wider ${
              link.blackout
                ? 'border-emerald-400 bg-emerald-600 text-white hover:bg-emerald-500'
                : 'border-red-400/70 bg-red-950/60 text-red-100 hover:bg-red-900/70'
            }`}
          >
            {link.blackout ? 'Restore Deep-Space Comm Link' : 'Simulate Comm Blackout'}
          </button>
        </div>

        {/* Autonomy Proof Callout when Onboard has an SPE Emergency that hasn't reached Ground yet */}
        {onboardHasEmergency && !groundHasEmergency && (
          <div className="mt-4 rounded-xl border border-amber-400 bg-amber-950/60 p-3.5 text-xs text-amber-100 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <strong>⚡ AUTONOMY PROOF IN PROGRESS:</strong> Onboard AEGIS detected a{' '}
              <span className="text-red-300 font-bold">
                SOLAR PARTICLE EVENT ({onboardRad.dose_rate_equivalent_uSv_h} µSv/h)
              </span>{' '}
              and initiated Storm Shelter evacuation immediately. Because of the{' '}
              <strong>{lagFormatted}</strong> one-way delay, MCC-Houston still sees nominal pre-storm telemetry until the downlink packet arrives!
            </div>
            <span className="font-mono font-bold text-amber-300 shrink-0">
              Increase speed (60× / 1k×) in Scenario Dock to watch packet arrive
            </span>
          </div>
        )}
      </div>

      {/* Delayed Ground Crew Cards & Delayed Radiation/Environment Snapshot */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <div className="lg:col-span-7 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold uppercase tracking-wider text-slate-300">
              Delayed Crew Health State (As of T−{lagFormatted})
            </h2>
            <span className="text-xs font-mono text-slate-400">
              Delayed Radiation: {groundSnapshot.radiation.dose_rate_equivalent_uSv_h} µSv/h · Delayed ppCO₂:{' '}
              {groundSnapshot.environment.ppco2_mmHg} mmHg
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {groundSnapshot.crew.map((c) => (
              <div
                key={c.id}
                className="flex items-center justify-between rounded-xl border border-slate-800 bg-space-900/90 p-3.5"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="rounded bg-cyan-500/15 border border-cyan-500/40 px-2 py-0.5 text-xs font-mono font-bold text-cyan-300">
                      {c.id} · {c.role}
                    </span>
                    <span className="text-xs font-semibold text-white">{c.name}</span>
                  </div>
                  <div className="text-xs font-mono text-slate-300">
                    HR: {c.vitals.heart_rate} bpm · SpO₂: {c.vitals.spo2}% · Sleep: {c.vitals.sleep_hours_24h}h
                  </div>
                  <div className="text-[11px] font-mono text-slate-400">
                    EVA Readiness: {c.readiness.EVA.value}% · Dose: {c.vitals.dose_rate_uSv_h} µSv/h
                  </div>
                </div>
                <StatusRing status={c.status} score={c.readiness.OVERALL.value} size={68} />
              </div>
            ))}
          </div>

          {/* Delayed Mission Alert Log on Ground */}
          <div className="rounded-xl border border-slate-800 bg-space-900/90 p-4 space-y-3">
            <h3 className="text-sm font-bold uppercase tracking-wider text-slate-300">
              Synced Mission Alerts Received by Ground ({groundSnapshot.alerts.length})
            </h3>
            {groundSnapshot.alerts.length === 0 ? (
              <p className="text-xs text-slate-400">
                No alerts received at MCC-Houston as of T−{lagFormatted}. (If an onboard alert was just triggered, its downlink packet is currently in transit across deep space.)
              </p>
            ) : (
              <div className="space-y-2">
                {groundSnapshot.alerts.map((a) => {
                  const st = STATUS_DISPLAY[severityToStatus(a.severity)];
                  return (
                    <div
                      key={a.id}
                      className="rounded-lg border border-slate-800 bg-space-950 p-3 text-xs space-y-1"
                    >
                      <div className="flex items-center justify-between">
                        <span className={`rounded border px-2 py-0.5 font-bold ${st.badgeClass}`}>
                          {st.label} · {a.rule_id}
                        </span>
                        <span className="font-mono text-slate-400">
                          Raised {a.raised_ts.slice(11, 19)} UTC
                        </span>
                      </div>
                      <div className="font-bold text-slate-100">{a.title}</div>
                      <div className="font-mono text-slate-300">
                        Evidence: {a.evidence.signal} = {a.evidence.value} {a.evidence.unit ?? ''} (Limit{' '}
                        {a.evidence.limit} · {a.evidence.limit_verified ? '✓ verified' : '⚠ unverified'})
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Flight Surgeon Recommendation Uplink Form & Queue */}
        <div className="lg:col-span-5 space-y-4">
          <form
            onSubmit={handleSendRecommendation}
            className="rounded-2xl border border-slate-800 bg-space-900/95 p-5 space-y-3.5"
          >
            <div>
              <h2 className="text-base font-bold text-white">
                Send Flight Surgeon Recommendation (Ground → Crew Uplink)
              </h2>
              <p className="text-xs text-slate-400">
                Delivered to onboard Crew Overview after configured one-way delay ({lagFormatted}).
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <label className="block space-y-1 text-xs">
                <span className="text-slate-300 font-semibold">Target Crew</span>
                <select
                  value={targetCrew}
                  onChange={(e) => setTargetCrew(e.target.value as CrewId | 'ALL')}
                  className="min-h-[44px] w-full rounded-lg border border-slate-700 bg-space-950 px-3 py-2 text-xs text-slate-100"
                >
                  <option value="ALL">ALL CREW (C1–C4)</option>
                  {state.crew.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.id} · {c.role} ({c.name})
                    </option>
                  ))}
                </select>
              </label>

              <label className="block space-y-1 text-xs">
                <span className="text-slate-300 font-semibold">Priority Tier</span>
                <select
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as Severity)}
                  className="min-h-[44px] w-full rounded-lg border border-slate-700 bg-space-950 px-3 py-2 text-xs text-slate-100"
                >
                  <option value="INFO">INFO</option>
                  <option value="CAUTION">CAUTION</option>
                  <option value="WARNING">WARNING</option>
                  <option value="EMERGENCY">EMERGENCY</option>
                </select>
              </label>
            </div>

            <label className="block space-y-1 text-xs">
              <span className="text-slate-300 font-semibold">Recommendation Title</span>
              <input
                type="text"
                value={recTitle}
                onChange={(e) => setRecTitle(e.target.value)}
                className="min-h-[44px] w-full rounded-lg border border-slate-700 bg-space-950 px-3 py-2 text-xs text-slate-100"
              />
            </label>

            <label className="block space-y-1 text-xs">
              <span className="text-slate-300 font-semibold">
                Clinical Decision-Support Rationale
              </span>
              <textarea
                rows={2}
                value={recRationale}
                onChange={(e) => setRecRationale(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-space-950 px-3 py-2 text-xs text-slate-100"
              />
            </label>

            <label className="block space-y-1 text-xs">
              <span className="text-slate-300 font-semibold">
                Suggested Crew Checklist (one item per line)
              </span>
              <textarea
                rows={3}
                value={recChecklistText}
                onChange={(e) => setRecChecklistText(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-space-950 px-3 py-2 font-mono text-xs text-slate-100"
              />
            </label>

            <button
              type="submit"
              className="min-h-[44px] w-full rounded-xl bg-cyan-500 px-4 py-2.5 text-xs font-black uppercase tracking-wider text-slate-950 hover:bg-cyan-400"
            >
              📡 Transmit Uplink Recommendation (ETA +{formatDurationSeconds(sim.comm_delay_s)})
            </button>
          </form>

          {/* Uplink / Downlink Store-and-Forward Message Log */}
          <div className="rounded-xl border border-slate-800 bg-space-900/90 p-4 space-y-2.5">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">
              Uplink Recommendations Log ({recommendations.length})
            </h3>
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {recommendations.map((rec) => (
                <div
                  key={rec.id}
                  className="rounded-lg border border-slate-800 bg-space-950 p-3 text-xs space-y-1"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono font-bold text-cyan-300">
                      To: {rec.crew_id} · {rec.priority}
                    </span>
                    <span
                      className={`rounded px-2 py-0.5 text-[10px] font-mono font-bold ${
                        rec.delivered
                          ? 'bg-emerald-500/20 text-emerald-300'
                          : 'bg-amber-500/20 text-amber-200'
                      }`}
                    >
                      {rec.delivered
                        ? rec.acknowledged_onboard
                          ? '✓ DELIVERED & ACKED ONBOARD'
                          : '✓ DELIVERED TO CREW DECK'
                        : link.blackout
                        ? '⚡ QUEUED (BLACKOUT)'
                        : `⏳ IN TRANSIT (ETA ${formatDurationSeconds(rec.remaining_delay_s)})`}
                    </span>
                  </div>
                  <div className="font-bold text-slate-100">{rec.title}</div>
                  <div className="text-slate-400">{rec.rationale}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
