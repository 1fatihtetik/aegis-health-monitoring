"""The world: one scenario run. Holds the onboard state, the ground state and the link between them.

Onboard: simulator -> store -> rules -> alerts -> readiness -> snapshot.
Ground: written only by delivered link messages. Ground code never reads onboard state.
"""

from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any

from app.alerts.manager import AlertManager
from app.clock import SimClock
from app.config import Config
from app.db.store import SeriesStore
from app.domain.enums import SIGNALS, Hazard, Severity
from app.domain.models import Alert, Observation
from app.link.link import (
    DOWN,
    PRIORITY_ALERT,
    PRIORITY_EMERGENCY,
    PRIORITY_RECOMMENDATION,
    PRIORITY_SNAPSHOT,
    UP,
    GroundNode,
    Link,
)
from app.rules.engine import RuleEngine
from app.scores.radiation import radiation_summary
from app.scores.readiness import compute_readiness
from app.sim.core import EFFECT_TYPES, Simulator
from app.sim.scenario import load_scenario
from app.util import iso, parse_duration, parse_ts


@dataclass
class TickResult:
    ts: datetime
    alerts: list[Alert] = field(default_factory=list)  # onboard alerts that changed
    ground_alerts: list[dict[str, Any]] = field(default_factory=list)  # alerts delivered to ground
    recommendations: list[dict[str, Any]] = field(default_factory=list)  # delivered onboard
    speed: float | None = None  # requested by a scenario event
    pause: bool = False


