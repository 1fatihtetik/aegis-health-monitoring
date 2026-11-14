"""API smoke tests. The background loop is off; tests advance the world by hand."""

import pytest
from fastapi.testclient import TestClient

from app.main import create_app


@pytest.fixture
def client():
    app = create_app(run_loop=False)
    with TestClient(app) as c:
        c.rt = app.state.rt
        yield c


def advance(client, n):
    for _ in range(n):
        client.rt.world.tick()


def test_health(client):
    body = client.get("/health").json()
    assert body["status"] == "ok" and "not a medical diagnosis" in body["disclaimer"]
    assert client.get("/api/v1/health").json()["status"] == "ok"


def test_crew_and_summary(client):
    body = client.get("/api/v1/crew").json()
    assert [c["id"] for c in body["crew"]] == ["C1", "C2", "C3", "C4"]
    assert body["node"] == "onboard" and body["age_s"] == 0
    assert set(body["hazards"]) == {"RADIATION", "ISOLATION_CONFINEMENT", "DISTANCE_FROM_EARTH", "GRAVITY_FIELDS",
                                    "HOSTILE_CLOSED_ENV"}
    summary = client.get("/api/v1/crew/C1/summary").json()
    assert summary["crew"]["vitals"]["heart_rate"] > 0 and "EVA" in summary["readiness"]
    assert summary["readiness"]["EVA"]["components"]["sleep"]["limit_verified"] is False
    assert client.get("/api/v1/crew/C9/summary").status_code == 404


def test_timeseries_and_limits(client):
    ts = client.get("/api/v1/environment/timeseries", params={"signal": "ppco2", "max_points": 100}).json()
    assert 0 < len(ts["points"]) <= 100 and ts["unit"] == "mmHg"
    assert ts["limits"][0]["verified"] is False and ts["limits"][0]["source_ref"]
    trend = client.get("/api/v1/crew/C3/timeseries", params={"signal": "bmd_estimate"}).json()
    assert len(trend["points"]) > 100 and trend["points"][0][1] > trend["points"][-1][1]
    limits = client.get("/api/v1/limits").json()
    assert limits["limits"]["bone"]["bmd_loss_pct_per_month_expected_0g"]["verified"] is True
    assert "ppco2" in limits["by_signal"]


def test_scenario_alert_ack_flow(client):
    assert client.post("/api/v1/sim/scenario", json={"name": "nope"}).status_code == 404
    status = client.post("/api/v1/sim/scenario", json={"name": "spe_event", "seed": 1}).json()
    assert status["scenario"] == "spe_event" and status["seed"] == 1
    advance(client, 60)
    alerts = client.get("/api/v1/alerts", params={"state": "OPEN", "severity": "EMERGENCY"}).json()["alerts"]
    assert len(alerts) == 1 and alerts[0]["rule_id"] == "rad.spe.dose_rate" and alerts[0]["checklist"]
    acked = client.post(f"/api/v1/alerts/{alerts[0]['id']}/ack").json()
    assert acked["state"] == "ACKNOWLEDGED" and acked["ack_ts"]
    rad = client.post("/api/v1/radiation/shelter", json={"crew_id": "C2"}).json()
    assert rad["spe"]["headcount"] == {"C1": False, "C2": True, "C3": False, "C4": False}
    assert client.get("/api/v1/crew").json()["crew"][0]["status"] == "EMERGENCY"


def test_ground_view_is_delayed(client):
    client.post("/api/v1/sim/scenario", json={"name": "spe_event"})
    advance(client, 40)
    assert client.get("/api/v1/alerts", params={"node": "ground"}).json()["alerts"] == []
    ground = client.get("/api/v1/crew", params={"node": "ground"}).json()
    assert ground["age_s"] == 720 and ground["crew"][0]["status"] == "NOMINAL"
    advance(client, 12)
    assert client.get("/api/v1/alerts", params={"node": "ground"}).json()["alerts"][0]["severity"] == "EMERGENCY"


def test_link_controls_and_recommendation(client):
    assert client.post("/api/v1/link/blackout", json={"on": True}).json()["blackout"] is True
    assert client.post("/api/v1/link/blackout", json={"on": False}).json()["blackout"] is False
    assert client.post("/api/v1/link/delay", json={"delay_s": 120}).json()["delay_s"] == 120
    rec = client.post("/api/v1/link/recommendation", json={"text": "Check scrubber B."}).json()
    assert rec["deliver_ts"] > rec["sent_ts"]
    assert client.get("/api/v1/link/recommendations").json()["recommendations"] == []
    advance(client, 3)
    assert client.get("/api/v1/link/recommendations").json()["recommendations"][0]["text"] == "Check scrubber B."


