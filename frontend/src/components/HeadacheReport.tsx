import React, { useState } from 'react';
import { CrewId } from '../api/types';
import { useAegis } from '../api/useLiveSocket';

const LEVELS = [
  { value: 0, label: 'None' },
  { value: 1, label: 'Mild' },
  { value: 2, label: 'Moderate' },
  { value: 3, label: 'Severe' },
];

/**
 * Quick headache self-report (0-3) sent as a symptom_headache observation. Together with heart rate
 * and cabin CO2 it feeds the context-branching rules (CO2 effect vs low fluid intake).
 */
export const HeadacheReport: React.FC<{ crewId: CrewId }> = ({ crewId }) => {
  const { state, reportHeadache } = useAegis();
  const [last, setLast] = useState<{ level: number; ok: boolean } | null>(null);
  const connected = state.sim.backend_connected;

  const send = async (level: number): Promise<void> => {
    const ok = await reportHeadache(crewId, level);
    setLast({ level, ok });
  };

  return (
    <div className="rounded-xl border border-slate-800 bg-space-900/90 p-4 space-y-2" data-testid="headache-report">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-100">Headache right now? ({crewId})</h3>
        {last && (
          <span className={`text-xs font-mono ${last.ok ? 'text-emerald-300' : 'text-amber-300'}`}>
            {last.ok ? `✓ Logged: ${LEVELS[last.level].label}` : '▲ Not logged (onboard server not reachable)'}
          </span>
        )}
      </div>
      <div className="grid grid-cols-4 gap-2">
        {LEVELS.map((l) => (
          <button
            key={l.value}
            type="button"
            disabled={!connected}
            onClick={() => void send(l.value)}
            className="min-h-[44px] rounded-lg border border-slate-700 bg-space-950 px-2 py-2 text-xs font-bold text-slate-100 hover:bg-space-800 disabled:opacity-40"
          >
            {l.value} · {l.label}
          </button>
        ))}
      </div>
      <p className="text-[11px] text-slate-400">
        AEGIS compares a headache with heart rate and cabin CO₂ to suggest a likely cause. It does not diagnose.
      </p>
    </div>
  );
};
