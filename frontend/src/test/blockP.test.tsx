import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DatasetMeta, GravityEffect, RadReplayInfo, SignalSource } from '../api/types';
import { DataSourceBadge, dataSourcesLine } from '../components/DataSourceBadge';
import { GravityEffectNote, gravityEffectLines } from '../components/GravityEffectNote';
import { ReplayLine } from '../components/ReplayLine';

// Block P, P-0: MEASURED_OTHER = measured by another agency (e.g. EPA RadNet). Never shown as NASA.
const RADNET: DatasetMeta = {
  id: 'radnet_test',
  label: 'RadNet test station',
  title: 'EPA RadNet gamma exposure rate, test window',
  source_url: 'https://www.epa.gov/radnet',
  retrieved: '2026-11-14',
  terms: 'US government public data',
  transform: 'mR/h x 10 -> uSv/h',
  agency: 'EPA',
};

const other: SignalSource = {
  provenance: 'MEASURED_OTHER',
  dataset_id: RADNET.id,
  basis: `${RADNET.title}. ${RADNET.transform}`,
  dataset: RADNET,
};

describe('P-0 MEASURED_OTHER provenance', () => {
  it('badge names the measuring agency and never says NASA', () => {
    render(<DataSourceBadge source={other} />);
    const badge = screen.getByTestId('data-source-badge');
    expect(badge).toHaveTextContent('Measured · EPA · RadNet test station');
    expect(badge).toHaveAttribute('data-provenance', 'MEASURED_OTHER');
    expect(badge.textContent).not.toMatch(/NASA/);
    expect(badge).toHaveAttribute('aria-label', expect.stringContaining('Measured · EPA'));
    expect(badge.className).toContain('min-h-[44px]');
    fireEvent.click(badge);
    const details = screen.getByTestId('data-source-details');
    expect(details).toHaveTextContent('another agency (not NASA)');
    expect(screen.getByTestId('data-source-manifest')).toHaveTextContent('www.epa.gov/radnet');
  });

  it('falls back to "non-NASA" when the manifest has no agency', () => {
    const noAgency: SignalSource = { ...other, dataset: { ...RADNET, agency: undefined } };
    render(<DataSourceBadge compact source={noAgency} />);
    expect(screen.getByTestId('data-source-badge')).toHaveTextContent('Measured · non-NASA · RadNet test station');
  });

  it('a dataset that claims NASA as agency still never reads as NASA under MEASURED_OTHER', () => {
    const odd: SignalSource = { ...other, dataset: { ...RADNET, agency: 'NASA' } };
    render(<DataSourceBadge source={odd} />);
    expect(screen.getByTestId('data-source-badge')).toHaveTextContent('Measured · non-NASA');
  });

  it('footer lists non-NASA measurements apart from NASA sources', () => {
    const nasa: SignalSource = {
      provenance: 'NASA_MEASURED',
      dataset_id: 'msl_rad_cruise_2012',
      basis: '',
      dataset: { ...RADNET, id: 'msl_rad_cruise_2012', label: 'MSL/RAD cruise 2012', agency: 'NASA' },
    };
    const both = dataSourcesLine({ area_dose_rate_absorbed: other, area_dose_rate_equivalent: nasa });
    expect(both).toContain('Radiation: NASA data (MSL/RAD cruise 2012).');
    expect(both).toContain('Non-NASA measurements: EPA RadNet test station.');
    expect(both).not.toContain('NASA data (RadNet');

    const onlyOther = dataSourcesLine({
      area_dose_rate_absorbed: other,
      heart_rate: { provenance: 'SYNTHETIC', dataset_id: null, basis: '' },
    });
    expect(onlyOther).toContain('Non-NASA measurements: EPA RadNet test station.');
    expect(onlyOther).not.toContain('Radiation: NASA data');
    expect(onlyOther).toContain('Crew physiology and cabin air: synthetic');
  });
});

