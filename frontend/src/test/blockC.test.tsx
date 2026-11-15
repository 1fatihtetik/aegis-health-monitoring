import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildCountermeasureObservations, journalKey, loadJournal } from '../api/countermeasures';
import { BUNDLED_LIMITS } from '../api/limits';
import { AdherencePerson, CountermeasurePlanItem } from '../api/types';
import { AdherenceChart } from '../components/AdherenceChart';
import { CountermeasurePlan } from '../components/CountermeasurePlan';

// The journal reads the mission clock and link state from the live hook; a fixed sim time proves it is not Date().
const SIM_TS = '2026-11-14T21:30:00Z';
vi.mock('../api/useLiveSocket', () => ({
  useAegis: () => ({
    state: {
      sim: { sim_ts: SIM_TS, phase: 'MARS_TRANSIT', mission_day: 142, backend_connected: true },
      link: { blackout: true },
    },
  }),
}));
import { Journal, PRIVACY_NOTICE } from '../views/Journal';

const RANKING = /\b(rank(ed|ing)?|top|best|worst|ahead of|behind|leaderboard|points?|streaks?|level[- ]up)\b/i;

const exercise: CountermeasurePlanItem = {
  countermeasure_id: 'exercise_resistance',
  title: 'Resistance exercise',
  type: 'EXERCISE',
  equipment: 'ARED (Advanced Resistive Exercise Device)',
  why: 'Without gravity, bones and muscles are not loaded and they weaken.',
  hazards: ['GRAVITY_FIELDS'],
  hrp_risks: ['HRP-11', 'HRP-09'],
  steps: ['Check the ARED', 'Warm up for 5 minutes', 'Tap Done and check the minutes'],
  prescription: [
    { label: 'Session length', ref: 'countermeasures.exercise_session_min', value: 60, source_ref: 'Project heuristic', verified: false, source_kind: 'design' },
  ],
  escalation: 'Pain in a joint: stop, rest, and tell the CMO before the next session.',
  log_minutes: true,
  minutes_max: 240,
  status: 'DUE',
  reason: 'routine',
  added_because: [],
  level: null,
  slot_start: '2026-11-14T10:00:00Z',
  due_until: '2026-11-14T12:00:00Z',
  done_ts: null,
  done_provenance: null,
  done_basis: null,
  done_minutes: null,
};

const fluid: CountermeasurePlanItem = {
  ...exercise,
  countermeasure_id: 'fluid_loading',
  title: 'Fluid loading before landing',
  type: 'FLUID_LOADING',
  why: 'Drinking extra water with salt before landing helps keep blood pressure up.',
  log_minutes: false,
  prescription: [
    { label: 'Water per day', ref: 'nutrition.fluid_intake_mL_day_min', value: 2500, source_ref: BUNDLED_LIMITS['nutrition.fluid_intake_mL_day_min'].source_ref, verified: true, source_kind: null },
  ],
  reason: 'added',
  added_because: ['Landing readiness gate on Hold'],
  status: 'NOT_LOGGED',
  level: 'INFO',
};

