"""Block C: countermeasures, weekly adherence and the CMO-only journal copy (ROADMAP section 0b, AGENTS.md 2c)."""

import builtins
import json
import re
import shutil
from datetime import timedelta
from pathlib import Path

import pytest
import yaml
from fastapi.testclient import TestClient

from app.config import CONFIG_DIR, Config
from app.db.store import SeriesStore
from app.main import create_app
from app.rules.engine import RuleEngine
from app.util import iso
from app.world import World
from tests.conftest import T0, run

ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture
def client():
    app = create_app(run_loop=False)
    with TestClient(app) as c:
        c.rt = app.state.rt
        yield c


def tap(client, crew_id, cm_id, minutes=None, n=0, **extra):
    """A Done tap on the tablet: countermeasure_done = 1 (+ exercise_minutes), CREW_ENTERED, entry method tap."""
    w = client.rt.world
    ts = iso(w.clock.now())
    obs = [{"id": f"cm-{crew_id}-{cm_id}-{ts}-{n}", "ts": ts, "crew_id": crew_id, "device_id": f"tablet-{crew_id}",
            "signal": "countermeasure_done", "value": 1, "unit": "1=done", "provenance": "CREW_ENTERED",
            "entry_method": "tap", "countermeasure_id": cm_id, **extra}]
    if minutes is not None:
        obs.append({**obs[0], "id": f"{obs[0]['id']}-min", "signal": "exercise_minutes", "value": minutes,
                    "unit": "min"})
    return client.post("/api/v1/observations", json=obs)


def plan(client, crew_id):
    return {i["countermeasure_id"]: i for i in client.get(f"/api/v1/countermeasures/plan?crew_id={crew_id}").json()["plan"]}


def tick(world, n=1):
    for _ in range(n):
        world.tick()


# ---- C-0: catalog --------------------------------------------------------------------------------------------------
def test_every_item_explains_itself(cfg):
    for item in cfg.countermeasures.items:
        assert item.why and item.steps and item.hazards and item.hrp_risks and item.equipment and item.escalation
        for p in item.prescription:
            limit = cfg.limit(p.limit_ref)
            assert limit.source_ref and (limit.verified or limit.source_kind)


def test_steps_never_wait_for_the_ground(cfg):
    """Supervisor note 3: onboard steps only; the CMO is the first contact, never the ground."""
    for item in cfg.countermeasures.items:
        for text in [*item.steps, item.escalation]:
            assert not re.search(r"\b(ask|call|wait for|contact) (the )?ground\b", text, re.I), (item.id, text)
        assert "CMO" in item.escalation


@pytest.mark.parametrize("change, message", [
    (lambda i: i.update(hazards=[]), "hazards"),
    (lambda i: i.update(hrp_risks=[]), "hrp_risks"),
    (lambda i: i["prescription"][0].update(limit_ref="countermeasures.nope"), "Unknown limit_ref"),
    (lambda i: i.update(triggered_by=["no.such.rule"]), "unknown rule"),
])
def test_loader_refuses_bad_items(tmp_path, change, message):
    shutil.copytree(CONFIG_DIR, tmp_path / "config")
    path = tmp_path / "config" / "countermeasures.yaml"
    data = yaml.safe_load(path.read_text(encoding="utf-8"))
    change(data["items"][0])
    path.write_text(yaml.safe_dump(data), encoding="utf-8")
    with pytest.raises(ValueError, match=message):
        Config(tmp_path / "config")


def test_catalog_endpoint_resolves_prescriptions(client):
    items = client.get("/api/v1/countermeasures").json()["items"]
    fluid = next(i for i in items if i["id"] == "fluid_daily")
    water = fluid["prescription"][0]
    assert water["ref"] == "nutrition.fluid_intake_mL_day_min" and water["verified"] and water["value"] == 2500
    ex = next(i for i in items if i["id"] == "exercise_resistance")
    assert all(not p["verified"] and p["source_kind"] for p in ex["prescription"])


