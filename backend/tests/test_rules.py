"""Unit tests per rule type: fires, doesn't fire, hysteresis, dedup (AGENTS.md section 7)."""

from datetime import timedelta

import pytest
from pydantic import ValidationError

from app.alerts.manager import AlertManager
from app.domain.enums import AlertState
from app.rules.engine import RuleEngine
from app.rules.models import Rule
from tests.conftest import T0, fill

CREW = ["C1", "C2"]
COMMON = {"severity": "CAUTION", "hazards": ["HOSTILE_CLOSED_ENV"], "hrp_risks": ["HRP-12"],
          "rationale": "r", "action": "a", "title": "t"}


def rule(**kw):
    return Rule(**{**COMMON, **kw})


CO2 = rule(id="co2", type="THRESHOLD", signal="ppco2", op=">", limit_ref="environment.ppco2_mmHg_1h_max", window="1m")
SLEEP = rule(id="sleep", type="THRESHOLD", signal="sleep_hours_24h", op="<", limit_ref="sleep.min_sleep_h_24h",
             window="1m", agg="last")


def firing(engine, now, rule_id, crew_id=None):
    return {(f.rule.id, f.crew_id): f for f in engine.evaluate(now)}[(rule_id, crew_id)]


def test_threshold_fires_with_evidence(cfg, store):
    engine = RuleEngine([CO2], cfg, store, CREW)
    f = firing(engine, fill(store, None, "ppco2", [3.5]), "co2")
    assert f.firing
    assert f.evidence["signal"] == "ppco2"
    assert f.evidence["value"] == 3.5
    assert f.evidence["limit"] == 3.0
    assert f.evidence["limit_verified"] is False
    assert f.evidence["window"] == "1m"
    assert f.evidence["limit_source_ref"]


def test_threshold_does_not_fire_below_limit_or_without_data(cfg, store):
    engine = RuleEngine([CO2], cfg, store, CREW)
    assert not firing(engine, T0, "co2").firing
    assert not firing(engine, fill(store, None, "ppco2", [2.5]), "co2").firing


def test_threshold_window_mean(cfg, store):
    hourly = rule(id="co2h", type="THRESHOLD", signal="ppco2", op=">", limit_ref="environment.ppco2_mmHg_1h_max",
                  window="1h")
    engine = RuleEngine([hourly], cfg, store, CREW)
    now = fill(store, None, "ppco2", [2.0] * 50 + [5.0] * 10)  # mean 2.5
    assert not firing(engine, now, "co2h").firing


def test_hysteresis(cfg, store):
    engine = RuleEngine([CO2], cfg, store, CREW)
    assert firing(engine, fill(store, None, "ppco2", [3.5]), "co2").firing
    t1 = T0 + timedelta(minutes=1)
    store.add(None, "ppco2", t1, 2.95)  # under the limit but inside the 3% margin: stays active
    assert firing(engine, t1, "co2").firing
    t2 = T0 + timedelta(minutes=2)
    store.add(None, "ppco2", t2, 2.8)
    assert not firing(engine, t2, "co2").firing
    t3 = T0 + timedelta(minutes=3)
    store.add(None, "ppco2", t3, 2.95)  # not active any more, so 2.95 does not fire
    assert not firing(engine, t3, "co2").firing


def test_dedup_and_lifecycle(cfg, store):
    engine, manager = RuleEngine([CO2], cfg, store, CREW), AlertManager()
    now = fill(store, None, "ppco2", [3.5])
    first = manager.process(engine.evaluate(now), now)
    assert len(first) == 1 and first[0].state == AlertState.RAISED
    assert first[0].hazards and first[0].hrp_risks and first[0].evidence

    t1 = now + timedelta(minutes=1)
    store.add(None, "ppco2", t1, 3.6)
    assert manager.process(engine.evaluate(t1), t1) == []  # still one alert
    assert len(manager.alerts) == 1

    manager.ack(first[0].id, t1)
    assert first[0].state == AlertState.ACKNOWLEDGED

    t2 = now + timedelta(minutes=2)
    store.add(None, "ppco2", t2, 2.0)
    cleared = manager.process(engine.evaluate(t2), t2)
    assert cleared[0].state == AlertState.RESOLVED and cleared[0].resolved_ts == t2

    t3 = now + timedelta(minutes=3)
    store.add(None, "ppco2", t3, 3.5)
    again = manager.process(engine.evaluate(t3), t3)
    assert len(again) == 1 and again[0].id != first[0].id


