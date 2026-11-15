import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BUNDLED_LIMITS } from '../api/limits';
import { bandText, buildObservations, needsConfirmation, parseEntry, rulesTripped } from '../api/selftests';
import { ScheduleItem, SignalSource } from '../api/types';
import { MeasurementForm } from '../components/MeasurementForm';
import { TodayList } from '../components/TodayList';
import { SelfTestExplainer } from '../components/SelfTestExplainer';
import { bpTest, spo2Field, sysField } from './fixtures/selftests';
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
    expect(line).not.toMatch(/Radiation, space weather/);
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

// ---- T-3 guided measurements -----------------------------------------------------------------------------------
describe('T-3 entry helpers', () => {
  it('refuses empty, non-numeric and implausible values in plain words', () => {
    expect(parseEntry(spo2Field, '').error).toMatch(/Enter/);
    expect(parseEntry(spo2Field, 'abc').error).toMatch(/not a number/);
    expect(parseEntry(spo2Field, '980').error).toMatch(/outside 50–100 %/);
    expect(parseEntry(spo2Field, '97')).toEqual({ value: 97, error: null });
    expect(parseEntry({ ...spo2Field, step: 0.1 }, '96,5').value).toBe(96.5);
  });

  it('finds the single-value rules a value trips; compound members alone do not count', () => {
    expect(rulesTripped(spo2Field, 88).map((r) => r.rule_id)).toEqual(['physio.spo2.low']);
    expect(rulesTripped(spo2Field, 97)).toEqual([]);
    expect(rulesTripped(sysField, 85)).toEqual([]); // orthostatic is a compound rule
    expect(needsConfirmation(rulesTripped(spo2Field, 88))).toBe(true); // WARNING
    expect(needsConfirmation(rulesTripped(sysField, 170))).toBe(false); // CAUTION
  });

  it('describes the band from the rule limits', () => {
    expect(bandText(spo2Field)).toBe('92 % or more');
    expect(bandText(sysField)).toBe('up to 160 mmHg');
  });

  it('labels every value CREW_ENTERED with the entry method and one shared timestamp', () => {
    const obs = buildObservations({
      crewId: 'C2',
      testId: 'bp_spo2',
      method: 'form',
      values: { bp_systolic: 118, spo2: 97 },
      units: { bp_systolic: 'mmHg', spo2: '%' },
      ts: '2026-11-14T20:00:00Z',
      phase: 'MARS_TRANSIT',
    });
    expect(obs).toHaveLength(2);
    for (const o of obs) {
      expect(o).toMatchObject({
        provenance: 'CREW_ENTERED',
        entry_method: 'form',
        test_id: 'bp_spo2',
        crew_id: 'C2',
        ts: '2026-11-14T20:00:00Z',
      });
      expect(o).not.toHaveProperty('dataset_id');
    }
    expect(new Set(obs.map((o) => o.id)).size).toBe(2);
  });
});

