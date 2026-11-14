"""Block R, R-2: MSL/RAD dose-rate replay (PRD section 6 M0, AGENTS.md sections 2a and 7)."""

import shutil
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
import yaml
from fastapi.testclient import TestClient

from app.config import CONFIG_DIR, Config
from app.datasets.provenance import ProvenanceTracker
from app.datasets.rad import RadReplay, load_rows
from app.datasets.registry import DATA_DIR, ReplayStatus
from app.domain.enums import Provenance, Quality
from app.main import create_app
from app.world import RAD_SIGNALS, World

T0 = datetime(2026, 11, 14, 20, 0, tzinfo=UTC)


def _manifest() -> dict[str, dict]:
    raw = yaml.safe_load((DATA_DIR / "MANIFEST.yaml").read_text(encoding="utf-8"))
    return {d["id"]: d for d in raw["datasets"]}


# ---- replay fidelity: the bundled windows match the published RAD means ---------------------------
@pytest.mark.parametrize("replay_id, dataset_id", [("rad_cruise", "msl_rad_cruise_2012"),
                                                   ("rad_gale", "msl_rad_gale_2013")])
def test_replay_mean_matches_published_value(cfg, replay_id, dataset_id):
    ref = _manifest()[dataset_id]["reference"]
    status = cfg.datasets.replay(replay_id)
    assert status is not None and status.active
    replay = RadReplay(status, DATA_DIR / status.spec["file"], T0)
    assert replay.quality_factor == ref["quality_factor"]
    # Dose equivalent within the tolerance stated in the manifest (AGENTS.md section 7, replay fidelity).
    mean_mSv_day = replay.mean_equivalent_uSv_h * 24 / 1000
    assert abs(mean_mSv_day - ref["dose_equivalent_mSv_day"]) <= ref["tolerance_mSv_day"]
    # The measured tissue dose itself is within the published uncertainty (about 17-19 %).
    mean_uGy_day = replay.mean_absorbed_uGy_h * 24
    assert abs(mean_uGy_day - ref["dose_rate_uGy_day"]) <= 0.19 * ref["dose_rate_uGy_day"]


# ---- time mapping and gap handling -----------------------------------------------------------------
def _replay(tmp_path: Path, rows: list[str], **spec) -> RadReplay:
    path = tmp_path / "rad.csv"
    path.write_text("# test\nutc,dose_e_uGy_h,dose_b_uGy_h,duration_s,quality\n" + "\n".join(rows) + "\n",
                    encoding="utf-8")
    status = ReplayStatus("t", "test_ds", [], True, "", {
        "adapter": "rad", "file": "rad.csv", "quality_factor": 4.0, "max_step": "40m", "max_hold": "2h",
        "start": "2012-01-01T00:00:00Z", **spec})
    return RadReplay(status, path, T0)


ROWS = [
    "2012-01-01T00:00:00Z,10.0,8,900,GOOD",
    "2012-01-01T00:30:00Z,12.0,8,900,GOOD",
    "2012-01-01T01:00:00Z,2.0,1,900,SUSPECT",   # dropout: held over
    "2012-01-01T01:30:00Z,11.0,8,900,GOOD",
    # 4.5 h downlink gap
    "2012-01-01T06:00:00Z,13.0,8,900,GOOD",
]


def test_time_mapping_is_deterministic_and_loops(tmp_path):
    rp = _replay(tmp_path, ROWS)
    assert rp.dataset_time(T0) == datetime(2012, 1, 1, tzinfo=UTC)
    assert rp.dataset_time(T0 + timedelta(minutes=45)) == datetime(2012, 1, 1, 0, 45, tzinfo=UTC)
    # loop period = window + one cadence (30 min) = 6 h 30 m
    assert rp.dataset_time(T0 + timedelta(hours=6, minutes=40)) == datetime(2012, 1, 1, 0, 10, tzinfo=UTC)
    assert rp.dataset_time(T0 - timedelta(minutes=20)) == datetime(2012, 1, 1, 6, 10, tzinfo=UTC)
    compressed = _replay(tmp_path, ROWS, compression=10)
    assert compressed.dataset_time(T0 + timedelta(minutes=3)) == datetime(2012, 1, 1, 0, 30, tzinfo=UTC)
    assert [rp.sample(T0 + timedelta(minutes=m)) for m in range(0, 400, 7)] == \
           [rp.sample(T0 + timedelta(minutes=m)) for m in range(0, 400, 7)]


