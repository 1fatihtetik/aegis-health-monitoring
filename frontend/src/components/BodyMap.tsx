import React, { useEffect, useState } from 'react';
import { backendApi, signalLabel } from '../api/backend';
import { RegionStatus, regionStatus, regionStatusText } from '../api/bodymap';
import {
  AlertItem,
  BodyRegion,
  CrewId,
  HAZARD_CATALOG,
  HRP_RISK_CATALOG,
  STATUS_DISPLAY,
  Severity,
  severityToStatus,
} from '../api/types';
import { useAegis } from '../api/useLiveSocket';
import { DataSourceBadge } from './DataSourceBadge';
import { Inspiration4ReferencePanel } from './Inspiration4Panel';
import { SeveritySublabel } from './SeveritySublabel';
import { Sparkline } from './Sparkline';

const CREW: CrewId[] = ['C1', 'C2', 'C3', 'C4'];
const round1 = (v: number): number => Number(v.toFixed(1));

/** Fill per status. Colour is never alone: every region also shows its icon and text. */
const FILL: Record<Severity | 'NONE', string> = {
  NONE: '#10b981',
  INFO: '#38bdf8',
  CAUTION: '#f59e0b',
  WARNING: '#f97316',
  EMERGENCY: '#ef4444',
};

/** Drawing of each configured region (presentation only; the links come from config). x/y = where the icon sits. */
const SHAPES: Record<string, { x: number; y: number; draw: React.ReactNode }> = {
  brain_eyes: {
    x: 100,
    y: 40,
    draw: <ellipse cx={100} cy={44} rx={28} ry={32} />,
  },
  lungs: {
    x: 76,
    y: 138,
    draw: (
      <>
        <path d="M92 104 C70 104 62 130 62 158 C62 172 72 178 84 174 L92 170 Z" />
        <path d="M108 104 C130 104 138 130 138 158 C138 172 128 178 116 174 L108 170 Z" />
      </>
    ),
  },
  heart_vessels: {
    x: 112,
    y: 146,
    draw: <path d="M112 162 C96 150 96 136 106 134 C110 133 112 136 112 138 C112 136 114 133 118 134 C128 136 128 150 112 162 Z" />,
  },
  blood_immune: {
    x: 100,
    y: 198,
    draw: <ellipse cx={100} cy={198} rx={30} ry={14} />,
  },
  kidneys: {
    x: 100,
    y: 232,
    draw: (
      <>
        <ellipse cx={82} cy={232} rx={9} ry={14} />
        <ellipse cx={118} cy={232} rx={9} ry={14} />
      </>
    ),
  },
  bones_muscles: {
    x: 100,
    y: 330,
    draw: (
      <>
        <rect x={34} y={100} width={18} height={130} rx={9} />
        <rect x={148} y={100} width={18} height={130} rx={9} />
        <rect x={72} y={270} width={22} height={130} rx={10} />
        <rect x={106} y={270} width={22} height={130} rx={10} />
      </>
    ),
  },
};

function statusMeta(severity: Severity | null): { icon: string; word: string } {
  if (!severity) return { icon: '✓', word: 'Nominal' };
  if (severity === 'INFO') return { icon: 'ℹ', word: 'Note' };
  return { icon: STATUS_DISPLAY[severityToStatus(severity)].symbol, word: severity };
}

const StatusChip: React.FC<{ severity: Severity | null }> = ({ severity }) => {
  const { icon, word } = statusMeta(severity);
  return (
    <span className="inline-flex items-center gap-1 text-xs font-bold text-slate-100">
      <span
        aria-hidden="true"
        className="inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] text-slate-950"
        style={{ backgroundColor: FILL[severity ?? 'NONE'] }}
      >
        {icon}
      </span>
      {word}
      {severity && <SeveritySublabel severity={severity} />}
    </span>
  );
};

