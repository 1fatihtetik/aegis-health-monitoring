import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { mapLanding, BackendSnapshot } from '../api/backend';
import { LandingGate, NextGravityIncrease } from '../api/types';
import { ReadinessGate, landingLine, needsAction } from '../components/ReadinessGate';
import { LandingGateSummary } from '../views/CrewOverview';

const comp = (signal: string, value: number | null, score: number | null, action: string) => ({
  signal,
  value,
  unit: signal === 'fluid_intake' ? 'mL' : '%',
  score,
  weight: 0.2,
  limit_ref: 'x.y',
  limit_verified: false,
  limit_source_ref: 'Project heuristic',
  action,
});

const gate = (go: boolean, over: Partial<LandingGate> = {}): LandingGate => ({
  value: go ? 82 : 46,
  base: go ? 82 : 56,
  alert_penalty: go ? 0 : 10,
  go,
  go_min: 70,
  go_min_verified: false,
  go_min_source_ref: 'Project heuristic',
  components: {
    fluid: comp('fluid_intake', go ? 3000 : 1200, go ? 100 : 10, 'Drink to the daily fluid target.'),
    stand: comp('stand_hr_rise', null, null, 'Do the stand test once gravity allows it.'),
    spo2: comp('spo2', 97.5, 100, 'Re-check SpO2.'),
  },
  hold_alerts: go ? [] : [{ id: 'a1', rule_id: 'cardio.orthostatic', severity: 'WARNING', title: 'Low blood pressure on standing' }],
  hold_actions: ['Tell the CMO now. The CMO decides on board; do not wait for Earth.'],
  hazards: ['GRAVITY_FIELDS'],
  hrp_risks: ['HRP-03'],
  ...over,
});

const next: NextGravityIncrease = { ts: '2026-11-15T12:30:00Z', in_s: 720, to_phase: 'MARS_SURFACE', from_g: 0, to_g: 0.38 };

describe('T-8 landing readiness gate', () => {
  it('says when the next landing is, or that none is scheduled', () => {
    expect(landingLine(next)).toBe('Next gravity increase: Mars surface, 0 g → 0.38 g, in 12m 00s (mission time).');
    expect(landingLine(null)).toMatch(/No gravity increase is scheduled/);
  });

  it('shows GO and HOLD with icon and text, the hold alert with its sublabel, and the hold steps', () => {
    render(<ReadinessGate gates={{ C1: gate(true), C3: gate(false) }} next={next} connected />);
    expect(screen.getByTestId('landing-verdict-C1').textContent).toBe('✓ GO');
    expect(screen.getByTestId('landing-verdict-C3').textContent).toBe('▲ HOLD');
    const hold = screen.getByTestId('landing-hold-alerts-C3');
    expect(hold.textContent).toMatch(/Low blood pressure on standing/);
    expect(hold.querySelector('[data-testid="severity-sublabel"]')?.textContent).toMatch(/LOM/);
    expect(screen.getByTestId('landing-hold-actions-C3').textContent).toMatch(/Tell the CMO/);
    // Hold rows open by default and show every component, the not-NASA marker and the plain action.
    const fluid = screen.getByTestId('landing-comp-C3-fluid');
    expect(fluid.textContent).toMatch(/1200 mL/);
    expect(fluid.textContent).toMatch(/Not a NASA limit/);
    expect(fluid.textContent).toMatch(/Drink to the daily fluid target/);
    expect(screen.getByTestId('landing-comp-C3-stand').textContent).toMatch(/no result yet, left out of the score/);
    expect(screen.getByTestId('readiness-gate').textContent).not.toMatch(/you have|point|streak|badge|leaderboard/i);
  });

  it('GO rows start collapsed; the Start buttons open the right test for that crew member', () => {
    const onStart = vi.fn();
    render(<ReadinessGate gates={{ C1: gate(true) }} next={next} connected onStartTest={onStart} />);
    expect(screen.queryByTestId('landing-comp-C1-fluid')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show details' }));
    fireEvent.click(screen.getByRole('button', { name: 'Start stand test' }));
    expect(onStart).toHaveBeenCalledWith('C1', 'stand_test');
    for (const b of screen.getAllByRole('button')) expect(b.className).toMatch(/min-h-\[44px\]/);
  });

  it('a part at or above its good anchor needs no step; a missing part does', () => {
    expect(needsAction(comp('spo2', 98, 100, 'x'))).toBe(false);
    expect(needsAction(comp('spo2', null, null, 'x'))).toBe(true);
    expect(needsAction(comp('spo2', 94, 70, 'x'))).toBe(true);
  });

  it('explains itself when the onboard server is not reachable', () => {
    render(<ReadinessGate gates={undefined} next={undefined} connected={false} />);
    expect(screen.getByTestId('readiness-gate').textContent).toMatch(/never needs the Earth link/);
  });

  it('the overview line names who is on Hold and is hidden when no landing is ahead', () => {
    const onOpen = vi.fn();
    const { rerender } = render(<LandingGateSummary gates={{ C1: gate(true), C3: gate(false) }} next={next} onOpen={onOpen} />);
    expect(screen.getByTestId('landing-gate-summary').textContent).toMatch(/▲ HOLD for C3/);
    fireEvent.click(screen.getByRole('button', { name: 'Open landing gate' }));
    expect(onOpen).toHaveBeenCalled();
    rerender(<LandingGateSummary gates={{ C1: gate(true) }} next={null} onOpen={onOpen} />);
    expect(screen.queryByTestId('landing-gate-summary')).toBeNull();
  });

  it('maps the snapshot LANDING entries and skips kinds without a gate', () => {
    const g = gate(false);
    const snap = {
      readiness: {
        C3: { LANDING: { ...g, formula: 'f', alert_ids: [] }, OVERALL: { value: 80, base: 80, alert_penalty: 0 } },
      },
    } as unknown as BackendSnapshot;
    const out = mapLanding(snap);
    expect(out?.C3?.go).toBe(false);
    expect(out?.C3?.hold_alerts[0].rule_id).toBe('cardio.orthostatic');
    expect(mapLanding({} as BackendSnapshot)).toBeUndefined();
  });
});
