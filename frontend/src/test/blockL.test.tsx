import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BUNDLED_LIMITS, SOURCE_KIND_LABEL, evidenceMarker, limitCounts, limitKindOf, notNasaLabel } from '../api/limits';
import { LimitSourceKind, Provenance } from '../api/types';
import { DataSourceBadge, dataSourcesLine } from '../components/DataSourceBadge';
import { DataSourcesPanel, openDataSourcesPanel } from '../components/DataSourcesPanel';
import { LimitBadge } from '../components/LimitBadge';

// Block L (ROADMAP §0a): labels say what a value IS. Wording only; data, limits and verified flags are unchanged.
describe('L-1 data source badge', () => {
  it.each<[Provenance, string]>([
    ['SYNTHETIC', 'Simulated'],
    ['SYNTHETIC_CALIBRATED', 'Simulated · NASA-calibrated'],
    ['NASA_DERIVED', 'NASA-derived'],
    ['CREW_ENTERED', 'Crew-entered'],
  ])('%s reads "%s" and never "Synthetic"', (provenance, text) => {
    render(<DataSourceBadge source={{ provenance, dataset_id: null, basis: '' }} />);
    const badge = screen.getByTestId('data-source-badge');
    expect(badge.textContent).toContain(text);
    expect(badge.textContent).not.toMatch(/synthetic/i);
  });

  it('badge details open the data panel', () => {
    render(
      <>
        <DataSourceBadge source={{ provenance: 'SYNTHETIC', dataset_id: null, basis: '' }} />
        <DataSourcesPanel provenance={{}} />
      </>,
    );
    fireEvent.click(screen.getByTestId('data-source-badge'));
    fireEvent.click(screen.getByTestId('data-source-panel-link'));
    expect(screen.getByTestId('data-sources-panel')).toBeInTheDocument();
  });
});

describe('L-1 limit marker', () => {
  it('every unverified limit has a kind; verified limits have none', () => {
    for (const l of Object.values(BUNDLED_LIMITS)) {
      if (l.verified) expect(l.source_kind).toBeUndefined();
      else expect(Object.keys(SOURCE_KIND_LABEL)).toContain(l.source_kind);
    }
  });

  it.each<[string, LimitSourceKind, string]>([
    ['physiology.spo2_pct_min', 'clinical', 'Not a NASA limit · Clinical guideline'],
    ['cognition.pvt_lapse_ms', 'published', 'Not a NASA limit · Published source'],
    ['readiness.eva_go_min', 'design', 'Not a NASA limit · AEGIS design setting'],
    ['bone.bmd_loss_pct_per_month_expected_0g', 'nasa_reference', 'Not a NASA limit · NASA reference, not a standard'],
  ])('%s is %s', (ref, kind, text) => {
    expect(BUNDLED_LIMITS[ref].source_kind).toBe(kind);
    render(<LimitBadge limit={BUNDLED_LIMITS[ref]} />);
    const marker = screen.getByTestId('not-nasa-limit');
    expect(marker.textContent).toBe(text);
    expect(marker.textContent).not.toMatch(/✓ NASA|unverified/);
  });

  it('no unverified limit ever renders the verified NASA badge', () => {
    for (const l of Object.values(BUNDLED_LIMITS).filter((x) => !x.verified)) {
      const { container, unmount } = render(<LimitBadge limit={l} />);
      expect(container.textContent).toMatch(/^Not a NASA limit/);
      expect(container.textContent).not.toContain('✓ NASA');
      unmount();
    }
  });

  it('verified limits keep "✓ NASA [Vx nnnn]"', () => {
    render(<LimitBadge limit={BUNDLED_LIMITS['environment.ppco2_mmHg_1h_max']} />);
    expect(screen.getByText('✓ NASA [V2 6004]')).toBeInTheDocument();
  });

  it('finds the kind offline from the ref or the source_ref, and never drops the marker', () => {
    expect(limitKindOf({ ref: 'physiology.hr_bpm.max' })).toBe('clinical');
    expect(limitKindOf({ sourceRef: BUNDLED_LIMITS['sleep.min_sleep_h_24h'].source_ref })).toBe('design');
    expect(evidenceMarker({ limit_ref: 'physiology.spo2_pct_min' })).toBe('Not a NASA limit · Clinical guideline');
    expect(evidenceMarker({ limit_source_kind: 'published' })).toBe('Not a NASA limit · Published source');
    expect(notNasaLabel(undefined)).toBe('Not a NASA limit');
    expect(notNasaLabel('bogus')).toBe('Not a NASA limit');
  });
});

describe('L-1 footer line', () => {
  it('names NASA sources with a counted limit total and says physiology is simulated', () => {
    const n = limitCounts().nasa;
    expect(n).toBe(14);
    const line = dataSourcesLine({
      area_dose_rate_equivalent: { provenance: 'NASA_MEASURED', dataset_id: 'msl_rad_cruise_2012', basis: '' },
      heart_rate: { provenance: 'SYNTHETIC_CALIBRATED', dataset_id: null, basis: '' },
    });
    expect(line.startsWith(
      `Radiation, space weather and ${n} limits: NASA sources. Crew physiology: simulated (no public in-flight astronaut data).`,
    )).toBe(true);
    expect(line).not.toMatch(/synthetic/i);
  });
});

describe('L-2 where our data comes from', () => {
  it('opens from the footer toggle, shows every section and counts per kind from limits.yaml', () => {
    render(<DataSourcesPanel provenance={{}} />);
    const toggle = screen.getByTestId('data-sources-panel-toggle');
    expect(toggle.className).toContain('min-h-[44px]');
    fireEvent.click(toggle);
    const panel = screen.getByTestId('data-sources-panel');
    for (const id of ['panel-nasa', 'panel-other', 'panel-simulated', 'panel-crew', 'panel-limits']) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
    }
    expect(screen.getByTestId('panel-simulated').textContent).toMatch(/restricted for crew privacy/);
    expect(screen.getByTestId('panel-other').textContent).toMatch(/EPA RadNet/);
    const counts = limitCounts();
    expect(counts.nasa + Object.values(counts.byKind).reduce((a, b) => a + b, 0)).toBe(counts.total);
    for (const [kind, count] of Object.entries(counts.byKind)) {
      expect(screen.getByTestId(`panel-kind-${kind}`).textContent).toContain(`: ${count},`);
    }
    expect(panel.textContent).not.toMatch(/point|streak|leaderboard|level-up/i);
  });

  it('opens from anywhere through openDataSourcesPanel()', () => {
    render(<DataSourcesPanel provenance={{}} />);
    expect(screen.queryByTestId('data-sources-panel')).toBeNull();
    act(() => openDataSourcesPanel());
    expect(screen.getByTestId('data-sources-panel')).toBeInTheDocument();
  });
});
