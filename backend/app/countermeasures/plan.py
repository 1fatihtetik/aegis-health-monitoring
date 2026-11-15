"""Countermeasure log, today's plan and the weekly adherence (Block C, C-0..C-2).

- SessionLog: countermeasures logged as done (a tap on the tablet: CREW_ENTERED; a scripted scenario event:
  SYNTHETIC). In memory only, never written to disk.
- today_plan(): what one crew member sees on the routine board today. Statuses are neutral: DONE, DUE (now),
  NOT_LOGGED (information only, INFO at most) and UPCOMING. No %, no score, no penalty (user decision 2026-11-15).
- weekly(): prescribed vs done per day and per type for one crew member, for the CMO and the ground. One person per
  result; the caller lists crew in the fixed C1..C4 order. No sorting by adherence, no crew average, no ranking.

Exercise sessions the simulator performs count as done (its session model, the same one behind the daily
`exercise_adherence_pct`), so adherence is derived from the session record, never typed. Other items count only from
the scenario start, because the simulator does not script them before then.
"""

from collections.abc import Callable, Iterable
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Any

from app.config import Config
from app.countermeasures.catalog import TYPE_ORDER, Countermeasure
from app.domain.enums import Provenance
from app.domain.models import Observation
from app.util import iso, parse_duration

DONE, DUE, NOT_LOGGED, UPCOMING = "DONE", "DUE", "NOT_LOGGED", "UPCOMING"
SIM_BASIS = "Simulated exercise session (seeded session model, adherence from config/crew.yaml); not a logged record."
TAP_BASIS = "Logged as done on the onboard tablet (tap). Kept in memory only."
SCRIPTED_BASIS = "Scripted countermeasure session for the synthetic crew (scenario {scenario}); not logged by a person."

SimDone = Callable[[str, date, int], bool]  # (crew_id, day, session index) -> the simulator did the session


@dataclass
class Session:
    ts: datetime
    crew_id: str
    cm_id: str
    provenance: str
    basis: str
    minutes: float | None = None


class SessionLog:
    def __init__(self) -> None:
        self.sessions: list[Session] = []  # oldest first
        self._by_key: dict[tuple[str, str, datetime], Session] = {}

    def record(self, obs: Observation, scenario: str) -> Session | None:
        """One session per (crew, countermeasure, ts): countermeasure_done and exercise_minutes of one tap merge."""
        if obs.countermeasure_id is None or obs.crew_id is None:
            return None
        key = (obs.crew_id, obs.countermeasure_id, obs.ts)
        session = self._by_key.get(key)
        if session is None:
            crew_entered = obs.provenance == Provenance.CREW_ENTERED
            basis = TAP_BASIS if crew_entered else SCRIPTED_BASIS.format(scenario=scenario)
            session = Session(obs.ts, obs.crew_id, obs.countermeasure_id, obs.provenance.value, basis)
            self._by_key[key] = session
            self.sessions.append(session)
            self.sessions.sort(key=lambda s: s.ts)
        if obs.signal.value == "exercise_minutes":
            session.minutes = obs.value
        return session

    def on(self, crew_id: str, cm_id: str, day: date) -> list[Session]:
        return [s for s in self.sessions if s.crew_id == crew_id and s.cm_id == cm_id and s.ts.date() == day]

    def since(self, crew_id: str, cm_id: str, start: datetime, now: datetime) -> list[Session]:
        return [s for s in self.sessions if s.crew_id == crew_id and s.cm_id == cm_id and start <= s.ts <= now]

    def as_list(self, crew_id: str | None = None) -> list[dict[str, Any]]:
        return [{"ts": iso(s.ts), "crew_id": s.crew_id, "countermeasure_id": s.cm_id, "provenance": s.provenance,
                 "basis": s.basis, "minutes": s.minutes} for s in self.sessions if crew_id in (None, s.crew_id)]


def _at(day: date, hour: float, like: datetime) -> datetime:
    return datetime(day.year, day.month, day.day, tzinfo=like.tzinfo) + timedelta(hours=hour)


def resolved_item(cfg: Config, item: Countermeasure) -> dict[str, Any]:
    """Catalog entry with each prescription's limit resolved (value, source_ref, verified, source_kind)."""
    out = item.model_dump(mode="json")
    out["prescription"] = [{"label": p.label, **cfg.limit(p.limit_ref).as_dict()} for p in item.prescription]
    return out


@dataclass
class Triggers:
    """Why triggered items are on one crew member's plan right now: {cm_id: [(reason, since)]}."""

    reasons: dict[str, list[tuple[str, datetime]]]


def triggers_for(cfg: Config, crew_id: str, open_alerts: Iterable[Any], readiness: dict[str, Any],
                 gravity_increase_ahead: bool, now: datetime) -> Triggers:
    """Open alerts (crew or cabin) in `triggered_by`; a Hold on a gate in `triggered_by_gate` while it applies."""
    mine = [a for a in open_alerts if a.crew_id in (None, crew_id)]
    reasons: dict[str, list[tuple[str, datetime]]] = {}
    for item in cfg.countermeasures.items:
        hits = [(a.title, a.raised_ts) for a in mine if a.rule_id in item.triggered_by]
        for gate in item.triggered_by_gate:
            spec = readiness.get(gate, {})
            ahead = gravity_increase_ahead if gate == "LANDING" else True
            if ahead and spec.get("go") is False:
                hits.append((f"{gate.capitalize()} readiness gate on Hold", now))
        if hits:
            reasons[item.id] = sorted(hits, key=lambda h: h[1])
    return Triggers(reasons)


