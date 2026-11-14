import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { buildInitialSystemState, formatOneWayDelay } from '../api/client';
import { AlertItem, DelaySource, RadReplayInfo, SpaceWeatherEvent } from '../api/types';
import { AlertBanner } from '../components/AlertBanner';
import { EmergencyTakeover } from '../components/EmergencyTakeover';
import { SpaceWeatherCard } from '../components/SpaceWeatherCard';

const horizons: DelaySource = {
  delay_s: 657.3,
  provenance: 'NASA_DERIVED',
  dataset_id: 'horizons_earth_mars_2026',
  basis: 'Earth-Mars one-way light time on 2026-11-14 from the JPL Horizons Earth-Mars ephemeris (range / c).',
  date: '2026-11-14',
};

const meta = (id: string) => ({
  id,
  label: id,
  title: id,
  source_url: 'https://example.invalid/',
  retrieved: '2026-11-14',
  terms: 'public',
  transform: 'none',
});

const event: SpaceWeatherEvent = {
  available: true,
  event_date: '2012-03-07',
  title: 'Solar particle event of 7-10 March 2012',
  provenance: 'NASA_MEASURED',
  sep: [],
  flares: [],
  cmes: [],
  flux: {
    label: '>10 MeV integral proton flux, near Earth (1 AU)',
    unit: 'pfu',
    points: [
      ['2012-03-07T00:30:00Z', 1.2],
      ['2012-03-08T11:30:00Z', 4559.95],
      ['2012-03-09T00:30:00Z', null],
      ['2012-03-10T00:30:00Z', 300],
    ],
    suspect: ['2012-03-09T00:30:00Z'],
    peak_pfu: 4559.95,
    peak_utc: '2012-03-08T11:30:00Z',
    peak_level: 'S3',
  },
  s_scale: ['S1', 'S2', 'S3', 'S4', 'S5'].map((level, i) => ({
    level,
    ref: `space_weather.proton_flux_${level.toLowerCase()}_pfu`,
    value: 10 ** (i + 1),
    source_ref: 'NOAA SWPC Space Weather Scales; a NOAA scale, not a NASA-STD-3001 limit',
    verified: false,
  })),
  sources: { sep: meta('donki_sep_2012_03'), events: meta('donki_flr_cme_2012_03'), flux: meta('omni2_proton_flux_2012_03') },
  problems: [],
  primary: {
    sep: { id: '2012-03-07T01:44:00-SEP-001', time: '2012-03-07T01:44Z', instruments: [], linked: [], link: null },
    flare: { id: 'f', class: 'X5.4', begin: null, peak: '2012-03-07T00:24Z', location: 'N18E31', region: 11429, link: null },
    cme: { id: 'c', start: '2012-03-07T00:36Z', speed_km_s: 2200, type: 'R', half_angle_deg: 50, linked: [], link: null },
  },
};

const speReplay: RadReplayInfo = {
  replay_id: 'rad_spe',
  dataset_id: 'msl_rad_spe_2012_03',
  label: 'MSL/RAD SPE Mar 2012',
  dataset_ts: '2012-03-08T06:00:00Z',
  observation_ts: '2012-03-08T05:50:00Z',
  compression: 20,
  quality: 'GOOD',
  quality_factor: 1.17,
  quality_factor_ref: 'Zeitlin et al. (2013)',
  absorbed_uGy_h: 500,
  synthetic_spe_overlay: false,
  event_date: '2012-03-07',
  donki_id: '2012-03-07T01:44:00-SEP-001',
};

describe('R-4 light-time delay', () => {
  it('labels the Horizons delay with its date, and leaves fixed delays plain', () => {
    expect(formatOneWayDelay(657.3, horizons)).toBe('10m 57s (JPL Horizons, 2026-11-14)');
    expect(formatOneWayDelay(720, { ...horizons, provenance: 'SYNTHETIC', date: null })).toBe('12m 00s');
    expect(formatOneWayDelay(720, null)).toBe('12m 00s');
  });
});

