"""REST API (PRD section 12). Every GET takes ?node=onboard|ground.

Onboard answers from live onboard state. Ground answers only from what the link has delivered,
and every response carries `as_of` and `age_s` so the UI can show "Data as of T-Xm Ys".
"""

import statistics
from datetime import datetime, timedelta
from typing import Any, Literal

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, Field

from app.countermeasures.plan import resolved_item
from app.datasets.provenance import check_agency
from app.domain.enums import SIGNALS, Signal
from app.domain.models import Observation
from app.rules.models import Predicate
from app.runtime import Runtime
from app.sim.scenario import list_scenarios
from app.util import iso, parse_duration
from app.world import RAD_SIGNALS

router = APIRouter(prefix="/api/v1")
Node = Literal["onboard", "ground"]


def _rt(request: Request) -> Runtime:
    rt: Runtime = request.app.state.rt
    return rt


def _snap(rt: Runtime, node: str) -> dict[str, Any]:
    return rt.world.ground.snapshot if node == "ground" else rt.world.snapshot


def _envelope(rt: Runtime, node: str, **data: Any) -> dict[str, Any]:
    w = rt.world
    now = w.clock.now()
    as_of = w.ground.as_of if node == "ground" and w.ground.as_of else now
    return {"node": node, "now": iso(now), "as_of": iso(as_of), "age_s": (now - as_of).total_seconds(), **data}


def _alerts(rt: Runtime, node: str) -> list[dict[str, Any]]:
    w = rt.world
    items = list(w.ground.alerts.values()) if node == "ground" else [
        a.model_dump(mode="json") for a in w.alerts.alerts.values()
    ]
    return sorted(items, key=lambda a: a["raised_ts"], reverse=True)


def _limits_by_signal(rt: Runtime) -> dict[str, list[dict[str, Any]]]:
    """Limit bands per signal, taken from the rules that use them."""
    cfg = rt.cfg
    out: dict[str, list[dict[str, Any]]] = {}
    for rule in cfg.rules:
        specs = [rule] if rule.signal else [m for m in rule.members if isinstance(m, Predicate)]
        for spec in specs:
            limit = cfg.limit(str(spec.limit_ref))
            out.setdefault(str(spec.signal), []).append({
                "rule_id": rule.id, "rule_type": rule.type.value, "severity": rule.severity.value,
                "op": spec.op, "window": spec.window, **limit.as_dict(),
            })
    return out


# Handlers are async on purpose: they then run on the event-loop thread, the same thread as the
# simulation tick (runtime.py), so a request never sees a store or alert map mid-update.
@router.get("/health")
async def health() -> dict[str, str]:
    """Same as /health; the frontend probes this path."""
    return {"status": "ok"}


# ---- crew ------------------------------------------------------------------------------------
@router.get("/crew")
async def crew(request: Request, node: Node = "onboard") -> dict[str, Any]:
    rt = _rt(request)
    snap = _snap(rt, node)
    return _envelope(rt, node, crew=snap["crew"], hazards=snap["hazards"], phase=snap["phase"],
                     mission_day=snap["mission_day"])


@router.get("/crew/{crew_id}/summary")
async def crew_summary(crew_id: str, request: Request, node: Node = "onboard") -> dict[str, Any]:
    rt = _rt(request)
    snap = _snap(rt, node)
    member = next((c for c in snap["crew"] if c["id"] == crew_id), None)
    if member is None:
        raise HTTPException(404, f"Unknown crew member '{crew_id}'")
    alerts = [a for a in _alerts(rt, node) if a["crew_id"] in (None, crew_id) and a["state"] != "RESOLVED"]
    units = {name: SIGNALS[name].unit for name in [*member["vitals"], *member["trends"]]}
    return _envelope(rt, node, crew=member, units=units, readiness=snap["readiness"][crew_id], alerts=alerts,
                     radiation=snap["radiation"]["crew"][crew_id])


