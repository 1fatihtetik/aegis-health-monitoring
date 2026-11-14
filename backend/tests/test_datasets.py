"""Block R, R-0: NASA data layer, and Block P, P-0: MEASURED_OTHER (PRD section 6 M0, AGENTS.md sections 2a and 7)."""

import socket
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
import yaml
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.datasets.provenance import ProvenanceTracker, check_agency, weakest
from app.datasets.registry import DATA_DIR, DatasetRegistry, sha256_file
from app.domain.enums import SIGNALS, Provenance
from app.domain.models import Observation
from app.main import create_app
from tests.conftest import run

T0 = datetime(2026, 11, 14, 12, 0, tzinfo=UTC)
PROVENANCES = {p.value for p in Provenance}


def write_setup(tmp: Path, *, file_bytes: bytes | None = b"ts,value\n", manifest_sha: str | None = None,
                replay: bool = True, manifest: bool = True, agency: str | None = None) -> DatasetRegistry:
    """A tiny data dir with one dataset file and one replay pointing at it."""
    data = tmp / "nasa"
    (data / "derived").mkdir(parents=True)
    rel = "derived/sample.csv"
    if file_bytes is not None:
        (data / rel).write_bytes(file_bytes)
    sha = manifest_sha or (sha256_file(data / rel) if file_bytes is not None else "0" * 64)
    if manifest:
        entry = {
            "id": "sample_ds", "tier": "D2", "title": "Sample", "source_url": "https://example.invalid/",
            "retrieved": "2026-11-14", "terms": "test", "transform": "none",
            "files": [{"path": rel, "sha256": sha}],
        }
        if agency:
            entry["agency"] = agency
        (data / "MANIFEST.yaml").write_text(yaml.safe_dump({"datasets": [entry]}), encoding="utf-8")
    spec = {
        "default_provenance": "SYNTHETIC",
        "signals": {"bmd_estimate": {"provenance": "SYNTHETIC_CALIBRATED", "basis": "test basis"}},
        "replays": [{"id": "rp", "dataset_id": "sample_ds", "file": rel,
                     "signals": ["area_dose_rate_equivalent"]}] if replay else [],
    }
    (tmp / "datasets.yaml").write_text(yaml.safe_dump(spec), encoding="utf-8")
    return DatasetRegistry(tmp / "datasets.yaml", data)


# ---- registry: manifest + sha256 check ---------------------------------------------------------
def test_repo_registry_loads_clean(cfg):
    reg = cfg.datasets
    assert reg.data_dir == DATA_DIR
    assert reg.problems == []
    assert all(r.active for r in reg.replays)
    for name in SIGNALS:
        assert reg.source(name).provenance.value in PROVENANCES


def test_good_file_activates_replay(tmp_path):
    reg = write_setup(tmp_path)
    assert reg.replay("rp").active and reg.problems == []
    assert reg.datasets()[0]["sha256_ok"] is True


def test_tampered_file_falls_back_to_synthetic(tmp_path, caplog):
    reg = write_setup(tmp_path, manifest_sha="f" * 64)
    rp = reg.replay("rp")
    assert rp is not None and not rp.active and "sha256" in rp.reason
    assert reg.datasets()[0]["sha256_ok"] is False
    assert any("sha256" in p for p in reg.problems)
    assert reg.source("area_dose_rate_equivalent").provenance == Provenance.SYNTHETIC
    assert "sha256" in caplog.text


def test_missing_file_and_missing_manifest_never_crash(tmp_path):
    reg = write_setup(tmp_path / "a", file_bytes=None)
    assert not reg.replay("rp").active and "missing" in reg.replay("rp").reason
    reg = write_setup(tmp_path / "b", manifest=False)
    assert not reg.replay("rp").active and "not in MANIFEST" in reg.replay("rp").reason
    assert any("not found" in p for p in reg.problems)


@pytest.mark.parametrize("entry, message", [
    ({"provenance": "NASA_MEASURED"}, "only from an active replay"),
    ({"provenance": "MEASURED_OTHER"}, "only from an active replay"),
    ({"provenance": "SYNTHETIC_CALIBRATED"}, "needs a 'basis'"),
])
def test_defaults_cannot_claim_nasa_or_skip_basis(tmp_path, entry, message):
    (tmp_path / "datasets.yaml").write_text(yaml.safe_dump({"signals": {"heart_rate": entry}}), encoding="utf-8")
    with pytest.raises(ValueError, match=message):
        DatasetRegistry(tmp_path / "datasets.yaml", tmp_path)


