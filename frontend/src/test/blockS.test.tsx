import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import App from '../App';

// Block S (ROADMAP §0c): the app is organised by who is looking. Browser-only fallback (no backend) is enough here.
const nav = (): HTMLElement => screen.getByRole('navigation', { name: 'Main Views' });
const tabNames = (): string[] =>
  within(nav())
    .getAllByRole('button')
    .map((b) => b.textContent ?? '');

describe('S-1 roles', () => {
  beforeEach(() => window.localStorage.clear());

  it('starts as crew with only Today, My health and Journal', () => {
    render(<App />);
    expect(screen.getByTestId('role-crew')).toHaveAttribute('aria-pressed', 'true');
    const names = tabNames();
    expect(names).toEqual(expect.arrayContaining(['Today', 'My health', 'Journal']));
    expect(names.some((n) => /Crew member|Radiation|Alert Center|Ground Console/.test(n))).toBe(false);
  });

  it('CMO sees Crew, Crew member and Radiation; ground sees only the console', () => {
    render(<App />);
    fireEvent.click(screen.getByTestId('role-cmo'));
    expect(tabNames()).toEqual(expect.arrayContaining(['Crew', 'Crew member (C1)', 'Radiation']));
    expect(tabNames()).not.toContain('Today');
    fireEvent.click(screen.getByTestId('role-ground'));
    expect(screen.getByTestId('ground-console-view')).toBeInTheDocument();
    expect(screen.queryByTestId('alert-banner')).toBeNull();
    expect(window.localStorage.getItem('aegis.role')).toBe('ground');
  });

  it('demo controls are closed by default and open with one tap', () => {
    render(<App />);
    expect(screen.queryByTestId('scenario-dock')).toBeNull();
    fireEvent.click(screen.getByTestId('demo-controls-toggle'));
    expect(screen.getByTestId('scenario-dock')).toBeInTheDocument();
  });

  it("the crew member's own page has no CMO sections and starts with the charts folded", () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'My health' }));
    expect(screen.getByTestId('crew-detail-view')).toBeInTheDocument();
    expect(screen.queryByTestId('weekly-adherence-onboard')).toBeNull();
    expect(screen.queryByTestId('shared-journal')).toBeNull();
    const fold = within(screen.getByTestId('crew-charts')).getByRole('button', { name: /Charts and trends/ });
    expect(fold).toHaveAttribute('aria-expanded', 'false');
    expect(fold.className).toContain('min-h-[44px]');
    fireEvent.click(fold);
    expect(fold).toHaveAttribute('aria-expanded', 'true');
  });

  it('the CMO page keeps its weekly chart and the charts open', () => {
    render(<App />);
    fireEvent.click(screen.getByTestId('role-cmo'));
    fireEvent.click(screen.getByRole('button', { name: 'Crew member (C1)' }));
    expect(screen.getByTestId('weekly-adherence-onboard')).toBeInTheDocument();
    expect(within(screen.getByTestId('crew-charts')).getByRole('button', { name: /Charts and trends/ })).toHaveAttribute(
      'aria-expanded',
      'true'
    );
  });
});

describe('S-3 alerts in one place', () => {
  beforeEach(() => window.localStorage.clear());

  it('no Alert Center tab; the header chip opens and closes the alert panel', () => {
    render(<App />);
    expect(screen.queryByRole('button', { name: /Alert Center/ })).toBeNull();
    fireEvent.click(screen.getByTestId('alerts-chip'));
    expect(screen.getByTestId('alerts-panel')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close alerts' }));
    expect(screen.queryByTestId('alerts-panel')).toBeNull();
  });

  it('a raised alert shows in the banner and its count in the chip', () => {
    render(<App />);
    fireEvent.click(screen.getByTestId('demo-controls-toggle'));
    fireEvent.click(screen.getByRole('button', { name: /CO₂ Scrubber Fault/i }));
    expect(screen.getByTestId('alert-banner')).toBeInTheDocument();
    expect(screen.getByTestId('alerts-chip').textContent).toMatch(/Alerts \([1-9]/);
  });
});
