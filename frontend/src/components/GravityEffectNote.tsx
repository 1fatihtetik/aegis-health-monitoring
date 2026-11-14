import React from 'react';
import { GravityEffect } from '../api/types';

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

export const GravityEffectNote: React.FC<{ gravity?: GravityEffect | null }> = ({ gravity }) => {
  if (!gravity) return null;
  return (
    <div className="mt-1.5 space-y-0.5" data-testid="gravity-effect">
      {gravityEffectLines(gravity).map((line) => (
        <p key={line} className="text-[11px] leading-snug text-slate-300">
          {line}
        </p>
      ))}
      <p className="text-[10px] text-slate-500" title={gravity.basis}>
        ◇ Synthetic (linear gravity model; sources: Ellman 2013, Norsk 2015, Meck 2001)
      </p>
    </div>
  );
};
