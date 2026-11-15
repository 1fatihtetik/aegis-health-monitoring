"""T-6: clickable body map. Region links live in config; every region links a signal or test; ground copy keeps
questionnaire data on board (ROADMAP.md §0.4, PRD §6 M11)."""

import shutil
from pathlib import Path

import pytest
import yaml
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.config import CONFIG_DIR, Config
from app.domain.enums import SIGNALS
from app.main import create_app

REGIONS = ["brain_eyes", "heart_vessels", "lungs", "bones_muscles", "kidneys", "blood_immune"]
UNMAPPED = {"rad.saa.transit"}  # INFO notice about the spacecraft's position, not about a body region


@pytest.fixture
def client():
    app = create_app(run_loop=False)
    with TestClient(app) as c:
        c.rt = app.state.rt
        yield c


def test_six_regions_each_link_a_signal_or_test_and_explain_themselves(cfg):
    regions = cfg.selftests.body_map
    assert [r.id for r in regions] == REGIONS
    for r in regions:
        assert r.what and r.hazards and r.hrp_risks and (r.signals or r.tests)
        assert "you have" not in r.what.lower()  # never diagnoses
    assert next(r for r in regions if r.id == "blood_immune").reference == "inspiration4"
    eye = next(r for r in regions if r.id == "brain_eyes")
    assert "amsler" in eye.tests and "eye.amsler.distortion" in eye.rules and "sans.watch" in eye.rules


def test_every_rule_that_concerns_the_body_is_on_the_map(cfg):
    mapped = {rule for r in cfg.selftests.body_map for rule in r.rules}
    assert {r.id for r in cfg.rules} - mapped == UNMAPPED


def _with(tmp_path: Path, mutate) -> Path:
    for f in CONFIG_DIR.glob("*.yaml"):
        shutil.copy(f, tmp_path / f.name)
    data = yaml.safe_load((tmp_path / "selftests.yaml").read_text(encoding="utf-8"))
    mutate(data["body_map"][0])
    (tmp_path / "selftests.yaml").write_text(yaml.safe_dump(data), encoding="utf-8")
    return tmp_path


@pytest.mark.parametrize("mutate", [
    lambda r: r.update(signals=[], tests=[]),
    lambda r: r.update(rules=["no.such.rule"]),
    lambda r: r.update(tests=["no_such_test"]),
    lambda r: r.update(signals=["no_such_signal"]),
    lambda r: r.update(hazards=[]),
    lambda r: r.update(hrp_risks=[]),
])
def test_loader_refuses_a_broken_region(tmp_path, mutate):
    with pytest.raises((ValueError, ValidationError)):
        Config(config_dir=_with(tmp_path, mutate))


def test_api_serves_regions_with_live_signals_rules_and_tests(client):
    w = client.rt.world
    w.tick()
    body = client.get("/api/v1/bodymap", params={"crew_id": "C2"}).json()
    assert body["crew_id"] == "C2" and [r["id"] for r in body["regions"]] == REGIONS
    heart = next(r for r in body["regions"] if r["id"] == "heart_vessels")
    hr = next(s for s in heart["signals"] if s["signal"] == "heart_rate")
    assert hr["latest"] is not None and hr["recent"] and hr["unit"] == "bpm" and hr["source"]["provenance"]
    assert {t["id"] for t in heart["tests"]} == {"bp_spo2", "stand_test"}
    assert all(r["title"] and r["severity"] for r in heart["rules"])
    lungs = next(r for r in body["regions"] if r["id"] == "lungs")
    assert next(s for s in lungs["signals"] if s["signal"] == "ppco2")["scope"] == "cabin"
    assert client.get("/api/v1/bodymap", params={"crew_id": "C9"}).status_code == 404


def test_ground_copy_leaves_questionnaires_on_board(client):
    onboard = client.get("/api/v1/bodymap", params={"crew_id": "C1"}).json()["regions"]
    ground = client.get("/api/v1/bodymap", params={"crew_id": "C1", "node": "ground"}).json()["regions"]
    brain_on = next(r for r in onboard if r["id"] == "brain_eyes")
    brain_gr = next(r for r in ground if r["id"] == "brain_eyes")
    assert {"kss", "mood"} <= {s["signal"] for s in brain_on["signals"]}
    assert not [s for s in brain_gr["signals"] if SIGNALS[s["signal"]].onboard_only]
    assert not {"cog.sleepiness", "psych.mood.low", "workload.high"} & {r["id"] for r in brain_gr["rules"]}
    assert not [t for t in brain_gr["tests"] if t["onboard_only"]]
    assert {"cog.pvt.lapses", "cog.performance_risk"} <= {r["id"] for r in brain_gr["rules"]}
