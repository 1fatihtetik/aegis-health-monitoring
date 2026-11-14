"""Block T: crew self-tests (ROADMAP section 0, AGENTS.md sections 2b and 7)."""

import re
import shutil
from pathlib import Path

import pytest
import yaml
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.config import CONFIG_DIR, Config
from app.datasets.provenance import weakest
from app.domain.enums import Provenance
from app.domain.models import Observation
from app.main import create_app
from app.util import iso
from app.world import World


@pytest.fixture
def client():
    app = create_app(run_loop=False)
    with TestClient(app) as c:
        c.rt = app.state.rt
        yield c


def entry(client, crew_id, signal, value, unit, test_id=None, method="form", **extra):
    w = client.rt.world
    obs = {"id": f"e-{crew_id}-{signal}-{iso(w.clock.now())}-{value}", "ts": iso(w.clock.now()), "crew_id": crew_id,
           "device_id": f"tablet-{crew_id}", "signal": signal, "value": value, "unit": unit,
           "provenance": "CREW_ENTERED", "entry_method": method, "test_id": test_id, **extra}
    return client.post("/api/v1/observations", json=[obs])


# ---- T-0: CREW_ENTERED ---------------------------------------------------------------------------------------------
def test_crew_entered_ranks_between_simulated_and_measured():
    order = [p.value for p in Provenance]
    assert order.index("SYNTHETIC_CALIBRATED") < order.index("CREW_ENTERED") < order.index("MEASURED_OTHER")
    assert weakest(["CREW_ENTERED", "NASA_MEASURED"]) == "CREW_ENTERED"
    assert weakest(["CREW_ENTERED", "MEASURED_OTHER"]) == "CREW_ENTERED"
    assert weakest(["CREW_ENTERED", "SYNTHETIC_CALIBRATED"]) == "SYNTHETIC_CALIBRATED"
    assert not Provenance.CREW_ENTERED.needs_dataset


def test_crew_entered_needs_no_dataset_but_an_entry_method():
    base = {"id": "x", "ts": "2026-11-14T20:00:00Z", "crew_id": "C1", "device_id": "tablet", "signal": "spo2",
            "value": 97, "unit": "%"}
    Observation(**base, provenance="CREW_ENTERED", entry_method="form")
    with pytest.raises(ValidationError):  # a person, not a dataset
        Observation(**base, provenance="CREW_ENTERED", entry_method="form", dataset_id="msl_rad_cruise_2012")
    with pytest.raises(ValidationError):
        Observation(**base, provenance="CREW_ENTERED")
    with pytest.raises(ValidationError):  # the entry method belongs to crew entries only
        Observation(**base, provenance="SYNTHETIC", entry_method="form")
    with pytest.raises(ValidationError):
        Observation(**{**base, "crew_id": None}, provenance="CREW_ENTERED", entry_method="form")


def test_entry_is_labelled_for_that_crew_member_only(client):
    w = client.rt.world
    assert entry(client, "C2", "symptom_headache", 2, "0-3", "headache", "tap").json()["accepted"] == 1
    assert w.source_for("symptom_headache", "C2")["provenance"] == "CREW_ENTERED"
    assert "tap" in w.source_for("symptom_headache", "C2")["basis"]
    assert w.source_for("symptom_headache", "C1")["provenance"] != "CREW_ENTERED"  # other crew keep their label
    assert w.provenance.current("symptom_headache").provenance != Provenance.CREW_ENTERED
    [result] = client.get("/api/v1/selftests/results", params={"crew_id": "C2"}).json()["results"]
    assert result["test_id"] == "headache" and result["values"] == {"symptom_headache": 2}
    assert result["provenance"] == "CREW_ENTERED" and result["entry_method"] == "tap"


