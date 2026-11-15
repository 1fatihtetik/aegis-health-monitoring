"""Group-A limits read from NASA-STD-3001 Vol 2 Rev F (2026-11-15): fluid 2.5 L [V2 6109], inspired O2 [V2 6003],
24-h noise dose [V2 6115]. Formulas, rule behaviour, honest labels."""

import pytest

from app.domain.enums import SIGNALS, Severity
from app.rules.engine import RuleEngine
from app.sim.core import inspired_o2_mmHg, noise_dose_rate_pct_h
from tests.conftest import T0, fill, run

NEW_VERIFIED = {
    "nutrition.fluid_intake_mL_day_min": ("[V2 6109]", 2500),
    "environment.pio2_mmHg_min": ("[V2 6003]", 127),
    "environment.pio2_mmHg_floor": ("[V2 6003]", 122),
    "environment.noise_dose_24h_max": ("[V2 6115]", 100),
}


def engine_for(cfg, store, *ids):
    return RuleEngine([r for r in cfg.rules if r.id in ids], cfg, store, ["C1"])


def firing(engine, now):
    return {f.rule.id: f for f in engine.evaluate(now) if f.firing}


def test_new_limits_are_verified_with_rev_f_clause(cfg):
    for ref, (clause, value) in NEW_VERIFIED.items():
        limit = cfg.limit(ref)
        assert limit.verified is True and limit.value == value, ref
        assert "NASA-STD-3001 Vol 2 Rev F" in limit.source_ref and clause in limit.source_ref, ref
    # The rest of group A stays honest: no NASA number exists for what we measure.
    for ref in ("environment.ppo2_kPa_min", "environment.noise_dBA_sleep_max", "environment.ppco2_mmHg_critical",
                "nutrition.sodium_intake_mg_day_max"):
        assert cfg.limit(ref).verified is False, ref


def test_inspired_o2_formula_matches_the_standard_table():
    # Sea-level air: inside the Table 6.2-1 normoxic target band 145-155 mmHg.
    assert 145 <= inspired_o2_mmHg(21.2, 101.3) <= 155
    # 19.5 kPa ambient at sea-level pressure is ~137 mmHg inspired (the old heuristic, above the 127 limit).
    assert inspired_o2_mmHg(19.5, 101.3) == pytest.approx(137.3, abs=0.5)
    # Exploration atmosphere 8.2 psia / 34 % O2 (Table 6.2-1 example) sits near the 127 mmHg mild-hypoxia limit.
    pb_kpa = 8.2 * 6.89476
    assert inspired_o2_mmHg(0.34 * pb_kpa, pb_kpa) == pytest.approx(128, abs=2)


def test_noise_dose_formula_hits_100_at_the_standard_criteria():
    assert 8 * noise_dose_rate_pct_h(75.0) == pytest.approx(100)  # 8 h at 75 dBA
    assert 24 * noise_dose_rate_pct_h(70.23) == pytest.approx(100, rel=0.01)  # ~70 dBA over 24 h
    assert 4 * noise_dose_rate_pct_h(78.0) == pytest.approx(100)  # 3 dB exchange rate halves the time


def test_o2_rules_use_inspired_o2_with_one_hour_and_floor_limits(cfg, store):
    low, crit = (next(r for r in cfg.rules if r.id == i) for i in ("env.o2.low", "env.o2.critical"))
    assert (low.signal, low.window, low.severity) == ("pio2", "1h", Severity.CAUTION)
    assert (crit.signal, crit.severity) == ("pio2", Severity.WARNING)
    assert SIGNALS["pio2"].unit == "mmHg" and SIGNALS["pio2"].scope == "cabin"
    engine = engine_for(cfg, store, "env.o2.low", "env.o2.critical")
    fill(store, None, "pio2", [149.0] * 60)
    assert firing(engine, T0) == {}
    end = fill(store, None, "pio2", [125.0] * 60, end=T0.replace(hour=T0.hour + 1))
    assert set(firing(engine, end)) == {"env.o2.low"}  # below 127 for the hour, above the 122 floor
    end = fill(store, None, "pio2", [120.0] * 10, end=end.replace(minute=10))
    fired = firing(engine, end)
    assert set(fired) == {"env.o2.low", "env.o2.critical"}
    ev = fired["env.o2.critical"].evidence
    assert ev["limit"] == 122 and ev["limit_verified"] is True and "[V2 6003]" in ev["limit_source_ref"]


def test_noise_dose_rule_integrates_24_hours(cfg, store):
    rule = next(r for r in cfg.rules if r.id == "env.noise.dose_24h")
    assert rule.hazards and rule.hrp_risks and "you have" not in (rule.rationale + rule.action).lower()
    engine = engine_for(cfg, store, "env.noise.dose_24h")
    fill(store, None, "noise_dose_rate", [noise_dose_rate_pct_h(65.0)] * (24 * 60))
    assert firing(engine, T0) == {}  # 65 dBA all day is ~10 % of the dose
    fill(store, None, "noise_dose_rate", [noise_dose_rate_pct_h(76.0)] * (24 * 60))
    fired = firing(engine, T0)
    assert "env.noise.dose_24h" in fired and fired["env.noise.dose_24h"].evidence["limit_verified"] is True


def test_nominal_day_stays_quiet_and_inside_the_o2_target(cfg):
    world = run(cfg, "nominal", 2)
    assert 145 <= world.store.latest(None, "pio2")[1] <= 155
    assert world.source_for("pio2")["provenance"] == "SYNTHETIC"  # derived from synthetic cabin values
    assert not [a for a in world.alerts.alerts.values() if a.rule_id.startswith("env.")]
