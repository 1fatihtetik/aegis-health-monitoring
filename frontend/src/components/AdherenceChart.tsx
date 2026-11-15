import React, { useEffect, useState } from 'react';
import { formatDurationSeconds } from '../api/client';
import { countermeasureApi, TYPE_LABEL } from '../api/countermeasures';
import { AdherencePerson, AdherenceResponse, CrewId } from '../api/types';
import { DataSourceBadge } from './DataSourceBadge';

const weekday = (iso: string): string =>
  ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'][new Date(`${iso}T00:00:00Z`).getUTCDay()];

/**
 * C-2: one crew member's last 7 days, prescribed vs done per countermeasure type, for the onboard CMO and the
 * ground. One person per chart on purpose: no other crew member, no crew average, nothing to compare against.
 */
export const AdherenceChart: React.FC<{ person: AdherencePerson; showBone?: boolean }> = ({ person, showBone = true }) => {
  const bone = person.bone_model;
  return (
    <article
      className="space-y-2 rounded-xl border border-slate-800 bg-space-950/60 p-3"
      data-testid={`adherence-${person.crew_id}`}
      aria-label={`Weekly countermeasures for ${person.crew_id}`}
    >
      <h4 className="text-sm font-bold text-slate-100">
        {person.crew_id} · {person.callsign}
      </h4>
      {person.types.length === 0 && <p className="text-xs text-slate-400">Nothing prescribed in the last 7 days.</p>}
      {person.types.map((type) => {
        const total = person.totals[type];
        return (
          <div key={type} className="space-y-1" data-testid={`adherence-${person.crew_id}-${type}`}>
            <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs">
              <span className="font-semibold text-slate-200">{TYPE_LABEL[type]}</span>
              <span className="font-mono text-slate-300">
                {total.done} of {total.prescribed} done{total.pct !== null ? ` · ${total.pct} %` : ''}
              </span>
            </div>
            <div className="flex items-end gap-1" role="img" aria-label={`${TYPE_LABEL[type]}, last 7 days`}>
              {person.days.map((d) => {
                const c = d.types[type];
                const frac = c.prescribed ? c.done / c.prescribed : 0;
                return (
                  <div key={d.date} className="flex w-8 flex-col items-center gap-0.5" title={`${d.date}: ${c.done} of ${c.prescribed}`}>
                    <div className="relative h-10 w-5 overflow-hidden rounded bg-slate-800">
                      {c.prescribed > 0 && (
                        <div className="absolute bottom-0 w-full bg-cyan-400/80" style={{ height: `${Math.round(frac * 100)}%` }} />
                      )}
                    </div>
                    <span className="font-mono text-[10px] text-slate-400">
                      {c.prescribed ? `${c.done}/${c.prescribed}` : '–'}
                    </span>
                    <span className="text-[10px] text-slate-500">{weekday(d.date)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
      {showBone && bone.pct_month_with_exercise !== null && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-300" data-testid={`bone-model-${person.crew_id}`}>
          <span>
            Bone trend this month −{bone.pct_month_with_exercise.toFixed(1)} % (model without exercise −
            {bone.pct_month_without_exercise.toFixed(1)} %)
          </span>
          <DataSourceBadge compact source={{ provenance: bone.provenance, dataset_id: null, basis: bone.basis }} />
        </div>
      )}
      <p className="text-[10px] text-slate-500">
        Exercise sessions from the session record; other items counted from {person.tracked_from.slice(0, 16).replace('T', ' ')} UTC.
      </p>
    </article>
  );
};

/**
 * Loads and shows the weekly charts. Onboard (CMO view): live from the onboard server. Ground: only the last rollup
 * delivered through the link, with its age ("Data as of T−Xm Ys"). Crew always in the fixed C1..C4 order.
 */
export const WeeklyAdherence: React.FC<{ node: 'onboard' | 'ground'; crewId?: CrewId; connected: boolean }> = ({
  node,
  crewId,
  connected,
}) => {
  const [data, setData] = useState<AdherenceResponse | null>(null);
  useEffect(() => {
    if (!connected) return;
    let live = true;
    const load = (): void => {
      void countermeasureApi.adherence(node, crewId).then((d) => {
        if (live && d) setData(d);
      });
    };
    load();
    const id = window.setInterval(load, 4000);
    return () => {
      live = false;
      window.clearInterval(id);
    };
  }, [node, crewId, connected]);

  return (
    <section className="space-y-3 rounded-xl border border-slate-800 bg-space-900/80 p-4" data-testid={`weekly-adherence-${node}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-slate-100">
          {node === 'ground' ? 'Weekly countermeasures (rollups from the spacecraft)' : 'CMO view: weekly countermeasures'}
        </h3>
        {node === 'ground' && data && (
          <span className="rounded bg-cyan-500 px-2 py-0.5 font-mono text-xs font-black text-slate-950" data-testid="adherence-as-of">
            Data as of T−{formatDurationSeconds(data.age_s)}
          </span>
        )}
      </div>
      <p className="text-[11px] text-slate-400">
        Prescribed vs done per day, one person per chart, so the CMO{node === 'ground' ? ' and the ground' : ''} can
        step in early. Never shown as a comparison between crew members.
      </p>
      {!connected && <p className="text-xs text-amber-200">▲ Needs the onboard server.</p>}
      <div className={`grid gap-3 ${crewId ? '' : 'md:grid-cols-2'}`}>
        {(data?.crew ?? []).map((p) => (
          <AdherenceChart key={p.crew_id} person={p} />
        ))}
      </div>
    </section>
  );
};
