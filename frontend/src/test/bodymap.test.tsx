import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { regionStatus, regionStatusText } from '../api/bodymap';
import { AlertItem, BodyRegion } from '../api/types';

// The body map reads open alerts from the live state; a small stand-in keeps this test offline.
const live = { alerts: [] as AlertItem[], connected: true };
vi.mock('../api/useLiveSocket', () => ({
  useAegis: () => ({ state: { alerts: live.alerts, sim: { backend_connected: live.connected } } }),
}));
const { BodyMap } = await import('../components/BodyMap');

const src = { provenance: 'SYNTHETIC_CALIBRATED' as const, dataset_id: null, basis: 'Simulated' };

// Shapes as served by GET /api/v1/bodymap for config/selftests.yaml `body_map` (two regions shown).
const regions: BodyRegion[] = [
  {
    id: 'heart_vessels',
    label: 'Heart & vessels',
    what: 'The heart and blood vessels move blood and oxygen.',
    hazards: ['GRAVITY_FIELDS'],
    hrp_risks: ['HRP-03'],
    signals: [
      { signal: 'heart_rate', unit: 'bpm', scope: 'crew', onboard_only: false, latest: { ts: '2026-11-14T12:00:00Z', value: 72 }, recent: [70, 71, 72], source: src },
    ],
    rules: [
      { id: 'physio.hr.high', title: 'Heart rate high', severity: 'CAUTION' },
      { id: 'cardio.orthostatic', title: 'Orthostatic intolerance risk', severity: 'WARNING' },
    ],
    tests: [{ id: 'stand_test', title: 'Stand test (10 minutes)', onboard_only: false }],
    reference: null,
  },
  {
    id: 'lungs',
    label: 'Lungs & breathing',
    what: 'The lungs take in oxygen and remove CO2.',
    hazards: ['HOSTILE_CLOSED_ENV'],
    hrp_risks: ['HRP-06'],
    signals: [
      { signal: 'ppco2', unit: 'mmHg', scope: 'cabin', onboard_only: false, latest: null, recent: [], source: src },
    ],
    rules: [{ id: 'env.co2.high_1h', title: 'Cabin CO2 high (1 h mean)', severity: 'CAUTION' }],
    tests: [{ id: 'bp_spo2', title: 'Blood pressure and oxygen check', onboard_only: false }],
    reference: null,
  },
];

function alert(rule_id: string, severity: AlertItem['severity'], crew_id: AlertItem['crew_id'], state: AlertItem['state'] = 'RAISED'): AlertItem {
  return {
    id: `${rule_id}-${crew_id}-${state}`,
    rule_id,
    title: `${rule_id} title`,
    crew_id,
    severity,
    state,
    raised_ts: '2026-11-14T12:00:00Z',
    hazards: [],
    hrp_risks: [],
    evidence: {} as AlertItem['evidence'],
    rationale: '',
    action: '',
    notes: [],
    origin: 'ONBOARD',
  };
}

describe('T-6 body map status', () => {
  it('colour = highest open severity of the region rules, for this crew member or the whole cabin', () => {
    const heart = regions[0];
    expect(regionStatus(heart, [], 'C1').severity).toBeNull();
    const alerts = [
      alert('physio.hr.high', 'CAUTION', 'C1'),
      alert('cardio.orthostatic', 'WARNING', 'C2'), // someone else
      alert('cardio.orthostatic', 'WARNING', 'C1', 'RESOLVED'), // closed
      alert('rad.spe.dose_rate', 'EMERGENCY', null), // not linked to this region
    ];
    expect(regionStatus(heart, alerts, 'C1').severity).toBe('CAUTION');
    expect(regionStatus(heart, alerts, 'C2').severity).toBe('WARNING');
    expect(regionStatus(regions[1], [alert('env.co2.high_1h', 'CAUTION', null)], 'C3').severity).toBe('CAUTION');
  });

  it('status text never diagnoses', () => {
    const st = regionStatus(regions[0], [alert('physio.hr.high', 'CAUTION', 'C1')], 'C1');
    const text = regionStatusText(regions[0], st);
    expect(text).toMatch(/^Indicators consistent with/);
    expect(text).toContain('Recommend CMO review');
    expect(text.toLowerCase()).not.toContain('you have');
    expect(regionStatusText(regions[0], regionStatus(regions[0], [], 'C1'))).toContain('✓ No open alerts');
  });
});

describe('T-6 BodyMap component', () => {
  beforeEach(() => {
    live.alerts = [];
    live.connected = true;
  });

  it('regions are ≥ 44 px buttons with icon + text; the figure follows open alerts', () => {
    live.alerts = [alert('cardio.orthostatic', 'WARNING', 'C1')];
    render(<BodyMap crewId="C1" initialRegions={regions} />);
    const heart = screen.getByTestId('bodymap-region-heart_vessels');
    expect(heart.className).toContain('min-h-[48px]');
    expect(heart).toHaveAccessibleName('Heart & vessels: WARNING');
    expect(heart).toHaveTextContent('■');
    expect(screen.getByTestId('bodymap-region-lungs')).toHaveTextContent('✓');
    expect(screen.getByTestId('bodymap-shape-heart_vessels')).toHaveAttribute('data-severity', 'WARNING');
    expect(screen.getByTestId('bodymap-shape-lungs')).toHaveAttribute('data-severity', 'NONE');
  });

  it('drawer shows readings with a source badge, HRP risks, alerts with LOM sublabel and Start buttons', () => {
    live.alerts = [alert('cardio.orthostatic', 'WARNING', 'C1')];
    const onStart = vi.fn();
    render(<BodyMap crewId="C1" initialRegions={regions} onStartTest={onStart} />);
    fireEvent.click(screen.getByTestId('bodymap-region-heart_vessels'));
    const drawer = screen.getByTestId('bodymap-drawer-heart_vessels');
    expect(drawer).toHaveTextContent('Indicators consistent with');
    expect(drawer).toHaveTextContent('HRP-03');
    expect(drawer).toHaveTextContent('LOM');
    expect(screen.getByTestId('bodymap-signals')).toHaveTextContent('Heart rate');
    fireEvent.click(screen.getByTestId('bodymap-start-stand_test'));
    expect(onStart).toHaveBeenCalledWith('C1', 'stand_test');
    // keyboard reachable: the region list is plain buttons
    expect(screen.getByTestId('bodymap-region-lungs').tagName).toBe('BUTTON');
  });

  it('without the onboard server it says so instead of guessing', () => {
    live.connected = false;
    render(<BodyMap crewId="C1" />);
    expect(screen.getByTestId('bodymap-unavailable')).toHaveTextContent('never needs the Earth link');
  });

  it('no gamification or diagnosis wording', () => {
    render(<BodyMap crewId="C1" initialRegions={regions} />);
    fireEvent.click(screen.getByTestId('bodymap-region-lungs'));
    const text = document.body.textContent?.toLowerCase() ?? '';
    for (const word of ['you have', 'points', 'streak', 'badge', 'level up', 'leaderboard']) {
      expect(text).not.toContain(word);
    }
  });
});
