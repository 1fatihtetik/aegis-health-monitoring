"""Block T: crew self-tests (ROADMAP section 0, AGENTS.md sections 2b and 7)."""

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