def test_ingest_refuses_bad_entries(client):
    assert entry(client, "C9", "spo2", 97, "%").status_code == 422  # unknown crew member
    assert entry(client, "C1", "spo2", 97, "%", test_id="nope").status_code == 422  # unknown test
    assert entry(client, "C1", "spo2", 97, "%", test_id="headache").status_code == 422  # not a field of that test
    assert entry(client, "C1", "symptom_headache", 7, "0-3", "headache", "tap").status_code == 422  # outside 0-3


def test_scripted_result_stays_synthetic(cfg):
    w = World(cfg, "nominal")
    w._scripted_selftest(w.clock.now(), {"crew": "C3", "test": "headache", "values": {"symptom_headache": 1}})
    src = w.source_for("symptom_headache", "C3")
    assert src["provenance"] == "SYNTHETIC" and "Scripted self-test result" in src["basis"]
    [result] = w.entries.results_for("C3")
    assert result["provenance"] == "SYNTHETIC" and result["entry_method"] is None


def test_hand_measurement_replaces_the_wearable_stream(client):
    w = client.rt.world
    entry(client, "C1", "symptom_headache", 3, "0-3", "headache", "tap")
    for _ in range(5):
        w.tick()
    since = w.entries.latest[("C1", "symptom_headache")].ts
    assert [p[1] for p in w.store.points("C1", "symptom_headache", since)][1:] == [3]  # no wearable samples after it
    assert w.entries.override_values("C1", "symptom_headache", w.clock.now()) == [3]  # what the rules judge
    assert w.engine._source("symptom_headache", "C1")["provenance"] == "CREW_ENTERED"


# ---- T-0: catalog ----------------------------------------------------------------------------------------------------
def test_catalog_explains_every_test(client):
    body = client.get("/api/v1/selftests").json()
    assert body["tests"] and body["settings"]["manual_override"]["source_ref"]
    for test in body["tests"]:
        assert test["why"] and test["steps"] and test["hazards"] and test["hrp_risks"] and test["escalation"]
        assert len(test["limits"]) == len(test["limit_refs"])
        for lim in test["limits"]:
            assert {"value", "verified", "source_ref"} <= lim.keys()
        for f in test["fields"]:
            assert f["unit"] and f["input_min"] < f["input_max"]


def _catalog_with(tmp_path: Path, mutate) -> Path:
    for f in CONFIG_DIR.glob("*.yaml"):
        shutil.copy(f, tmp_path / f.name)
    data = yaml.safe_load((tmp_path / "selftests.yaml").read_text(encoding="utf-8"))
    mutate(data["tests"][0])
    (tmp_path / "selftests.yaml").write_text(yaml.safe_dump(data), encoding="utf-8")
    return tmp_path


@pytest.mark.parametrize("mutate", [
    lambda t: t.update(hazards=[]),
    lambda t: t.update(hrp_risks=[]),
    lambda t: t.update(steps=[]),
    lambda t: t.pop("why"),
    lambda t: t.update(limit_refs=["physiology.no_such_limit"]),
    lambda t: t["fields"][0].update(signal="no_such_signal"),
    lambda t: t.update(hazards=["NOT_A_RIDGE_HAZARD"]),
])
def test_catalog_loader_refuses_incomplete_entries(tmp_path, mutate):
    with pytest.raises((ValueError, ValidationError)):
        Config(config_dir=_catalog_with(tmp_path, mutate))


# ---- T-3: guided measurements ----------------------------------------------------------------------------------------
def submit(client, crew_id, test_id, values):
    """One form submission: all values share one timestamp, like the tablet sends them."""
    w = client.rt.world
    ts = iso(w.clock.now())
    units = {f["signal"]: f["unit"] for t in client.get("/api/v1/selftests").json()["tests"] for f in t["fields"]}
    obs = [{"id": f"f-{crew_id}-{test_id}-{signal}-{ts}", "ts": ts, "crew_id": crew_id, "device_id": f"tablet-{crew_id}",
            "signal": signal, "value": value, "unit": units[signal], "provenance": "CREW_ENTERED",
            "entry_method": "form", "test_id": test_id} for signal, value in values.items()]
    return client.post("/api/v1/observations", json=obs)


