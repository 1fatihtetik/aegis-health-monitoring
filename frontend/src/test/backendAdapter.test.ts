import { describe, expect, it } from 'vitest';
import {
  BackendAlert,
  BackendSnapshot,
  applyOnboardSnapshot,
  extendHistory,
  mapAlert,
} from '../api/backend';
import { buildInitialSystemState } from '../api/client';
import fixture from './fixtures/backend_spe.json';

// Real payloads captured from the backend running spe_event (seed 42). Synthetic data.
const snap = fixture.snapshot as unknown as BackendSnapshot;
const alerts = (fixture.alerts as unknown as BackendAlert[]).map(mapAlert);

describe('backend snapshot adapter (G3-1)', () => {
  const prev = buildInitialSystemState(42);
  const history = { crew: {}, environment: {}, baselines: {} };
  extendHistory(history, snap);
  const state = applyOnboardSnapshot({ prev, snap, history, alerts });

  it('marks the state as backend-driven and copies sim + link from the snapshot', () => {
    expect(state.sim.backend_connected).toBe(true);
    expect(state.sim.active_scenario).toBe('spe_event');
    expect(state.sim.sim_ts).toBe(snap.now);
    expect(state.sim.running).toBe(!snap.sim.paused);
    expect(state.link.one_way_delay_s).toBe(snap.link.delay_s);
    expect(state.link.lag_seconds).toBe(Math.round(snap.link.ground_age_s));
  });

  it('renders backend crew, not the local fake crew', () => {
    expect(state.crew.map((c) => c.id)).toEqual(['C1', 'C2', 'C3', 'C4']);
    expect(state.crew[0].callsign).toBe(snap.crew?.[0].callsign);
    expect(state.crew[0].status).toBe('EMERGENCY');
    expect(state.crew[0].readiness.PHYSICAL.components.length).toBeGreaterThan(0);
    expect(state.crew[0].sparklines.heart_rate.length).toBe(1);
  });

  it('maps radiation: SPE active, area dose rate, neutron spectrum from the backend', () => {
    expect(state.radiation.spe_active).toBe(true);
    expect(state.radiation.status).toBe('EMERGENCY');
    expect(state.radiation.dose_rate_equivalent_uSv_h).toBeCloseTo(snap.radiation?.area.dose_rate_uSv_h ?? -1, 0);
    expect(state.radiation.spectrum_bins).toHaveLength(5);
  });

  it('keeps alert evidence with limit source and verified flag', () => {
    const spe = state.alerts.find((a) => a.rule_id === 'rad.spe.dose_rate');
    expect(spe?.severity).toBe('EMERGENCY');
    expect(spe?.evidence.limit_verified).toBe(false);
    expect(spe?.evidence.source_ref).toBeTruthy();
    expect(spe?.hazards).toContain('RADIATION');
  });

  it('extends history only when simulated time moves on', () => {
    extendHistory(history, snap);
    const again = applyOnboardSnapshot({ prev, snap, history, alerts });
    expect(again.crew[0].sparklines.heart_rate.length).toBe(1);
  });
});
