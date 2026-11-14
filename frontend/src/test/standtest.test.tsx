import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BUNDLED_LIMITS, formatLimit } from '../api/limits';
import { bandText, bandUnverified } from '../api/selftests';
import { dueCheckpoint, protocolMinutes, standParams, summarizeStand, sustainedRise } from '../api/standtest';
import { SelfTestDef, SelfTestField } from '../api/types';
import { MeasurementForm } from '../components/MeasurementForm';
import { Questionnaire, sliderMiddle } from '../components/Questionnaire';
import { StandTest } from '../components/StandTest';
import { standTestLine } from '../components/GravityEffectNote';

const field = (signal: string, unit: string, input_min: number, input_max: number, label = signal): SelfTestField => ({
  signal,
  label,
  input_min,
  input_max,
  step: 1,
  hint: '',
  unit,
  rule_limits: [],
});

// T-5 as in config/selftests.yaml (protocol confirmed by the supervisor 2026-11-15).
const standTest = (over: Partial<SelfTestDef> = {}): SelfTestDef => ({
  id: 'stand_test_short',
  title: 'Stand test, demo timing',
  kind: 'stand_test',
  entry_method: 'stand_test',
  fields: [field('heart_rate', 'bpm', 30, 220, 'Pulse'), field('bp_systolic', 'mmHg', 60, 260, 'Top'), field('bp_diastolic', 'mmHg', 30, 160, 'Bottom')],
  why: 'Standing after low gravity.',
  hazards: ['GRAVITY_FIELDS'],
  hrp_risks: ['HRP-03'],
  steps: ['Seat beside you', 'Lie down', 'Stand against the wall'],
  limit_refs: ['stand_test.sbp_drop_mmHg_min'],
  limits: [],
  escalation: 'Tell the CMO.',
  protocol: 'Lee et al. 2015',
  params: { supine_s: 300, stand_s: 600, min_gravity_g: 0.1, time_scale: 0.1 },
  checkpoints_min: [1, 3, 5, 10],
  stop_steps: ['Lie down flat now', 'Raise your legs', 'Call a crewmate'],
  short_mode_note: 'Demo timing, not the 10-minute stand protocol',
  schedule: null,
  after_gravity_increase: false,
  onboard_only: false,
  ...over,
});

describe('T-5 stand test logic', () => {
  const P = standParams(standTest({ params: { supine_s: 300, stand_s: 600, min_gravity_g: 0.1, time_scale: 1 } }));

  it('opens the readings at 1, 3, 5 and 10 minutes of standing', () => {
    expect(dueCheckpoint(59_000, P)).toBe(-1);
    expect(dueCheckpoint(60_000, P)).toBe(0);
    expect(dueCheckpoint(180_000, P)).toBe(1);
    expect(dueCheckpoint(300_000, P)).toBe(2);
    expect(dueCheckpoint(600_000, P)).toBe(3);
    expect(protocolMinutes(150_000, P)).toBe(2.5);
    expect(protocolMinutes(15_000, { ...P, time_scale: 0.1 })).toBe(2.5); // demo run reports protocol minutes
  });

  it('counts a heart-rate rise only when it holds on two readings in a row', () => {
    expect(sustainedRise([35, 10, 12, 11])).toBe(11); // one spike is not sustained
    expect(sustainedRise([31, 33, 20])).toBe(31);
    expect(sustainedRise([34])).toBe(34); // stopped after one reading: use it
  });

  it('summarises falls, rise and pulse pressure from the lying-down and standing readings', () => {
    const v = summarizeStand(
      { hr: 64, sbp: 118, dbp: 76 },
      [
        { minute: 1, hr: 80, sbp: 110, dbp: 78 },
        { minute: 3, hr: 96, sbp: 96, dbp: 80 },
        { minute: 5, hr: 98, sbp: 100, dbp: 82 },
      ],
      false,
      5,
    );
    expect(v).toEqual({
      stand_early_stop: 0,
      stand_minutes: 5,
      stand_sbp_drop: 22,
      stand_dbp_drop: -2,
      stand_hr_rise: 32,
      stand_pulse_pressure_min: 16,
      stand_pulse_pressure_pct: 16.7,
      heart_rate: 98,
      bp_systolic: 100,
      bp_diastolic: 82,
    });
  });

  it('keeps the early stop and the minutes even with no standing reading', () => {
    expect(summarizeStand({ hr: 60, sbp: 120, dbp: 80 }, [], true, 0.4)).toEqual({ stand_early_stop: 1, stand_minutes: 0.4 });
  });
});

