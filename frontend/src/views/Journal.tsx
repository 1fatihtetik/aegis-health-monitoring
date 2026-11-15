import React, { useEffect, useState } from 'react';
import { countermeasureApi, loadJournal, newJournalId, saveJournal } from '../api/countermeasures';
import { CrewId, JournalEntry } from '../api/types';
import { useAegis } from '../api/useLiveSocket';

const CREW: CrewId[] = ['C1', 'C2', 'C3', 'C4'];
const TAGS = ['slept badly', 'headache', 'conflict', 'homesick', 'good day'];
/** Optional writing prompts; the crew can ignore them. Nothing reads or scores what is written. */
const PROMPTS = [
  'What went well today?',
  'What is on your mind right now?',
  'What would make tomorrow a little easier?',
  'Something you are looking forward to?',
];
export const PRIVACY_NOTICE = 'Saved on this tablet, never sent to Earth.';

/**
 * C-4: a private journal per crew member. Entries live in this tablet's local storage only (key per crew member).
 * Each entry stays hidden until tapped. "Share with CMO" sends one copy to the onboard CMO after a preview and a
 * confirm; it can be withdrawn. Nothing here is analysed, scored or sent to the ground. Local storage is not
 * encrypted, and the copy does not claim it is.
 */
export const Journal: React.FC<{ initialCrewId?: CrewId; storage?: Storage | null }> = ({ initialCrewId = 'C1', storage }) => {
  const { state } = useAegis();
  const connected = state.sim.backend_connected;
  const store = storage;
  const [crewId, setCrewId] = useState<CrewId>(initialCrewId);
  const [entries, setEntries] = useState<JournalEntry[]>(() => loadJournal(initialCrewId, store));
  const [text, setText] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [promptIdx, setPromptIdx] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [preview, setPreview] = useState<JournalEntry | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setEntries(loadJournal(crewId, store));
    setOpenId(null);
    setPreview(null);
    setEditingId(null);
    setText('');
    setTags([]);
  }, [crewId, store]);

  const persist = (next: JournalEntry[]): void => {
    setEntries(next);
    if (!saveJournal(crewId, next, store)) setMessage('▲ Could not save on this tablet (storage unavailable).');
  };

  const save = (): void => {
    if (!text.trim()) return;
    if (editingId) {
      persist(entries.map((e) => (e.id === editingId ? { ...e, text: text.trim(), tags } : e)));
      setMessage('Entry updated on this tablet.');
    } else {
      // Mission (simulation) time, not the wall clock (supervisor note 5).
      const entry: JournalEntry = {
        id: newJournalId(),
        written_ts: state.sim.sim_ts,
        text: text.trim(),
        tags,
        prompt: promptIdx === null ? null : PROMPTS[promptIdx],
        context: { phase: state.sim.phase, mission_day: state.sim.mission_day, blackout: state.link.blackout },
        shared: false,
      };
      persist([entry, ...entries]);
      setMessage('Saved on this tablet.');
    }
    setText('');
    setTags([]);
    setEditingId(null);
    setPromptIdx(null);
  };

  const remove = async (entry: JournalEntry): Promise<void> => {
    if (entry.shared) await countermeasureApi.unshare(crewId, entry.id);
    persist(entries.filter((e) => e.id !== entry.id));
    setConfirmDelete(null);
    setOpenId(null);
    setMessage('Entry deleted from this tablet.');
  };

  const confirmShare = async (entry: JournalEntry): Promise<void> => {
    const ok = await countermeasureApi.share(crewId, entry);
    setPreview(null);
    if (ok) {
      persist(entries.map((e) => (e.id === entry.id ? { ...e, shared: true } : e)));
      setMessage('A copy was shared with the onboard CMO. It is never sent to Earth.');
    } else {
      setMessage('▲ Not shared: the onboard server is not reachable.');
    }
  };

  const withdraw = async (entry: JournalEntry): Promise<void> => {
    const ok = await countermeasureApi.unshare(crewId, entry.id);
    if (ok) {
      persist(entries.map((e) => (e.id === entry.id ? { ...e, shared: false } : e)));
      setMessage('Shared copy withdrawn. The entry stays on this tablet.');
    } else {
      setMessage('▲ Could not withdraw: the onboard server is not reachable.');
    }
  };

  return (
    <section className="space-y-4" data-testid="journal-view">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-black text-white">Private journal</h2>
          <p className="text-xs text-slate-300" data-testid="journal-privacy">
            🔒 {PRIVACY_NOTICE} Only you decide if the onboard CMO sees an entry.
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Whose journal">
          {CREW.map((id) => (
            <button
              key={id}
              type="button"
              aria-pressed={crewId === id}
              onClick={() => setCrewId(id)}
              className={`min-h-[44px] min-w-[56px] rounded-xl px-3 text-sm font-bold ${
                crewId === id ? 'bg-cyan-500 text-slate-950' : 'border border-slate-700 bg-space-900 text-slate-200'
              }`}
            >
              {id}
            </button>
          ))}
        </div>
      </div>

      <article className="space-y-3 rounded-2xl border border-slate-800 bg-space-900/95 p-4">
        <h3 className="text-sm font-bold text-slate-100">{editingId ? 'Edit entry' : `New entry · ${crewId}`}</h3>
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
          <span>{state.sim.sim_ts.slice(0, 16).replace('T', ' ')} UTC · {state.sim.phase.replace(/_/g, ' ').toLowerCase()} · day {state.sim.mission_day}</span>
          {state.link.blackout && <span className="rounded border border-slate-600 px-1.5 py-0.5">written during comm blackout</span>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {promptIdx === null ? (
            <button
              type="button"
              onClick={() => setPromptIdx(Math.floor((state.sim.mission_day || 0) % PROMPTS.length))}
              className="min-h-[44px] rounded-lg border border-slate-700 bg-space-950 px-3 text-xs text-slate-300"
            >
              Give me a prompt (optional)
            </button>
          ) : (
            <span className="flex flex-wrap items-center gap-2 text-sm italic text-slate-200">
              {PROMPTS[promptIdx]}
              <button
                type="button"
                onClick={() => setPromptIdx((promptIdx + 1) % PROMPTS.length)}
                className="min-h-[44px] rounded-lg border border-slate-700 px-3 text-xs not-italic text-slate-300"
              >
                Another
              </button>
              <button
                type="button"
                onClick={() => setPromptIdx(null)}
                className="min-h-[44px] rounded-lg border border-slate-700 px-3 text-xs not-italic text-slate-300"
              >
                No prompt
              </button>
            </span>
          )}
        </div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={5}
          aria-label="Journal text"
          placeholder="Write anything. This stays on this tablet."
          className="w-full rounded-lg border border-slate-700 bg-space-950 p-3 text-sm text-slate-100"
        />
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Optional tags">
          {TAGS.map((t) => (
            <button
              key={t}
              type="button"
              aria-pressed={tags.includes(t)}
              onClick={() => setTags(tags.includes(t) ? tags.filter((x) => x !== t) : [...tags, t])}
              className={`min-h-[44px] rounded-full px-3 text-xs font-bold ${
                tags.includes(t) ? 'bg-slate-100 text-slate-950' : 'border border-slate-700 bg-space-950 text-slate-300'
              }`}
            >
              {t}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={save}
            disabled={!text.trim()}
            className="min-h-[48px] rounded-xl bg-cyan-500 px-5 text-sm font-black text-slate-950 disabled:opacity-50"
          >
            {editingId ? 'Save changes' : 'Save on this tablet'}
          </button>
          {editingId && (
            <button
              type="button"
              onClick={() => {
                setEditingId(null);
                setText('');
                setTags([]);
              }}
              className="min-h-[48px] rounded-xl border border-slate-600 px-4 text-sm font-bold text-slate-200"
            >
              Cancel
            </button>
          )}
        </div>
        {message && (
          <p className="text-xs text-slate-300" role="status">
            {message}
          </p>
        )}
      </article>

      {preview && (
        <div role="dialog" aria-label="Share with the CMO" className="space-y-3 rounded-2xl border border-amber-500/60 bg-amber-950/30 p-4" data-testid="journal-share-preview">
          <h3 className="text-sm font-bold text-amber-100">Share this entry with the onboard CMO?</h3>
          <p className="text-xs text-amber-100">
            The CMO on board will be able to read exactly this. It is never sent to Earth, and you can withdraw it later.
          </p>
          <blockquote className="whitespace-pre-wrap rounded-lg border border-slate-700 bg-space-950 p-3 text-sm text-slate-100">
            {preview.text}
          </blockquote>
          {preview.tags.length > 0 && <p className="text-xs text-slate-300">Tags: {preview.tags.join(', ')}</p>}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              data-testid="journal-share-confirm"
              disabled={!connected}
              onClick={() => void confirmShare(preview)}
              className="min-h-[48px] rounded-xl bg-amber-400 px-5 text-sm font-black text-slate-950 disabled:opacity-50"
            >
              Yes, share with the CMO
            </button>
            <button
              type="button"
              onClick={() => setPreview(null)}
              className="min-h-[48px] rounded-xl border border-slate-600 px-4 text-sm font-bold text-slate-200"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <section className="space-y-2" data-testid="journal-entries">
        <h3 className="text-sm font-bold text-slate-100">Entries on this tablet ({entries.length})</h3>
        {entries.length === 0 && <p className="text-xs text-slate-400">No entries yet.</p>}
        {entries.map((e) => (
          <article key={e.id} className="rounded-xl border border-slate-800 bg-space-900/80 p-3 text-sm" data-testid={`journal-entry-${e.id}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-mono text-xs text-slate-400">
                {e.written_ts.slice(0, 16).replace('T', ' ')} UTC{e.context.blackout ? ' · during comm blackout' : ''}
                {e.shared ? ' · shared with the CMO' : ''}
              </span>
              <button
                type="button"
                aria-expanded={openId === e.id}
                onClick={() => setOpenId(openId === e.id ? null : e.id)}
                className="min-h-[44px] rounded-lg border border-slate-600 bg-space-950 px-3 text-xs font-bold text-slate-100"
              >
                {openId === e.id ? 'Hide' : 'Open'}
              </button>
            </div>
            {openId === e.id && (
              <div className="mt-2 space-y-2">
                {e.prompt && <p className="text-xs italic text-slate-400">{e.prompt}</p>}
                <p className="whitespace-pre-wrap text-slate-100" data-testid="journal-entry-text">
                  {e.text}
                </p>
                {e.tags.length > 0 && <p className="text-xs text-slate-400">Tags: {e.tags.join(', ')}</p>}
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setEditingId(e.id);
                      setText(e.text);
                      setTags(e.tags);
                    }}
                    className="min-h-[44px] rounded-lg border border-slate-600 px-3 text-xs font-bold text-slate-100"
                  >
                    Edit
                  </button>
                  {e.shared ? (
                    <button
                      type="button"
                      onClick={() => void withdraw(e)}
                      className="min-h-[44px] rounded-lg border border-amber-500/60 px-3 text-xs font-bold text-amber-100"
                    >
                      Withdraw from the CMO
                    </button>
                  ) : (
                    <button
                      type="button"
                      data-testid="journal-share"
                      onClick={() => setPreview(e)}
                      className="min-h-[44px] rounded-lg border border-amber-500/60 px-3 text-xs font-bold text-amber-100"
                    >
                      Share with CMO…
                    </button>
                  )}
                  {confirmDelete === e.id ? (
                    <>
                      <button
                        type="button"
                        onClick={() => void remove(e)}
                        className="min-h-[44px] rounded-lg bg-red-600 px-3 text-xs font-bold text-white"
                      >
                        Delete for good
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDelete(null)}
                        className="min-h-[44px] rounded-lg border border-slate-600 px-3 text-xs font-bold text-slate-200"
                      >
                        Keep
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(e.id)}
                      className="min-h-[44px] rounded-lg border border-slate-600 px-3 text-xs font-bold text-slate-200"
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
            )}
          </article>
        ))}
      </section>
    </section>
  );
};
