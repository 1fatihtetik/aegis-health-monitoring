"""R-5: space-weather card from bundled DONKI + OMNI2 (offline), forwarded to the crew only through the link."""

import shutil
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient

from app.config import CONFIG_DIR, Config
from app.datasets.registry import DATA_DIR
from app.main import create_app
from app.world import World


def test_event_record_from_bundled_data(cfg):
    ev = World(cfg, "nominal", 42).space_weather.event
    assert ev["available"] and ev["problems"] == [] and ev["provenance"] == "NASA_MEASURED"
    primary = ev["primary"]
    assert primary["sep"]["id"] == "2012-03-07T01:44:00-SEP-001"  # the SEP the RAD replay is tied to
    assert primary["flare"]["class"] == "X5.4" and primary["cme"]["speed_km_s"] == 2200
    flux = ev["flux"]
    assert flux["peak_utc"] == "2012-03-08T11:30:00Z" and abs(flux["peak_pfu"] - 4559.95) < 0.01
    assert flux["peak_level"] == "S3"
    assert all(s["verified"] is False for s in ev["s_scale"])  # NOAA scale, not a NASA-STD-3001 limit
    assert {"sep", "events", "flux"} <= ev["sources"].keys()
    assert all(src["source_url"].startswith("https://") and src["retrieved"] for src in ev["sources"].values())


def test_forward_goes_through_the_delayed_link(cfg):
    world = World(cfg, "nominal", 42)
    sent = world.clock.now()
    rec = world.forward_space_weather("C1")
    assert "X5.4" in rec["text"] and "S3" in rec["text"] and rec["checklist"]
    arrived = None
    for _ in range(20):
        if world.tick().recommendations:
            arrived = world.clock.now()
            break
        assert world.recommendations == []  # nothing onboard before the light time has passed
    assert arrived is not None and arrived >= sent + timedelta(seconds=world.delay_s)


def test_tampered_flux_file_drops_only_that_part(tmp_path):
    data = tmp_path / "nasa"
    shutil.copytree(DATA_DIR, data)
    flux = data / "derived" / "omni2_proton_flux_2012_03.csv"
    flux.write_text(flux.read_text(encoding="utf-8").replace("4559.95", "1.0"), encoding="utf-8")
    ev = World(Config(CONFIG_DIR, data), "nominal", 42).space_weather.event
    assert ev["flux"] is None and any(p.startswith("flux:") for p in ev["problems"])
    assert ev["available"] and ev["primary"]["flare"]["class"] == "X5.4"


@pytest.fixture
def client():
    app = create_app(run_loop=False)
    with TestClient(app) as c:
        yield c


def test_api(client):
    body = client.get("/api/v1/spaceweather/event").json()
    assert body["node"] == "ground" and body["event"]["primary"]["flare"]["class"] == "X5.4"
    rec = client.post("/api/v1/spaceweather/forward", json={"crew_id": None}).json()
    assert rec["origin"] == "GROUND" and rec["deliver_ts"] > rec["sent_ts"]
