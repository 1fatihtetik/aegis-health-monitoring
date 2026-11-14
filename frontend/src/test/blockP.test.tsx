import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DatasetMeta, SignalSource } from '../api/types';
import { DataSourceBadge, dataSourcesLine } from '../components/DataSourceBadge';

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