describe('C-1 countermeasures on the routine board', () => {
  it('explains why, shows each prescription marker and why an item was added', () => {
    render(<CountermeasurePlan items={[exercise, fluid]} connected onDone={vi.fn()} />);
    expect(screen.getByText(exercise.why)).toBeInTheDocument();
    expect(screen.getAllByTestId('not-nasa-limit')[0]).toHaveTextContent('Not a NASA limit · AEGIS design setting');
    expect(screen.getByTestId('cm-fluid_loading')).toHaveTextContent('✓ NASA [V2 6109]');
    expect(screen.getByTestId('cm-added-fluid_loading')).toHaveTextContent('Added because: Landing readiness gate on Hold');
  });

  it('not logged is neutral information, never a %, a score or a ranking', () => {
    render(<CountermeasurePlan items={[exercise, fluid]} connected onDone={vi.fn()} />);
    const board = screen.getByTestId('countermeasure-plan');
    expect(screen.getByTestId('cm-fluid_loading')).toHaveTextContent('Not logged yet · info only');
    expect(board.textContent).not.toMatch(/%/);
    expect(board.textContent).not.toMatch(RANKING);
    expect(screen.getByTestId('cm-fluid_loading').innerHTML).not.toMatch(/red-/);
  });

  it('Done logs with the prescribed minutes filled in (one tap) and big buttons', async () => {
    const onDone = vi.fn().mockResolvedValue({ ok: true, message: 'Logged on board.' });
    render(<CountermeasurePlan items={[exercise]} connected onDone={onDone} />);
    const done = screen.getByTestId('cm-done-exercise_resistance');
    expect(done.className).toContain('min-h-[44px]');
    fireEvent.click(done);
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(exercise, 60));
    expect(await screen.findByRole('status')).toHaveTextContent('Logged on board.');
  });

  it('Start shows the equipment, numbered steps and when to involve the CMO', () => {
    render(<CountermeasurePlan items={[exercise]} connected onDone={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    expect(screen.getByText(/ARED \(Advanced/)).toBeInTheDocument();
    expect(screen.getByText('Warm up for 5 minutes')).toBeInTheDocument();
    expect(screen.getByText(/When to involve the CMO/)).toBeInTheDocument();
  });

  it('a tap is CREW_ENTERED with the entry method and the countermeasure, no dataset', () => {
    const obs = buildCountermeasureObservations({ crewId: 'C3', item: exercise, minutes: 45, ts: SIM_TS, phase: 'MARS_TRANSIT' });
    expect(obs.map((o) => [o.signal, o.value])).toEqual([['countermeasure_done', 1], ['exercise_minutes', 45]]);
    for (const o of obs) {
      expect(o).toMatchObject({ provenance: 'CREW_ENTERED', entry_method: 'tap', countermeasure_id: 'exercise_resistance', crew_id: 'C3' });
      expect(o).not.toHaveProperty('dataset_id');
    }
    expect(buildCountermeasureObservations({ crewId: 'C1', item: fluid, minutes: null, ts: SIM_TS, phase: null })).toHaveLength(1);
  });
});

const person: AdherencePerson = {
  crew_id: 'C3',
  callsign: 'Orion',
  days: Array.from({ length: 7 }, (_, k) => ({
    date: `2026-11-${String(8 + k).padStart(2, '0')}`,
    types: {
      EXERCISE: { prescribed: 2, done: k % 2 },
      NUTRITION: { prescribed: 0, done: 0 },
      THIGH_CUFF: { prescribed: 0, done: 0 },
      LIGHT: { prescribed: 0, done: 0 },
      FLUID_LOADING: { prescribed: 0, done: 0 },
    },
  })),
  totals: {
    EXERCISE: { prescribed: 14, done: 3, pct: 21 },
    NUTRITION: { prescribed: 0, done: 0, pct: null },
    THIGH_CUFF: { prescribed: 0, done: 0, pct: null },
    LIGHT: { prescribed: 0, done: 0, pct: null },
    FLUID_LOADING: { prescribed: 0, done: 0, pct: null },
  },
  types: ['EXERCISE'],
  tracked_from: '2026-11-14T20:00:00Z',
  bone_model: {
    exercise_fraction: 0.21,
    pct_month_with_exercise: 1.11,
    pct_month_without_exercise: 1.25,
    gravity_g: 0,
    provenance: 'SYNTHETIC',
    basis: 'Simulator bone model. Simulated, not a measurement.',
  },
};

describe('C-2 weekly adherence chart (CMO and ground)', () => {
  it('one person per chart: 7 day bars, done of prescribed and %, no crew comparison', () => {
    render(<AdherenceChart person={person} />);
    const chart = screen.getByTestId('adherence-C3');
    expect(screen.getByTestId('adherence-C3-EXERCISE')).toHaveTextContent('3 of 14 done · 21 %');
    expect(chart.querySelectorAll('[title^="2026-11-"]')).toHaveLength(7);
    expect(chart.textContent).not.toMatch(RANKING);
    expect(chart.textContent).not.toMatch(/average|C1|C2|C4/);
  });

  it('shows the model effect line badged as simulated', () => {
    render(<AdherenceChart person={person} />);
    const line = screen.getByTestId('bone-model-C3');
    expect(line).toHaveTextContent('Bone trend this month −1.1 % (model without exercise −1.3 %)');
    expect(line.querySelector('[data-provenance="SYNTHETIC"]')).not.toBeNull();
  });
});

describe('C-4 private journal', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    window.localStorage.clear();
    fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  const write = (text: string): void => {
    fireEvent.change(screen.getByLabelText('Journal text'), { target: { value: text } });
    fireEvent.click(screen.getByRole('button', { name: 'homesick' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save on this tablet' }));
  };

  it('saves on this tablet per crew member, with mission time and blackout context, nothing sent', () => {
    render(<Journal initialCrewId="C2" />);
    expect(screen.getByTestId('journal-privacy')).toHaveTextContent(PRIVACY_NOTICE);
    expect(screen.getByTestId('journal-view').textContent).not.toMatch(/encrypt/i);
    write('Quiet day, good talk with home.');
    const saved = loadJournal('C2');
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ written_ts: SIM_TS, tags: ['homesick'], shared: false });
    expect(saved[0].context).toEqual({ phase: 'MARS_TRANSIT', mission_day: 142, blackout: true });
    expect(window.localStorage.getItem(journalKey('C1'))).toBeNull();
    expect(journalKey('C2')).toBe('aegis.journal.v1.C2');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('entries stay hidden until tapped, with a Hide control', () => {
    render(<Journal initialCrewId="C3" />);
    write('Private words.');
    expect(screen.queryByTestId('journal-entry-text')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(screen.getByTestId('journal-entry-text')).toHaveTextContent('Private words.');
    fireEvent.click(screen.getByRole('button', { name: 'Hide' }));
    expect(screen.queryByTestId('journal-entry-text')).toBeNull();
  });

  it('sharing with the CMO needs a preview and a confirm, and goes to the onboard server only', async () => {
    render(<Journal initialCrewId="C4" />);
    write('Argued about the schedule.');
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    fireEvent.click(screen.getByTestId('journal-share'));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByTestId('journal-share-preview')).toHaveTextContent('Argued about the schedule.');
    fireEvent.click(screen.getByTestId('journal-share-confirm'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/v1/journal/shared?node=onboard');
    expect(JSON.parse(String(init.body))).toMatchObject({ crew_id: 'C4', confirmed: true, text: 'Argued about the schedule.' });
    await waitFor(() => expect(loadJournal('C4')[0].shared).toBe(true));
  });

  it('delete asks once more and removes the entry from the tablet', () => {
    render(<Journal initialCrewId="C1" />);
    write('To be deleted.');
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete for good' }));
    return waitFor(() => expect(loadJournal('C1')).toEqual([]));
  });
});