// Block P, P-1..P-3: the replay line names the real instrument, never assumes MSL/RAD.
const base: RadReplayInfo = {
  replay_id: 'iss_leo',
  dataset_id: 'iss_dostel1_2019_01',
  label: 'ISS DOSTEL-1 2019',
  dataset_ts: '2019-01-03T00:30:00Z',
  observation_ts: '2019-01-03T00:29:40Z',
  compression: 1,
  quality: 'GOOD',
  quality_factor: 2.26,
  quality_factor_ref: 'Berger et al. (2017)',
  absorbed_uGy_h: 5.4,
  synthetic_spe_overlay: false,
  instrument: 'ISS Columbus DOSTEL-1 absorbed dose rate in silicon',
  measures: 'absorbed',
  measured_provenance: 'NASA_MEASURED',
  agency: 'NASA',
  saa: false,
};

describe('P-1..P-3 replay line', () => {
  it('names the ISS instrument and explains an SAA crossing', () => {
    const { rerender } = render(<ReplayLine replay={base} />);
    const line = screen.getByTestId('rad-replay-line');
    expect(line).toHaveTextContent('ISS Columbus DOSTEL-1');
    expect(line).toHaveTextContent('Dose equivalent = measured dose × Q 2.26');
    expect(line).not.toHaveTextContent('Curiosity');
    expect(screen.queryByTestId('rad-replay-saa')).toBeNull();
    rerender(<ReplayLine replay={{ ...base, saa: true }} />);
    expect(screen.getByTestId('rad-replay-saa')).toHaveTextContent('not a solar event');
  });

  it('marks the EPA RadNet replay as non-NASA and shows the reverse formula', () => {
    render(
      <ReplayLine
        replay={{
          ...base,
          replay_id: 'radnet_earth',
          label: 'EPA RadNet Houston 2024',
          instrument: 'EPA RadNet Houston TX gamma dose equivalent rate at ground level',
          measures: 'equivalent',
          measured_provenance: 'MEASURED_OTHER',
          agency: 'EPA',
          quality_factor: 1,
          saa: null,
        }}
      />,
    );
    expect(screen.getByTestId('rad-replay-agency')).toHaveTextContent('Measured by EPA, not NASA');
    expect(screen.getByTestId('rad-replay-line')).toHaveTextContent('Absorbed dose = dose equivalent ÷ Q 1');
  });
});

// Block P, P-5: the Gravity tile explains the linear model in plain words.

const mars: GravityEffect = {
  model: 'LINEAR',
  gravity_g: 0.38,
  load_factor: 0.62,
  bmd_loss_pct_month: 0.343,
  bmd_loss_pct_month_0g: 0.553,
  bp_offset_mmHg: [3.0, 3.4],
  hr_offset_bpm: 0,
  unloaded_days: 141.5,
  days_at_low_g: 141.5,
  transition: {
    ts: '2026-11-15T12:30:00Z', from_g: 0, to_g: 0.38, days_at_low_g: 141.5, presyncope_fraction: 0.83, risk: 0.315,
  },
  basis: 'Linear model ... Synthetic physiology, not a diagnosis.',
};

describe('P-5 gravity tile', () => {
  it('states the drift share, the blood-pressure shift and the landing risk', () => {
    const lines = gravityEffectLines(mars).join(' ');
    expect(lines).toContain('62% of the zero-g rate');
    expect(lines).toContain('+3/+3 mmHg');
    expect(lines).toContain('fainting risk when standing up ~32%');
    expect(lines).not.toMatch(/you have/i); // decision support, never a diagnosis
  });

  it('shows no loss at 1 g and renders the synthetic label', () => {
    const earth = { ...mars, gravity_g: 1, load_factor: 0, bmd_loss_pct_month: 0, transition: null };
    expect(gravityEffectLines(earth)[0]).toContain('no further bone or fitness loss');
    render(<GravityEffectNote gravity={mars} />);
    expect(screen.getByTestId('gravity-effect')).toHaveTextContent('Synthetic (linear gravity model');
  });
});
