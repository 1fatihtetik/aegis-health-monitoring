"""Comm link: delay, blackout, priority, and ground isolation (AGENTS.md sections 6 and 7)."""

import math
from datetime import timedelta

from app.link.link import DOWN, Link
from app.world import World
from tests.conftest import T0


def first_tick_after(world, ts):
    """Link messages are delivered on the first simulator tick at or after deliver_ts."""
    tick = world.cfg.mission["tick_s"]
    return ts + timedelta(seconds=math.ceil(world.delay_s / tick) * tick)


def ticks(world, n):
    out = []
    for _ in range(n):
        out.append(world.tick())
    return out


def test_ground_sees_data_one_delay_late(cfg):
    world = World(cfg, "nominal", 42)
    source = world.delay_source()
    assert source.provenance.value == "NASA_DERIVED" and source.dataset_id == "horizons_earth_mars_2026"
    assert 650 < world.delay_s < 662  # Earth-Mars light time on 2026-11-14 (JPL Horizons), not the old 720 s
    ticks(world, 30)
    assert world.clock.now() - world.ground.as_of == timedelta(minutes=math.ceil(world.delay_s / 60))
    assert world.ground.snapshot["ts"] != world.snapshot["ts"]


def test_recommendation_arrives_after_delay_not_before(cfg):
    world = World(cfg, "nominal", 42)
    ticks(world, 5)
    sent = world.clock.now()
    rec = world.send_recommendation("Hydrate and re-check BP in 30 min.", ["Drink 500 mL"], "C3")
    arrival = None
    for _ in range(20):
        result = world.tick()
        if result.recommendations:
            arrival = world.clock.now()
            break
        assert world.recommendations == []
    assert sent + timedelta(seconds=world.delay_s) <= arrival == first_tick_after(world, sent)
    assert world.recommendations[0]["text"] == rec["text"] and world.recommendations[0]["origin"] == "GROUND"


def test_ground_alert_lags_onboard_alert(cfg):
    world = World(cfg, "spe_event", 42)
    onboard_ts = ground_ts = None
    for _ in range(120):
        result = world.tick()
        if onboard_ts is None and any(a.rule_id == "rad.spe.dose_rate" for a in result.alerts):
            onboard_ts = world.clock.now()
            assert world.ground.alerts == {}
        if ground_ts is None and any(a["rule_id"] == "rad.spe.dose_rate" for a in result.ground_alerts):
            ground_ts = world.clock.now()
    assert onboard_ts is not None and ground_ts == first_tick_after(world, onboard_ts)


def test_blackout_stops_ground_but_not_onboard(cfg):
    world = World(cfg, "spe_event", 42)
    world.link.blackout = True
    frozen = world.ground.as_of
    ticks(world, 90)
    assert world.ground.as_of == frozen and world.ground.alerts == {}
    assert any(a.rule_id == "rad.spe.dose_rate" for a in world.alerts.open_alerts())  # onboard autonomy
    assert world.snapshot["radiation"]["spe"]["active"]

    world.link.blackout = False
    first = world.tick()
    assert any(a["rule_id"] == "rad.spe.dose_rate" for a in first.ground_alerts)  # alerts flush first
    ticks(world, 30)
    assert world.clock.now() - world.ground.as_of == timedelta(minutes=math.ceil(world.delay_s / 60))


def test_priority_order_and_bandwidth_cap():
    link = Link(max_msgs_per_tick=2)
    link.send(DOWN, "snapshot", 3, {"n": 1}, T0, 0)
    link.send(DOWN, "alert", 1, {"n": 2}, T0, 0)
    link.send(DOWN, "alert", 0, {"n": 3}, T0, 0)
    link.send(DOWN, "alert", 0, {"n": 4}, T0, 60)
    assert [m.payload["n"] for m in link.deliver(T0)] == [3, 2]
    assert [m.payload["n"] for m in link.deliver(T0)] == [1]
    assert link.deliver(T0 + timedelta(seconds=59)) == []
    assert [m.payload["n"] for m in link.deliver(T0 + timedelta(seconds=60))] == [4]


def test_light_time_follows_the_date(cfg):
    """R-4: the delay is the Horizons Earth-Mars light time for the simulated date, deterministic per date."""
    world = World(cfg, "nominal", 42)
    comm = world.comm
    d0 = comm.at("MARS_TRANSIT", world.start_ts).delay_s
    later = comm.at("MARS_TRANSIT", world.start_ts + timedelta(days=30)).delay_s
    assert later < d0  # Earth and Mars approach opposition (Jan 2027), the range shrinks
    assert comm.at("MARS_TRANSIT", world.start_ts).delay_s == d0
    # Daily table: 2026-11-14 660.863 s, 2026-11-15 656.618 s; 20:00 UTC is 5/6 of the way.
    assert abs(d0 - (660.863 + (656.618 - 660.863) * 20 / 24)) < 0.1
    assert comm.at("LEO", world.start_ts).provenance.value == "SYNTHETIC"  # not an Earth-Mars phase
    far = comm.at("MARS_TRANSIT", world.start_ts + timedelta(days=400))
    assert far.provenance.value == "SYNTHETIC" and far.delay_s == cfg.mission["phases"]["MARS_TRANSIT"]["comm_delay_s"]
    assert world.snapshot["phase"]["comm_delay_source"]["dataset_id"] == "horizons_earth_mars_2026"


def test_light_time_falls_back_when_file_tampered(tmp_path, cfg):
    import shutil

    from app.config import CONFIG_DIR, Config
    from app.datasets.registry import DATA_DIR

    data = tmp_path / "nasa"
    shutil.copytree(DATA_DIR, data)
    lt = data / "derived" / "horizons_earth_mars_lt.csv"
    lt.write_text(lt.read_text(encoding="utf-8").replace("660.863", "1.000"), encoding="utf-8")
    world = World(Config(CONFIG_DIR, data), "nominal", 42)
    assert world.delay_s == cfg.mission["phases"]["MARS_TRANSIT"]["comm_delay_s"]
    assert world.delay_source().provenance.value == "SYNTHETIC"
    assert any("light_time" in p for p in world.cfg.datasets.problems)