# ---- C-0: logging --------------------------------------------------------------------------------------------------
def test_tapped_session_is_crew_entered_and_on_the_plan(client):
    w = client.rt.world
    res = tap(client, "C3", "exercise_aerobic", minutes=50, n=1)
    assert res.json() == {"accepted": 2, "duplicates": 0}
    session = w.countermeasure_log.on("C3", "exercise_aerobic", w.clock.now().date())[-1]
    assert session.provenance == "CREW_ENTERED" and session.minutes == 50
    item = plan(client, "C3")["exercise_aerobic"]
    assert item["status"] == "DONE" and item["done_provenance"] == "CREW_ENTERED" and item["done_minutes"] == 50


@pytest.mark.parametrize("extra, why", [
    ({"countermeasure_id": "no_such_item"}, "Unknown countermeasure"),
    ({"value": 2}, "outside"),
    ({"test_id": "intake"}, "self-test"),
])
def test_bad_countermeasure_entries_are_refused(client, extra, why):
    res = tap(client, "C1", "exercise_resistance", **extra)
    assert res.status_code == 422 and why in res.json()["detail"]


def test_minutes_only_for_exercise_and_log_signals_need_an_item(client):
    res = tap(client, "C1", "thigh_cuff", minutes=30)
    assert res.status_code == 422 and "not logged" in res.json()["detail"]
    w = client.rt.world
    bare = {"id": "bare-1", "ts": iso(w.clock.now()), "crew_id": "C1", "device_id": "tablet-C1",
            "signal": "countermeasure_done", "value": 1, "unit": "1=done", "provenance": "CREW_ENTERED",
            "entry_method": "tap"}
    res = client.post("/api/v1/observations", json=[bare])
    assert res.status_code == 422 and "needs a countermeasure_id" in res.json()["detail"]


def test_scripted_session_stays_synthetic(cfg):
    w = run(cfg, "exercise_lapse", 1)
    sessions = w.countermeasure_log.as_list("C3")
    assert sessions and all(s["provenance"] == "SYNTHETIC" for s in sessions)
    assert sessions[0]["minutes"] == 45 and "Scripted" in sessions[0]["basis"]


def test_logging_works_with_the_link_blacked_out(client):
    w = client.rt.world
    client.post("/api/v1/link/blackout", json={"on": True})
    tick(w, 3)
    assert tap(client, "C4", "exercise_resistance", minutes=60).json()["accepted"] == 2
    assert plan(client, "C4")["exercise_resistance"]["status"] == "DONE"


def test_a_logged_session_counts_in_the_daily_adherence(cfg):
    """The simulator's daily exercise_adherence_pct counts sessions logged as done (adherence is derived)."""
    w = World(cfg, "nominal")
    day = w.clock.now().date()
    c3 = next(c for c in w.sim.crew if c.id == "C3")
    before = w.sim._adherence_pct(c3, w.start_ts.replace(hour=0, minute=0))
    missed = [i for i in range(2) if not w.sim.session_done("C3", day, i)]
    if not missed:
        pytest.skip("seed 42 has C3 do both sessions today")
    item = cfg.countermeasures.for_session(missed[0])
    w._scripted_countermeasure(w.clock.now(), {"crew": "C3", "item": item.id})
    after = w.sim._adherence_pct(c3, w.start_ts.replace(hour=0, minute=0))
    assert after == before + 50.0


# ---- C-1: today's plan on the routine board ------------------------------------------------------------------------
def test_same_scenario_and_seed_give_the_same_plan(cfg):
    a, b = run(cfg, "nominal", 2), run(cfg, "nominal", 2)
    assert [a.countermeasure_plan(c) for c in a.crew_ids] == [b.countermeasure_plan(c) for c in b.crew_ids]


