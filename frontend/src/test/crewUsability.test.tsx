import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BUNDLED_LIMITS, clauseId } from '../api/limits';
import { AlertItem } from '../api/types';
import { AlertBanner } from '../components/AlertBanner';
import { AutonomyNotice } from '../components/AutonomyNotice';
import { EmergencyTakeover } from '../components/EmergencyTakeover';
import { LimitBadge } from '../components/LimitBadge';
import { buildInitialSystemState } from '../api/client';

const co2Alert: AlertItem = {
  id: 'alert-co2-verified',
  rule_id: 'env.co2.high_1h',
  title: 'Cabin CO2 elevated (1 h mean)',
  crew_id: null,
  severity: 'CAUTION',
  state: 'RAISED',
  raised_ts: '2026-11-14T12:00:00Z',
  hazards: ['HOSTILE_CLOSED_ENV'],
  hrp_risks: ['HRP-12', 'HRP-14'],
  evidence: {
    signal: 'ppco2',
    value: 3.6,
    unit: 'mmHg',
    op: '>',
    limit: 3.0,
    limit_verified: true,
    source_ref: 'NASA-STD-3001 Vol 2 Rev D [V2 6004] Nominal Vehicle/Habitat CO2 Levels, via OCHMO-TB-004 Rev D',
    window: '1h',
    provenance: 'SYNTHETIC_CALIBRATED',
    dataset_id: null,
  },
  rationale: 'Elevated CO2 is linked to headache and reduced cognitive performance.',
  action: 'Check CDRA/scrubber status; increase ventilation; monitor symptoms.',
  checklist: ['Check the CO2 scrubber status panel', 'Turn cabin fans up', 'Recheck CO2 in 30 minutes'],
  notes: [],
  origin: 'ONBOARD',
};

describe('R-1 verified limits', () => {
  it('bundles at least 6 verified limits, each naming a clause id', () => {
    const verified = Object.values(BUNDLED_LIMITS).filter((l) => l.verified);
    expect(verified.length).toBeGreaterThanOrEqual(6);
    for (const l of verified) expect(clauseId(l.source_ref)).not.toBeNull();
    expect(BUNDLED_LIMITS['environment.ppco2_mmHg_1h_max'].verified).toBe(true);
    expect(BUNDLED_LIMITS['environment.ppco2_mmHg_critical'].verified).toBe(false);
  });

  it('LimitBadge shows the clause for verified limits and a warning for heuristics', () => {
    const { rerender } = render(<LimitBadge limit={BUNDLED_LIMITS['environment.ppco2_mmHg_1h_max']} />);
    expect(screen.getByText(/✓ NASA \[V2 6004\]/)).toBeInTheDocument();
    rerender(<LimitBadge limit={BUNDLED_LIMITS['environment.ppco2_mmHg_critical']} />);
    expect(screen.getAllByText(/Not a NASA limit/).length).toBeGreaterThan(0);
  });
});

describe('F-007 crew usability', () => {
  it('AlertBanner shows the NASA clause, data source and the checklist inline (1 tap to hide)', () => {
    render(<AlertBanner alerts={[co2Alert]} onAcknowledge={() => undefined} />);
    const banner = screen.getByTestId('alert-banner');
    expect(banner).toHaveTextContent('✓ NASA limit [V2 6004]');
    expect(banner).toHaveTextContent('Simulated · NASA-calibrated');
    expect(screen.getByTestId('checklist-alert-co2-verified')).toHaveTextContent('Turn cabin fans up');
    fireEvent.click(screen.getByRole('button', { name: /Hide steps/i }));
    expect(screen.queryByTestId('checklist-alert-co2-verified')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Show what to do now/i }));
    expect(screen.getByTestId('checklist-alert-co2-verified')).toBeInTheDocument();
  });

  it('AlertBanner tells the crew to act onboard when Earth is delayed or blacked out', () => {
    const { rerender } = render(
      <AlertBanner alerts={[co2Alert]} onAcknowledge={() => undefined} commDelaySeconds={5} />
    );
    expect(screen.queryByTestId('autonomy-notice')).toBeNull();
    rerender(<AlertBanner alerts={[co2Alert]} onAcknowledge={() => undefined} commDelaySeconds={720} />);
    expect(screen.getByTestId('autonomy-notice')).toHaveTextContent('12m 00s away');
    expect(screen.getByTestId('autonomy-notice')).toHaveTextContent('do not wait for ground confirmation');
    rerender(<AlertBanner alerts={[co2Alert]} onAcknowledge={() => undefined} linkBlackout commDelaySeconds={0} />);
    expect(screen.getByTestId('autonomy-notice')).toHaveTextContent('BLACKED OUT');
  });

  it('AutonomyNotice stays hidden on a near-real-time link', () => {
    render(<AutonomyNotice blackout={false} delaySeconds={1.3} />);
    expect(screen.queryByTestId('autonomy-notice')).toBeNull();
  });

  it('EmergencyTakeover shows plain-language signal label and blackout autonomy notice (F-008)', () => {
    const initial = buildInitialSystemState(42);
    const speAlert: AlertItem = {
      ...co2Alert,
      id: 'alert-spe-f008',
      rule_id: 'rad.spe.dose_rate',
      title: 'Solar particle event: dose rate above SPE threshold',
      severity: 'EMERGENCY',
      hazards: ['RADIATION'],
      hrp_risks: ['HRP-17'],
      evidence: {
        ...co2Alert.evidence,
        signal: 'area_dose_rate_equivalent',
        value: 312.0,
        unit: 'µSv/h',
        limit: 250,
        limit_verified: false,
      },
    };
    render(
      <EmergencyTakeover
        alert={speAlert}
        crew={initial.crew}
        radiation={initial.radiation}
        commDelaySeconds={720}
        groundLagSeconds={720}
        linkBlackout
        onToggleCrewShelter={() => undefined}
        onEvacuateAll={() => undefined}
        onAcknowledge={() => undefined}
        onResolve={() => undefined}
      />
    );
    const takeover = screen.getByTestId('emergency-takeover');
    expect(takeover).toHaveTextContent('Cabin radiation dose rate');
    expect(takeover).not.toHaveTextContent('area_dose_rate_equivalent');
    expect(screen.getByTestId('takeover-blackout')).toHaveTextContent('Earth link blacked out');
    expect(screen.getByTestId('autonomy-notice')).toHaveTextContent('Act onboard now');
  });
});