/** The figure. Shapes are a picture aid (pointer only); the region buttons beside it are the touch/keyboard targets. */
const Figure: React.FC<{
  regions: BodyRegion[];
  statuses: Record<string, RegionStatus>;
  selected: string | null;
  onSelect: (id: string) => void;
}> = ({ regions, statuses, selected, onSelect }) => (
  <svg viewBox="0 0 200 410" className="h-[360px] w-auto shrink-0" role="img" aria-label="Body map figure" data-testid="bodymap-figure">
    {/* silhouette */}
    <path
      d="M100 78 C84 78 82 90 82 94 L56 98 C44 100 34 106 34 118 L34 230 L52 230 L56 124 L64 124 L66 262 L72 262 L72 400 L94 400 L98 272 L102 272 L106 400 L128 400 L128 262 L134 262 L136 124 L144 124 L148 230 L166 230 L166 118 C166 106 156 100 144 98 L118 94 C118 90 116 78 100 78 Z"
      fill="currentColor"
      className="text-slate-700/40"
    />
    {regions.map((r) => {
      const shape = SHAPES[r.id];
      if (!shape) return null;
      const sev = statuses[r.id]?.severity ?? null;
      return (
        <g
          key={r.id}
          data-testid={`bodymap-shape-${r.id}`}
          data-severity={sev ?? 'NONE'}
          onClick={() => onSelect(r.id)}
          className="cursor-pointer"
          fill={FILL[sev ?? 'NONE']}
          fillOpacity={selected === r.id ? 0.95 : 0.6}
          stroke={selected === r.id ? '#e2e8f0' : '#0f172a'}
          strokeWidth={selected === r.id ? 3 : 1.5}
        >
          <title>{r.label}</title>
          {shape.draw}
          <text x={shape.x} y={shape.y + 5} textAnchor="middle" fontSize={14} fontWeight={900} fill="#0f172a" stroke="none">
            {statusMeta(sev).icon}
          </text>
        </g>
      );
    })}
  </svg>
);

