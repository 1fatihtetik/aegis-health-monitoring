"""Scenario integration tests: fixed seed, max speed, expected alerts within their windows."""

import pytest

from app.sim.scenario import list_scenarios, load_scenario
from app.util import parse_duration
from tests.conftest import run

HOURS = {
    "spe_event": 8,
    "co2_scrubber_degradation": 8,
    "insomnia_streak": 14,
    "orthostatic_intolerance": 3,
    "demo_5min": 25,
    "headache_branching": 13,
    "leo_baseline": 8,
    "lunar_surface": 6,
}


def alert_log(world):
    return sorted(
        (a.raised_ts, a.rule_id, a.crew_id or "", a.severity.value, a.state.value) for a in world.alerts.alerts.values()
    )


@pytest.mark.parametrize("name", sorted(HOURS))
def test_scenario_fires_expected_alerts(cfg, name):
    world = run(cfg, name, HOURS[name])
    alerts = list(world.alerts.alerts.values())
    for exp in load_scenario(name)["expected"]:
        deadline = world.start_ts + parse_duration(exp["within"])
        hits = [
            a for a in alerts
            if a.rule_id == exp["rule_id"] and a.severity.value == exp["severity"]
            and ("crew_id" not in exp or a.crew_id == exp["crew_id"]) and a.raised_ts <= deadline
        ]
        assert hits, f"{name}: expected {exp} by {deadline}, got {alert_log(world)}"
    for a in alerts:  # every alert is traceable and explainable
        assert a.hazards and a.hrp_risks
        assert {"signal", "value", "limit", "limit_verified", "window"} <= a.evidence.keys()


def test_every_scenario_file_is_covered():
    assert {s["name"] for s in list_scenarios()} == set(HOURS) | {"nominal"}


def test_nominal_day_has_no_alerts(cfg):
    world = run(cfg, "nominal", 24)
    assert alert_log(world) == []
    assert all(c["status"] == "NOMINAL" and c["eva_go"] for c in world.snapshot["crew"])


def test_only_expected_crew_are_flagged(cfg):
    world = run(cfg, "insomnia_streak", 14)
    assert {a.crew_id for a in world.alerts.alerts.values()} == {"C1"}
    eva = {c["id"]: c["eva_go"] for c in world.snapshot["crew"]}
    assert eva == {"C1": False, "C2": True, "C3": True, "C4": True}


def test_determinism(cfg):
    a, b = run(cfg, "demo_5min", 25, seed=7), run(cfg, "demo_5min", 25, seed=7)
    assert alert_log(a) == alert_log(b)
    assert a.snapshot == b.snapshot
    assert alert_log(a) != [] and run(cfg, "nominal", 1, seed=8).snapshot != run(cfg, "nominal", 1, seed=9).snapshot


def test_spe_radiation_summary_and_shelter(cfg):
    world = run(cfg, "spe_event", 1)
    rad = world.snapshot["radiation"]
    assert rad["spe"]["active"] and rad["spe"]["checklist"] and not rad["spe"]["all_sheltered"]
    assert rad["area"]["neutron_fraction"] == pytest.approx(0.30, abs=0.03)
    assert rad["limits"]["career"]["verified"] is True and "[V1 4030]" in rad["limits"]["career"]["source_ref"]
    assert rad["limits"]["spe_dose_rate"]["verified"] is False  # heuristic alert threshold
    assert rad["limits"]["spe_event"]["value"] == 250
    world.set_sheltered("C1", True)
    for _ in range(60):
        world.tick()
    crew = world.snapshot["radiation"]["crew"]
    assert crew["C1"]["sheltered"] and crew["C1"]["dose_rate_uSv_h"] < 0.5 * crew["C2"]["dose_rate_uSv_h"]
    assert crew["C1"]["event_dose_mSv"] < crew["C2"]["event_dose_mSv"]
    # Sheltering avoids dose: C1 saved a real amount, unsheltered C2 saved next to nothing.
    assert crew["C1"]["event_dose_saved_mSv"] > 10 * crew["C2"]["event_dose_saved_mSv"]
    assert crew["C1"]["event_dose_saved_mSv"] > 0


def test_demo_script_controls_speed_and_pauses(cfg):
    from app.world import World

    world = World(cfg, "demo_5min", 42)
    speeds, paused, blackout_minutes = [], False, []
    for minute in range(25 * 60):
        result = world.tick()
        if result.speed is not None:
            speeds.append(result.speed)
        paused = paused or result.pause
        if world.link.blackout:
            blackout_minutes.append(minute)
    assert speeds == [120, 3600, 60, 3600, 60] and paused
    assert world.snapshot["phase"]["name"] == "MARS_SURFACE"
    # Scripted comm blackout from 20h45m to 21h10m, then the link is back.
    assert blackout_minutes and blackout_minutes[0] == 20 * 60 + 45 and blackout_minutes[-1] == 21 * 60 + 9
    assert not world.link.blackout


def test_demo_blackout_delays_ground_but_not_onboard(cfg):
    """Alerts still in transit when the demo blackout starts reach the ground only after it ends; onboard is on time."""
    from app.world import World

    world = World(cfg, "demo_5min", 42)
    ground_seen = {}
    for _ in range(22 * 60):
        for alert in world.tick().ground_alerts:
            ground_seen.setdefault((alert["rule_id"], alert["crew_id"]), world.clock.now())
    dose = [a for a in world.alerts.alerts.values() if a.rule_id == "rad.dose.24h"]
    assert len(dose) == 4
    blackout_end = world.start_ts + parse_duration("21h10m")
    for a in dose:
        assert a.raised_ts < blackout_end  # onboard: raised on time
        assert ground_seen[(a.rule_id, a.crew_id)] >= blackout_end  # ground: only after the link is back


def test_demo_orthostatic_alert_does_not_flap(cfg):
    world = run(cfg, "demo_5min", 25)
    ortho = [a for a in world.alerts.alerts.values() if a.rule_id == "cardio.orthostatic"]
    assert len(ortho) == 1 and ortho[0].crew_id == "C3" and ortho[0].resolved_ts is None


def test_headache_branches_on_cabin_co2(cfg):
    world = run(cfg, "headache_branching", 13)
    fired = {(a.rule_id, a.crew_id) for a in world.alerts.alerts.values() if a.rule_id.startswith("ctx.")}
    assert fired == {("ctx.headache_tachy.hydration", "C2"), ("ctx.headache_tachy.co2", "C4")}


# ---- P-7 phase scenarios ---------------------------------------------------------------------------------------
def test_leo_baseline_shows_saa_notices_but_no_spe_alarm(cfg):
    world = run(cfg, "leo_baseline", 8)
    rules = {a.rule_id for a in world.alerts.alerts.values()}
    assert rules == {"rad.saa.transit"}
    assert all(a.severity.value == "INFO" for a in world.alerts.alerts.values())
    src = world.snapshot["provenance"]["area_dose_rate_absorbed"]
    assert (src["provenance"], src["dataset_id"]) == ("NASA_MEASURED", "iss_dostel1_2019_01")


def test_lunar_surface_switches_radiation_and_gravity(cfg):
    world = run(cfg, "lunar_surface", 6)
    assert alert_log(world) == []
    src = world.snapshot["provenance"]["area_dose_rate_equivalent"]
    assert (src["provenance"], src["dataset_id"]) == ("NASA_DERIVED", "lro_crater_surface_2019_01")
    g = world.snapshot["phase"]["gravity"]
    assert g["gravity_g"] == 0.16 and g["load_factor"] == 0.84
    assert g["transition"] and g["transition"]["to_g"] == 0.16
