"""T-1 routine schedule: due / done / overdue per crew member from the simulation clock (PRD section 6 M11).

Slots repeat every `every` at time of day `at` (UTC, sim clock), anchored on the scenario start day. A slot is DUE for
`due_window`, then OVERDUE until the next slot. OVERDUE is a neutral INFO item: it never raises an alert, never
changes readiness and is never counted or scored (no gamification, user decision). Slots before the scenario start
are not tracked, so the board starts clean (UPCOMING). A gravity increase adds the tests marked
`after_gravity_increase`, due for `after_gravity_window` from the moment of the increase.

Pure function of (catalog, results, start, now, transition): the same scenario + seed gives the same board.
"""

from datetime import datetime, timedelta
from typing import Any

from app.selftests.catalog import Catalog, SelfTest
from app.util import iso, parse_duration

DUE, DONE, OVERDUE, UPCOMING = "DUE", "DONE", "OVERDUE", "UPCOMING"


def _anchor(start: datetime, at: str) -> datetime:
    hh, mm = (int(x) for x in at.split(":"))
    return start.replace(hour=hh, minute=mm, second=0, microsecond=0)


def _done_since(results: list[dict[str, Any]], test_id: str, crew_id: str, since: datetime,
                now: datetime) -> dict[str, Any] | None:
    hits = [r for r in results
            if r["test_id"] == test_id and r["crew_id"] == crew_id and since <= datetime.fromisoformat(
                r["ts"].replace("Z", "+00:00")) <= now]
    return hits[-1] if hits else None


def _item(test: SelfTest, reason: str, status: str, slot_start: datetime | None, due_until: datetime | None,
          next_due: datetime | None, done: dict[str, Any] | None) -> dict[str, Any]:
    return {
        "test_id": test.id, "title": test.title, "kind": test.kind, "hazards": [h.value for h in test.hazards],
        "reason": reason, "status": status,
        # OVERDUE is information only (INFO); the other states carry no level at all.
        "level": "INFO" if status == OVERDUE else None,
        "slot_start": iso(slot_start) if slot_start else None, "due_until": iso(due_until) if due_until else None,
        "next_due": iso(next_due) if next_due else None,
        "done_ts": done["ts"] if done else None, "done_provenance": done["provenance"] if done else None,
    }


def routine_item(test: SelfTest, crew_id: str, results: list[dict[str, Any]], start: datetime,
                 now: datetime) -> dict[str, Any] | None:
    sched = test.schedule
    if sched is None:
        return None
    every, window = parse_duration(sched.every), parse_duration(sched.due_window)
    anchor = _anchor(start, sched.at)
    k = (now - anchor) // every  # floor division of timedeltas -> int (negative before the first slot)
    slot = anchor + k * every
    if slot < start:  # the routine starts at the scenario start; earlier slots are not tracked
        return _item(test, "routine", UPCOMING, None, None, slot + every, None)
    done = _done_since(results, test.id, crew_id, slot, now)
    if done:
        status = DONE
    elif now < slot + window:
        status = DUE
    else:
        status = OVERDUE
    return _item(test, "routine", status, slot, slot + window, slot + every, done)


def gravity_item(test: SelfTest, crew_id: str, results: list[dict[str, Any]], transition_ts: datetime,
                 window: timedelta, now: datetime) -> dict[str, Any]:
    done = _done_since(results, test.id, crew_id, transition_ts, now)
    status = DONE if done else (DUE if now < transition_ts + window else OVERDUE)
    return _item(test, "after gravity increase", status, transition_ts, transition_ts + window, None, done)


ORDER = {DUE: 0, OVERDUE: 1, DONE: 2, UPCOMING: 3}


def build_schedule(catalog: Catalog, results: list[dict[str, Any]], crew_ids: list[str], start: datetime,
                   now: datetime, transition_ts: datetime | None) -> dict[str, list[dict[str, Any]]]:
    window = parse_duration(catalog.setting("after_gravity_window"))
    out: dict[str, list[dict[str, Any]]] = {}
    for crew_id in crew_ids:
        items: list[dict[str, Any]] = []
        if transition_ts is not None and start <= transition_ts <= now:
            items += [gravity_item(t, crew_id, results, transition_ts, window, now)
                      for t in catalog.tests if t.after_gravity_increase]
        items += [i for t in catalog.tests if (i := routine_item(t, crew_id, results, start, now)) is not None]
        out[crew_id] = sorted(items, key=lambda i: (ORDER[i["status"]], i["due_until"] or i["next_due"] or ""))
    return out
