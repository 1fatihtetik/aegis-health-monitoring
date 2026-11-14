import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import App from '../App';
import { buildInitialSystemState } from '../api/client';
import { AlertItem } from '../api/types';
import { AlertBanner } from '../components/AlertBanner';
import { EmergencyTakeover } from '../components/EmergencyTakeover';
import { StatusRing } from '../components/StatusRing';

describe('AEGIS Frontend Component & Autonomy Suite', () => {
  it('StatusRing renders colorblind-safe symbol + text for all 4 statuses', () => {
    const { rerender } = render(<StatusRing status="NOMINAL" score={94} />);
    expect(screen.getByTestId('status-ring')).toHaveTextContent('✓ nominal');
    expect(screen.getByTestId('status-ring')).toHaveTextContent('94');

    rerender(<StatusRing status="CAUTION" score={68} />);
    expect(screen.getByTestId('status-ring')).toHaveTextContent('▲ caution');

    rerender(<StatusRing status="WARNING" score={51} />);
    expect(screen.getByTestId('status-ring')).toHaveTextContent('■ warning');

    rerender(<StatusRing status="EMERGENCY" score={22} />);
    expect(screen.getByTestId('status-ring')).toHaveTextContent('✖ emergency');
  });

  it('AlertBanner shows hazards, HRP risks, evidence, unverified limit marker, and triggers acknowledge', () => {
    const onAck = vi.fn();
    const sampleAlert: AlertItem = {
      id: 'alert-co2-test',
      rule_id: 'env.co2.high_1h',
      title: 'Elevated Cabin ppCO₂ — Scrubber Fault',
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
        limit_verified: false,
        source_ref: 'NASA-STD-3001 Vol 2, VERIFY',
        window: '1h',
      },
      rationale: 'Indicators consistent with elevated cabin CO2. Recommend CMO review.',
      action: 'Check CDRA/scrubber status; increase ventilation.',
      notes: [],
      origin: 'ONBOARD',
    };

    render(<AlertBanner alerts={[sampleAlert]} onAcknowledge={onAck} />);
    const banner = screen.getByTestId('alert-banner');
    expect(banner).toHaveTextContent('▲ caution');
    expect(banner).toHaveTextContent('HRP-12');
    expect(banner).toHaveTextContent('HRP-14');
    expect(banner).toHaveTextContent('ppco2');
    expect(banner).toHaveTextContent('3.6 mmHg');
    expect(banner).toHaveTextContent('⚠ unverified limit');

    fireEvent.click(screen.getByRole('button', { name: /Acknowledge Alert/i }));
    expect(onAck).toHaveBeenCalledWith('alert-co2-test');
  });

  it('EmergencyTakeover renders SPE shelter procedure, CANS neutron fraction, headcount, and callbacks', () => {
    const initial = buildInitialSystemState(42);
    const onToggleCrew = vi.fn();
    const onEvacuateAll = vi.fn();
    const onAck = vi.fn();
    const onResolve = vi.fn();

    const speAlert: AlertItem = {
      id: 'alert-spe-1',
      rule_id: 'rad.spe.emergency_takeover',
      title: 'SOLAR PARTICLE EVENT (SPE) — Rapid Proton & Secondary Neutron Flux Surge',
      crew_id: null,
      severity: 'EMERGENCY',
      state: 'RAISED',
      raised_ts: '2026-11-14T12:05:00Z',
      hazards: ['RADIATION', 'DISTANCE_FROM_EARTH'],
      hrp_risks: ['HRP-17'],
      evidence: {
        signal: 'dose_rate_equivalent',
        value: 215.0,
        unit: 'µSv/h',
        op: '>',
        limit: 100.0,
        limit_verified: false,
        source_ref: 'Project heuristic',
        window: '5m',
      },
      rationale: 'Indicators consistent with Solar Particle Event.',
      action: 'Report to storm shelter immediately.',
      notes: [],
      origin: 'ONBOARD',
    };

    render(
      <EmergencyTakeover
        alert={speAlert}
        crew={initial.crew}
        radiation={{
          ...initial.radiation,
          spe_active: true,
          dose_rate_equivalent_uSv_h: 215.0,
          neutron_dose_equivalent_rate_uSv_h: 68.8,
          neutron_fraction_pct: 32.0,
        }}
        commDelaySeconds={720}
        groundLagSeconds={720}
        onToggleCrewShelter={onToggleCrew}
        onEvacuateAll={onEvacuateAll}
        onAcknowledge={onAck}
        onResolve={onResolve}
      />
    );

    const dialog = screen.getByTestId('emergency-takeover');
    expect(dialog).toHaveTextContent('EMERGENCY — LEVEL 1');
    expect(dialog).toHaveTextContent('32% neutron share');
    expect(dialog).toHaveTextContent('0/4 Accounted');
    expect(dialog).toHaveTextContent('⚠ unverified limit');

    fireEvent.click(screen.getByRole('button', { name: /Confirm All 4 Crew in Shelter/i }));
    expect(onEvacuateAll).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: /Acknowledge & Monitor on Deck/i }));
    expect(onAck).toHaveBeenCalledWith('alert-spe-1');
  });

  it('App shell renders persistent disclaimer footer, triggers scenarios, and shows Ground Console delay', () => {
    render(<App />);

    // Persistent disclaimer footer
    expect(screen.getByTestId('persistent-disclaimer-footer')).toHaveTextContent(
      'Decision support only, not a medical diagnosis.'
    );
    // Browser-only fallback (no backend): the data line says everything is synthetic.
    expect(screen.getByTestId('data-sources-line')).toHaveTextContent('all synthetic');

    // Trigger CO2 scrubber fault from ScenarioDock
    fireEvent.click(screen.getByRole('button', { name: /CO₂ Scrubber Fault/i }));
    expect(screen.getByTestId('alert-banner')).toHaveTextContent(
      'Elevated Cabin ppCO₂ — CDRA Scrubber Bed A Saturation'
    );

    // Switch to Ground Console and verify Data as of T-Xm Ys header
    fireEvent.click(screen.getByRole('button', { name: /Ground Console/i }));
    expect(screen.getByTestId('ground-delay-banner')).toHaveTextContent(/Data as of T−/i);
  });
});
