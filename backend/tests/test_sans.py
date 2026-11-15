"""T-7: SANS watch rule (HRP-10). Fires, does not fire, hysteresis, evidence, honest copy (ROADMAP.md §0.4)."""

from datetime import timedelta

from app.domain.enums import Severity
from app.rules.engine import RuleEngine
from tests.conftest import T0, fill, run

CREW = ["C1", "C2"]


def sans_engine(cfg, store):
    ids = {"sans.watch", "intake.sodium.high", "intake.fluid.low", "eye.amsler.distortion"}
    return RuleEngine([r for r in cfg.rules if r.id in ids], cfg, store, CREW)


def findings(engine, now):
    return {(f.rule.id, f.crew_id): f for f in engine.evaluate(now)}


def test_rule_is_traceable_and_honest(cfg):
    rule = next(r for r in cfg.rules if r.id == "sans.watch")
    assert rule.severity == Severity.CAUTION
    assert [h.value for h in rule.hazards] == ["GRAVITY_FIELDS", "HOSTILE_CLOSED_ENV"]
    assert [h.value for h in rule.hrp_risks] == ["HRP-10"]
    text = " ".join([rule.rationale, rule.action, *rule.checklist]).lower()
    assert "limited" in rule.rationale and "limited" in rule.action
    assert "eye self-check" in text and "cmo" in text
    assert "you have" not in text  # decision support, never a diagnosis
    for ref in ("sans.low_g_days_min", "sans.ppco2_mmHg_24h_mean_max"):
        assert cfg.limit(ref).verified is False and cfg.limit(ref).source_ref


def test_fires_for_the_crew_member_with_high_sodium_after_a_month_in_low_g(cfg, store):
    engine = sans_engine(cfg, store)
    fill(store, None, "low_g_days", [45.0])
    fill(store, None, "ppco2", [2.0] * 60)
    store.add("C1", "sodium_intake", T0, 4200)
    f = findings(engine, T0)
    assert f[("sans.watch", "C1")].firing
    assert not f[("sans.watch", "C2")].firing
    members = f[("sans.watch", "C1")].evidence["members"]
    signals = [m["signal"] for m in members]
    assert signals == ["low_g_days", "ppco2", "sodium_intake", "fluid_intake", "amsler_flag"]  # every member listed
    assert members[0]["limit_ref"] == "sans.low_g_days_min" and members[0]["firing"]


def test_does_not_fire_before_a_month_or_without_a_contributor(cfg, store):
    engine = sans_engine(cfg, store)
    fill(store, None, "low_g_days", [12.0])
    store.add("C1", "sodium_intake", T0, 4200)
    store.add("C2", "fluid_intake", T0, 900)
    f = findings(engine, T0)
    assert not f[("sans.watch", "C1")].firing and not f[("sans.watch", "C2")].firing

    t1 = T0 + timedelta(minutes=1)
    store.add(None, "low_g_days", t1, 60.0)
    store.add("C1", "sodium_intake", t1, 2000)
    store.add("C2", "fluid_intake", t1, 3000)  # above the [V2 6109] 2.5 L minimum
    f = findings(engine, t1)
    assert not f[("sans.watch", "C1")].firing and not f[("sans.watch", "C2")].firing


def test_cabin_co2_day_mean_watches_every_crew_member_with_hysteresis(cfg, store):
    engine = sans_engine(cfg, store)
    fill(store, None, "low_g_days", [100.0])
    now = fill(store, None, "ppco2", [3.2] * (24 * 60))
    f = findings(engine, now)
    assert f[("sans.watch", "C1")].firing and f[("sans.watch", "C2")].firing
    # back just under the limit: still inside the hysteresis band, so the watch holds
    t1 = now + timedelta(minutes=1)
    store.add(None, "low_g_days", t1, 100.0)
    for i in range(24 * 60):
        store.add(None, "ppco2", t1 - timedelta(minutes=i), 2.97)
    assert findings(engine, t1)[("sans.watch", "C1")].firing
    t2 = t1 + timedelta(minutes=1)
    for i in range(24 * 60):
        store.add(None, "ppco2", t2 - timedelta(minutes=i), 2.5)
    store.add(None, "low_g_days", t2, 100.0)
    assert not findings(engine, t2)[("sans.watch", "C1")].firing


def test_simulator_emits_low_g_days_and_resets_at_one_g(cfg):
    world = run(cfg, "nominal", 1)
    point = world.store.latest(None, "low_g_days")
    assert point is not None and point[1] > 30  # scenario day 142 of the Mars transit
    world.sim.set_phase("POST_LANDING")
    world.tick()
    assert world.store.latest(None, "low_g_days")[1] == 0.0


def test_nominal_day_does_not_raise_the_watch(cfg):
    world = run(cfg, "nominal", 6)
    assert not [a for a in world.alerts.alerts.values() if a.rule_id == "sans.watch"]


def test_scrubber_degradation_raises_the_watch_from_the_day_mean(cfg):
    world = run(cfg, "co2_scrubber_degradation", 24)
    raised = [a for a in world.alerts.alerts.values() if a.rule_id == "sans.watch"]
    assert {a.crew_id for a in raised} == {"C1", "C2", "C3", "C4"}
    assert all(a.severity == Severity.CAUTION for a in raised)