def test_gaps_hold_last_good_value_as_suspect_then_fall_back(tmp_path):
    rp = _replay(tmp_path, ROWS)
    at = lambda minutes: rp.sample(T0 + timedelta(minutes=minutes))  # noqa: E731
    good = at(35)
    assert good and good.quality == Quality.GOOD and good.absorbed_uGy_h == 12.0 and good.equivalent_uSv_h == 48.0
    held = at(65)  # the 01:00 row is SUSPECT: hold 12.0 from 00:30
    assert held and held.quality == Quality.SUSPECT and held.absorbed_uGy_h == 12.0
    assert at(95).quality == Quality.GOOD and at(95).absorbed_uGy_h == 11.0
    in_gap = at(150)  # 01:30 + 80 min: beyond max_step 40m, within max_hold 2h
    assert in_gap and in_gap.quality == Quality.SUSPECT and in_gap.absorbed_uGy_h == 11.0
    assert at(240) is None  # 01:30 + 2.5 h: beyond max_hold, the synthetic generator takes over
    assert at(365).quality == Quality.GOOD and at(365).absorbed_uGy_h == 13.0


def test_load_rows_skips_comments(tmp_path):
    p = tmp_path / "x.csv"
    p.write_text("# c\nutc,dose_e_uGy_h,dose_b_uGy_h,duration_s,quality\n2012-01-01T00:00:00Z,1.5,1,900,GOOD\n",
                 encoding="utf-8")
    assert load_rows(p) == [(datetime(2012, 1, 1, tzinfo=UTC), 1.5, Quality.GOOD)]


# ---- the world: replayed values flow through the normal store/rules path ---------------------------
def _world(cfg: Config, ticks: int = 20, scenario: str = "nominal") -> World:
    w = World(cfg, scenario, 42)
    for _ in range(ticks):
        w.tick()
    return w


def test_world_replays_rad_cruise_with_provenance(cfg):
    w = _world(cfg)
    now = w.clock.now()
    rad = w.radiation.sample(now, "MARS_TRANSIT")
    assert rad is not None
    assert w.store.latest(None, "area_dose_rate_absorbed")[1] == pytest.approx(rad.absorbed_uGy_h)
    assert w.store.latest(None, "area_dose_rate_equivalent")[1] == pytest.approx(rad.absorbed_uGy_h * 3.82)
    prov = w.snapshot["provenance"]
    assert prov["area_dose_rate_absorbed"]["provenance"] == "NASA_MEASURED"
    for signal in RAD_SIGNALS[1:]:
        assert prov[signal]["provenance"] == "NASA_DERIVED", signal
    for signal in RAD_SIGNALS:
        assert prov[signal]["dataset_id"] == "msl_rad_cruise_2012"
    assert prov["heart_rate"]["provenance"] == "SYNTHETIC"
    replay = w.snapshot["radiation"]["replay"]
    assert replay["label"] == "MSL/RAD cruise 2012" and replay["compression"] == 1
    assert replay["dataset_ts"].startswith("2012-04-12T00:20")
    # personal dose ~ 24 h of the replayed cruise rate, not the old 75 uSv/h constant
    assert 1.2 < w.snapshot["radiation"]["crew"]["C1"]["dose_24h_mSv"] < 2.2


def test_replay_is_deterministic(cfg):
    a, b = _world(cfg, 30), _world(cfg, 30)
    assert a.store.points(None, "area_dose_rate_equivalent") == b.store.points(None, "area_dose_rate_equivalent")
    assert a.store.points("C2", "dose_rate_equivalent") == b.store.points("C2", "dose_rate_equivalent")