class World:
    def __init__(self, cfg: Config, scenario: str = "nominal", seed: int = 42) -> None:
        self.cfg = cfg
        self.seed = seed
        self.scenario = load_scenario(scenario)
        mission = cfg.mission
        self.start_ts = parse_ts(self.scenario.get("start_ts", mission["start_ts"]))
        self.crew_ids = [c["id"] for c in cfg.crew]
        self.clock = SimClock(self.start_ts - timedelta(hours=mission["prewarm_h"]))
        self.store = SeriesStore()
        self.sim = Simulator(cfg, self.clock, seed, self.scenario.get("phase", mission["default_phase"]), self.start_ts)
        self._events = sorted(
            ((self.start_ts + parse_duration(e["at"]), i, e) for i, e in enumerate(self.scenario["events"])),
            key=lambda x: (x[0], x[1]),
        )
        self._seen_ids: set[str] = set()

        # History + prewarm: fills the buffers and baselines before the scenario starts. No rules run here.
        for ts, crew_id, signal, value in self.sim.history():
            self.store.add(crew_id, signal, ts, value)
        while self.clock.now() < self.start_ts:
            self._fire_events(self.clock.now(), TickResult(self.clock.now()), prewarm=True)
            self._ingest(self.sim.step())

        self.engine = RuleEngine(cfg.rules, cfg, self.store, self.crew_ids, mission["tick_s"])
        self.alerts = AlertManager()
        self.link = Link(mission["link"]["max_msgs_per_tick"])
        self.delay_override: float | None = None
        self.recommendations: list[dict[str, Any]] = []
        self.snapshot = self._build_snapshot()
        self.ground = GroundNode(self.store.copy())  # data before T0 counts as already synced
        self.ground.snapshot, self.ground.as_of = self.snapshot, self.start_ts

    # ---- time ----------------------------------------------------------------------------
    @property
    def delay_s(self) -> float:
        if self.delay_override is not None:
            return self.delay_override
        return float(self.sim.phase_cfg["comm_delay_s"])

    def _ingest(self, samples: list[tuple[str | None, str, float]]) -> None:
        now = self.clock.now()
        for crew_id, signal, value in samples:
            self.store.add(crew_id, signal, now, value)

    def _fire_events(self, now: datetime, result: TickResult, prewarm: bool = False) -> None:
        while self._events and self._events[0][0] <= now:
            ts, _, event = self._events.pop(0)
            kind, params = event["type"], event["params"]
            if kind in EFFECT_TYPES:
                end = ts + parse_duration(event.get("duration", "100d"))
                self.sim.add_effect(kind, ts, end, params)
            elif kind == "phase":
                self.sim.set_phase(params["name"])
            elif kind == "speed" and not prewarm:
                result.speed = float(params["speed"])
            elif kind == "pause" and not prewarm:
                result.pause = True

    def tick(self) -> TickResult:
        result = TickResult(self.clock.now())
        self._fire_events(self.clock.now(), result)
        self._ingest(self.sim.step())
        now = result.ts = self.clock.now()

        result.alerts = self.alerts.process(self.engine.evaluate(now), now)
        self.snapshot = self._build_snapshot()
        for alert in result.alerts:
            self._send_alert(alert)
        self.link.send(DOWN, "snapshot", PRIORITY_SNAPSHOT, self.snapshot, now, self.delay_s)

        for msg in self.link.deliver(now):
            if msg.direction == DOWN:
                self.ground.receive(msg)
                if msg.kind == "alert":
                    result.ground_alerts.append(msg.payload)
            else:
                rec = {**msg.payload, "delivered_ts": iso(now)}
                self.recommendations.append(rec)
                result.recommendations.append(rec)
        return result

    # ---- onboard actions -----------------------------------------------------------------
    def _send_alert(self, alert: Alert) -> None:
        priority = PRIORITY_EMERGENCY if alert.severity == Severity.EMERGENCY else PRIORITY_ALERT
        self.link.send(DOWN, "alert", priority, alert.model_dump(mode="json"), self.clock.now(), self.delay_s)

    def ack_alert(self, alert_id: str) -> Alert:
        alert = self.alerts.ack(alert_id, self.clock.now())
        self._send_alert(alert)
        return alert

    def treat_alert(self, alert_id: str) -> Alert:
        alert = self.alerts.treat(alert_id, self.clock.now())
        self._send_alert(alert)
        return alert

    def resolve_alert(self, alert_id: str, text: str = "Resolved by crew.") -> Alert:
        alert = self.alerts.resolve(alert_id, self.clock.now(), text)
        self._send_alert(alert)
        return alert

    def note_alert(self, alert_id: str, text: str) -> Alert:
        alert = self.alerts.note(alert_id, self.clock.now(), text)
        self._send_alert(alert)
        return alert

    def set_sheltered(self, crew_id: str, sheltered: bool) -> None:
        self.sim.set_sheltered(crew_id, sheltered)
        self.snapshot = self._build_snapshot()

    def ingest_observations(self, observations: list[Observation]) -> tuple[int, int]:
        """Idempotent on Observation.id. Returns (accepted, duplicates)."""
        accepted = 0
        for obs in observations:
            if obs.id in self._seen_ids:
                continue
            self._seen_ids.add(obs.id)
            self.store.add(obs.crew_id, obs.signal.value, obs.ts, obs.value)
            accepted += 1
        return accepted, len(observations) - accepted

    # ---- ground actions (only through the link) ------------------------------------------
    def send_recommendation(self, text: str, checklist: list[str], crew_id: str | None) -> dict[str, Any]:
        now = self.clock.now()
        payload: dict[str, Any] = {"text": text, "checklist": checklist, "crew_id": crew_id, "origin": "GROUND"}
        msg = self.link.send(UP, "recommendation", PRIORITY_RECOMMENDATION, payload, now, self.delay_s)
        payload |= {"id": msg.id, "sent_ts": iso(msg.sent_ts), "deliver_ts": iso(msg.deliver_ts)}
        self.ground.sent_recommendations.append(payload)
        return payload

    # ---- snapshot ------------------------------------------------------------------------
    def _build_snapshot(self) -> dict[str, Any]:
        now = self.clock.now()
        open_alerts = self.alerts.open_alerts() if hasattr(self, "alerts") else []
        all_alerts = list(self.alerts.alerts.values()) if hasattr(self, "alerts") else []
        readiness = compute_readiness(self.cfg, self.store, open_alerts, self.crew_ids, now)

        def status(alerts: list[Alert]) -> tuple[str, Alert | None]:
            top = max(alerts, key=lambda a: a.severity.rank, default=None)
            return (top.severity.value if top else "NOMINAL"), top

        crew = []
        for c in self.cfg.crew:
            cid = c["id"]
            mine = [a for a in open_alerts if a.crew_id in (None, cid)]
            level, top = status(mine)
            vitals: dict[str, float] = {}
            trends: dict[str, float] = {}
            for name, meta in SIGNALS.items():
                if meta.scope != "crew":
                    continue
                point = self.store.latest(cid, name)
                if point:
                    (trends if meta.daily else vitals)[name] = round(point[1], 3)
            crew.append({
                "id": cid, "callsign": c["callsign"], "role": c["role"], "status": level,
                "top_alert": {"id": top.id, "title": top.title, "severity": top.severity.value} if top else None,
                "alert_count": len(mine), "vitals": vitals, "trends": trends,
                "readiness": {k: v["value"] for k, v in readiness[cid].items()},
                "eva_go": readiness[cid]["EVA"].get("go"),
            })

        environment = {}
        for name, meta in SIGNALS.items():
            if meta.scope == "cabin":
                point = self.store.latest(None, name)
                if point:
                    environment[name] = round(point[1], 3)

        hazards = {}
        for hazard in Hazard:
            level, _ = status([a for a in open_alerts if hazard in a.hazards])
            hazards[hazard.value] = {
                "status": level,
                "alert_ids": [a.id for a in open_alerts if hazard in a.hazards],
            }

        sheltered = {c.id: c.sheltered for c in self.sim.crew}
        return {
            "ts": iso(now),
            "scenario": self.scenario["name"],
            "seed": self.seed,
            "mission_day": int(self.sim.elapsed_days(now)),
            "phase": {
                "name": self.sim.phase,
                "gravity_g": self.sim.phase_cfg["gravity_g"],
                "comm_delay_s": self.sim.phase_cfg["comm_delay_s"],
            },
            "crew": crew,
            "environment": environment,
            "hazards": hazards,
            "readiness": readiness,
            "radiation": radiation_summary(self.cfg, self.store, all_alerts, sheltered, now),
        }