def test_manual_resolve_is_not_re_raised_while_condition_holds(cfg, store):
    engine, manager = RuleEngine([CO2], cfg, store, CREW), AlertManager()
    now = fill(store, None, "ppco2", [3.5])
    alert = manager.process(engine.evaluate(now), now)[0]
    manager.resolve(alert.id, now)
    t1 = now + timedelta(minutes=1)
    store.add(None, "ppco2", t1, 3.5)
    assert manager.process(engine.evaluate(t1), t1) == []
    assert len(manager.alerts) == 1


def test_crew_rule_is_per_crew(cfg, store):
    engine = RuleEngine([SLEEP], cfg, store, CREW)
    fill(store, "C1", "sleep_hours_24h", [4.0])
    now = fill(store, "C2", "sleep_hours_24h", [8.0])
    assert firing(engine, now, "sleep", "C1").firing
    assert not firing(engine, now, "sleep", "C2").firing


def test_baseline(cfg, store):
    base = rule(id="temp", type="BASELINE", signal="skin_temp", op=">", limit_ref="physiology.baseline_z_alert",
                window="30m", baseline_window="48h")
    normal = [36.5, 36.7] * 150
    engine = RuleEngine([base], cfg, store, CREW)
    now = fill(store, "C1", "skin_temp", normal)
    assert not firing(engine, now, "temp", "C1").firing

    hot_store = type(store)()
    engine = RuleEngine([base], cfg, hot_store, CREW)
    now = fill(hot_store, "C1", "skin_temp", normal + [38.0] * 30)
    f = firing(engine, now, "temp", "C1")
    assert f.firing and f.evidence["value"] > 3.0 and f.evidence["baseline_sd"] > 0


def test_baseline_needs_history(cfg, store):
    base = rule(id="temp", type="BASELINE", signal="skin_temp", op=">", limit_ref="physiology.baseline_z_alert")
    engine = RuleEngine([base], cfg, store, CREW)
    assert not firing(engine, fill(store, "C1", "skin_temp", [39.0] * 20), "temp", "C1").firing


def test_cumulative(cfg, store):
    dose = rule(id="dose", type="CUMULATIVE", signal="dose_rate_equivalent", op=">",
                limit_ref="radiation.dose_24h_mSv_max", window="24h", scale=0.001, unit="mSv")
    engine = RuleEngine([dose], cfg, store, CREW)
    fill(store, "C1", "dose_rate_equivalent", [300.0] * 1440)  # 7.2 mSv
    now = fill(store, "C2", "dose_rate_equivalent", [100.0] * 1440)  # 2.4 mSv
    high = firing(engine, now, "dose", "C1")
    assert high.firing and high.evidence["value"] == pytest.approx(7.2) and high.evidence["unit"] == "mSv"
    assert not firing(engine, now, "dose", "C2").firing


def test_compound_all(cfg, store):
    compound = rule(id="cog", type="COMPOUND", **{"all": ["sleep", "co2"]})
    engine = RuleEngine([SLEEP, CO2, compound], cfg, store, CREW)
    fill(store, "C1", "sleep_hours_24h", [4.0])
    fill(store, "C2", "sleep_hours_24h", [8.0])
    now = fill(store, None, "ppco2", [3.5])
    f = firing(engine, now, "cog", "C1")
    assert f.firing and len(f.evidence["members"]) == 2
    assert all("limit" in m and "value" in m for m in f.evidence["members"])
    assert not firing(engine, now, "cog", "C2").firing  # CO2 alone is not enough

    t1 = now + timedelta(minutes=1)
    store.add(None, "ppco2", t1, 2.0)
    store.add("C1", "sleep_hours_24h", t1, 4.0)
    assert not firing(engine, t1, "cog", "C1").firing  # sleep alone is not enough


