"""Block P, P-5: gravity drives physiology (model A, LINEAR; user decision 2026-11-14)."""

import pytest

from app.config import Config
from app.world import World

PHASE_G = {"LEO": 0.0, "LUNAR_SURFACE": 0.16, "MARS_SURFACE": 0.38, "POST_LANDING": 1.0}


def _world(cfg: Config, scenario: str = "nominal") -> World:
    return World(cfg, scenario, 42)


@pytest.mark.parametrize("phase, g", sorted(PHASE_G.items()))
def test_drift_rate_scales_linearly_with_gravity(cfg, phase, g):
    w = _world(cfg)
    zero_g = w.sim.bmd_rate_pct_month(0.9, 0.0)
    w.sim.set_phase(phase)
    assert w.sim.bmd_rate_pct_month(0.9) == pytest.approx(zero_g * (1 - g))
    before = w.sim.unloaded_days
    for _ in range(120):
        w.tick()
    assert w.sim.unloaded_days - before == pytest.approx(120 / 1440 * (1 - g))


def test_moon_and_mars_keep_84_and_62_percent_of_the_0g_loss(cfg):
    w = _world(cfg)
    rates = {}
    for phase in ("MARS_TRANSIT", "LUNAR_SURFACE", "MARS_SURFACE", "POST_LANDING"):
        w.sim.set_phase(phase)
        rates[phase] = w.sim.gravity_state()["bmd_loss_pct_month"]
    assert rates["LUNAR_SURFACE"] / rates["MARS_TRANSIT"] == pytest.approx(0.84, abs=0.01)
    assert rates["MARS_SURFACE"] / rates["MARS_TRANSIT"] == pytest.approx(0.62, abs=0.01)
    assert rates["POST_LANDING"] == 0.0  # the linear model has no loss at 1 g (and models no recovery)


def test_0g_start_keeps_the_old_bone_curve(cfg):
    w = _world(cfg)  # MARS_TRANSIT, 0 g: unloaded days == mission days
    assert w.sim.unloaded_days == pytest.approx(w.sim.elapsed_days(w.clock.now()), abs=1e-6)


def test_bmd_after_a_month_differs_by_phase(cfg):
    def bmd_after(phase: str) -> float:
        w = _world(cfg)
        w.sim.set_phase(phase)
        w.sim.unloaded_days += 30 * w.sim.load_factor(PHASE_G[phase])  # 30 days in this phase
        c = w.sim.crew[0]
        return dict((s, v) for _, s, v in w.sim._daily(c, w.clock.now()))["bmd_estimate"]
    leo, moon, mars, earth = (bmd_after(p) for p in ("LEO", "LUNAR_SURFACE", "MARS_SURFACE", "POST_LANDING"))
    assert leo < moon < mars < earth


def test_blood_pressure_rises_with_gravity_heart_rate_does_not(cfg):
    w = _world(cfg)
    assert w.sim.bp_offset() == (0.0, 0.0, 0.0)
    w.sim.set_phase("MARS_SURFACE")
    sbp, dbp, hr = w.sim.bp_offset()
    assert sbp == pytest.approx(0.38 * 8) and dbp == pytest.approx(0.38 * 9) and hr == 0.0  # Norsk 2015 x g


def test_landing_after_a_long_cruise_carries_the_meck_risk(cfg):
    w = _world(cfg)  # day ~140 at 0 g
    assert w.sim.presyncope_fraction(5) == pytest.approx(0.17)
    assert w.sim.presyncope_fraction(200) == pytest.approx(0.83)
    assert 0.17 < w.sim.presyncope_fraction(70) < 0.83
    w.sim.set_phase("MARS_SURFACE")
    t = w.sim.gravity_state()["transition"]
    assert t["from_g"] == 0.0 and t["to_g"] == 0.38 and t["days_at_low_g"] > 129
    assert t["risk"] == pytest.approx(0.83 * 0.38, abs=1e-3)
    w.sim.set_phase("RETURN")  # a gravity decrease is not a transition
    assert w.sim.gravity_state()["transition"]["to_g"] == 0.38
    w.sim.set_phase("POST_LANDING")
    assert w.sim.gravity_state()["transition"]["risk"] == pytest.approx(0.83 * 1.0, abs=1e-3)
    assert w.sim.low_g_days == 0.0


def test_snapshot_explains_the_gravity_effect(cfg):
    w = _world(cfg)
    w.tick()
    grav = w.snapshot["phase"]["gravity"]
    assert grav["model"] == "LINEAR" and grav["gravity_g"] == 0.0 and grav["load_factor"] == 1.0
    assert "Norsk" in grav["basis"] and "Meck" in grav["basis"] and "not a diagnosis" in grav["basis"]


def test_mars_landing_still_raises_the_orthostatic_warning(cfg):
    w = _world(cfg, "orthostatic_intolerance")
    for _ in range(150):
        w.tick()
    raised = [(a.rule_id, a.crew_id) for a in w.alerts.alerts.values()]
    assert ("cardio.orthostatic", "C3") in raised
    assert w.snapshot["phase"]["gravity"]["transition"]["to_g"] == 0.38
