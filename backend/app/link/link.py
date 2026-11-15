"""Store-and-forward comm link between the onboard and ground stores (PRD M7).

Every message is delivered at deliver_ts = sent_ts + delay, never earlier. Nothing is delivered
during a blackout. Per tick, due messages go out in priority order up to the bandwidth cap:
0 EMERGENCY alerts, 1 other alerts, 2 recommendations, 3 one-minute snapshots and rollups (Block C: the
weekly adherence). Raw data is not sent. Journal entries are never sent.
"""

from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

from app.db.store import SeriesStore
from app.util import iso, parse_ts

DOWN, UP = "DOWN", "UP"  # DOWN: onboard -> ground, UP: ground -> onboard
PRIORITY_EMERGENCY, PRIORITY_ALERT, PRIORITY_RECOMMENDATION, PRIORITY_SNAPSHOT = 0, 1, 2, 3


@dataclass
class Message:
    id: str
    seq: int
    direction: str
    priority: int
    kind: str
    payload: dict[str, Any]
    sent_ts: datetime
    deliver_ts: datetime
    delivered_ts: datetime | None = None


class Link:
    def __init__(self, max_msgs_per_tick: int) -> None:
        self.max_msgs_per_tick = max_msgs_per_tick
        self.blackout = False
        self.pending: list[Message] = []
        self.last_delivery_ts: datetime | None = None
        self._seq = 0

    def send(self, direction: str, kind: str, priority: int, payload: dict[str, Any], now: datetime,
             delay_s: float) -> Message:
        self._seq += 1
        msg = Message(f"{direction}-{self._seq}", self._seq, direction, priority, kind, payload, now,
                      now + timedelta(seconds=delay_s))
        self.pending.append(msg)
        return msg

    def deliver(self, now: datetime) -> list[Message]:
        if self.blackout:
            return []
        out: list[Message] = []
        for direction in (DOWN, UP):
            due = sorted(
                (m for m in self.pending if m.direction == direction and m.deliver_ts <= now),
                key=lambda m: (m.priority, m.seq),
            )
            out += due[: self.max_msgs_per_tick]
        if out:
            sent = {m.id for m in out}
            self.pending = [m for m in self.pending if m.id not in sent]
            for m in out:
                m.delivered_ts = now
            self.last_delivery_ts = now
        return out

    def status(self, delay_s: float) -> dict[str, Any]:
        return {
            "delay_s": delay_s,
            "blackout": self.blackout,
            "queue_down": sum(1 for m in self.pending if m.direction == DOWN),
            "queue_up": sum(1 for m in self.pending if m.direction == UP),
            "last_delivery_ts": iso(self.last_delivery_ts) if self.last_delivery_ts else None,
        }


class GroundNode:
    """Ground-side state. Written only by delivered link messages (AGENTS.md section 6)."""

    def __init__(self, store: SeriesStore) -> None:
        self.store = store  # history synced before the scenario started
        self.snapshot: dict[str, Any] = {}
        self.as_of: datetime | None = None
        self.alerts: dict[str, dict[str, Any]] = {}
        self.sent_recommendations: list[dict[str, Any]] = []
        self.adherence: dict[str, Any] = {}  # C-2: last delivered weekly adherence rollup
        self.adherence_as_of: datetime | None = None

    def receive(self, msg: Message) -> None:
        if msg.kind == "alert":
            self.alerts[msg.payload["id"]] = msg.payload
        elif msg.kind == "adherence":
            ts = parse_ts(msg.payload["ts"])
            if self.adherence_as_of is None or ts > self.adherence_as_of:
                self.adherence, self.adherence_as_of = msg.payload, ts
        elif msg.kind == "snapshot":
            ts = parse_ts(msg.payload["ts"])
            if self.as_of is not None and ts <= self.as_of:
                return
            self.snapshot, self.as_of = msg.payload, ts
            for crew in msg.payload["crew"]:
                for signal, value in crew["vitals"].items():
                    self.store.add(crew["id"], signal, ts, value)
                for signal, value in crew["trends"].items():
                    latest = self.store.latest(crew["id"], signal)
                    if latest is None or latest[1] != value:
                        self.store.add(crew["id"], signal, ts, value)
            for signal, value in msg.payload["environment"].items():
                self.store.add(None, signal, ts, value)
