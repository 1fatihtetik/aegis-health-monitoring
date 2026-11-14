"""Readiness scores (PRD M3): transparent weighted formulas with inspectable components.

Component score: 100 at `good`, 50 at the configured limit, linear, clamped to 0-100.
Score = weighted mean of components - penalty for each open alert on the crew member.
"""

from datetime import datetime
from typing import Any

from app.config import Config
from app.db.store import SeriesStore
from app.domain.enums import SIGNALS
from app.domain.models import Alert
from app.rules.engine import AGGS
from app.util import parse_duration

FORMULA = "component = 100 at good, 50 at limit, linear, clamped 0-100; score = weighted mean - alert penalties"


def compute_readiness(
    cfg: Config, store: SeriesStore, open_alerts: list[Alert], crew_ids: list[str], now: datetime
) -> dict[str, dict[str, Any]]:
    penalties: dict[str, float] = cfg.readiness["alert_penalty"]
    out: dict[str, dict[str, Any]] = {}
    for cid in crew_ids:
        mine = [a for a in open_alerts if a.crew_id in (None, cid)]
        penalty = sum(penalties.get(a.severity.value, 0) for a in mine)
        out[cid] = {}
        for kind, spec in cfg.readiness["kinds"].items():
            components: dict[str, Any] = {}
            total, weight_sum = 0.0, 0.0
            for name, comp in spec["components"].items():
                signal = comp["signal"]
                subject = cid if SIGNALS[signal].scope == "crew" else None
                values = store.window(subject, signal, now - parse_duration(comp["window"]))
                limit = cfg.limit(comp["limit_ref"])
                if not values:
                    components[name] = {"signal": signal, "value": None, "score": None, "weight": comp["weight"]}
                    continue
                value = AGGS[comp["agg"]](values)
                span = limit.value - comp["good"]
                score = max(0.0, min(100.0, 100 - 50 * (value - comp["good"]) / span))
                total += score * comp["weight"]
                weight_sum += comp["weight"]
                components[name] = {
                    "signal": signal, "value": round(value, 2), "unit": SIGNALS[signal].unit,
                    "good": comp["good"], "limit": limit.value, "limit_ref": limit.ref,
                    "limit_verified": limit.verified, "limit_source_ref": limit.source_ref,
                    "window": comp["window"], "score": round(score, 1), "weight": comp["weight"],
                }
            base = total / weight_sum if weight_sum else 0.0
            entry: dict[str, Any] = {
                "value": round(max(0.0, min(100.0, base - penalty)), 1),
                "base": round(base, 1),
                "alert_penalty": penalty,
                "alert_ids": [a.id for a in mine],
                "components": components,
                "hazards": spec["hazards"],
                "hrp_risks": spec["hrp_risks"],
                "formula": FORMULA,
            }
            if "go_min_ref" in spec:
                go = cfg.limit(spec["go_min_ref"])
                entry |= {"go": entry["value"] >= go.value, "go_min": go.value, "go_min_verified": go.verified}
            out[cid][kind] = entry
    return out
