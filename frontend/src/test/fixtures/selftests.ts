import { SelfTestDef, SelfTestField } from '../../api/types';

// Block T test fixtures shaped like GET /api/v1/selftests entries.
export const spo2Field: SelfTestField = {
  signal: 'spo2',
  label: 'Blood oxygen (SpO2)',
  input_min: 50,
  input_max: 100,
  step: 1,
  hint: '',
  unit: '%',
  rule_limits: [
    {
      rule_id: 'physio.spo2.low',
      rule_type: 'THRESHOLD',
      severity: 'WARNING',
      op: '<',
      window: '5m',
      ref: 'physiology.spo2_pct_min',
      value: 92,
      source_ref: 'Clinical heuristic',
      verified: false,
    },
  ],
};

export const sysField: SelfTestField = {
  signal: 'bp_systolic',
  label: 'Blood pressure, top number (systolic)',
  input_min: 60,
  input_max: 260,
  step: 1,
  hint: '',
  unit: 'mmHg',
  rule_limits: [
    {
      rule_id: 'physio.bp.high',
      rule_type: 'THRESHOLD',
      severity: 'CAUTION',
      op: '>',
      window: '15m',
      ref: 'physiology.bp_systolic_mmHg.max',
      value: 160,
      source_ref: 'Clinical heuristic',
      verified: false,
    },
    {
      rule_id: 'cardio.orthostatic',
      rule_type: 'COMPOUND',
      severity: 'WARNING',
      op: '<',
      window: '15m',
      ref: 'physiology.bp_systolic_mmHg.min',
      value: 90,
      source_ref: 'Clinical heuristic',
      verified: false,
    },
  ],
};

export const bpTest: SelfTestDef = {
  id: 'bp_spo2',
  title: 'Blood pressure and oxygen check',
  kind: 'measurement',
  entry_method: 'form',
  fields: [sysField, spo2Field],
  why: 'Shows how the heart and lungs cope.',
  hazards: ['GRAVITY_FIELDS', 'HOSTILE_CLOSED_ENV'],
  hrp_risks: ['HRP-03', 'HRP-06'],
  steps: ['Sit quietly for 5 minutes', 'Measure', 'Type the numbers and tap Done'],
  limit_refs: ['physiology.spo2_pct_min', 'physiology.bp_systolic_mmHg.min', 'physiology.bp_systolic_mmHg.max'],
  limits: [],
  escalation: 'Tell the crew medical officer (CMO) now.',
  protocol: '',
  schedule: null,
  after_gravity_increase: false,
  onboard_only: false,
};