describe('T-5 StandTest screen', () => {
  let t = 0;
  beforeEach(() => {
    vi.useFakeTimers();
    t = 0;
  });
  afterEach(() => vi.useRealTimers());
  const advance = (ms: number): void => {
    act(() => {
      t += ms;
      vi.advanceTimersByTime(ms);
    });
  };
  const enter = (hr: string, sbp: string, dbp: string): void => {
    fireEvent.change(screen.getByTestId('stand-heart_rate'), { target: { value: hr } });
    fireEvent.change(screen.getByTestId('stand-bp_systolic'), { target: { value: sbp } });
    fireEvent.change(screen.getByTestId('stand-bp_diastolic'), { target: { value: dbp } });
  };

  it('refuses to start without gravity and labels the demo timing', () => {
    render(<StandTest test={standTest()} gravityG={0} connected onSubmit={vi.fn()} now={() => t} />);
    expect(screen.getByTestId('stand-short-note').textContent).toContain('Demo timing, not the 10-minute stand protocol');
    expect(screen.getByTestId('stand-needs-gravity')).toBeTruthy();
    expect((screen.getByTestId('stand-start') as HTMLButtonElement).disabled).toBe(true);
  });

  it('STOP saves the captured readings at once with the early-stop flag and shows what to do', async () => {
    const onSubmit = vi.fn().mockResolvedValue({ ok: true, message: 'Saved on board.' });
    render(<StandTest test={standTest()} gravityG={0.16} connected onSubmit={onSubmit} now={() => t} />);
    fireEvent.click(screen.getByTestId('stand-start'));
    advance(30_000); // demo: 5 min lying = 30 s
    enter('62', '120', '78');
    fireEvent.click(screen.getByTestId('stand-save-supine'));
    expect(screen.getByTestId('stand-stop')).toBeTruthy(); // always visible while standing
    advance(6_000); // minute 1
    enter('96', '98', '80');
    fireEvent.click(screen.getByTestId('stand-save-reading'));
    advance(6_000); // 2 protocol minutes in
    await act(async () => {
      fireEvent.click(screen.getByTestId('stand-stop'));
    });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    const values = onSubmit.mock.calls[0][0] as Record<string, number>;
    expect(values.stand_early_stop).toBe(1);
    expect(values.stand_minutes).toBe(2);
    expect(values.stand_sbp_drop).toBe(22);
    expect(values.bp_systolic).toBe(98);
    expect(screen.getByTestId('stand-stopped').textContent).toContain('Lie down flat now');
  });

  it('runs the full stand with readings at each checkpoint, then submits once', async () => {
    const onSubmit = vi.fn().mockResolvedValue({ ok: true, message: 'Saved on board.' });
    render(<StandTest test={standTest()} gravityG={0.38} connected onSubmit={onSubmit} now={() => t} />);
    fireEvent.click(screen.getByTestId('stand-start'));
    advance(30_000);
    enter('60', '118', '76');
    fireEvent.click(screen.getByTestId('stand-save-supine'));
    for (const [at, minute] of [[6_000, 1], [12_000, 3], [12_000, 5], [30_000, 10]] as const) {
      advance(at);
      expect(screen.getByTestId(`stand-checkpoint-${minute}`)).toBeTruthy();
      enter('70', '116', '78');
      await act(async () => {
        fireEvent.click(screen.getByTestId('stand-save-reading'));
      });
    }
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ stand_early_stop: 0, stand_minutes: 10, stand_hr_rise: 10 });
    expect(screen.getByTestId('stand-summary')).toBeTruthy();
  });

  it('marks a checkpoint missed when the next one comes due', () => {
    render(<StandTest test={standTest()} gravityG={0.16} connected onSubmit={vi.fn()} now={() => t} />);
    fireEvent.click(screen.getByTestId('stand-start'));
    advance(30_000);
    enter('60', '118', '76');
    fireEvent.click(screen.getByTestId('stand-save-supine'));
    advance(18_000); // minute 3 is due, minute 1 was never entered
    expect(screen.getByTestId('stand-checkpoint-3')).toBeTruthy();
    enter('70', '116', '78');
    fireEvent.click(screen.getByTestId('stand-save-reading'));
    expect(screen.getByTestId('stand-captured').textContent).toContain('missed: min 1');
  });

  it('refuses a reading with the bottom number above the top number', () => {
    render(<StandTest test={standTest()} gravityG={0.16} connected onSubmit={vi.fn()} now={() => t} />);
    fireEvent.click(screen.getByTestId('stand-start'));
    advance(30_000);
    enter('60', '80', '90');
    fireEvent.click(screen.getByTestId('stand-save-supine'));
    expect(screen.getByRole('alert').textContent).toContain('bottom number must be lower');
  });
});