def test_an_alert_adds_its_item_and_the_item_leaves_when_it_resolves(client):
    w = client.rt.world
    assert "fluid_loading" not in plan(client, "C2")
    entry = {"ts": iso(w.clock.now()), "crew_id": "C2", "device_id": "tablet-C2", "signal": "fluid_intake",
             "unit": "mL", "provenance": "CREW_ENTERED", "entry_method": "form", "test_id": "intake"}
    client.post("/api/v1/observations", json=[{**entry, "id": "fl-1", "value": 1000}])
    tick(w)
    item = plan(client, "C2")["fluid_loading"]
    assert item["reason"] == "added" and item["added_because"] == ["Fluid intake low"] and item["status"] == "DUE"
    tick(w)
    client.post("/api/v1/observations", json=[{**entry, "id": "fl-2", "ts": iso(w.clock.now()), "value": 3000}])
    tick(w)
    assert "fluid_loading" not in plan(client, "C2")


def test_a_landing_hold_adds_fluid_loading(cfg):
    w = run(cfg, "orthostatic_intolerance", 0.3)  # C3 holds before the Mars landing (scripted low fluid)
    items = {i["countermeasure_id"]: i for i in w.countermeasure_plan("C3")}
    assert w.snapshot["readiness"]["C3"]["LANDING"]["go"] is False
    assert "Landing readiness gate on Hold" in items["fluid_loading"]["added_because"]


def test_not_logged_is_never_above_info(cfg):
    w = run(cfg, "nominal", 4)
    statuses = set()
    for cid in w.crew_ids:
        for item in w.countermeasure_plan(cid):
            statuses.add(item["status"])
            assert item["level"] in (None, "INFO")
            assert (item["level"] == "INFO") == (item["status"] == "NOT_LOGGED")
    assert statuses <= {"DONE", "DUE", "NOT_LOGGED", "UPCOMING"}
    assert not any(a.rule_id.startswith("cm.") for a in w.alerts.alerts.values())


def test_plan_has_no_percent_or_score(client):
    for cid in ("C1", "C3"):
        body = json.dumps(client.get(f"/api/v1/countermeasures/plan?crew_id={cid}").json()["plan"])
        assert not re.search(r'"(pct|percent|score|rank|points?)"', body)


# ---- C-2: weekly adherence for the CMO and the ground --------------------------------------------------------------
def test_adherence_is_per_person_in_fixed_order_without_average(client):
    body = client.get("/api/v1/countermeasures/adherence").json()
    assert [c["crew_id"] for c in body["crew"]] == ["C1", "C2", "C3", "C4"]
    assert not re.search(r'"(average|mean|rank|best|worst|crew_pct)"', json.dumps(body))
    c3 = body["crew"][2]
    assert len(c3["days"]) == 7 and c3["totals"]["EXERCISE"]["prescribed"] >= 12
    assert c3["bone_model"]["provenance"] == "SYNTHETIC"


def _missed_exercise(world):
    """A crew member and exercise item whose slot today has passed and that the simulator did not do."""
    for cid in world.crew_ids:
        for item in world.countermeasure_plan(cid):
            if item["type"] == "EXERCISE" and item["status"] in ("DUE", "NOT_LOGGED"):
                return cid, item["countermeasure_id"]
    return None


def test_ground_sees_adherence_only_after_the_link_delay(client):
    w = client.rt.world
    client.post("/api/v1/link/delay", json={"delay_s": 600})
    missed = _missed_exercise(w)
    if missed is None:
        pytest.skip("no missed session at the start of nominal")
    cid, cm_id = missed
    idx = w.crew_ids.index(cid)

    def done(node):
        return client.get(f"/api/v1/countermeasures/adherence?node={node}").json()["crew"][idx]["totals"]["EXERCISE"]["done"]

    ground_before = done("ground")
    tap(client, cid, cm_id, minutes=60)
    assert done("onboard") == ground_before + 1 and done("ground") == ground_before
    tick(w, 60)  # the hourly rollup is sent now
    sent = w.clock.now()
    tick(w, 9)
    assert done("ground") == ground_before  # still in flight
    tick(w, 2)
    assert done("ground") == ground_before + 1
    body = client.get("/api/v1/countermeasures/adherence?node=ground").json()
    assert body["as_of"] == iso(sent) and body["age_s"] > 0