def test_compound_with_inline_predicates(cfg, store):
    compound = rule(id="ortho", type="COMPOUND", **{"all": [
        {"signal": "bp_systolic", "op": "<", "limit_ref": "physiology.bp_systolic_mmHg.min", "window": "1m"},
        {"signal": "heart_rate", "op": ">", "limit_ref": "physiology.hr_orthostatic_bpm", "window": "1m"},
    ]})
    engine = RuleEngine([compound], cfg, store, CREW)
    fill(store, "C1", "bp_systolic", [85.0])
    now = fill(store, "C1", "heart_rate", [105.0])
    assert firing(engine, now, "ortho", "C1").firing
    assert not firing(engine, now, "ortho", "C2").firing


def test_rule_without_traceability_is_rejected():
    with pytest.raises(ValidationError):
        Rule(id="x", type="THRESHOLD", title="t", signal="ppco2", limit_ref="environment.ppco2_mmHg_1h_max",
             severity="CAUTION", hazards=[], hrp_risks=["HRP-12"], rationale="r", action="a")
    with pytest.raises(ValidationError):
        Rule(id="x", type="THRESHOLD", title="t", signal="ppco2", limit_ref="environment.ppco2_mmHg_1h_max",
             severity="CAUTION", hazards=["RADIATION"], rationale="r", action="a")


def test_config_limits_and_rules_are_traceable(cfg):
    for section in cfg.limits.values():
        for entry in section.values():
            assert "source_ref" in entry and isinstance(entry["verified"], bool)
    for r in cfg.rules:
        assert r.hazards and r.hrp_risks and r.rationale and r.action


HEADACHE = {"signal": "symptom_headache", "op": ">=", "limit_ref": "symptoms.headache_report_min", "window": "1m",
            "agg": "max"}


def test_compound_none_branches_on_context(cfg, store):
    co2_branch = rule(id="b.co2", type="COMPOUND", context="g", branch="co2", **{"all": [HEADACHE, "co2"]})
    other = rule(id="b.other", type="COMPOUND", context="g", branch="other", **{"all": [HEADACHE], "none": ["co2"]})
    engine = RuleEngine([CO2, co2_branch, other], cfg, store, CREW)
    fill(store, "C1", "symptom_headache", [2.0])
    now = fill(store, None, "ppco2", [2.0])
    f = firing(engine, now, "b.other", "C1")
    assert f.firing and not firing(engine, now, "b.co2", "C1").firing
    assert f.evidence["context"] == {"group": "g", "branch": "other"}
    assert f.evidence["members"][-1]["negated"] is True and f.evidence["value"] == f.evidence["limit"] == 2

    t1 = now + timedelta(minutes=1)
    store.add(None, "ppco2", t1, 3.6)
    store.add("C1", "symptom_headache", t1, 2.0)
    assert firing(engine, t1, "b.co2", "C1").firing  # same symptom, cabin CO2 high: the other branch
    assert not firing(engine, t1, "b.other", "C1").firing
    assert not firing(engine, t1, "b.co2", "C2").firing  # C2 reported nothing


def test_compound_needs_all_or_any():
    with pytest.raises(ValidationError):
        rule(id="x", type="COMPOUND", none=["co2"])


def test_hysteresis_hold_is_marked(cfg, store):
    engine = RuleEngine([CO2], cfg, store, CREW)
    now = fill(store, None, "ppco2", [3.5])
    assert "hysteresis_hold" not in firing(engine, now, "co2").evidence
    t1 = now + timedelta(minutes=1)
    store.add(None, "ppco2", t1, 2.95)  # under the limit, above the clear threshold
    f = firing(engine, t1, "co2")
    assert f.firing and f.evidence["hysteresis_hold"] is True


def test_in_treatment_transition(cfg, store):
    engine = RuleEngine([CO2], cfg, store, CREW)
    manager = AlertManager()
    now = fill(store, None, "ppco2", [3.5])
    [alert] = manager.process(engine.evaluate(now), now)
    manager.treat(alert.id, now)
    assert alert.state == AlertState.IN_TREATMENT and alert.ack_ts == now
    assert alert in manager.open_alerts()
    manager.resolve(alert.id, now)
    manager.treat(alert.id, now)  # a resolved alert stays resolved
    assert alert.state == AlertState.RESOLVED
