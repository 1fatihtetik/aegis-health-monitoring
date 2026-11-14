"""Runtime: owns the current World, advances it in real time and pushes WebSocket messages.

This is the only place that reads the wall clock. Domain code uses the injected SimClock.
"""

import asyncio
import time
from typing import Any

from fastapi import WebSocket

from app.config import Config
from app.world import TickResult, World

MIN_SPEED, MAX_SPEED = 1.0, 10000.0
LOOP_SLEEP_S = 0.05
BROADCAST_EVERY_S = 0.2
MAX_TICKS_PER_LOOP = 100


class Runtime:
    def __init__(self, cfg: Config) -> None:
        self.cfg = cfg
        self.world = World(cfg, "nominal", 42)
        self.speed = float(self.world.scenario.get("speed", 60))
        self.paused = False
        self.clients: dict[WebSocket, str] = {}
        self._task: asyncio.Task[None] | None = None

    # ---- control -------------------------------------------------------------------------
    def start_scenario(self, name: str, seed: int = 42, speed: float | None = None) -> None:
        self.world = World(self.cfg, name, seed)
        self.speed = self._clamp(speed if speed is not None else float(self.world.scenario.get("speed", 60)))
        self.paused = False

    def set_speed(self, speed: float) -> None:
        self.speed = self._clamp(speed)

    @staticmethod
    def _clamp(speed: float) -> float:
        return max(MIN_SPEED, min(MAX_SPEED, speed))

    def sim_status(self) -> dict[str, Any]:
        return {
            "scenario": self.world.scenario["name"],
            "description": self.world.scenario.get("description", ""),
            "seed": self.world.seed,
            "speed": self.speed,
            "paused": self.paused,
            "tick_s": self.cfg.mission["tick_s"],
        }

    # ---- views ---------------------------------------------------------------------------
    def link_status(self) -> dict[str, Any]:
        w = self.world
        source = w.delay_source()
        status = w.link.status(source.delay_s)
        status["delay_source"] = source.as_dict()
        as_of = w.ground.as_of or w.start_ts
        status["ground_as_of"] = as_of.isoformat().replace("+00:00", "Z")
        status["ground_age_s"] = (w.clock.now() - as_of).total_seconds()
        return status

    def snapshot_message(self, node: str) -> dict[str, Any]:
        w = self.world
        snap = w.ground.snapshot if node == "ground" else w.snapshot
        now = w.clock.now()
        return {
            "type": "snapshot",
            "node": node,
            "now": now.isoformat().replace("+00:00", "Z"),
            "as_of": snap["ts"],
            "age_s": (now - w.ground.as_of).total_seconds() if node == "ground" and w.ground.as_of else 0.0,
            "sim": self.sim_status(),
            "link": self.link_status(),
            **snap,
        }

    # ---- loop ----------------------------------------------------------------------------
    def apply(self, result: TickResult) -> list[tuple[str, dict[str, Any]]]:
        """Turns a tick result into (node, message) pairs and applies scenario speed/pause requests."""
        if result.speed is not None:
            self.speed = self._clamp(result.speed)
        if result.pause:
            self.paused = True
        out: list[tuple[str, dict[str, Any]]] = []
        out += [("onboard", {"type": "alert", "node": "onboard", "alert": a.model_dump(mode="json")}) for a in result.alerts]
        out += [("ground", {"type": "alert", "node": "ground", "alert": a}) for a in result.ground_alerts]
        out += [("onboard", {"type": "recommendation", "node": "onboard", "recommendation": r}) for r in result.recommendations]
        return out

    async def broadcast(self, node: str | None, message: dict[str, Any]) -> None:
        for ws, ws_node in list(self.clients.items()):
            if node is None or ws_node == node:
                try:
                    await ws.send_json(message)
                except Exception:  # noqa: BLE001 - a dead client must not stop the loop
                    self.clients.pop(ws, None)

    async def broadcast_snapshots(self) -> None:
        for node in set(self.clients.values()):
            await self.broadcast(node, self.snapshot_message(node))

    async def run(self) -> None:
        last = time.monotonic()
        last_broadcast = 0.0
        budget = 0.0
        tick_s = self.cfg.mission["tick_s"]
        while True:
            await asyncio.sleep(LOOP_SLEEP_S)
            now = time.monotonic()
            elapsed, last = now - last, now
            messages: list[tuple[str, dict[str, Any]]] = []
            if self.paused:
                budget = 0.0
            else:
                budget = min(budget + elapsed * self.speed / tick_s, MAX_TICKS_PER_LOOP)
                world = self.world
                while budget >= 1 and not self.paused and world is self.world:
                    budget -= 1
                    speed_before = self.speed
                    messages += self.apply(world.tick())
                    if self.speed != speed_before:
                        budget = 0.0  # a scenario speed change takes effect at once
            for node, message in messages:
                await self.broadcast(node, message)
            if messages or now - last_broadcast >= BROADCAST_EVERY_S:
                last_broadcast = now
                await self.broadcast_snapshots()

    def start(self) -> None:
        if self._task is None:
            self._task = asyncio.create_task(self.run())

    async def stop(self) -> None:
        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None