def test_mars_surface_switches_to_gale_replay(cfg):
    w = _world(cfg, 5)
    w.sim.set_phase("MARS_SURFACE")
    w.tick()
    prov = w.snapshot["provenance"]["area_dose_rate_absorbed"]
    assert prov["provenance"] == "NASA_MEASURED" and prov["dataset_id"] == "msl_rad_gale_2013"
    assert w.snapshot["radiation"]["replay"]["label"] == "MSL/RAD Gale crater 2013"
    assert 5 < w.store.latest(None, "area_dose_rate_absorbed")[1] < 11  # ~0.21 mGy/day
    w.sim.set_phase("POST_LANDING")  # no replay for this phase -> synthetic
    w.tick()
    assert w.snapshot["provenance"]["area_dose_rate_absorbed"]["provenance"] == "SYNTHETIC"
    assert w.snapshot["radiation"]["replay"] is None


def test_synthetic_spe_overlay_is_labelled_synthetic(cfg):
    w = _world(cfg, 40, "spe_event")  # SPE effect starts at 30 min
    prov = w.snapshot["provenance"]["area_dose_rate_equivalent"]
    assert prov["provenance"] == "SYNTHETIC" and "R-3" in prov["basis"]
    assert w.snapshot["radiation"]["replay"]["synthetic_spe_overlay"] is True


def test_tampered_rad_file_falls_back_to_synthetic(tmp_path, caplog):
    data = tmp_path / "nasa"
    shutil.copytree(DATA_DIR, data)
    csv = data / "derived" / "msl_rad_cruise_2012.csv"
    csv.write_text(csv.read_text(encoding="utf-8").replace("GOOD", "GOOD ", 1), encoding="utf-8")
    cfg = Config(CONFIG_DIR, data)
    assert not cfg.datasets.replay("rad_cruise").active
    assert any("rad_cruise" in p and "sha256" in p for p in cfg.datasets.problems)
    w = _world(cfg, 5)
    assert w.snapshot["provenance"]["area_dose_rate_absorbed"]["provenance"] == "SYNTHETIC"
    assert w.snapshot["radiation"]["replay"] is None
    assert w.store.latest(None, "area_dose_rate_equivalent")[1] > 0  # synthetic generator still runs


# ---- F-006 item 3: manifest details reach the badge and the alert evidence -------------------------
def test_manifest_details_fill_basis_and_dataset(cfg):
    tr = ProvenanceTracker(cfg.datasets)
    tr.set("area_dose_rate_absorbed", Provenance.NASA_MEASURED, "msl_rad_cruise_2012", T0)
    src = tr.current("area_dose_rate_absorbed").as_dict()
    assert src["basis"].startswith("MSL Curiosity RAD dose rate in Mars cruise")
    meta = src["dataset"]
    assert meta["label"] == "MSL/RAD cruise 2012"
    assert meta["source_url"].startswith("https://pds-ppi.igpp.ucla.edu/")
    assert {"title", "retrieved", "transform", "terms"} <= meta.keys()


def test_rule_evidence_carries_manifest_details(cfg):
    w = _world(cfg, 3)
    src = w.engine._source("area_dose_rate_equivalent")
    assert src["provenance"] == "NASA_DERIVED" and src["dataset"]["label"] == "MSL/RAD cruise 2012"
    assert "3.82" in src["basis"]


@pytest.fixture
def client():
    app = create_app(run_loop=False)
    with TestClient(app) as c:
        c.rt = app.state.rt
        yield c


def test_api_exposes_replay(client):
    rt = client.rt
    for _ in range(5):
        rt.world.tick()
    body = client.get("/api/v1/environment/timeseries?signal=area_dose_rate_absorbed").json()
    assert body["provenance"]["provenance"] == "NASA_MEASURED"
    assert body["provenance"]["dataset"]["label"] == "MSL/RAD cruise 2012"
    assert isinstance(body["suspect"], list)
    datasets = client.get("/api/v1/datasets").json()
    assert {d["id"] for d in datasets["datasets"]} >= {"msl_rad_cruise_2012", "msl_rad_gale_2013"}
    assert all(r["active"] for r in datasets["replays"])
    summary = client.get("/api/v1/radiation/summary").json()
    assert summary["replay"]["dataset_id"] == "msl_rad_cruise_2012"
    assert summary["area"]["dose_rate_absorbed_uGy_h"] > 0
