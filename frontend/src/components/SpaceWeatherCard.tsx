import React, { useState } from 'react';
import { formatDurationSeconds } from '../api/client';
import { RadReplayInfo, SpaceWeatherEvent } from '../api/types';
import { DataSourceBadge } from './DataSourceBadge';
import { LimitBadge } from './LimitBadge';

/** "2012-03-07T00:24Z" -> "03-07 00:24 UTC". */
function shortUtc(ts: string | null | undefined): string {
  if (!ts || ts.length < 16) return 'time unknown';
  return `${ts.slice(5, 10)} ${ts.slice(11, 16)} UTC`;
}

const W = 760;
const H = 170;
const PAD = { l: 44, r: 30, t: 10, b: 22 };

/** Hourly >10 MeV flux on a log axis with the NOAA S-levels from limits.yaml (unverified, not NASA limits). */
const FluxChart: React.FC<{ event: SpaceWeatherEvent; markerTs: string | null }> = ({ event, markerTs }) => {
  const flux = event.flux;
  if (!flux) return null;
  const pts = flux.points.filter((p): p is [string, number] => p[1] !== null && p[1] > 0);
  if (pts.length < 2) return null;
  const t0 = Date.parse(pts[0][0]);
  const t1 = Date.parse(pts[pts.length - 1][0]);
  const lo = -1; // 0.1 pfu
  const hi = 5; // 1e5 pfu
  const x = (ts: string) => PAD.l + ((Date.parse(ts) - t0) / (t1 - t0)) * (W - PAD.l - PAD.r);
  const y = (v: number) => PAD.t + (1 - (Math.log10(v) - lo) / (hi - lo)) * (H - PAD.t - PAD.b);
  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join(' ');
  const markerMs = markerTs ? Date.parse(markerTs) : NaN;
  const showMarker = Number.isFinite(markerMs) && markerMs >= t0 && markerMs <= t1;
  const days = [];
  for (let d = Math.ceil(t0 / 86400000) * 86400000; d <= t1; d += 86400000) days.push(d);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full h-auto max-w-3xl"
      role="img"
      aria-label={`${flux.label}, peak ${Math.round(flux.peak_pfu ?? 0)} pfu`}
      data-testid="spaceweather-flux-chart"
    >
      {event.s_scale.slice(0, 4).map((s) => (
        <g key={s.level}>
          <line x1={PAD.l} x2={W - PAD.r} y1={y(s.value)} y2={y(s.value)} stroke="#f59e0b" strokeOpacity={0.35} strokeDasharray="4 4" />
          <text x={W - PAD.r + 4} y={y(s.value) + 3} fontSize={10} fill="#fbbf24">
            {s.level}
          </text>
        </g>
      ))}
      {[0.1, 1, 10, 100, 1000, 10000].map((v) => (
        <text key={v} x={PAD.l - 6} y={y(v) + 3} fontSize={9} fill="#94a3b8" textAnchor="end">
          {v >= 1 ? v.toLocaleString('en-US') : v}
        </text>
      ))}
      {days.map((d) => (
        <text key={d} x={PAD.l + ((d - t0) / (t1 - t0)) * (W - PAD.l - PAD.r)} y={H - 6} fontSize={9} fill="#94a3b8" textAnchor="middle">
          {new Date(d).toISOString().slice(5, 10)}
        </text>
      ))}
      <path d={path} fill="none" stroke="#38bdf8" strokeWidth={1.8} />
      {showMarker && (
        <g data-testid="spaceweather-replay-marker">
          <line
            x1={x(new Date(markerMs).toISOString())}
            x2={x(new Date(markerMs).toISOString())}
            y1={PAD.t}
            y2={H - PAD.b}
            stroke="#f472b6"
            strokeWidth={1.5}
          />
          <text x={x(new Date(markerMs).toISOString()) + 4} y={PAD.t + 10} fontSize={10} fill="#f9a8d4">
            onboard replay now
          </text>
        </g>
      )}
    </svg>
  );
};

export interface SpaceWeatherCardProps {
  event: SpaceWeatherEvent | null;
  connected: boolean;
  /** RAD replay info from the delayed ground snapshot; marks where the onboard SPE replay is on the timeline. */
  replay?: RadReplayInfo | null;
  delaySeconds: number;
  blackout: boolean;
  onForward: () => Promise<boolean>;
}

