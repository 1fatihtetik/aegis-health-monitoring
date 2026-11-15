import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SelfTestDef } from '../api/types';
import { AmslerGrid, amslerValues, marksSummary } from '../components/AmslerGrid';

// T-9: shape as served by GET /selftests for config/selftests.yaml `amsler`.
const amsler: SelfTestDef = {
  id: 'amsler',
  title: 'Eye check (Amsler grid)',
  kind: 'amsler',
  entry_method: 'amsler',
  fields: [
    { signal: 'amsler_flag', label: 'Flag', input_min: 0, input_max: 1, step: 1, hint: '', unit: '0=none,1=areas marked', rule_limits: [] },
    { signal: 'amsler_cells_right', label: 'Right', input_min: 0, input_max: 100, step: 1, hint: '', unit: 'cells', rule_limits: [] },
    { signal: 'amsler_cells_left', label: 'Left', input_min: 0, input_max: 100, step: 1, hint: '', unit: 'cells', rule_limits: [] },
  ],
  why: 'Why.',
  hazards: ['GRAVITY_FIELDS'],
  hrp_risks: ['HRP-10'],
  steps: ['Cover your LEFT eye', 'Tap the squares', 'Save'],
  limit_refs: ['eye.amsler_flag_min'],
  limits: [],
  escalation: 'Any marked area: show the marked grid to the CMO today.',
  protocol: '',
  params: { grid: 10 },
  short_mode_note: '',
  schedule: null,
  after_gravity_increase: false,
  onboard_only: false,
};

describe('T-9 Amsler grid', () => {
  it('counts marks per eye and sets the flag only when something is marked', () => {
    expect(amslerValues({ right: {}, left: {} })).toEqual({ amsler_flag: 0, amsler_cells_right: 0, amsler_cells_left: 0 });
    expect(amslerValues({ right: { 3: 'wavy', 4: 'missing' }, left: { 55: 'blurred' } })).toEqual({
      amsler_flag: 1,
      amsler_cells_right: 2,
      amsler_cells_left: 1,
    });
    expect(marksSummary({ 1: 'wavy', 2: 'wavy', 9: 'missing' })).toBe('2 wavy, 1 missing');
    expect(marksSummary({})).toBe('nothing marked');
  });

  it('one eye at a time: 100 tap targets with a letter, not colour alone; save sends counts only', async () => {
    const onSubmit = vi.fn().mockResolvedValue({ ok: true, message: '' });
    render(<AmslerGrid test={amsler} connected onSubmit={onSubmit} />);
    expect(screen.getByTestId('amsler-stage-right')).toHaveTextContent('Cover your LEFT eye');
    const cells = screen.getAllByRole('button', { name: /^Row \d+, column \d+/ });
    expect(cells).toHaveLength(100);
    expect(cells[0].className).toContain('h-11 w-11'); // 44 px

    fireEvent.click(screen.getByTestId('amsler-cell-right-44'));
    expect(screen.getByTestId('amsler-cell-right-44')).toHaveTextContent('W');
    fireEvent.click(screen.getByTestId('amsler-kind-missing'));
    fireEvent.click(screen.getByTestId('amsler-cell-right-45'));
    expect(screen.getByTestId('amsler-cell-right-45')).toHaveAttribute('aria-label', 'Row 5, column 6, marked missing');
    // tapping the same square with the same kind removes the mark
    fireEvent.click(screen.getByTestId('amsler-cell-right-45'));
    fireEvent.click(screen.getByTestId('amsler-cell-right-45'));
    expect(screen.getByTestId('amsler-count-right')).toHaveTextContent('1 wavy, 1 missing');

    fireEvent.click(screen.getByTestId('amsler-next'));
    expect(screen.getByTestId('amsler-stage-left')).toHaveTextContent('Cover your RIGHT eye');
    fireEvent.click(screen.getByTestId('amsler-next'));
    expect(screen.getByTestId('amsler-flagged')).toHaveTextContent('show the marked grid to the CMO');

    await act(async () => {
      fireEvent.click(screen.getByTestId('amsler-save'));
    });
    expect(onSubmit).toHaveBeenCalledWith({ amsler_flag: 1, amsler_cells_right: 2, amsler_cells_left: 0 });
    expect(screen.getByRole('status')).toHaveTextContent('Show this screen to the CMO');
    expect(screen.getByTestId('amsler-save')).toBeDisabled(); // saved once
  });

  it('a clean check saves a zero flag; offline the save is disabled', async () => {
    const onSubmit = vi.fn().mockResolvedValue({ ok: true, message: '' });
    const { rerender } = render(<AmslerGrid test={amsler} connected={false} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByTestId('amsler-next'));
    fireEvent.click(screen.getByTestId('amsler-next'));
    expect(screen.getByTestId('amsler-clear')).toBeInTheDocument();
    expect(screen.getByTestId('amsler-save')).toBeDisabled();
    rerender(<AmslerGrid test={amsler} connected onSubmit={onSubmit} />);
    await act(async () => {
      fireEvent.click(screen.getByTestId('amsler-save'));
    });
    expect(onSubmit).toHaveBeenCalledWith({ amsler_flag: 0, amsler_cells_right: 0, amsler_cells_left: 0 });
  });

  it('never uses diagnosis or gamification words', () => {
    render(<AmslerGrid test={amsler} connected onSubmit={vi.fn()} />);
    const text = document.body.textContent?.toLowerCase() ?? '';
    for (const word of ['you have', 'points', 'streak', 'badge', 'level up', 'leaderboard']) {
      expect(text).not.toContain(word);
    }
  });
});
