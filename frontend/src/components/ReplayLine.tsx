import React from 'react';
import { RadReplayInfo } from '../api/types';

function utcMinute(iso: string): string {
  return `${iso.slice(0, 16).replace('T', ' ')} UTC`;
}

/** Which measurement is playing right now, and how it maps onto mission time (AGENTS.md §2a). */
export const ReplayLine: React.FC<{ replay?: RadReplayInfo | null }> = ({ replay }) => {
  if (!replay) {
    return (
      <p className="text-xs text-slate-400" data-testid="rad-replay-line">
        Radiation source: synthetic background (no measured replay active for this mission phase).
      </p>
    );
  }
  const speed = replay.compression === 1 ? 'replayed in real time' : `replayed ×${replay.compression}`;
  // Older payloads (Block R) carry no instrument: they were always MSL/RAD.
  const instrument = replay.instrument ?? 'Curiosity RAD tissue dose rate';
  const nonNasa = replay.agency !== undefined && replay.agency !== 'NASA';
  const formula =
    replay.measures === 'equivalent'
      ? `Absorbed dose = dose equivalent ÷ Q ${replay.quality_factor}.`
      : `Dose equivalent = measured dose × Q ${replay.quality_factor}.`;
  return (
    <p className="flex flex-wrap items-center gap-2 text-xs text-sky-100" data-testid="rad-replay-line">
      <span className="rounded border border-sky-400/60 bg-sky-950/60 px-2 py-0.5 font-bold">◆ {replay.label}</span>
      <span>
        {instrument}, measurement from {utcMinute(replay.observation_ts)}, {speed}. {formula}
      </span>
      {nonNasa && (
        <span
          className="rounded border border-amber-300/60 bg-amber-950/50 px-2 py-0.5 font-semibold text-amber-100"
          data-testid="rad-replay-agency"
        >
          ▣ Measured by {replay.agency}, not NASA
        </span>
      )}
      {replay.saa === true && (
        <span
          className="rounded border border-violet-300/60 bg-violet-950/50 px-2 py-0.5 font-semibold text-violet-100"
          data-testid="rad-replay-saa"
        >
          ◇ Crossing the South Atlantic Anomaly: short dose spike, not a solar event. The shelter alarm stands down.
        </span>
      )}
      {replay.quality === 'SUSPECT' && (
        <span
          className="rounded border border-amber-300/60 bg-amber-950/50 px-2 py-0.5 font-semibold text-amber-100"
          data-testid="rad-replay-held"
        >
          ▲ data gap: holding last good value
        </span>
      )}
      {replay.donki_id && (
        <span className="rounded border border-red-400/60 bg-red-950/60 px-2 py-0.5 font-mono font-semibold text-red-100">
          SPE {replay.event_date} · DONKI {replay.donki_id}
        </span>
      )}
      {replay.synthetic_spe_overlay && (
        <span className="rounded border border-slate-500 bg-slate-800/70 px-2 py-0.5 font-semibold text-slate-100">
          · SPE profile is synthetic (real MSL/RAD SPE replay inactive)
        </span>
      )}
    </p>
  );
};
