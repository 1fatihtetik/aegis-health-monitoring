import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BackendAlert, mapAlert } from '../api/backend';
import { AlertChecklist } from '../components/AlertChecklist';
import { ContextBadge, EvidenceDetails } from '../components/EvidenceDetails';

// Shape of a ctx.headache_tachy.hydration alert as the backend sends it (synthetic values).
const hydration: BackendAlert = {
  id: 'a1',
  rule_id: 'ctx.headache_tachy.hydration',
  title: 'Headache + raised heart rate, cabin CO2 normal',
  crew_id: 'C2',
  severity: 'CAUTION',
  state: 'RAISED',
  raised_ts: '2026-11-14T12:00:00Z',
  ack_ts: null,
  resolved_ts: null,
  hazards: ['GRAVITY_FIELDS'],
  hrp_risks: ['HRP-03'],
  evidence: {
    signal: 'compound',
    value: 3,
    limit: 3,
    logic: { all: [], none: ['env.co2.high_1h'] },
    context: { group: 'headache_tachy', branch: 'hydration' },
    members: [
      { signal: 'symptom_headache', value: 2, op: '>=', limit: 1, firing: true, unit: '0-3' },
      { signal: 'heart_rate', value: 104.2, op: '>', limit: 100, firing: true, unit: 'bpm', hysteresis_hold: true },
      { rule_id: 'env.co2.high_1h', signal: 'ppco2', value: 2.1, op: '>', limit: 3, firing: false, negated: true },
    ],
  },
  rationale: 'r',
  action: 'a',
  checklist: ['Drink 500 mL of water', 'Rest for 30 minutes', 'Recheck in 30 minutes'],
  notes: [],
  origin: 'ONBOARD',
} as unknown as BackendAlert;

describe('compound evidence and context (G3-7)', () => {
  const alert = mapAlert(hydration);

  it('maps context, negated members and hysteresis holds', () => {
    expect(alert.evidence.context).toEqual({ group: 'headache_tachy', branch: 'hydration' });
    const [, hr, co2] = alert.evidence.clauses ?? [];
    expect(hr.hysteresis_hold).toBe(true);
    expect(co2.negated).toBe(true);
    expect(co2.label).toBe('Cabin CO₂ above limit: must NOT be true');
  });

  it('renders the branch badge and "not true" for the negated CO2 member', () => {
    render(
      <>
        <ContextBadge evidence={alert.evidence} />
        <EvidenceDetails evidence={alert.evidence} />
      </>
    );
    expect(screen.getByTestId('context-badge').textContent).toContain('low fluid intake');
    const clauses = screen.getAllByTestId('evidence-clause');
    expect(clauses).toHaveLength(3);
    expect(clauses[2].textContent).toContain('✓ not true');
    expect(clauses[1].textContent).toContain('hysteresis hold');
    expect(screen.getByText(/Conditions met/).textContent).toContain('3');
  });
});

describe('alert checklist (G3-9)', () => {
  it('ticks steps with 44 px targets', () => {
    render(<AlertChecklist alertId="a-check" steps={['One', 'Two', 'Three']} />);
    expect(screen.getByText('0/3 done')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Step 2: Two'));
    expect(screen.getByText('1/3 done')).toBeInTheDocument();
    const label = screen.getByLabelText('Step 2: Two').closest('label');
    expect(label?.className).toContain('min-h-[44px]');
  });

  it('renders nothing without steps', () => {
    const { container } = render(<AlertChecklist alertId="a-none" steps={[]} />);
    expect(container.firstChild).toBeNull();
  });
});
