import React, { useEffect, useState } from 'react';
import { countermeasureApi } from '../api/countermeasures';
import { CrewId, SharedJournalEntry } from '../api/types';

/**
 * C-4, CMO view: journal entries this crew member chose to share with the onboard CMO (one at a time, after a
 * preview and a confirm). Hidden until tapped. The copy lives in onboard memory only and never goes to Earth.
 */
export const SharedJournal: React.FC<{ crewId: CrewId; connected: boolean }> = ({ crewId, connected }) => {
  const [entries, setEntries] = useState<SharedJournalEntry[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  useEffect(() => {
    if (!connected) return;
    let live = true;
    const load = (): void => {
      void countermeasureApi.shared(crewId).then((e) => {
        if (live && e) setEntries(e);
      });
    };
    load();
    const id = window.setInterval(load, 4000);
    return () => {
      live = false;
      window.clearInterval(id);
    };
  }, [crewId, connected]);

  return (
    <section className="space-y-2 rounded-xl border border-slate-800 bg-space-900/80 p-4" data-testid="shared-journal">
      <h3 className="text-sm font-bold text-slate-100">CMO view: journal entries shared by {crewId}</h3>
      <p className="text-[11px] text-slate-400">
        Only entries the crew member chose to share. Kept on board in memory, never sent to Earth. The crew member can
        withdraw a shared entry at any time.
      </p>
      {entries.length === 0 ? (
        <p className="text-xs text-slate-400">No shared entries.</p>
      ) : (
        <ul className="space-y-2">
          {entries.map((e) => (
            <li key={e.entry_id} className="rounded-lg border border-slate-800 bg-space-950/60 p-2 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-mono text-slate-400">Written {e.written_ts.slice(0, 16).replace('T', ' ')} UTC</span>
                <button
                  type="button"
                  aria-expanded={openId === e.entry_id}
                  onClick={() => setOpenId(openId === e.entry_id ? null : e.entry_id)}
                  className="min-h-[44px] rounded-lg border border-slate-600 bg-space-900 px-3 font-bold text-slate-100"
                >
                  {openId === e.entry_id ? 'Hide' : 'Show entry'}
                </button>
              </div>
              {openId === e.entry_id && (
                <div className="mt-2 space-y-1">
                  {e.tags.length > 0 && <p className="text-slate-400">Tags: {e.tags.join(', ')}</p>}
                  <p className="whitespace-pre-wrap text-slate-100">{e.text}</p>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};