def test_observation_claiming_nasa_needs_dataset_id():
    base = {"id": "x", "ts": T0, "device_id": "d", "signal": "ppco2", "value": 2.0, "unit": "mmHg"}
    assert Observation(**base).provenance == Provenance.SYNTHETIC
    with pytest.raises(ValidationError, match="dataset_id"):
        Observation(**base, provenance="NASA_MEASURED")
    assert Observation(**base, provenance="NASA_MEASURED", dataset_id="ds").dataset_id == "ds"


# ---- provenance tracker --------------------------------------------------------------------------
def test_tracker_segments_follow_source_changes(cfg):
    tr = ProvenanceTracker(cfg.datasets)
    sig = "area_dose_rate_equivalent"
    assert tr.current(sig).provenance == Provenance.SYNTHETIC
    tr.set(sig, Provenance.NASA_MEASURED, "msl_rad", T0)
    tr.set(sig, Provenance.NASA_MEASURED, "msl_rad", T0 + timedelta(hours=1))  # no-op, same source
    tr.set(sig, Provenance.SYNTHETIC, None, T0 + timedelta(hours=2))
    assert tr.at(sig, T0 - timedelta(minutes=1)).provenance == Provenance.SYNTHETIC
    assert tr.at(sig, T0 + timedelta(minutes=30)).dataset_id == "msl_rad"
    assert [s["provenance"] for s in tr.segments(sig)] == ["SYNTHETIC", "NASA_MEASURED", "SYNTHETIC"]
    window = tr.segments(sig, T0 + timedelta(minutes=10), T0 + timedelta(minutes=20))
    assert [s["dataset_id"] for s in window] == ["msl_rad"]


def test_weakest_picks_least_real():
    assert weakest(["NASA_MEASURED", "SYNTHETIC_CALIBRATED"]) == "SYNTHETIC_CALIBRATED"
    assert weakest(["NASA_MEASURED", "NASA_DERIVED"]) == "NASA_DERIVED"
    assert weakest([]) == "SYNTHETIC"


# ---- provenance reaches snapshot, evidence and API -----------------------------------------------
def test_every_alert_evidence_has_provenance(cfg):
    world = run(cfg, "headache_branching", 13)  # includes compound + context-branching rules
    assert world.alerts.alerts
    for alert in world.alerts.alerts.values():
        ev = alert.evidence
        assert ev["provenance"] in PROVENANCES and "dataset_id" in ev
        for member in ev.get("members", []):
            assert member["provenance"] in PROVENANCES
    assert set(world.snapshot["provenance"]) == set(SIGNALS)
    assert world.snapshot["provenance"]["bmd_estimate"]["provenance"] == "SYNTHETIC_CALIBRATED"


@pytest.fixture
def client():
    app = create_app(run_loop=False)
    with TestClient(app) as c:
        c.rt = app.state.rt
        yield c


def test_datasets_endpoint_and_timeseries_provenance(client):
    body = client.get("/api/v1/datasets").json()
    assert {"datasets", "replays", "problems", "signals"} <= body.keys()
    assert set(body["signals"]) == set(SIGNALS)
    assert client.get("/api/v1/datasets?node=ground").json()["node"] == "ground"
    ts = client.get("/api/v1/environment/timeseries?signal=ppco2").json()
    assert ts["provenance"]["provenance"] in PROVENANCES and ts["provenance"]["segments"]
    ts = client.get("/api/v1/crew/C1/timeseries?signal=heart_rate&node=ground").json()
    assert ts["provenance"]["provenance"] in PROVENANCES


def test_ingested_observation_sets_provenance(client):
    w = client.rt.world
    obs = {"id": "obs-nasa-1", "ts": w.clock.now().isoformat(), "device_id": "replay", "signal": "ppco2",
           "value": 2.4, "unit": "mmHg", "provenance": "NASA_MEASURED", "dataset_id": "test_ds"}
    assert client.post("/api/v1/observations", json=[obs]).status_code == 200
    assert w.provenance.current("ppco2").dataset_id == "test_ds"
    bad = {**obs, "id": "obs-nasa-2", "dataset_id": None}
    assert client.post("/api/v1/observations", json=[bad]).status_code == 422