const RegionDrawer: React.FC<{
  region: BodyRegion;
  status: RegionStatus;
  crewId: CrewId;
  onStartTest?: (crewId: CrewId, testId: string) => void;
  onClose: () => void;
}> = ({ region, status, crewId, onStartTest, onClose }) => (
  <section
    className="flex-1 space-y-3 rounded-xl border border-slate-700 bg-space-950/80 p-4"
    data-testid={`bodymap-drawer-${region.id}`}
    aria-label={`${region.label} details`}
  >
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="space-y-1">
        <h4 className="text-base font-black text-white">
          {region.label} · {crewId}
        </h4>
        <StatusChip severity={status.severity} />
      </div>
      <button
        type="button"
        onClick={onClose}
        className="min-h-[44px] rounded-lg border border-slate-600 bg-space-900 px-3 text-sm font-bold text-slate-100"
      >
        Close
      </button>
    </div>
    <p className="text-sm text-slate-200" data-testid="bodymap-status-text">
      {regionStatusText(region, status)}
    </p>
    <p className="text-xs text-slate-400">{region.what}</p>

    {status.alerts.length > 0 && (
      <ul className="space-y-1" data-testid="bodymap-alerts">
        {status.alerts.map((a: AlertItem) => (
          <li key={a.id} className="flex flex-wrap items-center gap-2 text-xs text-slate-100">
            <StatusChip severity={a.severity} />
            <span>{a.title}</span>
            {a.crew_id === null && <span className="text-slate-400">(cabin, whole crew)</span>}
          </li>
        ))}
      </ul>
    )}

    <div>
      <h5 className="mb-1 text-xs font-bold uppercase tracking-wide text-slate-400">Linked readings</h5>
      <ul className="grid gap-2 sm:grid-cols-2" data-testid="bodymap-signals">
        {region.signals.map((s) => (
          <li key={s.signal} className="space-y-1 rounded-lg border border-slate-800 bg-space-900/80 p-2">
            {s.latest && s.recent.length > 1 ? (
              <Sparkline data={s.recent} label={signalLabel(s.signal)} unit={s.unit} currentValue={round1(s.latest.value)} />
            ) : (
              <p className="text-xs text-slate-200">
                <span className="text-slate-400">{signalLabel(s.signal)}:</span>{' '}
                {s.latest ? (
                  <strong>
                    {round1(s.latest.value)} {s.unit}
                  </strong>
                ) : (
                  <span className="text-slate-500">no reading yet</span>
                )}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-1">
              {s.latest && <DataSourceBadge compact source={s.source} />}
              {s.scope === 'cabin' && <span className="text-[11px] text-slate-400">cabin</span>}
              {s.onboard_only && <span className="text-[11px] text-violet-200">🔒 stays on board</span>}
            </div>
          </li>
        ))}
      </ul>
    </div>

    <p className="text-[11px] text-slate-400">
      {region.hazards.map((h) => `[${HAZARD_CATALOG[h].letter}] ${HAZARD_CATALOG[h].shortName}`).join(' · ')} ·{' '}
      {region.hrp_risks.map((r) => `${r} ${HRP_RISK_CATALOG[r]?.name ?? ''}`.trim()).join(' · ')}
    </p>

    {region.tests.length > 0 && (
      <div>
        <h5 className="mb-1 text-xs font-bold uppercase tracking-wide text-slate-400">Self-tests for this region</h5>
        <div className="flex flex-wrap gap-2">
          {region.tests.map((t) =>
            onStartTest ? (
              <button
                key={t.id}
                type="button"
                data-testid={`bodymap-start-${t.id}`}
                onClick={() => onStartTest(crewId, t.id)}
                className="min-h-[44px] rounded-lg bg-cyan-500 px-3 text-sm font-bold text-slate-950 hover:bg-cyan-400"
              >
                Start: {t.title}
              </button>
            ) : (
              <span key={t.id} className="rounded-lg border border-slate-700 px-2 py-1 text-xs text-slate-200">
                {t.title}
              </span>
            ),
          )}
        </div>
      </div>
    )}

    {region.reference === 'inspiration4' && <Inspiration4ReferencePanel titleId={`i4-title-bodymap-${crewId}`} />}
  </section>
);

/**
 * T-6 clickable body map. Region colour + icon + text = the highest open alert severity among the rules linked to
 * that region in config (this crew member plus cabin-wide alerts). The map shows indicators and never diagnoses.
 * Loads the region links from the onboard server; it never needs the Earth link.
 */
export const BodyMap: React.FC<{
  crewId: CrewId;
  onCrewChange?: (id: CrewId) => void;
  onStartTest?: (crewId: CrewId, testId: string) => void;
  /** Test hook: regions given directly instead of loading them. */
  initialRegions?: BodyRegion[];
}> = ({ crewId, onCrewChange, onStartTest, initialRegions }) => {
  const { state } = useAegis();
  const connected = state.sim.backend_connected;
  const [regions, setRegions] = useState<BodyRegion[] | null>(initialRegions ?? null);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    if (initialRegions || !connected) return;
    let live = true;
    const load = (): void => {
      void backendApi.bodyMap(crewId).then((r) => {
        if (live && r) setRegions(r);
      });
    };
    load();
    const id = window.setInterval(load, 5000); // readings follow the simulation clock
    return () => {
      live = false;
      window.clearInterval(id);
    };
  }, [connected, crewId, initialRegions]);

  const statuses: Record<string, RegionStatus> = Object.fromEntries(
    (regions ?? []).map((r) => [r.id, regionStatus(r, state.alerts, crewId)]),
  );
  const open = regions?.find((r) => r.id === selected) ?? null;

  return (
    <section className="space-y-3 rounded-2xl border border-slate-800 bg-space-900/90 p-4" data-testid="bodymap" aria-label="Body map">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-300">Body map · {crewId}</h3>
          <p className="text-xs text-slate-400">
            Tap a region to see its readings, alerts and self-tests. Colour, icon and text show the highest open alert.
            Indicators only, not a diagnosis.
          </p>
        </div>
        {onCrewChange && (
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Crew member for the body map">
            {CREW.map((id) => (
              <button
                key={id}
                type="button"
                aria-pressed={crewId === id}
                onClick={() => onCrewChange(id)}
                className={`min-h-[44px] min-w-[52px] rounded-xl px-3 text-sm font-bold ${
                  crewId === id ? 'bg-cyan-500 text-slate-950' : 'border border-slate-700 bg-space-950 text-slate-200'
                }`}
              >
                {id}
              </button>
            ))}
          </div>
        )}
      </div>

      {!regions ? (
        <p className="rounded-lg border border-amber-500/50 bg-amber-950/30 p-3 text-sm text-amber-100" data-testid="bodymap-unavailable">
          ▲ The body map loads from the onboard server, which is not reachable right now. It never needs the Earth link.
        </p>
      ) : (
        <div className="flex flex-col gap-4 lg:flex-row">
          <div className="flex gap-3">
            <Figure regions={regions} statuses={statuses} selected={selected} onSelect={setSelected} />
            <ul className="flex flex-col gap-2" aria-label="Body regions">
              {regions.map((r) => {
                const sev = statuses[r.id]?.severity ?? null;
                const { icon, word } = statusMeta(sev);
                return (
                  <li key={r.id}>
                    <button
                      type="button"
                      data-testid={`bodymap-region-${r.id}`}
                      aria-pressed={selected === r.id}
                      aria-label={`${r.label}: ${word}`}
                      onClick={() => setSelected(selected === r.id ? null : r.id)}
                      className={`flex min-h-[48px] w-full min-w-[180px] items-center gap-2 rounded-xl border px-3 text-left text-sm font-bold text-slate-100 ${
                        selected === r.id ? 'border-cyan-300 bg-space-800' : 'border-slate-700 bg-space-950'
                      }`}
                    >
                      <span
                        aria-hidden="true"
                        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-black text-slate-950"
                        style={{ backgroundColor: FILL[sev ?? 'NONE'] }}
                      >
                        {icon}
                      </span>
                      <span className="flex-1">{r.label}</span>
                      <span className="text-[11px] font-semibold text-slate-300">{word}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
          {open ? (
            <RegionDrawer
              region={open}
              status={statuses[open.id]}
              crewId={crewId}
              onStartTest={onStartTest}
              onClose={() => setSelected(null)}
            />
          ) : (
            <p className="flex-1 self-center text-sm text-slate-400">Pick a region to see what it does and what is linked to it.</p>
          )}
        </div>
      )}
    </section>
  );
};