def test_blackout_holds_the_ground_adherence(cfg):
    w = World(cfg, "nominal")
    w.link.blackout = True
    tick(w, 130)
    assert w.ground.adherence_as_of == w.start_ts
    w.link.blackout = False
    tick(w, 2 + int(w.delay_s // 60))
    assert w.ground.adherence_as_of > w.start_ts


# ---- C-3: early-warning rule ---------------------------------------------------------------------------------------
def _engine(cfg, values):
    store = SeriesStore()
    for k, v in enumerate(values):  # one daily point, oldest first, the last one at T0
        store.add("C3", "exercise_adherence_pct", T0 - timedelta(days=len(values) - 1 - k), v)
    rule = next(r for r in cfg.rules if r.id == "cm.exercise.low_7d")
    return RuleEngine([rule], cfg, store, ["C3"]), store


def _fires(engine, now=T0):
    return next(f for f in engine.evaluate(now) if f.crew_id == "C3")


def test_low_7d_fires_and_does_not_fire(cfg):
    engine, _ = _engine(cfg, [50, 0, 50, 0, 0, 50, 0])  # mean 21 %
    f = _fires(engine)
    assert f.firing and f.rule.severity.value == "INFO" and f.evidence["window"] == "7d"
    assert f.evidence["provenance"] and f.evidence["limit_source_kind"] == "design"
    engine, _ = _engine(cfg, [100, 50, 100, 50, 50, 100, 50])
    assert not _fires(engine).firing


def test_low_7d_hysteresis(cfg):
    engine, store = _engine(cfg, [0, 0, 50, 50, 50, 50, 50])  # mean 35.7
    assert _fires(engine).firing
    store.add("C3", "exercise_adherence_pct", T0 + timedelta(days=1), 55)  # window [0, 50 x 5, 55]: mean 43.6
    f = _fires(engine, T0 + timedelta(days=1))
    assert f.firing and f.evidence.get("hysteresis_hold")  # over 40 %, but not past 44 % (clear_margin 0.1)
    store.add("C3", "exercise_adherence_pct", T0 + timedelta(days=2), 100)  # window [50 x 5, 55, 100]: mean 57.9
    assert not _fires(engine, T0 + timedelta(days=2)).firing


def test_exercise_lapse_trips_only_c3(cfg):
    w = run(cfg, "exercise_lapse", 1)
    hits = [a for a in w.alerts.alerts.values() if a.rule_id == "cm.exercise.low_7d"]
    assert [a.crew_id for a in hits] == ["C3"] and hits[0].severity.value == "INFO"
    assert hits[0].evidence["provenance"]


def test_bone_model_line_is_simulated(cfg):
    w = World(cfg, "nominal")
    c3 = next(c for c in w.adherence()["crew"] if c["crew_id"] == "C3")
    bone = c3["bone_model"]
    assert bone["pct_month_with_exercise"] < bone["pct_month_without_exercise"]
    assert bone["provenance"] == "SYNTHETIC" and "Simulated" in bone["basis"]


# ---- C-4: the journal copy shared with the onboard CMO -------------------------------------------------------------
SECRET = "Missing home today; argued with C2 about the schedule."


def share(client, confirmed=True, node="onboard", entry_id="j-1"):
    body = {"crew_id": "C4", "entry_id": entry_id, "text": SECRET, "tags": ["homesick"],
            "written_ts": iso(client.rt.world.clock.now()), "context": {"phase": "MARS_TRANSIT"},
            "confirmed": confirmed}
    return client.post(f"/api/v1/journal/shared?node={node}", json=body)


def test_share_needs_the_confirm_step(client):
    res = share(client, confirmed=False)
    assert res.status_code == 422 and "confirm" in res.json()["detail"]
    assert client.rt.world.journal_shared == {}


def test_ground_is_refused(client):
    assert share(client, node="ground").status_code == 403
    assert client.get("/api/v1/journal/shared?node=ground").status_code == 403
    assert client.delete("/api/v1/journal/shared/C4/j-1?node=ground").status_code == 403


def test_shared_copy_is_onboard_and_can_be_withdrawn(client):
    assert share(client).status_code == 200
    entries = client.get("/api/v1/journal/shared?crew_id=C4").json()["entries"]
    assert [e["text"] for e in entries] == [SECRET]
    assert client.delete("/api/v1/journal/shared/C4/j-1").json() == {"removed": True}
    assert client.get("/api/v1/journal/shared").json()["entries"] == []


def test_journal_never_reaches_the_link_or_the_ground(client):
    w = client.rt.world
    sent = []
    original = w.link.send

    def spy(*args, **kwargs):
        msg = original(*args, **kwargs)
        sent.append(json.dumps(msg.payload))
        return msg

    w.link.send = spy
    share(client)
    client.post("/api/v1/link/blackout", json={"on": True})
    tick(w, 70)
    client.post("/api/v1/link/blackout", json={"on": False})
    tick(w, 70)
    assert sent and not any(SECRET in p or "homesick" in p for p in sent)
    ground = json.dumps({"snap": w.ground.snapshot, "alerts": w.ground.alerts, "adh": w.ground.adherence},
                        default=str)
    assert SECRET not in ground and "journal" not in ground


def test_backend_never_writes_the_journal_to_disk(client, monkeypatch):
    real_open = builtins.open

    def guarded(file, mode="r", *args, **kwargs):
        if any(m in mode for m in "wax+"):
            raise AssertionError(f"write to {file}")
        return real_open(file, mode, *args, **kwargs)

    monkeypatch.setattr(builtins, "open", guarded)
    monkeypatch.setattr(Path, "write_text", lambda *a, **k: (_ for _ in ()).throw(AssertionError("write_text")))
    assert share(client, entry_id="j-disk").status_code == 200
    assert client.delete("/api/v1/journal/shared/C4/j-disk").status_code == 200


def test_no_sentiment_or_keyword_code_reads_the_journal():
    """No rule, score or analysis reads journal text (ROADMAP 0b.2 rule 4)."""
    backend = [p for p in (ROOT / "backend" / "app").rglob("*.py")]
    for path in backend:
        text = path.read_text(encoding="utf-8")
        assert not re.search(r"sentiment|polarity|vader|textblob", text, re.I), path.name
        if path.name not in ("world.py", "routes.py"):
            assert "journal_shared" not in text, path.name
    rules = (ROOT / "config" / "rules.yaml").read_text(encoding="utf-8")
    assert "journal" not in rules


# ---- no ranking anywhere in Block C copy ---------------------------------------------------------------------------
RANKING = re.compile(r"\b(rank(ed|ing)?|top|best|worst|ahead of|behind|leaderboards?|points?|streaks?|level[- ]up)\b",
                     re.I)


def test_no_ranking_or_comparison_wording_in_block_c_copy():
    files = [ROOT / "config" / "countermeasures.yaml",
             *[p for p in (ROOT / "frontend" / "src" / "components").glob("*.tsx")
               if p.stem in ("CountermeasurePlan", "AdherenceChart", "Journal", "SharedJournal")],
             ROOT / "frontend" / "src" / "views" / "Journal.tsx"]
    for path in files:
        if not path.exists():
            continue
        for n, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            stripped = line.strip()
            if "data-testid" in line or "className" in line or stripped.startswith(("#", "//", "*", "/*", "{/*")):
                continue
            shown = line if path.suffix == ".yaml" else " ".join(
                [m[1] for m in re.findall(r"(['\"`])(.*?)\1", line)] + re.findall(r">([^<>{}]+)<", line))
            assert not RANKING.search(shown), f"{path.name}:{n}: {stripped}"
