/**
 * Block C helpers: countermeasure logging, weekly adherence and the CMO-only journal copy. Pure functions and thin
 * REST calls; no thresholds of their own (prescriptions come resolved from config/limits.yaml via the backend).
 */
import { backendApi } from './backend';
import {
  AdherenceResponse,
  CountermeasurePlanItem,
  CountermeasureType,
  CrewId,
  JournalEntry,
  SharedJournalEntry,
} from './types';

export const TYPE_LABEL: Record<CountermeasureType, string> = {
  EXERCISE: 'Exercise sessions',
  NUTRITION: 'Water and food target',
  THIGH_CUFF: 'Thigh cuff',
  LIGHT: 'Light schedule',
  FLUID_LOADING: 'Fluid loading',
};

export interface CountermeasureObservation {
  id: string;
  ts: string;
  crew_id: CrewId;
  location: null;
  device_id: string;
  signal: 'countermeasure_done' | 'exercise_minutes';
  value: number;
  unit: string;
  quality: 'GOOD';
  phase: string | null;
  provenance: 'CREW_ENTERED';
  entry_method: 'tap';
  countermeasure_id: string;
}

function newId(crewId: CrewId, cmId: string): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `cm-${crewId}-${cmId}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/** A Done tap: countermeasure_done = 1 (and the exercise minutes), CREW_ENTERED, entry method "tap". */
export function buildCountermeasureObservations(input: {
  crewId: CrewId;
  item: Pick<CountermeasurePlanItem, 'countermeasure_id' | 'log_minutes'>;
  minutes: number | null;
  ts: string;
  phase: string | null;
}): CountermeasureObservation[] {
  const base = {
    ts: input.ts,
    crew_id: input.crewId,
    location: null,
    device_id: `tablet-${input.crewId}`,
    quality: 'GOOD' as const,
    phase: input.phase,
    provenance: 'CREW_ENTERED' as const,
    entry_method: 'tap' as const,
    countermeasure_id: input.item.countermeasure_id,
  };
  const obs: CountermeasureObservation[] = [
    { ...base, id: newId(input.crewId, input.item.countermeasure_id), signal: 'countermeasure_done', value: 1, unit: '1=done' },
  ];
  if (input.item.log_minutes && input.minutes !== null) {
    obs.push({ ...base, id: newId(input.crewId, input.item.countermeasure_id), signal: 'exercise_minutes', value: input.minutes, unit: 'min' });
  }
  return obs;
}

export const countermeasureApi = {
  async plan(crewId: CrewId): Promise<CountermeasurePlanItem[] | null> {
    const res = await backendApi.getJson<{ plan: CountermeasurePlanItem[] }>(`/countermeasures/plan?crew_id=${crewId}`);
    return res?.plan ?? null;
  },
  async adherence(node: 'onboard' | 'ground', crewId?: CrewId): Promise<AdherenceResponse | null> {
    const who = crewId ? `&crew_id=${crewId}` : '';
    return backendApi.getJson<AdherenceResponse>(`/countermeasures/adherence?node=${node}${who}`);
  },
  async log(obs: CountermeasureObservation[]): Promise<{ ok: boolean; message: string }> {
    const res = await backendApi.postJsonDetailed<{ accepted: number }>('/observations', obs);
    if (res.data && res.data.accepted > 0) return { ok: true, message: 'Logged on board.' };
    if (res.data) return { ok: false, message: 'Already logged.' };
    return { ok: false, message: `Not logged: ${res.detail ?? 'refused by the onboard server.'}` };
  },
  async shared(crewId?: CrewId): Promise<SharedJournalEntry[] | null> {
    const who = crewId ? `&crew_id=${crewId}` : '';
    const res = await backendApi.getJson<{ entries: SharedJournalEntry[] }>(`/journal/shared?node=onboard${who}`);
    return res?.entries ?? null;
  },
  /** Sends one confirmed copy to the onboard CMO (memory only on board; never to the ground). */
  async share(crewId: CrewId, entry: JournalEntry): Promise<boolean> {
    const res = await backendApi.postJson<SharedJournalEntry>('/journal/shared?node=onboard', {
      crew_id: crewId,
      entry_id: entry.id,
      text: entry.text,
      tags: entry.tags,
      written_ts: entry.written_ts,
      context: entry.context,
      confirmed: true,
    });
    return res !== null;
  },
  async unshare(crewId: CrewId, entryId: string): Promise<boolean> {
    try {
      const res = await fetch(`/api/v1/journal/shared/${crewId}/${encodeURIComponent(entryId)}?node=onboard`, {
        method: 'DELETE',
      });
      return res.ok;
    } catch {
      return false;
    }
  },
};

// ---- journal storage: this tablet's local storage only ------------------------------------------------------------

/** One key per crew member (shared tablet). Never synced, never sent to Earth. */
export const journalKey = (crewId: CrewId): string => `aegis.journal.v1.${crewId}`;

export function loadJournal(crewId: CrewId, storage: Storage | null = safeStorage()): JournalEntry[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(journalKey(crewId));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as JournalEntry[]) : [];
  } catch {
    return [];
  }
}

export function saveJournal(crewId: CrewId, entries: JournalEntry[], storage: Storage | null = safeStorage()): boolean {
  if (!storage) return false;
  try {
    storage.setItem(journalKey(crewId), JSON.stringify(entries));
    return true;
  } catch {
    return false;
  }
}

function safeStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function newJournalId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `j-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
