import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BackendAlert, mapAlert } from '../api/backend';
import { SelfTestDef } from '../api/types';
import { EvidenceDetails } from '../components/EvidenceDetails';
import { Questionnaire, scoreAnswers } from '../components/Questionnaire';

// T-4: questionnaires stay on board. Shapes as in config/selftests.yaml.
const base: Omit<SelfTestDef, 'id' | 'title' | 'fields' | 'items'> = {
  kind: 'questionnaire',
  entry_method: 'questionnaire',
  why: 'Why.',
  hazards: ['ISOLATION_CONFINEMENT'],
  hrp_risks: ['HRP-14'],
  steps: ['Think', 'Tap', 'Save'],
  limit_refs: [],
  limits: [],
  escalation: 'Tell the CMO.',
  protocol: '',
  params: {},
  short_mode_note: '',
  schedule: null,
  after_gravity_increase: false,
  onboard_only: true,
  score: 'mean',
};

const kss: SelfTestDef = {
  ...base,
  id: 'kss',
  title: 'Sleepiness check (KSS)',
  fields: [{ signal: 'kss', label: 'KSS', input_min: 1, input_max: 9, step: 1, hint: '', unit: '1-9', rule_limits: [] }],
  items: [
    {
      label: 'How sleepy have you felt in the last 10 minutes?',
      min: 1,
      max: 9,
      step: 1,
      anchors: { '1': 'Extremely alert', '7': 'Sleepy, but no effort to keep awake', '9': 'Very sleepy, fighting sleep' },
    },
  ],
};

const tlx: SelfTestDef = {
  ...base,
  id: 'tlx',
  title: 'Workload check (NASA-TLX)',
  fields: [
    { signal: 'tlx_workload', label: 'TLX', input_min: 0, input_max: 100, step: 1, hint: '', unit: '0-100', rule_limits: [] },
  ],
  items: ['Mental', 'Physical', 'Time', 'Performance', 'Effort', 'Frustration'].map((label) => ({
    label,
    min: 0,
    max: 100,
    step: 5,
    anchors: { '0': 'Very low', '100': 'Very high' },
  })),
};

describe('T-4 Questionnaire', () => {
  it('KSS: tap an anchored answer, save the score, say it stays on board', async () => {
    const onSubmit = vi.fn().mockResolvedValue({ ok: true, message: 'Stored on board.' });
    render(<Questionnaire test={kss} connected onSubmit={onSubmit} />);
    expect(screen.getByTestId('onboard-only-badge')).toHaveTextContent('never sent to Earth');
    expect(screen.getByTestId('questionnaire-save')).toBeDisabled();
    expect(screen.getByTestId('answer-0-7')).toHaveTextContent('Sleepy, but no effort to keep awake');
    fireEvent.click(screen.getByTestId('answer-0-8'));
    await act(async () => {
      fireEvent.click(screen.getByTestId('questionnaire-save'));
    });
    expect(onSubmit).toHaveBeenCalledWith({ kss: 8 });
    expect(screen.getByRole('status')).toHaveTextContent('Stored on board only.');
  });

  it('NASA-TLX: six sliders, raw TLX = mean; save only when every slider was moved', async () => {
    const onSubmit = vi.fn().mockResolvedValue({ ok: true, message: '' });
    render(<Questionnaire test={tlx} connected onSubmit={onSubmit} />);
    const values = [80, 20, 70, 30, 75, 60];
    values.slice(0, 5).forEach((v, i) => fireEvent.change(screen.getByTestId(`slider-${i}`), { target: { value: String(v) } }));
    expect(screen.getByTestId('questionnaire-save')).toBeDisabled();
    fireEvent.change(screen.getByTestId('slider-5'), { target: { value: '60' } });
    await act(async () => {
      fireEvent.click(screen.getByTestId('questionnaire-save'));
    });
    expect(onSubmit).toHaveBeenCalledWith({ tlx_workload: 55.8 });
    expect(scoreAnswers(values)).toBe(55.8);
  });
});

describe('T-4 redacted evidence on the ground', () => {
  it('shows a placeholder instead of the questionnaire member', () => {
    const alert: BackendAlert = {
      id: 'g1',
      rule_id: 'cog.performance_risk',
      title: 'Cognitive performance risk',
      crew_id: 'C1',
      severity: 'CAUTION',
      state: 'RAISED',
      raised_ts: '2026-11-15T08:00:00Z',
      ack_ts: null,
      resolved_ts: null,
      hazards: ['ISOLATION_CONFINEMENT'],
      hrp_risks: ['HRP-14'],
      evidence: {
        signal: 'compound',
        value: 2,
        limit: 2,
        members: [
          { rule_id: 'sleep.short_24h', signal: 'sleep_hours_24h', value: 4.1, op: '<', limit: 6, firing: true, unit: 'h' },
          { signal: 'redacted', value: 0, limit: 0, redacted: 'Onboard-only questionnaire answer; not sent to the ground.' },
        ],
      },
      rationale: 'r',
      action: 'a',
      checklist: [],
      notes: [],
      origin: 'ONBOARD',
    };
    render(<EvidenceDetails evidence={mapAlert(alert).evidence} />);
    expect(screen.getByTestId('evidence-clause-redacted')).toHaveTextContent('not sent to the ground');
    expect(screen.getAllByTestId('evidence-clause')).toHaveLength(1);
  });
});
