import React from 'react';
import { formatDurationSeconds } from '../api/client';
import { MissionPhaseName, ScenarioName } from '../api/types';
import { useAegis } from '../api/useLiveSocket';

const SCENARIO_BUTTONS: Array<{
  id: ScenarioName;
  label: string;
  badge: string;
  style: string;
}> = [
  {
    id: 'demo_5min',
    label: '▶ Play 5-Min Scripted Demo',
    badge: 'PRD §14',
    style: 'border-cyan-400/70 bg-cyan-500/20 text-cyan-100 hover:bg-cyan-500/30',
  },
  {
    id: 'spe_event',
    label: '✖ Solar Particle Event (SPE)',
    badge: 'EMERGENCY',
    style: 'border-red-500/70 bg-red-500/20 text-red-100 hover:bg-red-500/30',
  },
  {
    id: 'co2_scrubber_degradation',
    label: '▲ CO₂ Scrubber Fault',
    badge: 'CAUTION',
    style: 'border-amber-400/60 bg-amber-500/15 text-amber-100 hover:bg-amber-500/25',
  },
  {
    id: 'insomnia_streak',
    label: '▲ Insomnia + Cognitive Risk',
    badge: 'COMPOUND',
    style: 'border-amber-400/60 bg-amber-500/15 text-amber-100 hover:bg-amber-500/25',
  },
  {
    id: 'orthostatic_intolerance',
    label: '■ Landing Orthostatic Drop',
    badge: 'WARNING',
    style: 'border-orange-400/60 bg-orange-500/15 text-orange-100 hover:bg-orange-500/25',
  },
];

const SPEED_OPTIONS = [1, 10, 60, 100, 1000, 10000];

const PHASE_OPTIONS: MissionPhaseName[] = [
  'LEO',
  'LUNAR_SURFACE',
  'MARS_TRANSIT',
  'MARS_SURFACE',
  'POST_LANDING',
];

export const ScenarioDock: React.FC = () => {
  const {
    state,
    triggerScenario,
    resetNominal,
    setSimSpeed,
    toggleSimRunning,
    setMissionPhase,
    setSeed,
    toggleLinkBlackout,
  } = useAegis();

  const { sim, link } = state;

  return (
    <section
      aria-label="Simulation & Scenario Presenter Dock"
      data-testid="scenario-dock"
      className="rounded-xl border border-slate-800 bg-space-900/95 px-4 py-3 shadow-lg"
    >
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3">
        {/* Scenario Trigger Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-400 mr-1">
            Scenario Dock:
          </span>
          {SCENARIO_BUTTONS.map((btn) => {
            const isActive = sim.active_scenario === btn.id;
            return (
              <button
                key={btn.id}
                type="button"
                onClick={() => triggerScenario(btn.id)}
                className={`min-h-[44px] inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-all ${
                  btn.style
                } ${isActive ? 'ring-2 ring-white/80' : ''}`}
              >
                <span>{btn.label}</span>
                <span className="rounded bg-black/40 px-1.5 py-0.5 text-[10px] font-mono">
                  {btn.badge}
                </span>
              </button>
            );
          })}

          <button
            type="button"
            onClick={resetNominal}
            className="min-h-[44px] rounded-lg border border-slate-700 bg-space-800 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:bg-space-700"
          >
            ↺ Reset Nominal
          </button>
        </div>

        {/* Playback Speed, Phase, Seed, and Comm Link Blackout Controls */}
        <div className="flex flex-wrap items-center gap-2.5 text-xs">
          <button
            type="button"
            onClick={toggleSimRunning}
            className="min-h-[44px] min-w-[84px] rounded-lg border border-slate-700 bg-space-800 px-3 py-1.5 font-bold text-slate-100 hover:bg-space-700"
          >
            {sim.running ? '⏸ Pause' : '▶ Resume'}
          </button>

          <div className="flex items-center rounded-lg border border-slate-700 bg-space-950 p-1">
            <span className="px-2 text-[11px] text-slate-400">Speed:</span>
            {SPEED_OPTIONS.map((spd) => (
              <button
                key={spd}
                type="button"
                onClick={() => setSimSpeed(spd)}
                className={`min-h-[34px] rounded px-2 py-1 text-xs font-mono font-semibold transition-colors ${
                  sim.speed === spd
                    ? 'bg-cyan-500 text-slate-950'
                    : 'text-slate-300 hover:bg-space-800'
                }`}
              >
                {spd >= 1000 ? `${spd / 1000}k×` : `${spd}×`}
              </button>
            ))}
          </div>

          <label className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-space-950 px-2.5 py-1.5 min-h-[44px]">
            <span className="text-[11px] text-slate-400">Phase:</span>
            <select
              aria-label="Mission Phase"
              value={sim.phase}
              onChange={(e) => setMissionPhase(e.target.value as MissionPhaseName)}
              className="bg-transparent font-mono text-xs font-semibold text-slate-100 focus:outline-none"
            >
              {PHASE_OPTIONS.map((ph) => (
                <option key={ph} value={ph} className="bg-space-900 text-slate-100">
                  {ph}
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-space-950 px-2.5 py-1.5 min-h-[44px]">
            <span className="text-[11px] text-slate-400">Seed:</span>
            <input
              aria-label="Deterministic RNG Seed"
              type="number"
              value={sim.seed}
              onChange={(e) => setSeed(Number(e.target.value) || 42)}
              className="w-14 bg-transparent font-mono text-xs font-bold text-cyan-300 focus:outline-none"
            />
          </label>

          <button
            type="button"
            onClick={toggleLinkBlackout}
            className={`min-h-[44px] rounded-lg border px-3 py-1.5 text-xs font-bold uppercase tracking-wide transition-all ${
              link.blackout
                ? 'border-red-400 bg-red-600/30 text-red-100'
                : 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25'
            }`}
          >
            {link.blackout
              ? '⚡ Link Blackout: ON (Autonomous)'
              : `📡 Link Delay: ${formatDurationSeconds(sim.comm_delay_s)}`}
          </button>
        </div>
      </div>

      {sim.demo_segment_label && (
        <div className="mt-2.5 flex items-center justify-between rounded-lg border border-cyan-500/40 bg-cyan-950/30 px-3 py-1.5 text-xs text-cyan-200">
          <span className="font-semibold">{sim.demo_segment_label}</span>
          <span className="font-mono text-[11px] text-cyan-300">
            12m Mars comm delay elapses in ~12s at 60× speed
          </span>
        </div>
      )}
    </section>
  );
};