BASELINE_SIGNALS = ["heart_rate", "hrv_rmssd", "spo2", "resp_rate", "skin_temp", "bp_systolic", "bp_diastolic"]


@router.get("/crew/{crew_id}/baselines")
async def crew_baselines(crew_id: str, request: Request, node: Node = "onboard", window: str | None = None) -> dict[str, Any]:
    """Personal rolling baseline per vital: mean, sd, current (10 min mean) and z-score."""
    rt = _rt(request)
    if crew_id not in rt.world.crew_ids:
        raise HTTPException(404, f"Unknown crew member '{crew_id}'")
    try:
        span = parse_duration(window or rt.cfg.mission["baseline_window"])
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    store = rt.world.ground.store if node == "ground" else rt.world.store
    z_limit = rt.cfg.limit("physiology.baseline_z_alert")
    ground_as_of = rt.world.ground.as_of
    now = ground_as_of if node == "ground" and ground_as_of else rt.world.clock.now()
    out: dict[str, Any] = {}
    for signal in BASELINE_SIGNALS:
        history = store.window(crew_id, signal, now - span)
        recent = store.window(crew_id, signal, now - timedelta(minutes=10))
        if len(history) < 2:
            out[signal] = {"unit": SIGNALS[signal].unit, "n": len(history), "mean": None}
            continue
        mean, sd = statistics.fmean(history), statistics.pstdev(history)
        current = statistics.fmean(recent) if recent else None
        z = (current - mean) / sd if current is not None and sd > 0 else None
        out[signal] = {
            "unit": SIGNALS[signal].unit, "n": len(history), "mean": round(mean, 2), "sd": round(sd, 2),
            "current": round(current, 2) if current is not None else None,
            "z": round(z, 2) if z is not None else None,
            "outside": z is not None and abs(z) > z_limit.value,
        }
    return _envelope(rt, node, crew_id=crew_id, window=window or rt.cfg.mission["baseline_window"],
                     z_limit=z_limit.as_dict(), baselines=out)