describe('Gravity tile stand-test line (T-5)', () => {
  it('names the crew with an open standing alert, else suggests the test after a landing', () => {
    const alert = { rule_id: 'cardio.stand.early_stop', crew_id: 'C3' } as never;
    expect(standTestLine(null, [alert])).toContain('stand test stopped early for C3');
    const g = { transition: { risk: 0.13 } } as never;
    expect(standTestLine(g, [])).toContain('Take the 10-minute stand test');
    expect(standTestLine(null, [])).toBeNull();
  });
});

describe('F-010 self-test bands in plain words', () => {
  it('formats Block T limits with unit and direction', () => {
    expect(formatLimit(BUNDLED_LIMITS['nutrition.fluid_intake_mL_day_min'])).toBe('≥ 2000 mL');
    expect(formatLimit(BUNDLED_LIMITS['nutrition.sodium_intake_mg_day_max'])).toBe('≤ 3000 mg');
    expect(formatLimit(BUNDLED_LIMITS['cognition.pvt_lapse_ms'])).toBe('> 355 ms');
    expect(formatLimit(BUNDLED_LIMITS['physiology.bp_diastolic_mmHg'])).toBe('50–100 mmHg');
    expect(formatLimit(BUNDLED_LIMITS['stand_test.sbp_drop_mmHg_min'])).toBe('≥ 20 mmHg');
    expect(BUNDLED_LIMITS['questionnaire.kss_sleepy_min'].label).not.toMatch(/_/);
    expect(formatLimit(BUNDLED_LIMITS['environment.ppco2_mmHg_1h_max'], '<=')).toBe('≤ 3 mmHg'); // explicit op wins
  });

  it('shows the diastolic band from its display limits when no rule judges it alone', () => {
    const lim = (value: number) => ({ ref: 'physiology.bp_diastolic_mmHg.min', value, source_ref: 'Clinical heuristic', verified: false });
    const dia = { ...field('bp_diastolic', 'mmHg', 30, 160), band: { low: lim(50), high: lim(100) } };
    expect(bandText(dia)).toBe('50–100 mmHg');
    expect(bandUnverified(dia)).toBe(true);
    expect(bandText(field('bp_diastolic', 'mmHg', 30, 160))).toBeNull();
  });

  it('puts words on the tap-scale buttons', () => {
    const test = {
      ...standTest(),
      id: 'headache',
      kind: 'report' as const,
      entry_method: 'tap' as const,
      fields: [{ ...field('symptom_headache', '0-3', 0, 3), anchors: { '0': 'None', '1': 'Mild', '2': 'Moderate', '3': 'Severe' } }],
    };
    render(<MeasurementForm test={test} connected onSubmit={vi.fn()} />);
    expect(screen.getByTestId('tap-0').textContent).toBe('0None');
    expect(screen.getByTestId('tap-3').textContent).toBe('3Severe');
  });
});

describe('F-011 TLX slider starts unset', () => {
  it('lets the crew answer the middle value with one tap instead of sliding off and back', async () => {
    const item = { label: 'Mental demand', min: 0, max: 100, step: 5, anchors: { '0': 'Very low', '100': 'Very high' } };
    expect(sliderMiddle(item)).toBe(50);
    expect(sliderMiddle({ ...item, max: 9, min: 1, step: 1 })).toBe(5);
    const onSubmit = vi.fn().mockResolvedValue({ ok: true, message: 'ok' });
    const test = {
      ...standTest(),
      id: 'tlx',
      kind: 'questionnaire' as const,
      entry_method: 'questionnaire' as const,
      onboard_only: true,
      fields: [field('tlx_workload', '0-100', 0, 100)],
      items: [item],
      score: 'mean' as const,
    };
    render(<Questionnaire test={test} connected onSubmit={onSubmit} />);
    expect(screen.getByTestId('slider-0').getAttribute('data-unset')).toBe('true');
    expect((screen.getByTestId('questionnaire-save') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId('slider-keep-0'));
    expect(screen.getByTestId('slider-0').getAttribute('data-unset')).toBe('false');
    await act(async () => {
      fireEvent.click(screen.getByTestId('questionnaire-save'));
    });
    expect(onSubmit).toHaveBeenCalledWith({ tlx_workload: 50 });
  });
});