describe('R-5 space-weather card', () => {
  it('renders the real event, the NOAA level as unverified, and marks the onboard replay time', () => {
    render(
      <SpaceWeatherCard event={event} connected replay={speReplay} delaySeconds={657} blackout={false} onForward={async () => true} />
    );
    expect(screen.getByTestId('spaceweather-flare')).toHaveTextContent('X5.4');
    expect(screen.getByTestId('spaceweather-cme')).toHaveTextContent('2200 km/s');
    expect(screen.getByTestId('spaceweather-sep')).toHaveTextContent('2012-03-07T01:44:00-SEP-001');
    const card = screen.getByTestId('spaceweather-card');
    expect(card).toHaveTextContent('4560 pfu');
    expect(card).toHaveTextContent('not a NASA limit');
    expect(card).toHaveTextContent('⚠ unverified');
    expect(card).toHaveTextContent('◆NASA · omni2_proton_flux_2012_03');
    expect(screen.getByTestId('spaceweather-replay-marker')).toBeInTheDocument();
  });

  it('forwards the brief through the link (button >= 44 px) and says so', async () => {
    const onForward = vi.fn(async () => true);
    render(<SpaceWeatherCard event={event} connected delaySeconds={657} blackout onForward={onForward} />);
    const btn = screen.getByTestId('spaceweather-forward-btn');
    expect(btn.className).toContain('min-h-[44px]');
    expect(btn).toHaveTextContent('ETA +10m 57s');
    fireEvent.click(btn);
    await waitFor(() => expect(screen.getByTestId('spaceweather-forward-status')).toHaveTextContent('waits for the link'));
    expect(onForward).toHaveBeenCalledTimes(1);
  });

  it('explains itself in browser-only mode instead of inventing data', () => {
    render(<SpaceWeatherCard event={null} connected={false} delaySeconds={720} blackout={false} onForward={async () => false} />);
    expect(screen.getByTestId('spaceweather-card')).toHaveTextContent('not available in browser-only mode');
  });
});

describe('F-009 evidence readability', () => {
  const base: AlertItem = {
    id: 'a-compound',
    rule_id: 'cog.performance_risk',
    title: 'Cognitive performance risk',
    crew_id: 'C1',
    severity: 'CAUTION',
    state: 'RAISED',
    raised_ts: '2026-11-14T12:00:00Z',
    hazards: ['ISOLATION_CONFINEMENT'],
    hrp_risks: ['HRP-04'],
    evidence: { signal: 'compound', value: 2, limit: 2, limit_verified: false, window: '', provenance: 'SYNTHETIC' },
    rationale: 'Short sleep plus high CO2.',
    action: 'Defer complex tasks.',
    checklist: ['Defer complex tasks'],
    notes: [],
    origin: 'ONBOARD',
  };

  it('AlertBanner phrases compound evidence in plain words, with no stray operator or "over"', () => {
    render(<AlertBanner alerts={[base]} onAcknowledge={() => undefined} />);
    expect(screen.getByTestId('banner-compound-evidence')).toHaveTextContent('Combined indicators: 2 of 2 conditions met');
    const banner = screen.getByTestId('alert-banner');
    expect(banner).not.toHaveTextContent('over )');
    expect(banner).not.toHaveTextContent('(> limit');
  });

  it('EmergencyTakeover shows the rule value + unit and the RAD replay line', () => {
    const initial = buildInitialSystemState();
    const alert: AlertItem = {
      ...base,
      id: 'a-spe',
      rule_id: 'rad.spe.dose_rate',
      severity: 'EMERGENCY',
      crew_id: null,
      evidence: {
        signal: 'area_dose_rate_equivalent',
        value: 612.4,
        unit: 'µSv/h',
        op: '>',
        limit: 250,
        limit_verified: false,
        window: '',
        provenance: 'NASA_DERIVED',
      },
    };
    render(
      <EmergencyTakeover
        alert={alert}
        crew={initial.crew}
        radiation={{ ...initial.radiation, replay: speReplay }}
        commDelaySeconds={657}
        groundLagSeconds={660}
        onToggleCrewShelter={() => undefined}
        onEvacuateAll={() => undefined}
        onAcknowledge={() => undefined}
        onResolve={() => undefined}
      />
    );
    expect(screen.getByTestId('takeover-evidence-value')).toHaveTextContent('612.4 µSv/h');
    const line = screen.getByTestId('rad-replay-line');
    expect(line).toHaveTextContent('replayed ×20');
    expect(line).toHaveTextContent('DONKI 2012-03-07T01:44:00-SEP-001');
    expect(screen.getByTestId('emergency-takeover')).not.toHaveTextContent('over )');
  });
});
