import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { mapAlert } from '../api/backend';
import type { BackendAlert } from '../api/backend';
import { DatasetMeta, RadReplayInfo, SignalSource } from '../api/types';
import { DataSourceBadge, dataSourcesLine } from '../components/DataSourceBadge';
import { ReplayLine } from '../views/Radiation';

const CRUISE: DatasetMeta = {
  id: 'msl_rad_cruise_2012',
  label: 'MSL/RAD cruise 2012',
  title: 'MSL Curiosity RAD dose rate in Mars cruise, 2012-04-10 to 2012-04-19 (quiet GCR)',
  source_url: 'https://pds-ppi.igpp.ucla.edu/data/MSL-M-RAD-3-RDR-V1.0/DATA/CRUISE/',
  retrieved: '2026-11-14',
  terms: 'NASA PDS public data',
  transform: 'Kept DOSIMETRY_TOTAL_DOSE_E of every RDR observation.',
};

const measured: SignalSource = {
  provenance: 'NASA_MEASURED',
  dataset_id: CRUISE.id,
  basis: `${CRUISE.title}. ${CRUISE.transform}`,
  dataset: CRUISE,
};

const replay: RadReplayInfo = {
  replay_id: 'rad_cruise',
  dataset_id: CRUISE.id,
  label: CRUISE.label,
  dataset_ts: '2012-04-12T00:30:00Z',
  observation_ts: '2012-04-12T00:28:47Z',
  compression: 1,
  quality: 'GOOD',
  quality_factor: 3.82,
  quality_factor_ref: 'Zeitlin et al. (2013)',
  absorbed_uGy_h: 18.5,
  synthetic_spe_overlay: false,
};

describe('R-2 MSL/RAD replay in the UI', () => {
  it('badge names the NASA dataset and shows the manifest entry on tap (F-006 item 3)', () => {
    render(<DataSourceBadge source={measured} />);
    const badge = screen.getByTestId('data-source-badge');
    expect(badge).toHaveTextContent('NASA · MSL/RAD cruise 2012');
    expect(badge).toHaveAttribute('data-provenance', 'NASA_MEASURED');
    fireEvent.click(badge);
    const manifest = screen.getByTestId('data-source-manifest');
    expect(manifest).toHaveTextContent('pds-ppi.igpp.ucla.edu');
    expect(manifest).toHaveTextContent('Retrieved 2026-11-14');
    expect(manifest).toHaveTextContent('Transform: Kept DOSIMETRY_TOTAL_DOSE_E');
  });

  it('derived values say NASA-derived, not measured', () => {
    render(<DataSourceBadge compact source={{ ...measured, provenance: 'NASA_DERIVED', basis: 'RAD x Q 3.82' }} />);
    expect(screen.getByTestId('data-source-badge')).toHaveTextContent('NASA-derived · MSL/RAD cruise 2012');
  });

  it('alert evidence keeps basis and dataset from the backend', () => {
    const alert = mapAlert({
      id: 'a1',
      rule_id: 'rad.dose.24h',
      title: '24 h dose',
      crew_id: 'C1',
      severity: 'WARNING',
      state: 'RAISED',
      raised_ts: '2026-11-14T20:00:00Z',
      ack_ts: null,
      resolved_ts: null,
      hazards: ['RADIATION'],
      hrp_risks: ['HRP-17'],
      evidence: {
        signal: 'dose_rate_equivalent', value: 2.1, limit: 2.0, window: '24h', limit_verified: false,
        provenance: 'NASA_DERIVED', dataset_id: CRUISE.id, basis: 'RAD x Q', dataset: CRUISE,
      },
      rationale: '',
      action: '',
      checklist: [],
      notes: [],
      origin: 'ONBOARD',
    } as BackendAlert);
    expect(alert.evidence.dataset?.label).toBe('MSL/RAD cruise 2012');
    expect(alert.evidence.basis).toBe('RAD x Q');
  });

  it('replay line labels the measurement time and a held gap', () => {
    const { rerender } = render(<ReplayLine replay={replay} />);
    const line = screen.getByTestId('rad-replay-line');
    expect(line).toHaveTextContent('MSL/RAD cruise 2012');
    expect(line).toHaveTextContent('2012-04-12 00:28 UTC, replayed in real time');
    expect(screen.queryByTestId('rad-replay-held')).toBeNull();
    rerender(<ReplayLine replay={{ ...replay, quality: 'SUSPECT', compression: 60 }} />);
    expect(screen.getByTestId('rad-replay-line')).toHaveTextContent('replayed ×60');
    expect(screen.getByTestId('rad-replay-held')).toHaveTextContent('holding last good value');
    rerender(<ReplayLine replay={null} />);
    expect(screen.getByTestId('rad-replay-line')).toHaveTextContent('simulated background');
  });

  it('footer names the NASA dataset and keeps physiology simulated', () => {
    const line = dataSourcesLine({
      area_dose_rate_absorbed: measured,
      area_dose_rate_equivalent: { ...measured, provenance: 'NASA_DERIVED' },
      heart_rate: { provenance: 'SYNTHETIC', dataset_id: null, basis: '' },
    });
    expect(line).toContain('Radiation, space weather and 14 limits: NASA sources.');
    expect(line).toContain('Replaying: MSL/RAD cruise 2012.');
    expect(line).toContain('Crew physiology: simulated (no public in-flight astronaut data).');
  });
});