/** Ground console space-weather card (R-5). Data are bundled NASA records; nothing is fetched from the internet. */
export const SpaceWeatherCard: React.FC<SpaceWeatherCardProps> = ({
  event,
  connected,
  replay,
  delaySeconds,
  blackout,
  onForward,
}) => {
  const [sent, setSent] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle');

  if (!connected || !event) {
    return (
      <div className="rounded-xl border border-slate-800 bg-space-900/90 p-4 text-xs text-slate-300" data-testid="spaceweather-card">
        <h3 className="text-sm font-bold uppercase tracking-wider text-slate-300">Space weather</h3>
        <p className="mt-1">
          The space-weather record (bundled NASA DONKI + OMNI2 data) comes from the AEGIS backend. It is not
          available in browser-only mode.
        </p>
      </div>
    );
  }

  const p = event.primary;
  const flux = event.flux;
  const peakLevel = flux?.peak_level ? event.s_scale.find((s) => s.level === flux.peak_level) : undefined;
  const fluxSource = {
    provenance: event.provenance,
    dataset_id: event.sources.flux?.id ?? null,
    basis: 'Hourly OMNI2 >10 MeV integral proton flux near Earth (GOES-sourced), replayed from the bundled file.',
    dataset: event.sources.flux ?? null,
  };
  const eventsSource = {
    provenance: event.provenance,
    dataset_id: event.sources.events?.id ?? null,
    basis: 'NASA CCMC DONKI flare and CME records for the event window.',
    dataset: event.sources.events ?? null,
  };
  const replayIsEvent = Boolean(replay?.donki_id);

  const forward = async () => {
    setSent('sending');
    setSent((await onForward()) ? 'sent' : 'failed');
  };

  return (
    <div className="rounded-xl border border-sky-700/60 bg-space-900/90 p-4 space-y-3" data-testid="spaceweather-card">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-bold uppercase tracking-wider text-sky-200">
            Space weather · {event.title || `event of ${event.event_date}`}
          </h3>
          <p className="text-[11px] text-slate-400">
            Real records from NASA DONKI and OMNIWeb, bundled with AEGIS. Measured near Earth; the crew&apos;s own RAD
            replay is the onboard measurement.
          </p>
        </div>
        <DataSourceBadge source={eventsSource} compact />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
        <div className="rounded-lg border border-slate-800 bg-space-950 p-2.5" data-testid="spaceweather-flare">
          <div className="text-slate-400">Solar flare</div>
          {p?.flare ? (
            <div className="font-mono text-slate-100">
              <strong className="text-amber-200">{p.flare.class}</strong> peak {shortUtc(p.flare.peak)}
              <div className="text-slate-400">
                {p.flare.location ?? ''} {p.flare.region ? `· AR ${p.flare.region}` : ''}
              </div>
            </div>
          ) : (
            <div className="text-slate-500">No linked flare record</div>
          )}
        </div>
        <div className="rounded-lg border border-slate-800 bg-space-950 p-2.5" data-testid="spaceweather-cme">
          <div className="text-slate-400">Coronal mass ejection</div>
          {p?.cme ? (
            <div className="font-mono text-slate-100">
              <strong className="text-amber-200">{Math.round(p.cme.speed_km_s ?? 0)} km/s</strong> from{' '}
              {shortUtc(p.cme.start)}
              <div className="text-slate-400">
                type {p.cme.type ?? '?'} · half-angle {p.cme.half_angle_deg ?? '?'}°
              </div>
            </div>
          ) : (
            <div className="text-slate-500">No linked CME record</div>
          )}
        </div>
        <div className="rounded-lg border border-slate-800 bg-space-950 p-2.5" data-testid="spaceweather-sep">
          <div className="text-slate-400">Particle event (SEP) onset</div>
          {p?.sep ? (
            <div className="font-mono text-slate-100">
              {shortUtc(p.sep.time)}
              <div className="text-slate-400 break-all">DONKI {p.sep.id}</div>
            </div>
          ) : (
            <div className="text-slate-500">No SEP record</div>
          )}
        </div>
      </div>

      {flux && (
        <div className="space-y-1">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="text-slate-300">
              {flux.label}: peak <strong className="font-mono text-white">{Math.round(flux.peak_pfu ?? 0)} pfu</strong>{' '}
              at {shortUtc(flux.peak_utc)}
              {peakLevel && (
                <>
                  {' '}
                  (NOAA level <strong className="text-amber-200">{peakLevel.level}</strong>, a NOAA scale, not a NASA
                  limit <LimitBadge
                    limit={{ key: peakLevel.ref, label: `NOAA ${peakLevel.level}`, unit: 'pfu', ...peakLevel }}
                  />)
                </>
              )}
            </span>
            <DataSourceBadge source={fluxSource} compact />
          </div>
          <FluxChart event={event} markerTs={replayIsEvent ? replay?.dataset_ts ?? null : null} />
          {replayIsEvent && replay && (
            <p className="text-[11px] text-pink-200" data-testid="spaceweather-replay-line">
              Onboard is replaying the MSL/RAD measurement of this event (×{replay.compression}); the pink line is the
              replayed time as of the last delivered snapshot.
            </p>
          )}
        </div>
      )}

      {event.problems.length > 0 && (
        <p className="text-[11px] text-amber-300">▲ Missing part of the record: {event.problems.join('; ')}</p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void forward()}
          disabled={sent === 'sending'}
          data-testid="spaceweather-forward-btn"
          className="min-h-[44px] rounded-xl bg-sky-500 px-4 py-2 text-xs font-black uppercase tracking-wider text-slate-950 hover:bg-sky-400 disabled:opacity-60"
        >
          📡 Forward space-weather brief to crew (ETA +{formatDurationSeconds(delaySeconds)})
        </button>
        {sent === 'sent' && (
          <span className="text-xs text-emerald-300" data-testid="spaceweather-forward-status">
            ✓ Queued on the uplink{blackout ? ' (link blackout: waits for the link)' : ''}. It reaches the crew after the
            light-time delay.
          </span>
        )}
        {sent === 'failed' && <span className="text-xs text-red-300">✖ Not sent. Check the backend connection.</span>}
      </div>
    </div>
  );
};
