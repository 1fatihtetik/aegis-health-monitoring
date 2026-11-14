import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SignalSource } from '../api/types';
import { DataSourceBadge, dataSourcesLine } from '../components/DataSourceBadge';
import { SeveritySublabel } from '../components/SeveritySublabel';

// Block T, T-0: CREW_ENTERED = typed or tapped by a person on the tablet. No dataset, never "measured".
const entered: SignalSource = {
  provenance: 'CREW_ENTERED',
  dataset_id: null,
  basis: 'Entered by the crew on the onboard tablet (form). Kept in memory only, not a NASA record.',
};

describe('T-0 CREW_ENTERED provenance', () => {
  it('badge says crew-entered, never NASA or measured', () => {
    render(<DataSourceBadge source={entered} />);
    const badge = screen.getByTestId('data-source-badge');
    expect(badge).toHaveTextContent('Crew-entered');
    expect(badge).toHaveAttribute('data-provenance', 'CREW_ENTERED');
    expect(badge.textContent).not.toMatch(/NASA|Measured/);
    expect(badge.className).toContain('min-h-[44px]');
  });

  it('footer names crew entries next to the NASA sources', () => {
    const line = dataSourcesLine({ symptom_headache: entered });
    expect(line).toContain('Self-test entries: crew-entered.');
    expect(line).not.toMatch(/Radiation: NASA/);
  });
});

describe('T-0 severity sublabel (PRD §7.4)', () => {
  it.each([
    ['CAUTION', 'LOMO'],
    ['WARNING', 'LOM'],
    ['EMERGENCY', 'LOC'],
  ] as const)('%s shows %s', (severity, code) => {
    render(<SeveritySublabel severity={severity} />);
    expect(screen.getByTestId('severity-sublabel')).toHaveTextContent(code);
  });

  it('INFO has no sublabel', () => {
    const { container } = render(<SeveritySublabel severity="INFO" />);
    expect(container).toBeEmptyDOMElement();
  });
});