def _timeseries(rt: Runtime, node: str, crew_id: str | None, signal: Signal, start: datetime | None,
                end: datetime | None, max_points: int) -> dict[str, Any]:
    store = rt.world.ground.store if node == "ground" else rt.world.store
    points = store.points(crew_id, signal.value, start, end)
    stride = max(1, -(-len(points) // max_points))
    return _envelope(
        rt, node, crew_id=crew_id, signal=signal.value, unit=SIGNALS[signal.value].unit,
        points=[[iso(ts), round(v, 3)] for ts, v in points[::stride]],
        limits=_limits_by_signal(rt).get(signal.value, []),
        provenance=_provenance(rt, node, signal.value, start, end),
        suspect=_suspect(rt, node, signal.value, start, end),
    )


def _suspect(rt: Runtime, node: str, signal: str, start: datetime | None, end: datetime | None) -> list[list[str]]:
    """[from, to] spans where a RAD data gap was filled by holding the last value (quality SUSPECT)."""
    if node == "ground" or signal not in RAD_SIGNALS:
        return []
    return [[iso(a), iso(b)] for a, b in rt.world.suspect
            if (end is None or a <= end) and (start is None or b >= start)]


def _provenance(rt: Runtime, node: str, signal: str, start: datetime | None, end: datetime | None) -> dict[str, Any]:
    """Current source of a signal plus the segments covering the window (ground: what the link delivered)."""
    if node == "ground":
        current = _snap(rt, node).get("provenance", {}).get(signal) or rt.cfg.datasets.source(signal).as_dict()
        return {**current, "segments": [{"since": None, **current}]}
    tracker = rt.world.provenance
    return {**tracker.current(signal).as_dict(), "segments": tracker.segments(signal, start, end)}


@router.get("/crew/{crew_id}/timeseries")
async def crew_timeseries(
    crew_id: str, request: Request, signal: Signal, node: Node = "onboard",
    start: datetime | None = Query(None, alias="from"), end: datetime | None = Query(None, alias="to"),
    max_points: int = Query(600, ge=10, le=5000),
) -> dict[str, Any]:
    return _timeseries(_rt(request), node, crew_id, signal, start, end, max_points)


# ---- environment / radiation / readiness -----------------------------------------------------
@router.get("/environment/current")
async def environment(request: Request, node: Node = "onboard") -> dict[str, Any]:
    rt = _rt(request)
    snap = _snap(rt, node)
    limits = _limits_by_signal(rt)
    values = {
        name: {"value": value, "unit": SIGNALS[name].unit, "limits": limits.get(name, [])}
        for name, value in snap["environment"].items()
    }
    return _envelope(rt, node, environment=values)


@router.get("/environment/timeseries")
async def environment_timeseries(
    request: Request, signal: Signal, node: Node = "onboard",
    start: datetime | None = Query(None, alias="from"), end: datetime | None = Query(None, alias="to"),
    max_points: int = Query(600, ge=10, le=5000),
) -> dict[str, Any]:
    return _timeseries(_rt(request), node, None, signal, start, end, max_points)


@router.get("/radiation/summary")
async def radiation(request: Request, node: Node = "onboard") -> dict[str, Any]:
    rt = _rt(request)
    return _envelope(rt, node, **_snap(rt, node)["radiation"])


class ShelterBody(BaseModel):
    crew_id: str
    sheltered: bool = True


@router.post("/radiation/shelter")
async def shelter(body: ShelterBody, request: Request) -> dict[str, Any]:
    """Headcount: log a crew member as in (or out of) the storm shelter. Onboard action."""
    rt = _rt(request)
    try:
        rt.world.set_sheltered(body.crew_id, body.sheltered)
    except KeyError as exc:
        raise HTTPException(404, f"Unknown crew member '{body.crew_id}'") from exc
    return _envelope(rt, "onboard", **rt.world.snapshot["radiation"])


@router.get("/readiness")
async def readiness(request: Request, kind: str | None = None, node: Node = "onboard") -> dict[str, Any]:
    rt = _rt(request)
    data = _snap(rt, node)["readiness"]
    if kind:
        data = {cid: {kind: kinds[kind]} for cid, kinds in data.items() if kind in kinds}
    return _envelope(rt, node, readiness=data)


# ---- alerts ----------------------------------------------------------------------------------
@router.get("/alerts")
async def alerts(request: Request, state: str | None = None, severity: str | None = None, node: Node = "onboard") -> dict[str, Any]:
    rt = _rt(request)
    items = _alerts(rt, node)
    if state == "OPEN":
        items = [a for a in items if a["state"] != "RESOLVED"]
    elif state:
        items = [a for a in items if a["state"] == state]
    if severity:
        items = [a for a in items if a["severity"] == severity]
    return _envelope(rt, node, alerts=items)


class NoteBody(BaseModel):
    text: str = Field(min_length=1, max_length=2000)


def _alert_action(request: Request, alert_id: str, action: str, text: str | None = None) -> dict[str, Any]:
    world = _rt(request).world
    if alert_id not in world.alerts.alerts:
        raise HTTPException(404, f"Unknown alert '{alert_id}'")
    if action == "ack":
        alert = world.ack_alert(alert_id)
    elif action == "treat":
        alert = world.treat_alert(alert_id)
    elif action == "resolve":
        alert = world.resolve_alert(alert_id)
    else:
        alert = world.note_alert(alert_id, text or "")
    world.snapshot = world._build_snapshot()
    return alert.model_dump(mode="json")


@router.post("/alerts/{alert_id}/ack")
async def alert_ack(alert_id: str, request: Request) -> dict[str, Any]:
    return _alert_action(request, alert_id, "ack")


@router.post("/alerts/{alert_id}/treat")
async def alert_treat(alert_id: str, request: Request) -> dict[str, Any]:
    """RAISED or ACKNOWLEDGED -> IN_TREATMENT."""
    return _alert_action(request, alert_id, "treat")


@router.post("/alerts/{alert_id}/resolve")
async def alert_resolve(alert_id: str, request: Request) -> dict[str, Any]:
    return _alert_action(request, alert_id, "resolve")


@router.post("/alerts/{alert_id}/note")
async def alert_note(alert_id: str, body: NoteBody, request: Request) -> dict[str, Any]:
    return _alert_action(request, alert_id, "note", body.text)


# ---- rules / limits --------------------------------------------------------------------------
@router.get("/rules")
async def rules(request: Request) -> dict[str, Any]:
    return {"rules": [r.model_dump(mode="json") for r in _rt(request).cfg.rules]}


@router.get("/limits")
async def limits(request: Request) -> dict[str, Any]:
    rt = _rt(request)
    return {"limits": rt.cfg.limits, "by_signal": _limits_by_signal(rt),
            "signals": {name: {"unit": m.unit, "scope": m.scope, "device": m.device, "daily": m.daily}
                        for name, m in SIGNALS.items()}}


# ---- NASA datasets (PRD section 6 M0) ----------------------------------------------------------
@router.get("/datasets")
async def datasets(request: Request, node: Node = "onboard") -> dict[str, Any]:
    """Bundled NASA sources, replay status and the current provenance of every signal."""
    rt = _rt(request)
    snap = _snap(rt, node)
    return _envelope(rt, node, **rt.cfg.datasets.status(), signals=snap.get("provenance", {}))


# ---- simulator -------------------------------------------------------------------------------
@router.get("/sim/status")
async def sim_status(request: Request) -> dict[str, Any]:
    rt = _rt(request)
    return {**rt.sim_status(), "now": iso(rt.world.clock.now()), "scenarios": list_scenarios()}


class ScenarioBody(BaseModel):
    name: str
    seed: int = 42
    speed: float | None = Field(None, ge=1, le=10000)


@router.post("/sim/scenario")
async def sim_scenario(body: ScenarioBody, request: Request) -> dict[str, Any]:
    rt = _rt(request)
    try:
        rt.start_scenario(body.name, body.seed, body.speed)
    except KeyError as exc:
        raise HTTPException(404, str(exc)) from exc
    return await sim_status(request)


class ControlBody(BaseModel):
    action: Literal["pause", "resume", "speed"]
    speed: float | None = Field(None, ge=1, le=10000)


@router.post("/sim/control")
async def sim_control(body: ControlBody, request: Request) -> dict[str, Any]:
    rt = _rt(request)
    if body.action == "pause":
        rt.paused = True
    elif body.action == "resume":
        rt.paused = False
    elif body.speed is None:
        raise HTTPException(422, "action 'speed' needs 'speed'")
    else:
        rt.set_speed(body.speed)
    return await sim_status(request)


# ---- link ------------------------------------------------------------------------------------
@router.get("/link/status")
async def link_status(request: Request) -> dict[str, Any]:
    rt = _rt(request)
    return {**rt.link_status(), "now": iso(rt.world.clock.now()), "phase": rt.world.sim.phase}


class BlackoutBody(BaseModel):
    on: bool


@router.post("/link/blackout")
async def link_blackout(body: BlackoutBody, request: Request) -> dict[str, Any]:
    _rt(request).world.link.blackout = body.on
    return await link_status(request)


class DelayBody(BaseModel):
    delay_s: float | None = Field(None, ge=0, le=3600)  # null: use the mission phase delay


@router.post("/link/delay")
async def link_delay(body: DelayBody, request: Request) -> dict[str, Any]:
    _rt(request).world.delay_override = body.delay_s
    return await link_status(request)


class RecommendationBody(BaseModel):
    text: str = Field(min_length=1, max_length=2000)
    checklist: list[str] = Field(default_factory=list)
    crew_id: str | None = None


@router.post("/link/recommendation")
async def link_recommendation(body: RecommendationBody, request: Request) -> dict[str, Any]:
    """Ground -> crew. Delivered onboard after the comm delay, never earlier."""
    return _rt(request).world.send_recommendation(body.text, body.checklist, body.crew_id)


@router.get("/link/recommendations")
async def link_recommendations(request: Request, node: Node = "onboard") -> dict[str, Any]:
    rt = _rt(request)
    w = rt.world
    items = w.ground.sent_recommendations if node == "ground" else w.recommendations
    return _envelope(rt, node, recommendations=list(reversed(items)))


# ---- space weather (R-5) ---------------------------------------------------------------------
@router.get("/spaceweather/event")
async def spaceweather_event(request: Request, node: Node = "ground") -> dict[str, Any]:
    """Bundled DONKI SEP/FLR/CME + OMNI2 proton flux for the replayed SPE. Offline; never fetched at runtime."""
    rt = _rt(request)
    return _envelope(rt, node, event=rt.world.space_weather.event)


class ForwardBody(BaseModel):
    crew_id: str | None = None


@router.post("/spaceweather/forward")
async def spaceweather_forward(body: ForwardBody, request: Request) -> dict[str, Any]:
    """Ground -> crew: sends the space-weather brief as a recommendation through the delayed link."""
    w = _rt(request).world
    if not w.space_weather.event["available"]:
        raise HTTPException(409, "No bundled space-weather record is available")
    return w.forward_space_weather(body.crew_id)


# ---- reference panels (P-6) ------------------------------------------------------------------
@router.get("/reference/inspiration4")
async def reference_inspiration4(request: Request, node: Node = "onboard") -> dict[str, Any]:
    """Bundled Inspiration4 aggregate CBC/CMP reference (NASA OSDR). Static, offline, same on both nodes."""
    rt = _rt(request)
    return _envelope(rt, node, panel=rt.world.inspiration4)


# ---- crew self-tests (Block T, PRD section 6 M11) ----------------------------------------------
def _selftest_catalog(rt: Runtime) -> list[dict[str, Any]]:
    """Catalog entries with their normal bands resolved from limits.yaml and, per field, the rule limits that the
    value is judged against (the form asks for confirmation before sending a WARNING/EMERGENCY value)."""
    cfg = rt.cfg
    by_signal = _limits_by_signal(rt)
    out = []
    for test in cfg.selftests.tests:
        entry = test.model_dump(mode="json")
        entry["limits"] = [cfg.limit(ref).as_dict() for ref in test.limit_refs]
        for f in entry["fields"]:
            f["unit"] = SIGNALS[f["signal"]].unit
            f["rule_limits"] = by_signal.get(f["signal"], [])
            # display-only band when no single-value rule judges the field (F-010: diastolic BP)
            f["band"] = {side: cfg.limit(f[f"band_{side}"]).as_dict() if f.get(f"band_{side}") else None
                         for side in ("low", "high")}
        out.append(entry)
    return out


@router.get("/selftests")
async def selftests(request: Request, node: Node = "onboard") -> dict[str, Any]:
    """Self-test catalog: why / steps / normal band / escalation per test (config/selftests.yaml)."""
    rt = _rt(request)
    settings = {k: v.model_dump() for k, v in rt.cfg.selftests.settings.items()}
    return _envelope(rt, node, tests=_selftest_catalog(rt), settings=settings)


@router.get("/selftests/schedule")
async def selftest_schedule(request: Request, crew_id: str | None = None) -> dict[str, Any]:
    """Onboard: T-1 due / done / overdue per crew member for the current sim time. Overdue is INFO only."""
    rt = _rt(request)
    if crew_id is not None and crew_id not in rt.world.crew_ids:
        raise HTTPException(404, f"Unknown crew member '{crew_id}'")
    board = rt.world.selftest_schedule()
    if crew_id is not None:
        board = {crew_id: board[crew_id]}
    return _envelope(rt, "onboard", schedule=board)


@router.get("/selftests/results")
async def selftest_results(request: Request, crew_id: str | None = None) -> dict[str, Any]:
    """Onboard only: self-test results so far (crew-entered and scripted), oldest first. In memory only."""
    rt = _rt(request)
    if crew_id is not None and crew_id not in rt.world.crew_ids:
        raise HTTPException(404, f"Unknown crew member '{crew_id}'")
    return _envelope(rt, "onboard", results=rt.world.entries.results_for(crew_id))


def _body_map(rt: Runtime, node: str, crew_id: str) -> list[dict[str, Any]]:
    """T-6: regions with their linked signals (latest value, the last 2 h, source), rules and tests. The ground copy
    leaves out onboard-only signals and the single-signal rules and tests built on them (T-4)."""
    w, cfg = rt.world, rt.cfg
    store = w.ground.store if node == "ground" else w.store
    now = w.clock.now()
    rules = {r.id: r for r in cfg.rules}

    def onboard_only_rule(rule_id: str) -> bool:  # a compound reaches the ground with its onboard member redacted
        rule = rules[rule_id]
        return bool(rule.signal) and SIGNALS[str(rule.signal)].onboard_only

    out = []
    for region in cfg.selftests.body_map:
        signals = []
        for signal in region.signals:
            meta = SIGNALS[signal]
            if node == "ground" and meta.onboard_only:
                continue
            owner = crew_id if meta.scope == "crew" else None
            latest = store.latest(owner, signal)
            recent = store.points(owner, signal, now - timedelta(hours=2), now)
            stride = max(1, -(-len(recent) // 30))
            source = ((_snap(rt, node).get("provenance", {}).get(signal) or cfg.datasets.source(signal).as_dict())
                      if node == "ground" else w.source_for(signal, owner))
            signals.append({
                "signal": signal, "unit": meta.unit, "scope": meta.scope, "onboard_only": meta.onboard_only,
                "latest": {"ts": iso(latest[0]), "value": round(latest[1], 3)} if latest else None,
                "recent": [round(v, 3) for _, v in recent[::stride]], "source": source,
            })
        tests = [cfg.selftests.test(t) for t in region.tests]
        out.append({
            "id": region.id, "label": region.label, "what": region.what,
            "hazards": [h.value for h in region.hazards], "hrp_risks": [h.value for h in region.hrp_risks],
            "signals": signals,
            "rules": [{"id": r, "title": rules[r].title or r, "severity": rules[r].severity.value}
                      for r in region.rules if not (node == "ground" and onboard_only_rule(r))],
            "tests": [{"id": t.id, "title": t.title, "onboard_only": t.onboard_only}
                      for t in tests if not (node == "ground" and t.onboard_only)],
            "reference": region.reference,
        })
    return out


@router.get("/bodymap")
async def body_map(request: Request, crew_id: str, node: Node = "onboard") -> dict[str, Any]:
    """T-6 body map for one crew member: what each region does and what it links to (config/selftests.yaml).
    The UI colours each region from the open alerts of its rules; the map never diagnoses."""
    rt = _rt(request)
    if crew_id not in rt.world.crew_ids:
        raise HTTPException(404, f"Unknown crew member '{crew_id}'")
    return _envelope(rt, node, crew_id=crew_id, regions=_body_map(rt, node, crew_id))


# ---- countermeasures (Block C, PRD section 6 M5) ---------------------------------------------
def _crew_or_404(rt: Runtime, crew_id: str) -> None:
    if crew_id not in rt.world.crew_ids:
        raise HTTPException(404, f"Unknown crew member '{crew_id}'")


@router.get("/countermeasures")
async def countermeasures(request: Request, node: Node = "onboard") -> dict[str, Any]:
    """Countermeasure catalog: why / steps / equipment / prescription (resolved limits) per item."""
    rt = _rt(request)
    settings = {k: v.model_dump() for k, v in rt.cfg.countermeasures.settings.items()}
    return _envelope(rt, node, items=[resolved_item(rt.cfg, i) for i in rt.cfg.countermeasures.items],
                     settings=settings)


@router.get("/countermeasures/plan")
async def countermeasure_plan(request: Request, crew_id: str) -> dict[str, Any]:
    """Onboard: one crew member's countermeasures today. Neutral statuses (done / not logged), INFO at most, no %."""
    rt = _rt(request)
    _crew_or_404(rt, crew_id)
    return _envelope(rt, "onboard", crew_id=crew_id, plan=rt.world.countermeasure_plan(crew_id))


@router.get("/countermeasures/adherence")
async def countermeasure_adherence(request: Request, node: Node = "onboard",
                                   crew_id: str | None = None) -> dict[str, Any]:
    """C-2: last 7 days prescribed vs done per crew member, for the onboard CMO and the ground. Crew in the fixed
    C1..C4 order, one entry per person: no sorting by adherence, no crew average. The ground copy is the last rollup
    delivered through the link, and as_of / age_s say how old it is."""
    rt = _rt(request)
    w = rt.world
    if crew_id is not None:
        _crew_or_404(rt, crew_id)
    if node == "ground":
        data, as_of = w.ground.adherence, w.ground.adherence_as_of or w.start_ts
    else:
        data, as_of = w.adherence(), w.clock.now()
    crew = [c for c in data.get("crew", []) if crew_id in (None, c["crew_id"])]
    now = w.clock.now()
    return {"node": node, "now": iso(now), "as_of": iso(as_of), "age_s": (now - as_of).total_seconds(), "crew": crew}


@router.get("/countermeasures/log")
async def countermeasure_log(request: Request, crew_id: str | None = None) -> dict[str, Any]:
    """Onboard only: countermeasures logged as done (tablet taps and scripted sessions), oldest first. In memory."""
    rt = _rt(request)
    if crew_id is not None:
        _crew_or_404(rt, crew_id)
    return _envelope(rt, "onboard", sessions=rt.world.countermeasure_log.as_list(crew_id))


# ---- private journal: the copy shared with the onboard CMO (Block C, C-4) ------------------------
# Entries live in the crew tablet's local storage. Only an entry the crew member chose to share, after a preview and
# a confirm step, comes here: in memory only, never on disk, never in a link message, never on the ground.
JOURNAL_GROUND = "Journal entries stay on board: the ground never sees them."


class JournalShareBody(BaseModel):
    crew_id: str
    entry_id: str = Field(min_length=1, max_length=100)
    text: str = Field(min_length=1, max_length=10000)
    tags: list[str] = Field(default_factory=list, max_length=10)
    written_ts: str = Field(min_length=1, max_length=40)
    context: dict[str, Any] = Field(default_factory=dict)
    confirmed: bool = False  # the tablet sends true only after the preview and the confirm tap


def _no_ground(node: str) -> None:
    if node == "ground":
        raise HTTPException(403, JOURNAL_GROUND)


@router.get("/journal/shared")
async def journal_shared(request: Request, crew_id: str | None = None, node: Node = "onboard") -> dict[str, Any]:
    """Onboard CMO view: entries crew members chose to share. `?node=ground` is refused."""
    _no_ground(node)
    rt = _rt(request)
    if crew_id is not None:
        _crew_or_404(rt, crew_id)
    entries = [e for (cid, _), e in rt.world.journal_shared.items() if crew_id in (None, cid)]
    return _envelope(rt, "onboard", entries=sorted(entries, key=lambda e: (e["crew_id"], e["written_ts"])))


@router.post("/journal/shared")
async def journal_share(body: JournalShareBody, request: Request, node: Node = "onboard") -> dict[str, Any]:
    _no_ground(node)
    rt = _rt(request)
    _crew_or_404(rt, body.crew_id)
    if not body.confirmed:
        raise HTTPException(422, "Sharing needs the confirm step: preview the entry, then confirm.")
    return rt.world.share_journal(body.crew_id, body.entry_id, body.text, body.tags, body.written_ts, body.context)


@router.delete("/journal/shared/{crew_id}/{entry_id}")
async def journal_unshare(crew_id: str, entry_id: str, request: Request, node: Node = "onboard") -> dict[str, Any]:
    """Withdraws a shared copy; the entry stays on the tablet."""
    _no_ground(node)
    rt = _rt(request)
    _crew_or_404(rt, crew_id)
    return {"removed": rt.world.unshare_journal(crew_id, entry_id)}


# ---- ingest ----------------------------------------------------------------------------------
@router.post("/observations")
async def observations(items: list[Observation], request: Request) -> dict[str, int]:
    """Batch ingest, idempotent on Observation.id. Units must be canonical for the signal."""
    for obs in items:
        if obs.unit != SIGNALS[obs.signal.value].unit:
            raise HTTPException(422, f"{obs.signal.value}: unit must be '{SIGNALS[obs.signal.value].unit}'")
    world = _rt(request).world
    for obs in items:  # Block T: an entry names a real crew member and, if given, a catalog test
        if obs.crew_id is not None and SIGNALS[obs.signal.value].scope == "crew" and obs.crew_id not in world.crew_ids:
            raise HTTPException(422, f"Unknown crew member '{obs.crew_id}'")
        if obs.test_id is not None:
            try:
                test = world.cfg.selftests.test(obs.test_id)
            except KeyError as exc:
                raise HTTPException(422, str(exc)) from exc
            field = next((f for f in test.fields if f.signal == obs.signal.value), None)
            if field is None:
                raise HTTPException(422, f"{obs.signal.value} is not a field of self-test '{test.id}'")
            if test.kind == "stand_test" and world.sim.phase_cfg["gravity_g"] < test.params["min_gravity_g"]:
                raise HTTPException(422, f"{test.title} needs gravity (now {world.sim.phase_cfg['gravity_g']:g} g): "
                                         "in weightlessness standing does not load the circulation")
            if not field.input_min <= obs.value <= field.input_max:
                raise HTTPException(422, f"{field.label}: {obs.value:g} is outside {field.input_min:g}-"
                                         f"{field.input_max:g} {SIGNALS[field.signal].unit}; check the reading")
    for obs in items:  # Block C: a logged countermeasure names a catalog item and only its log signals
        if obs.countermeasure_id is None:
            if obs.signal.value in ("countermeasure_done", "exercise_minutes"):
                raise HTTPException(422, f"{obs.signal.value} needs a countermeasure_id")
            continue
        try:
            item = world.cfg.countermeasures.item(obs.countermeasure_id)
        except KeyError as exc:
            raise HTTPException(422, str(exc)) from exc
        if obs.test_id is not None or obs.crew_id is None:
            raise HTTPException(422, "A countermeasure entry names a crew member and no self-test")
        allowed = {"countermeasure_done": (1.0, 1.0)}
        if item.log_minutes:
            allowed["exercise_minutes"] = (1.0, item.minutes_max)
        if obs.signal.value not in allowed:
            raise HTTPException(422, f"{obs.signal.value} is not logged for countermeasure '{item.id}'")
        lo, hi = allowed[obs.signal.value]
        if not lo <= obs.value <= hi:
            raise HTTPException(422, f"{item.title}: {obs.value:g} is outside {lo:g}-{hi:g} {obs.unit}")
    for obs in items:  # P-0: the label must match who measured the dataset
        meta = world.provenance.registry.dataset_meta(obs.dataset_id)
        if meta:
            try:
                check_agency(obs.provenance, meta["agency"], obs.dataset_id)
            except ValueError as exc:
                raise HTTPException(422, str(exc)) from exc
    accepted, duplicates = world.ingest_observations(items)
    return {"accepted": accepted, "duplicates": duplicates}
