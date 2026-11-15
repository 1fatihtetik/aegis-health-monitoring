"""T-8: LANDING readiness gate (Go / Hold) before a gravity increase (ROADMAP.md §0.4)."""

import pytest
from fastapi.testclient import TestClient

from app.config import Config
from app.domain.enums import Severity
from app.main import create_app
from app.scores.readiness import compute_readiness
from tests.conftest import run


def landing(world, crew_id):
    return world.snapshot["readiness"][crew_id]["LANDING"]


def test_landing_kind_is_traceable_and_honest(cfg):
    spec = cfg.readiness["kinds"]["LANDING"]
    assert spec["hazards"] and "HRP-03" in spec["hrp_risks"]
    assert set(spec["components"]) == {"pvt", "stand", "fluid", "spo2", "low_g"}
    assert all(c.get("action") for c in spec["components"].values())
    assert spec["hold_actions"] and "CMO" in spec["hold_actions"][0]
    for ref in [spec["go_min_ref"], *(c["limit_ref"] for c in spec["components"].values())]:
        assert cfg.limit(ref).source_ref
    assert cfg.limit("readiness.landing_go_min").verified is False
    assert cfg.limit("landing.low_g_days_long").verified is False
    text = " ".join([*spec["hold_actions"], *(c["action"] for c in spec["components"].values())]).lower()
    assert "you have" not in text and "presyncop" not in text


def test_c3_holds_before_the_mars_landing_and_after_it(cfg):
    before = run(cfg, "orthostatic_intolerance", 0.3)
    nxt = before.snapshot["phase"]["next_gravity_increase"]
    assert nxt["to_phase"] == "MARS_SURFACE" and nxt["to_g"] == 0.38 and nxt["in_s"] > 0
    c3, c1 = landing(before, "C3"), landing(before, "C1")
    assert c3["go"] is False and c3["components"]["fluid"]["value"] == 1200  # scripted low fluid log
    assert c1["go"] is True
    assert c3["components"]["stand"]["value"] is None  # no stand test possible in 0 g; left out of the score
    assert c3["go_min_verified"] is False and c3["hold_actions"]

    after = run(cfg, "orthostatic_intolerance", 2)
    assert after.snapshot["phase"]["next_gravity_increase"] is None
    c3 = landing(after, "C3")
    assert c3["go"] is False and "cardio.orthostatic" in {a["rule_id"] for a in c3["hold_alerts"]}
    assert landing(after, "C1")["go"] is True


def test_an_open_hold_rule_forces_hold_whatever_the_score(cfg):
    world = run(cfg, "orthostatic_intolerance", 2)
    alert = next(a for a in world.alerts.open_alerts() if a.rule_id == "cardio.orthostatic")
    moved = alert.model_copy(update={"crew_id": "C1", "severity": Severity.INFO})  # INFO: no score penalty
    now = world.clock.now()
    gate = compute_readiness(cfg, world.store, [moved], ["C1"], now)["C1"]["LANDING"]
    assert gate["value"] >= gate["go_min"] and gate["go"] is False
    assert [a["rule_id"] for a in gate["hold_alerts"]] == ["cardio.orthostatic"]
    assert compute_readiness(cfg, world.store, [], ["C1"], now)["C1"]["LANDING"]["go"] is True


def test_unknown_hold_rule_is_refused(cfg):
    kinds = cfg.readiness["kinds"]["LANDING"]
    kinds["hold_rules"].append("no.such.rule")
    try:
        with pytest.raises(ValueError, match="unknown hold rule"):
            Config._validate(cfg)
    finally:
        kinds["hold_rules"].remove("no.such.rule")


def test_nominal_crew_is_go_and_demo_shows_the_lunar_landing_ahead(cfg):
    world = run(cfg, "nominal", 1)
    assert all(landing(world, c)["go"] for c in ("C1", "C2", "C3", "C4"))
    demo = run(cfg, "demo_5min", 0.1)
    assert demo.snapshot["phase"]["next_gravity_increase"]["to_phase"] == "LUNAR_SURFACE"


def test_readiness_endpoint_serves_the_landing_gate():
    app = create_app(run_loop=False)
    with TestClient(app) as client:
        body = client.get("/api/v1/readiness", params={"kind": "LANDING"}).json()["readiness"]
        gate = body["C1"]["LANDING"]
        assert {"go", "go_min", "hold_alerts", "hold_actions", "components"} <= gate.keys()
        assert gate["components"]["spo2"]["action"]


def test_landing_components_carry_their_source(cfg):
    world = run(cfg, "orthostatic_intolerance", 0.3)
    comps = landing(world, "C3")["components"]
    assert comps["fluid"]["source"]["provenance"] == "SYNTHETIC"  # scripted self-test result, never CREW_ENTERED
    assert "scripted" in comps["fluid"]["source"]["basis"].lower()
    assert comps["spo2"]["source"]["provenance"]
    assert "source" not in comps["stand"]  # no value, no source
