import React from 'react';
import { AlertItem, GravityEffect } from '../api/types';

/** Plain-language lines for the Gravity tile (P-5, model A linear). Decision support, not a diagnosis. */
export function gravityEffectLines(g: GravityEffect): string[] {
  const pct = Math.round(g.load_factor * 100);
  const lines: string[] = [];
  if (g.load_factor <= 0) {
    lines.push('Full gravity: no further bone or fitness loss from gravity (recovery is not modelled).');
  } else {
    lines.push(
      `Bone and fitness loss run at ${pct}% of the zero-g rate here (bone ~${g.bmd_loss_pct_month.toFixed(2)}%/month with exercise).`,
    );
  }
  const [sbp, dbp] = g.bp_offset_mmHg;
  if (sbp > 0 || dbp > 0) {
    lines.push(`Fluids shift back to the legs: blood pressure about +${sbp.toFixed(0)}/+${dbp.toFixed(0)} mmHg vs. zero g.`);
  }
  if (g.transition && g.transition.risk > 0) {
    const t = g.transition;
    lines.push(
      `After the change from ${t.from_g} g to ${t.to_g} g (${Math.round(t.days_at_low_g)} days at lower gravity): ` +
        `fainting risk when standing up ~${Math.round(t.risk * 100)}%. Stand up slowly, with someone nearby.`,
    );
  }
  return lines;
}

/** T-5: rules that judge standing up (the stand test and the existing orthostatic rule). */
export const STANDING_RULES = ['cardio.stand.early_stop', 'cardio.stand.positive', 'cardio.orthostatic'];

/** T-5 line for the Gravity tile: who has an open stand-test / standing alert, or when to take the test. */
export function standTestLine(g: GravityEffect | null | undefined, alerts: AlertItem[]): string | null {
  const open = alerts.filter((a) => STANDING_RULES.includes(a.rule_id) && a.crew_id);
  if (open.length) {
    const crew = [...new Set(open.map((a) => a.crew_id))].sort().join(', ');
    const stopped = open.some((a) => a.rule_id === 'cardio.stand.early_stop');
    return `Standing up: ${stopped ? 'stand test stopped early' : 'indicators on standing'} for ${crew}. Recommend CMO review; no ladders or long standing tasks.`;
  }
  if (g?.transition && g.transition.risk > 0) {
    return 'Take the 10-minute stand test (Self-tests) before standing work after this gravity change.';
  }
  return null;
}

export const GravityEffectNote: React.FC<{ gravity?: GravityEffect | null; alerts?: AlertItem[] }> = ({ gravity, alerts = [] }) => {
  if (!gravity) return null;
  const stand = standTestLine(gravity, alerts);
  return (
    <div className="mt-1.5 space-y-0.5" data-testid="gravity-effect">
      {gravityEffectLines(gravity).map((line) => (
        <p key={line} className="text-[11px] leading-snug text-slate-300">
          {line}
        </p>
      ))}
      {stand && (
        <p className="text-[11px] font-semibold leading-snug text-amber-200" data-testid="gravity-stand-test">
          ▲ {stand}
        </p>
      )}
      <p className="text-[10px] text-slate-500" title={gravity.basis}>
        ◇ Simulated (linear gravity model; sources: Ellman 2013, Norsk 2015, Meck 2001)
      </p>
    </div>
  );
};