def _slot(item: Countermeasure, crew_cfg: dict[str, Any], day: date, like: datetime) -> tuple[datetime, datetime] | None:
    """(slot start, due until) of a daily item on `day`; None for items that are only triggered."""
    if item.session is not None:
        start = _at(day, float(crew_cfg["exercise_hours"][item.session]), like)
        return start, start + parse_duration(item.due_window)
    if item.schedule is not None:
        hh, mm = (int(x) for x in item.schedule.at.split(":"))
        start = _at(day, hh + mm / 60, like)
        return start, start + parse_duration(item.schedule.due_window)
    return None


def _done_on(cfg: Config, item: Countermeasure, crew_cfg: dict[str, Any], day: date, now: datetime, log: SessionLog,
             results: list[dict[str, Any]], sim_done: SimDone, since: datetime | None = None) -> dict[str, Any] | None:
    """The record that makes the item done on `day` (newest), or None. `since` limits triggered items."""
    sessions = log.on(crew_cfg["id"], item.id, day)
    if since is not None:
        sessions = [s for s in sessions if s.ts >= since]
    sessions = [s for s in sessions if s.ts <= now]
    if sessions:
        s = sessions[-1]
        return {"ts": iso(s.ts), "provenance": s.provenance, "basis": s.basis, "minutes": s.minutes}
    if item.done_by_test:
        hits = [r for r in results if r["test_id"] == item.done_by_test and r["crew_id"] == crew_cfg["id"]
                and r["ts"][:10] == day.isoformat() and r["ts"] <= iso(now)]
        if hits:
            r = hits[-1]
            return {"ts": r["ts"], "provenance": r["provenance"], "basis": r["basis"], "minutes": None}
    if item.session is not None:
        slot = _slot(item, crew_cfg, day, now)
        assert slot is not None
        if sim_done(crew_cfg["id"], day, item.session) and slot[0] + timedelta(hours=1) <= now:
            return {"ts": iso(slot[0] + timedelta(hours=1)), "provenance": Provenance.SYNTHETIC.value,
                    "basis": SIM_BASIS, "minutes": None}
    return None


def today_plan(cfg: Config, crew_cfg: dict[str, Any], now: datetime, log: SessionLog, results: list[dict[str, Any]],
               sim_done: SimDone, triggers: Triggers) -> list[dict[str, Any]]:
    """One crew member's countermeasures for today, in catalog order. Neutral statuses, INFO at most."""
    today = now.date()
    out: list[dict[str, Any]] = []
    for item in cfg.countermeasures.items:
        base = resolved_item(cfg, item)
        reasons = triggers.reasons.get(item.id, [])
        slot = _slot(item, crew_cfg, today, now)
        if slot is not None:
            done = _done_on(cfg, item, crew_cfg, today, now, log, results, sim_done)
            status = DONE if done else UPCOMING if now < slot[0] else DUE if now < slot[1] else NOT_LOGGED
            reason, added = "routine", [r for r, _ in reasons]
            slot_start, due_until = iso(slot[0]), iso(slot[1])
        elif reasons:
            since = reasons[0][1]
            done = _done_on(cfg, item, crew_cfg, today, now, log, results, sim_done, since=since)
            status, reason, added = (DONE if done else DUE), "added", [r for r, _ in reasons]
            slot_start, due_until = iso(since), None
        else:
            continue
        out.append({
            **base, "countermeasure_id": item.id, "status": status, "reason": reason, "added_because": added,
            # information only: "not logged" never raises an alert, never changes readiness, is never counted
            "level": "INFO" if status == NOT_LOGGED else None,
            "slot_start": slot_start, "due_until": due_until,
            "done_ts": done["ts"] if done else None, "done_provenance": done["provenance"] if done else None,
            "done_basis": done["basis"] if done else None, "done_minutes": done["minutes"] if done else None,
        })
    return out


def weekly(cfg: Config, crew_cfg: dict[str, Any], now: datetime, tracked_from: datetime, log: SessionLog,
           results: list[dict[str, Any]], sim_done: SimDone, added: set[tuple[str, str, date]],
           bone: Callable[[float | None], dict[str, Any]]) -> dict[str, Any]:
    """Last N days (today included) of prescribed vs done per type, for one crew member (CMO and ground only)."""
    n = int(cfg.countermeasures.setting("adherence_days"))
    cid = crew_cfg["id"]
    days = [now.date() - timedelta(days=k) for k in range(n - 1, -1, -1)]
    rows = []
    totals = {t: {"prescribed": 0, "done": 0} for t in TYPE_ORDER}
    for day in days:
        per_type = {t: {"prescribed": 0, "done": 0} for t in TYPE_ORDER}
        for item in cfg.countermeasures.items:
            slot = _slot(item, crew_cfg, day, now)
            if slot is not None:
                prescribed = slot[0] <= now and (item.session is not None or slot[0] >= tracked_from)
            else:
                prescribed = (cid, item.id, day) in added
            if not prescribed:
                continue
            per_type[item.type]["prescribed"] += 1
            if _done_on(cfg, item, crew_cfg, day, now, log, results, sim_done):
                per_type[item.type]["done"] += 1
        for t in TYPE_ORDER:
            totals[t]["prescribed"] += per_type[t]["prescribed"]
            totals[t]["done"] += per_type[t]["done"]
        rows.append({"date": day.isoformat(), "types": per_type})
    out_totals = {t: {**v, "pct": round(100 * v["done"] / v["prescribed"]) if v["prescribed"] else None}
                  for t, v in totals.items()}
    ex = totals["EXERCISE"]
    fraction = ex["done"] / ex["prescribed"] if ex["prescribed"] else None
    return {"crew_id": cid, "callsign": crew_cfg["callsign"], "days": rows, "totals": out_totals,
            "types": [t for t in TYPE_ORDER if totals[t]["prescribed"]], "tracked_from": iso(tracked_from),
            "bone_model": bone(fraction)}
