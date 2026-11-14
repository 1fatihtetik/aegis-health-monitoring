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
from app.datasets.horizons import CommDelay, LightTime
from app.datasets.inspiration4 import load_inspiration4
from app.datasets.provenance import ProvenanceTracker
from app.datasets.rad import RadiationReplays
from app.datasets.spaceweather import SpaceWeather
from app.db.store import SeriesStore
from app.domain.enums import SIGNALS, Hazard, Provenance, Quality, Severity
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

RAD_SIGNALS = ("area_dose_rate_absorbed", "area_dose_rate_equivalent", "neutron_dose_equivalent_rate",
               "dose_rate_equivalent", "dose_rate_absorbed", "dose_mission")


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
        self.provenance = ProvenanceTracker(cfg.datasets)
        self.radiation = RadiationReplays(cfg.datasets, self.start_ts)
        self.comm = CommDelay(cfg.datasets, mission["phases"])  # R-4: JPL Horizons light time by date
        self.space_weather = SpaceWeather(cfg)  # R-5: ground-side DONKI/OMNI2 context, reaches the crew via link
        self.inspiration4 = load_inspiration4(cfg.datasets)  # P-6: aggregate reference panel, bundled, onboard too
        self.suspect: list[list[datetime]] = []  # [from, to] spans where a RAD gap was filled by holding (SUSPECT)
        self.sim = Simulator(cfg, self.clock, seed, self.scenario.get("phase", mission["default_phase"]), self.start_ts,
                             self.radiation)
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
        self.engine.provenance = lambda signal: self.provenance.current(signal).as_dict()
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
        return self.delay_source().delay_s

    def delay_source(self) -> LightTime:
        """One-way comm delay now and where it comes from (operator override > JPL Horizons > phase constant)."""
        if self.delay_override is not None:
            return LightTime(self.delay_override, Provenance.SYNTHETIC, None,
                             "Set by an operator (POST /link/delay), not ephemeris.", None)
        return self.comm.at(self.sim.phase, self.clock.now())

    def _ingest(self, samples: list[tuple[str | None, str, float]]) -> None:
        now = self.clock.now()
        for crew_id, signal, value in samples:
            self.store.add(crew_id, signal, now, value)
        self._track_radiation_source(now)

    def _track_radiation_source(self, now: datetime) -> None:
        """Provenance of the radiation signals after a simulator step (R-2, AGENTS.md section 2a)."""
        rad = self.sim.rad_sample
        if rad is not None and rad.quality == Quality.SUSPECT:
            if self.suspect and self.suspect[-1][1] >= now - self.sim.tick:
                self.suspect[-1][1] = now
            else:
                self.suspect.append([now, now])
        replay = (self.radiation.for_event("spe") if self.sim.spe_replay_active
                  else self.radiation.for_phase(self.sim.phase))
        if rad is None or replay is None:
            for signal in RAD_SIGNALS:
                src = self.cfg.datasets.source(signal)
                self.provenance.set(signal, src.provenance, src.dataset_id, now, src.basis)
            return
        if self.sim.spe_active and not self.sim.spe_replay_active:
            basis = "Synthetic SPE profile multiplied onto the replayed background (rad_spe replay inactive)."
            for signal in RAD_SIGNALS:
                self.provenance.set(signal, Provenance.SYNTHETIC, None, now, basis)
            return
        did, q = rad.dataset_id, replay.quality_factor
        measured, derived_prov = replay.measured_provenance, replay.derived_provenance
        fraction = self.sim.neutron_fraction(self.sim.spe_replay_active)
        event_note = (f" [SPE {replay.event_date}, DONKI {replay.donki_id}, replayed x{replay.compression:g}]"
                      if replay.donki_id else "")
        q_note = f"<Q> {q} ({replay.quality_factor_ref})"
        if replay.measures == "absorbed":
            measured_signal = "area_dose_rate_absorbed"
            other = ("area_dose_rate_equivalent", f"{replay.instrument} x mean quality factor {q_note}{event_note}.")
        else:  # the dataset already reports a dose equivalent rate (P-3 RadNet)
            measured_signal = "area_dose_rate_equivalent"
            other = ("area_dose_rate_absorbed", f"{replay.instrument} / {q_note}.")
        neutron = (replay.neutron_note or f"{fraction:.0%} of the area dose equivalent (neutron share: project "
                   "heuristic from the CSA LEO value, unverified).")
        derived = {
            other[0]: other[1],
            "neutron_dose_equivalent_rate": neutron,
            "dose_rate_equivalent": "Area dose equivalent x (1 + seeded per-crew variation, sd 2%); x shelter factor "
                                    f"{self.cfg.mission['sim']['shelter_dose_factor']} (heuristic) while sheltered in "
                                    f"an SPE{event_note}.",
            "dose_rate_absorbed": f"Personal dose equivalent / <Q> {q}.",
            "dose_mission": "Mission days before the scenario x the replay's mean dose-equivalent rate, plus the "
                            "integral of the personal dose rate.",
        }
        self.provenance.set(measured_signal, measured, did, now, f"{replay.instrument}{event_note}.")
        for signal, basis in derived.items():
            self.provenance.set(signal, derived_prov, did, now, basis)
        if rad.saa is not None:
            self.provenance.set("saa_transit", derived_prov, did, now,
                                "Spacecraft position in the dataset record inside the South Atlantic Anomaly box "
                                "10-80 deg W, 5-45 deg S (Berger et al. 2017, J. Space Weather Space Clim. 7:A8).")

    def replay_status(self) -> dict[str, Any] | None:
        """What the radiation view shows about the active RAD replay (AGENTS.md section 2a: label the mapping)."""
        rad = self.sim.rad_sample
        replay = (self.radiation.for_event("spe") if self.sim.spe_replay_active
                  else self.radiation.for_phase(self.sim.phase))
        if rad is None or replay is None:
            return None
        meta = self.cfg.datasets.dataset_meta(rad.dataset_id) or {}
        return {
            "replay_id": rad.replay_id, "dataset_id": rad.dataset_id, "label": meta.get("label", rad.dataset_id),
            "dataset_ts": iso(rad.dataset_ts), "observation_ts": iso(rad.source_ts),
            "compression": replay.compression, "quality": rad.quality.value,
            "quality_factor": replay.quality_factor, "quality_factor_ref": replay.quality_factor_ref,
            "absorbed_uGy_h": round(rad.absorbed_uGy_h, 3),
            "synthetic_spe_overlay": self.sim.spe_active and not self.sim.spe_replay_active,
            "event_date": replay.event_date or None,
            "donki_id": replay.donki_id or None,
            # P-1..P-3: which instrument, what it measures, and how it is labelled (the UI must not assume MSL/RAD).
            "instrument": replay.instrument,
            "measures": replay.measures,
            "measured_provenance": replay.measured_provenance.value,
            "agency": meta.get("agency", "NASA"),
            "saa": rad.saa,
        }

    def _fire_events(self, now: datetime, result: TickResult, prewarm: bool = False) -> None:
        while self._events and self._events[0][0] <= now:
            ts, _, event = self._events.pop(0)
            kind, params = event["type"], event["params"]
            if kind in EFFECT_TYPES:
                end = ts + parse_duration(event.get("duration", "100d"))
                self.sim.add_effect(kind, ts, end, params)
            elif kind == "phase":
                self.sim.set_phase(params["name"])
            elif kind == "blackout" and not prewarm:
                self.link.blackout = bool(params["active"])
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
            self.provenance.set(obs.signal.value, obs.provenance, obs.dataset_id, obs.ts)
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

    def forward_space_weather(self, crew_id: str | None = None) -> dict[str, Any]:
        """R-5: the ground forwards the bundled space-weather brief to the crew through the delayed link."""
        text, checklist = self.space_weather.crew_brief()
        return self.send_recommendation(text, checklist, crew_id)

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
                "id": cid, "callsign": c["callsign"], "name": c.get("name", c["callsign"]), "role": c["role"], "status": level,
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
                "gravity": self.sim.gravity_state(),
                "comm_delay_s": self.delay_s,
                "comm_delay_source": self.delay_source().as_dict(),
            },
            "crew": crew,
            "environment": environment,
            "hazards": hazards,
            "readiness": readiness,
            "radiation": {**radiation_summary(self.cfg, self.store, all_alerts, sheltered, now),
                          "replay": self.replay_status()},
            "provenance": self.provenance.snapshot(),
        }
