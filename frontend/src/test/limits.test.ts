import { BUNDLED_LIMITS, flattenLimits, formatLimit, parseLimitsYaml } from '../api/limits';
import { buildInitialSystemState } from '../api/client';

describe('limits from config/limits.yaml (G3-2)', () => {
  it('bundles every entry with source_ref and verified', () => {
    const co2 = BUNDLED_LIMITS['environment.ppco2_mmHg_1h_max'];
    expect(co2.value).toBeGreaterThan(0);
    expect(co2.verified).toBe(false);
    expect(co2.source_ref).toContain('STD-3001');
    expect(BUNDLED_LIMITS['bone.bmd_loss_pct_per_month_expected_0g'].verified).toBe(true);
    for (const l of Object.values(BUNDLED_LIMITS)) {
      expect(l.source_ref).toBeTruthy();
      expect(l.value !== undefined || (l.min !== undefined && l.max !== undefined)).toBe(true);
    }
  });

  it('offline state uses the bundled limits, not a copy', () => {
    expect(buildInitialSystemState(42).limits).toBe(BUNDLED_LIMITS);
  });

  it('parses quoted strings with commas and flattens the backend tree shape', () => {
    const tree = parseLimitsYaml('a:\n  b: { value: 1.5, source_ref: "X, Y", verified: true }  # note\n');
    expect(tree).toEqual({ a: { b: { value: 1.5, source_ref: 'X, Y', verified: true } } });
    const flat = flattenLimits({ physiology: { hr_bpm: { min: 40, max: 140, source_ref: 's', verified: false } } });
    expect(formatLimit(flat['physiology.hr_bpm'])).toBe('40–140 bpm');
  });

  it('rejects lines it does not understand', () => {
    expect(() => parseLimitsYaml('a:\n  b: 3\n')).toThrow(/line 2/);
  });
});
