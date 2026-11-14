import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import bundledCsv from '../../../data/nasa/derived/inspiration4_cbc_cmp_aggregate.csv?raw';
import {
  Inspiration4ReferencePanel,
  changeText,
  parseInspiration4Csv,
  preflightMean,
} from '../components/Inspiration4Panel';

// P-6: Inspiration4 aggregate CBC/CMP reference panel (ROADMAP §0.3). Aggregate only, renders offline.
describe('P-6 Inspiration4 reference panel', () => {
  it('bundled file parses to aggregate rows only (no per-person data)', () => {
    const panel = parseInspiration4Csv(bundledCsv);
    expect(panel.available).toBe(true);
    expect(panel.crew_n).toBe(4);
    expect(panel.provenance).toBe('NASA_MEASURED');
    expect(panel.analytes.every((a) => a.points.every((p) => p.n >= 3))).toBe(true);
    expect(bundledCsv).not.toMatch(/SUBJECT_ID|C00[1-9]/);
  });

  it('refuses a file with per-person columns', () => {
    const bad = 'ANALYTE,VALUE,SUBJECT_ID,SEX,timepoint\nHEMOGLOBIN,14,C001,M,L-3\n';
    const panel = parseInspiration4Csv(bad);
    expect(panel.available).toBe(false);
    expect(panel.problem).toMatch(/per-person/);
  });

  it('computes the pre-flight average and a plain-language change', () => {
    const a = {
      panel: 'CBC',
      analyte: 'X',
      unit: 'u',
      ref_low: 1,
      ref_high: 20,
      ref_note: '',
      points: [
        { timepoint: 'L-92', n: 4, mean: 10, sd: 1 },
        { timepoint: 'L-44', n: 4, mean: 10, sd: 1 },
        { timepoint: 'L-3', n: 4, mean: 10, sd: 1 },
        { timepoint: 'R+1', n: 4, mean: 12, sd: 1 },
      ],
    };
    expect(preflightMean(a)).toBe(10);
    expect(changeText(a)).toBe('up 20 %');
  });

  it('renders offline from the bundled copy with a NASA badge and >= 44 px controls', () => {
    render(<Inspiration4ReferencePanel initial={null} />);
    expect(screen.getByTestId('inspiration4-panel')).toHaveTextContent('Not a diagnosis');
    const badge = screen.getByTestId('data-source-badge');
    expect(badge).toHaveAttribute('data-provenance', 'NASA_MEASURED');
    expect(screen.getAllByTestId('inspiration4-row')).toHaveLength(8);
    const toggle = screen.getByTestId('inspiration4-toggle');
    expect(toggle.className).toContain('min-h-[44px]');
    fireEvent.click(toggle);
    expect(screen.getAllByTestId('inspiration4-row').length).toBeGreaterThan(30);
  });

  it('shows the reason when the panel is unavailable', () => {
    const panel = { ...parseInspiration4Csv(bundledCsv), available: false, analytes: [], problem: 'sha256 mismatch' };
    render(<Inspiration4ReferencePanel initial={panel} />);
    expect(screen.getByTestId('inspiration4-unavailable')).toHaveTextContent('sha256 mismatch');
  });
});