def open_alert(world, rule_id, crew_id):
    return next((a for a in world.alerts.open_alerts() if a.rule_id == rule_id and a.crew_id == crew_id), None)


def test_low_spo2_entry_raises_the_existing_alert_with_crew_entered_evidence(client):
    w = client.rt.world
    w.link.blackout = True  # onboard feature: works with the Earth link down
    assert submit(client, "C1", "bp_spo2", {"bp_systolic": 118, "bp_diastolic": 76, "spo2": 88}).json()["accepted"] == 3
    w.tick()
    alert = open_alert(w, "physio.spo2.low", "C1")
    assert alert is not None and alert.severity.value == "WARNING"
    assert alert.evidence["value"] == 88 and alert.evidence["provenance"] == "CREW_ENTERED"
    assert open_alert(w, "physio.spo2.low", "C2") is None
    [result] = w.entries.results_for("C1")
    assert result["values"] == {"bp_systolic": 118, "bp_diastolic": 76, "spo2": 88}


@pytest.mark.parametrize(("test_id", "values", "rule_id", "severity"), [
    ("glucose", {"glucose": 55}, "metab.glucose.low", "WARNING"),
    ("glucose", {"glucose": 240}, "metab.glucose.high", "CAUTION"),
    ("temperature", {"body_temp": 38.6}, "physio.temp.fever", "CAUTION"),
    ("temperature", {"body_temp": 34.2}, "physio.temp.low", "CAUTION"),
    ("intake", {"fluid_intake": 1200, "sodium_intake": 2000}, "intake.fluid.low", "CAUTION"),
    ("intake", {"fluid_intake": 2500, "sodium_intake": 4500}, "intake.sodium.high", "INFO"),
    ("bp_spo2", {"bp_systolic": 172, "bp_diastolic": 96, "spo2": 97}, "physio.bp.high", "CAUTION"),
])
def test_measurement_rules_fire_on_entries(client, test_id, values, rule_id, severity):
    w = client.rt.world
    assert submit(client, "C3", test_id, values).status_code == 200
    w.tick()
    alert = open_alert(w, rule_id, "C3")
    assert alert is not None and alert.severity.value == severity
    assert alert.evidence["provenance"] == "CREW_ENTERED" and alert.evidence["limit_verified"] is False


def test_normal_entries_raise_nothing(client):
    w = client.rt.world
    submit(client, "C4", "bp_spo2", {"bp_systolic": 120, "bp_diastolic": 78, "spo2": 98})
    submit(client, "C4", "glucose", {"glucose": 95})
    submit(client, "C4", "temperature", {"body_temp": 36.8})
    submit(client, "C4", "intake", {"fluid_intake": 2500, "sodium_intake": 2200})
    w.tick()
    assert [a.rule_id for a in w.alerts.open_alerts() if a.crew_id == "C4"] == []


def test_out_of_range_typing_is_refused(client):
    r = submit(client, "C1", "bp_spo2", {"bp_systolic": 1180, "bp_diastolic": 76, "spo2": 98})
    assert r.status_code == 422 and "outside" in r.json()["detail"]
    assert client.rt.world.entries.results_for("C1") == []  # nothing from the refused batch was stored


def test_new_measurement_limits_are_honestly_unverified(cfg):
    for ref in ("physiology.body_temp_C.max", "metabolic.glucose_mg_dL.min", "nutrition.fluid_intake_mL_day_min",
                "nutrition.sodium_intake_mg_day_max", "physiology.bp_diastolic_mmHg.min"):
        assert cfg.limit(ref).verified is False


# ---- T-1: routine schedule -----------------------------------------------------------------------------------------
def board_for(world, crew_id):
    return {i["test_id"] + ("+g" if i["reason"] != "routine" else ""): i for i in world.selftest_schedule()[crew_id]}