describe('T-3 MeasurementForm', () => {
  it('shows the catalog text: why, band with the not-NASA marker, CMO escalation', () => {
    render(<SelfTestExplainer test={bpTest} limits={BUNDLED_LIMITS} />);
    expect(screen.getByTestId('selftest-why')).toHaveTextContent('heart and lungs');
    expect(screen.getByTestId('selftest-band')).toHaveTextContent('Not a NASA limit · Clinical guideline');
    expect(screen.getByTestId('selftest-escalation')).toHaveTextContent('CMO');
  });

  it('refuses an implausible value without sending it', async () => {
    const onSubmit = vi.fn();
    render(<MeasurementForm test={bpTest} connected onSubmit={onSubmit} />);
    expect(screen.getByTestId('selftest-steps').querySelectorAll('li')).toHaveLength(3);
    fireEvent.change(screen.getByTestId('field-bp_systolic'), { target: { value: '1180' } });
    fireEvent.change(screen.getByTestId('field-spo2'), { target: { value: '97' } });
    fireEvent.click(screen.getByTestId('selftest-done'));
    expect(await screen.findByRole('alert')).toHaveTextContent('outside 60–260 mmHg');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('asks to re-check a WARNING value before sending, then sends it', async () => {
    const onSubmit = vi.fn().mockResolvedValue({ ok: true, message: 'Stored on board.' });
    render(<MeasurementForm test={bpTest} connected onSubmit={onSubmit} />);
    fireEvent.change(screen.getByTestId('field-bp_systolic'), { target: { value: '118' } });
    fireEvent.change(screen.getByTestId('field-spo2'), { target: { value: '88' } });
    expect(screen.getByTestId('band-spo2')).toHaveTextContent('Not a NASA limit · Clinical guideline');
    expect(screen.getByTestId('tripped-spo2')).toHaveTextContent('WARNING alert: below 92 %');
    expect(screen.getByTestId('tripped-spo2')).toHaveTextContent('LOM');
    fireEvent.click(screen.getByTestId('selftest-done'));
    expect(await screen.findByTestId('confirm-panel')).toHaveTextContent('raises a WARNING alert');
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('confirm-send'));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ bp_systolic: 118, spo2: 88 }));
    expect(await screen.findByTestId('selftest-outcome')).toHaveTextContent('Stored on board.');
  });

  it('cannot send while the onboard server is down', () => {
    render(<MeasurementForm test={bpTest} connected={false} onSubmit={vi.fn()} />);
    expect(screen.getByTestId('selftest-done')).toBeDisabled();
    expect(screen.getByText(/Earth link is not needed/)).toBeInTheDocument();
  });
});

// ---- T-1 routine board -----------------------------------------------------------------------------------------
const item = (over: Partial<ScheduleItem>): ScheduleItem => ({
  test_id: 'bp_spo2',
  title: 'Blood pressure and oxygen check',
  kind: 'measurement',
  hazards: ['GRAVITY_FIELDS'],
  reason: 'routine',
  status: 'DUE',
  level: null,
  slot_start: '2026-11-15T07:00:00Z',
  due_until: '2026-11-15T10:00:00Z',
  next_due: '2026-11-16T07:00:00Z',
  done_ts: null,
  done_provenance: null,
  ...over,
});

describe('T-1 routine in the Today list (Block S)', () => {
  it('shows due / done / not done yet in plain, neutral words and starts a test', () => {
    const onStart = vi.fn();
    render(
      <TodayList
        onStart={onStart}
        countermeasures={[]}
        connected
        onDone={vi.fn()}
        routine={[
          item({}),
          item({ test_id: 'intake', title: 'Daily fluid and salt log', status: 'OVERDUE', level: 'INFO' }),
          item({ test_id: 'body_mass', title: 'Body mass', status: 'DONE', done_ts: '2026-11-15T08:05:00Z' }),
          item({ test_id: 'bp_spo2', reason: 'after gravity increase', status: 'DUE' }),
        ]}
      />
    );
    expect(screen.getByTestId('routine-bp_spo2')).toHaveTextContent('Due now, until 10:00 UTC');
    const overdue = screen.getByTestId('routine-intake');
    expect(overdue).toHaveTextContent('info only');
    expect(overdue.innerHTML).not.toMatch(/red-|EMERGENCY|WARNING|CAUTION/);
    expect(screen.getByTestId('routine-body_mass')).toHaveTextContent('Done at 08:05 UTC');
    expect(screen.getByTestId('routine-bp_spo2-gravity')).toHaveTextContent('Extra check after a gravity increase');
    fireEvent.click(screen.getAllByRole('button', { name: 'Start' })[0]);
    expect(onStart).toHaveBeenCalledWith('bp_spo2');
  });

  it('never shows points, streaks, scores or counts of tests done', () => {
    render(<TodayList onStart={vi.fn()} countermeasures={[]} connected onDone={vi.fn()} routine={[item({ status: 'DONE', done_ts: '2026-11-15T07:30:00Z' })]} />);
    expect(screen.getByTestId('today-list').textContent).not.toMatch(/point|streak|badge|level|score|\d+\s*\/\s*\d+/i);
  });
});
