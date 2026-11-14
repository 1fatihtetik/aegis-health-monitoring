"""Comm link: delay, blackout, priority, and ground isolation (AGENTS.md sections 6 and 7)."""

from datetime import timedelta

from app.link.link import DOWN, Link
from app.world import World
from tests.conftest import T0


def ticks(world, n):
    out = []
    for _ in range(n):
        out.append(world.tick())
    return out


def test_ground_sees_data_one_delay_late(cfg):
    world = World(cfg, "nominal", 42)
    delay = timedelta(seconds=world.delay_s)
    assert delay == timedelta(minutes=12)
    ticks(world, 30)
    assert world.clock.now() - world.ground.as_of == delay
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
    assert arrival == sent + timedelta(seconds=world.delay_s)
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
    assert onboard_ts is not None and ground_ts == onboard_ts + timedelta(seconds=world.delay_s)


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
    assert world.clock.now() - world.ground.as_of == timedelta(seconds=world.delay_s)


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