def test_sim_control(client):
    assert client.post("/api/v1/sim/control", json={"action": "pause"}).json()["paused"] is True
    assert client.post("/api/v1/sim/control", json={"action": "speed", "speed": 1000}).json()["speed"] == 1000
    assert client.post("/api/v1/sim/control", json={"action": "speed", "speed": 99999}).status_code == 422


def test_observations_are_idempotent(client):
    obs = {"id": "o-1", "ts": "2026-11-14T20:05:00Z", "crew_id": "C1", "device_id": "bio-C1",
           "signal": "heart_rate", "value": 72.0, "unit": "bpm", "quality": "GOOD", "phase": "MARS_TRANSIT"}
    assert client.post("/api/v1/observations", json=[obs]).json() == {"accepted": 1, "duplicates": 0}
    assert client.post("/api/v1/observations", json=[obs]).json() == {"accepted": 0, "duplicates": 1}
    assert client.post("/api/v1/observations", json=[{**obs, "id": "o-2", "unit": "Hz"}]).status_code == 422


def test_websocket_sends_snapshot(client):
    with client.websocket_connect("/ws/live?node=ground") as ws:
        msg = ws.receive_json()
    assert msg["type"] == "snapshot" and msg["node"] == "ground" and "crew" in msg and "link" in msg


def test_treat_baselines_spectrum_physical(client):
    client.post("/api/v1/sim/scenario", json={"name": "spe_event", "seed": 42})
    advance(client, 60)
    [alert] = [a for a in client.get("/api/v1/alerts", params={"state": "OPEN"}).json()["alerts"]
               if a["rule_id"] == "rad.spe.dose_rate"]
    treated = client.post(f"/api/v1/alerts/{alert['id']}/treat").json()
    assert treated["state"] == "IN_TREATMENT" and treated["ack_ts"]
    assert client.post("/api/v1/alerts/nope/treat").status_code == 404

    base = client.get("/api/v1/crew/C1/baselines").json()
    hr = base["baselines"]["heart_rate"]
    assert base["window"] == "48h" and hr["n"] > 2000 and hr["sd"] > 0 and hr["z"] is not None
    assert base["z_limit"]["verified"] is False
    assert client.get("/api/v1/crew/C9/baselines").status_code == 404
    assert client.get("/api/v1/crew/C1/baselines", params={"window": "bad"}).status_code == 422
    assert client.get("/api/v1/crew/C1/baselines", params={"node": "ground"}).json()["node"] == "ground"

    area = client.get("/api/v1/radiation/summary").json()["area"]
    bins = area["neutron_spectrum"]
    assert len(bins) == 5 and sum(b["flux_fraction"] for b in bins) == pytest.approx(1.0)
    assert sum(b["dose_rate_uSv_h"] for b in bins) == pytest.approx(area["neutron_rate_uSv_h"], rel=0.01)

    physical = client.get("/api/v1/readiness", params={"kind": "PHYSICAL"}).json()["readiness"]["C1"]["PHYSICAL"]
    assert physical["components"]["bone"]["value"] is not None and 0 <= physical["value"] <= 100
    assert "HRP-11" in physical["hrp_risks"]


def test_daily_sleep_and_adherence_series(client):
    for signal in ("sleep_night_h", "exercise_adherence_pct"):
        points = client.get("/api/v1/crew/C3/timeseries", params={"signal": signal}).json()["points"]
        assert len(points) >= 140, signal  # one per mission day (day 142 at T0)
        assert points == sorted(points)
    nights = client.get("/api/v1/crew/C3/timeseries", params={"signal": "sleep_night_h"}).json()["points"]
    assert all(3 <= v <= 9 for _, v in nights)
    adherence = [v for _, v in client.get("/api/v1/crew/C3/timeseries",
                                          params={"signal": "exercise_adherence_pct"}).json()["points"]]
    assert set(adherence) <= {0.0, 50.0, 100.0} and 40 < sum(adherence) / len(adherence) < 80  # C3: 60%
