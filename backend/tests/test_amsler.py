"""T-9: Amsler grid eye self-check (ROADMAP.md §0.4, PRD §6 M11). Click input, CREW_ENTERED, no image stored."""

from datetime import timedelta

import pytest
from fastapi.testclient import TestClient

from app.domain.enums import SIGNALS, Severity
from app.main import create_app
from app.rules.engine import RuleEngine
from app.util import iso
from tests.conftest import T0, fill

AMSLER_SIGNALS = ["amsler_flag", "amsler_cells_right", "amsler_cells_left"]


@pytest.fixture
def client():
    app = create_app(run_loop=False)
    with TestClient(app) as c:
        c.rt = app.state.rt
        yield c


def submit(client, crew_id, values, method="amsler"):
    w = client.rt.world
    ts = iso(w.clock.now())
    obs = [{"id": f"a-{crew_id}-{signal}-{ts}", "ts": ts, "crew_id": crew_id, "device_id": f"tablet-{crew_id}",
            "signal": signal, "value": value, "unit": SIGNALS[signal].unit, "provenance": "CREW_ENTERED",
            "entry_method": method, "test_id": "amsler"} for signal, value in values.items()]
    return client.post("/api/v1/observations", json=obs)


def open_alert(world, rule_id, crew_id):
    return next((a for a in world.alerts.open_alerts() if a.rule_id == rule_id and a.crew_id == crew_id), None)


def test_catalog_entry_explains_itself_and_stores_no_image(cfg):
    test = cfg.selftests.test("amsler")
    assert test.kind == "amsler" and test.entry_method == "amsler"
    assert [f.signal for f in test.fields] == AMSLER_SIGNALS  # flag + counts only: no picture, no cell list
    assert [h.value for h in test.hazards] == ["GRAVITY_FIELDS"] and [r.value for r in test.hrp_risks] == ["HRP-10"]
    steps = " ".join(test.steps).lower()
    assert "cover your left eye" in steps and "cover" in steps and "dot in the middle" in steps
    assert "cmo" in test.escalation.lower() and test.schedule is not None and test.schedule.every == "7d"
    assert test.params["grid"] * test.params["grid"] == 100
    lim = cfg.limit("eye.amsler_flag_min")
    assert lim.verified is False and "not a medical limit" in lim.source_ref
    assert all(SIGNALS[s].entry_only and not SIGNALS[s].onboard_only for s in AMSLER_SIGNALS)


def test_rule_is_traceable_and_never_diagnoses(cfg):
    rule = next(r for r in cfg.rules if r.id == "eye.amsler.distortion")
    assert rule.severity == Severity.CAUTION
    assert [h.value for h in rule.hazards] == ["GRAVITY_FIELDS"] and [r.value for r in rule.hrp_risks] == ["HRP-10"]
    text = " ".join([rule.rationale, rule.action, *rule.checklist]).lower()
    assert "indicators consistent with" in text and "cmo" in text and "you have" not in text
    sans = next(r for r in cfg.rules if r.id == "sans.watch")
    assert "eye.amsler.distortion" in sans.any


def engine(cfg, store):
    ids = {"sans.watch", "intake.sodium.high", "intake.fluid.low", "eye.amsler.distortion"}
    return RuleEngine([r for r in cfg.rules if r.id in ids], cfg, store, ["C1", "C2"])


def test_marked_grid_fires_and_a_clean_recheck_clears(cfg, store):
    eng = engine(cfg, store)
    fill(store, None, "low_g_days", [10.0])  # too early for the SANS watch
    store.add("C1", "amsler_flag", T0, 1.0)
    store.add("C2", "amsler_flag", T0, 0.0)
    f = {(x.rule.id, x.crew_id): x for x in eng.evaluate(T0)}
    assert f[("eye.amsler.distortion", "C1")].firing and not f[("eye.amsler.distortion", "C2")].firing
    assert not f[("sans.watch", "C1")].firing  # the Amsler flag alone only counts after a month below 1 g
    t1 = T0 + timedelta(days=1)
    store.add(None, "low_g_days", t1, 11.0)
    store.add("C1", "amsler_flag", t1, 0.0)
    f = {(x.rule.id, x.crew_id): x for x in eng.evaluate(t1)}
    assert not f[("eye.amsler.distortion", "C1")].firing


def test_marked_grid_joins_the_sans_watch_after_a_month_in_low_g(cfg, store):
    eng = engine(cfg, store)
    fill(store, None, "low_g_days", [45.0])
    fill(store, None, "ppco2", [2.0] * 60)
    store.add("C2", "amsler_flag", T0, 1.0)
    f = {(x.rule.id, x.crew_id): x for x in eng.evaluate(T0)}
    assert f[("sans.watch", "C2")].firing and not f[("sans.watch", "C1")].firing
    member = next(m for m in f[("sans.watch", "C2")].evidence["members"] if m["signal"] == "amsler_flag")
    assert member["firing"]


def test_entry_is_crew_entered_raises_caution_and_works_in_blackout(client):
    w = client.rt.world
    w.link.blackout = True  # onboard feature
    r = submit(client, "C3", {"amsler_flag": 1, "amsler_cells_right": 4, "amsler_cells_left": 0})
    assert r.status_code == 200 and r.json()["accepted"] == 3
    w.tick()
    alert = open_alert(w, "eye.amsler.distortion", "C3")
    assert alert is not None and alert.severity == Severity.CAUTION
    assert alert.evidence["provenance"] == "CREW_ENTERED" and alert.evidence["limit_verified"] is False
    [result] = w.entries.results_for("C3")
    assert result["values"] == {"amsler_flag": 1, "amsler_cells_right": 4, "amsler_cells_left": 0}
    assert result["entry_method"] == "amsler" and result["provenance"] == "CREW_ENTERED"


def test_clean_check_raises_nothing_and_marks_the_routine_done(client):
    w = client.rt.world
    submit(client, "C4", {"amsler_flag": 0, "amsler_cells_right": 0, "amsler_cells_left": 0})
    w.tick()
    assert open_alert(w, "eye.amsler.distortion", "C4") is None
    board = client.get("/api/v1/selftests/schedule", params={"crew_id": "C4"}).json()["schedule"]["C4"]
    item = next(i for i in board if i["test_id"] == "amsler")
    assert item["status"] in {"DONE", "UPCOMING"}  # weekly slot; DONE once its slot has started


def test_refuses_more_cells_than_the_grid_has(client):
    r = submit(client, "C1", {"amsler_flag": 1, "amsler_cells_right": 101, "amsler_cells_left": 0})
    assert r.status_code == 422 and "outside" in r.json()["detail"]
    assert client.rt.world.entries.results_for("C1") == []


def test_catalog_api_serves_the_grid_size(client):
    test = next(t for t in client.get("/api/v1/selftests").json()["tests"] if t["id"] == "amsler")
    assert test["params"]["grid"] == 10 and test["limits"][0]["verified"] is False
    assert {f["signal"]: f["unit"] for f in test["fields"]}["amsler_cells_right"] == "cells"