def test_board_starts_clean_then_slots_come_due_and_go_overdue_as_info(cfg):
    w = World(cfg, "nominal")  # starts 20:00 UTC
    board = board_for(w, "C1")
    assert {i["status"] for i in board.values()} == {"UPCOMING"}  # slots before T0 are not tracked
    for _ in range(61):  # 21:01: the 21:00 intake log is due
        w.tick()
    assert board_for(w, "C1")["intake"]["status"] == "DUE"
    for _ in range(3 * 60):  # 00:01: due window (3 h) passed
        w.tick()
    item = board_for(w, "C1")["intake"]
    assert item["status"] == "OVERDUE" and item["level"] == "INFO"
    assert [a for a in w.alerts.alerts.values()] == []  # overdue never raises an alert
    assert w.snapshot["readiness"]["C1"]["OVERALL"]["alert_penalty"] == 0  # and costs no readiness


def test_entering_the_test_marks_it_done_for_that_crew_member_only(client):
    w = client.rt.world
    for _ in range(61):
        w.tick()
    submit(client, "C2", "intake", {"fluid_intake": 2400, "sodium_intake": 2100})
    body = client.get("/api/v1/selftests/schedule").json()["schedule"]
    c2 = {i["test_id"]: i for i in body["C2"]}
    c1 = {i["test_id"]: i for i in body["C1"]}
    assert c2["intake"]["status"] == "DONE" and c2["intake"]["done_provenance"] == "CREW_ENTERED"
    assert c1["intake"]["status"] == "DUE"
    assert client.get("/api/v1/selftests/schedule", params={"crew_id": "C9"}).status_code == 404


def test_gravity_increase_adds_extra_checks(cfg):
    w = World(cfg, "orthostatic_intolerance")
    for _ in range(29):
        w.tick()
    assert not any(i["reason"] != "routine" for i in w.selftest_schedule()["C3"])
    for _ in range(2):  # the Mars landing at 30m
        w.tick()
    extra = board_for(w, "C3")["bp_spo2+g"]
    assert extra["status"] == "DUE" and extra["reason"] == "after gravity increase"
    for _ in range(121):
        w.tick()
    assert board_for(w, "C3")["bp_spo2+g"]["status"] == "OVERDUE"
    assert board_for(w, "C3")["bp_spo2+g"]["level"] == "INFO"


def test_same_scenario_and_seed_give_the_same_board(cfg):
    boards = []
    for _ in range(2):
        w = World(cfg, "orthostatic_intolerance", seed=7)
        for _ in range(200):
            w.tick()
        boards.append(w.selftest_schedule())
    assert boards[0] == boards[1]


def test_overdue_is_never_above_info(cfg):
    w = World(cfg, "nominal")
    for _ in range(26 * 60):
        if w.clock.now().minute == 0:
            for items in w.selftest_schedule().values():
                assert all(i["level"] in (None, "INFO") for i in items)
        w.tick()


COMMENT = ("#", "//", "*", "/*", "{/*")
STRING = re.compile(r"(['\"`])(.*?)\1")  # string literals in a line of TSX
JSX_TEXT = re.compile(r">([^<>{}]+)<")
GAMIFICATION = re.compile(r"\b(points?|streaks?|badges? earned|level[- ]up|leaderboards?|achievements?|xp)\b", re.I)


def test_no_gamification_wording_in_self_test_copy():
    """User decision: no points, streaks, badges, levels or leaderboards anywhere in the self-test UI or catalog."""
    root = Path(__file__).resolve().parents[2]
    files = [root / "config" / "selftests.yaml", *(root / "frontend" / "src").rglob("*.tsx")]
    for path in files:
        if "test" in path.parts:
            continue
        for n, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            if "data-testid" in line or "className" in line or line.strip().startswith(COMMENT):
                continue  # comments state the rule itself; only shown copy counts
            shown = line if path.suffix == ".yaml" else " ".join(
                [m[1] for m in STRING.findall(line)] + JSX_TEXT.findall(line))
            assert not GAMIFICATION.search(shown), f"{path.name}:{n}: {line.strip()}"