# ---- P-0: MEASURED_OTHER (non-NASA measured data, e.g. EPA RadNet) -------------------------------
def test_measured_other_ranks_below_nasa_labels():
    # A group with a non-NASA member must never be labelled NASA (compound evidence uses weakest()).
    assert weakest(["NASA_DERIVED", "MEASURED_OTHER", "NASA_MEASURED"]) == "MEASURED_OTHER"
    assert weakest(["MEASURED_OTHER", "SYNTHETIC_CALIBRATED"]) == "SYNTHETIC_CALIBRATED"
    assert Provenance.MEASURED_OTHER.needs_dataset and not Provenance.SYNTHETIC_CALIBRATED.needs_dataset


def test_measured_other_observation_needs_dataset_id():
    base = {"id": "x", "ts": T0, "device_id": "d", "signal": "area_dose_rate_absorbed", "value": 0.1, "unit": "µGy/h"}
    with pytest.raises(ValidationError, match="dataset_id"):
        Observation(**base, provenance="MEASURED_OTHER")
    assert Observation(**base, provenance="MEASURED_OTHER", dataset_id="radnet").dataset_id == "radnet"


def test_manifest_agency_defaults_to_nasa(tmp_path):
    assert write_setup(tmp_path / "a").dataset_meta("sample_ds")["agency"] == "NASA"
    reg = write_setup(tmp_path / "b", agency="EPA")
    assert reg.dataset_meta("sample_ds")["agency"] == "EPA"
    assert reg.datasets()[0]["agency"] == "EPA"


def test_label_must_match_the_measuring_agency(tmp_path):
    epa = ProvenanceTracker(write_setup(tmp_path / "epa", agency="EPA"))
    epa.set("area_dose_rate_absorbed", Provenance.MEASURED_OTHER, "sample_ds", T0)
    src = epa.current("area_dose_rate_absorbed")
    assert src.provenance == Provenance.MEASURED_OTHER and src.dataset["agency"] == "EPA"
    with pytest.raises(ValueError, match="needs a NASA dataset"):
        epa.set("area_dose_rate_equivalent", Provenance.NASA_MEASURED, "sample_ds", T0)
    nasa = ProvenanceTracker(write_setup(tmp_path / "nasa"))
    with pytest.raises(ValueError, match="non-NASA"):
        nasa.set("area_dose_rate_absorbed", Provenance.MEASURED_OTHER, "sample_ds", T0)
    check_agency(Provenance.SYNTHETIC, "EPA", None)  # synthetic values carry no agency claim


def test_ingest_rejects_measured_other_on_a_nasa_dataset(client):
    w = client.rt.world
    obs = {"id": "obs-other-1", "ts": w.clock.now().isoformat(), "device_id": "replay",
           "signal": "area_dose_rate_absorbed", "value": 0.1, "unit": "µGy/h",
           "provenance": "MEASURED_OTHER", "dataset_id": "msl_rad_cruise_2012"}
    res = client.post("/api/v1/observations", json=[obs])
    assert res.status_code == 422 and "NASA dataset" in res.json()["detail"]
    assert w.provenance.current("area_dose_rate_absorbed").provenance != Provenance.MEASURED_OTHER


# ---- offline: the full demo runs with outbound networking blocked --------------------------------
LOOPBACK = {"127.0.0.1", "::1", "localhost"}


def test_demo_runs_with_outbound_network_blocked(cfg, monkeypatch):
    attempts: list[object] = []
    real_connect = socket.socket.connect

    def guarded_connect(self, address):  # type: ignore[no-untyped-def]
        host = address[0] if isinstance(address, tuple) else address
        if host not in LOOPBACK:
            attempts.append(address)
            raise OSError(f"outbound network blocked in test: {address}")
        return real_connect(self, address)

    def guarded_create(address, *args, **kwargs):  # type: ignore[no-untyped-def]
        attempts.append(address)
        raise OSError(f"outbound network blocked in test: {address}")

    monkeypatch.setattr(socket.socket, "connect", guarded_connect)
    monkeypatch.setattr(socket, "create_connection", guarded_create)
    world = run(cfg, "demo_5min", 25)
    assert attempts == []
    assert any(a.severity.value == "EMERGENCY" for a in world.alerts.alerts.values())
