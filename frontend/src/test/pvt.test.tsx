import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { classify, nextIsiMs, pvtParams, summarize, PvtParams } from '../api/pvt';
import { SelfTestDef } from '../api/types';
import { PvtTest } from '../components/PvtTest';

// T-2 PVT-B (Basner et al. 2011): params as in config/selftests.yaml, lapse limit as in config/limits.yaml.
const P: PvtParams = { duration_s: 180, isi_min_s: 1, isi_max_s: 4, false_start_ms: 100, timeout_ms: 30000 };
const LAPSE = 355;

const pvtTest = (over: Partial<SelfTestDef> = {}): SelfTestDef => ({
  id: 'pvt_b_short',
  title: 'Reaction-time test, demo length (30 s)',
  kind: 'pvt',
  entry_method: 'pvt',
  fields: [],
  why: 'Alertness.',
  hazards: ['ISOLATION_CONFINEMENT'],
  hrp_risks: ['HRP-14'],
  steps: ['Tap Start', 'Tap when the counter appears', 'Save'],
  limit_refs: ['cognition.pvt_lapse_ms'],
  limits: [],
  escalation: 'Tell the CMO.',
  protocol: 'PVT-B',
  params: { ...P, duration_s: 30 },
  short_mode_note: 'Demo length, not the 3-minute protocol',
  schedule: null,
  after_gravity_increase: false,
  onboard_only: false,
  ...over,
});

describe('T-2 PVT-B logic', () => {
  it('draws gaps uniformly between 1 and 4 s', () => {
    expect(nextIsiMs(() => 0, P)).toBe(1000);
    expect(nextIsiMs(() => 0.5, P)).toBe(2500);
    expect(nextIsiMs(() => 0.9999, P)).toBeLessThanOrEqual(4000);
    for (let i = 0; i < 200; i++) {
      const gap = nextIsiMs(Math.random, P);
      expect(gap).toBeGreaterThanOrEqual(1000);
      expect(gap).toBeLessThanOrEqual(4000);
    }
  });

  it('applies the lapse rule (> 355 ms), false starts and timeouts', () => {
    expect(classify(null, LAPSE, P)).toBe('false_start'); // tapped before the counter
    expect(classify(80, LAPSE, P)).toBe('false_start'); // faster than 100 ms: anticipation
    expect(classify(250, LAPSE, P)).toBe('ok');
    expect(classify(355, LAPSE, P)).toBe('ok');
    expect(classify(356, LAPSE, P)).toBe('lapse');
    expect(classify(30000, LAPSE, P)).toBe('timeout');
  });

  it('summarizes: mean over real responses; timeouts count as lapses', () => {
    const s = summarize([
      { rt_ms: 300, kind: 'ok' },
      { rt_ms: 400, kind: 'lapse' },
      { rt_ms: null, kind: 'false_start' },
      { rt_ms: null, kind: 'timeout' },
    ]);
    expect(s).toEqual({ mean_rt: 350, lapses: 2, false_starts: 1, responses: 2 });
    expect(summarize([]).mean_rt).toBeNull();
  });

  it('refuses a catalog entry without its protocol parameters', () => {
    expect(() => pvtParams(pvtTest({ params: { duration_s: 30 } }))).toThrow(/params/);
    expect(pvtParams(pvtTest()).duration_s).toBe(30);
  });
});

describe('T-2 PvtTest screen', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('labels the short mode, scores taps and saves mean RT, lapses and false starts', async () => {
    const onSubmit = vi.fn().mockResolvedValue({ ok: true, message: 'Stored on board.' });
    render(<PvtTest test={pvtTest()} lapseMs={LAPSE} connected onSubmit={onSubmit} now={() => Date.now()} rand={() => 0} />);
    expect(screen.getByTestId('pvt-short-note')).toHaveTextContent('Demo length, not the 3-minute protocol');
    fireEvent.click(screen.getByTestId('pvt-start'));
    const target = screen.getByTestId('pvt-target');
    fireEvent.pointerDown(target); // before the counter: false start, gap restarts
    act(() => vi.advanceTimersByTime(1000)); // counter appears
    expect(target).toHaveAccessibleName('Counter showing: tap now');
    act(() => vi.advanceTimersByTime(300));
    fireEvent.pointerDown(target); // 300 ms: ok
    act(() => vi.advanceTimersByTime(1000));
    act(() => vi.advanceTimersByTime(400));
    fireEvent.keyDown(window, { code: 'Space', key: ' ' }); // 400 ms: lapse
    act(() => vi.advanceTimersByTime(30000)); // test ends by itself
    expect(screen.getByTestId('pvt-summary')).toHaveTextContent('350 ms');
    await act(async () => {
      fireEvent.click(screen.getByTestId('pvt-save'));
    });
    expect(onSubmit).toHaveBeenCalledWith({ pvt_mean_rt: 350, pvt_lapses: 1, pvt_false_starts: 1 });
  });

  it('the full protocol shows no short-mode label and can be stopped without a result', () => {
    const onSubmit = vi.fn();
    render(
      <PvtTest test={pvtTest({ id: 'pvt_b', params: { ...P }, short_mode_note: '' })} lapseMs={LAPSE} connected onSubmit={onSubmit} />
    );
    expect(screen.queryByTestId('pvt-short-note')).toBeNull();
    expect(screen.getByTestId('pvt-start')).toHaveTextContent('3 min');
    fireEvent.click(screen.getByTestId('pvt-start'));
    fireEvent.click(screen.getByText('Stop test (no result)'));
    expect(screen.getByTestId('pvt-start')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
