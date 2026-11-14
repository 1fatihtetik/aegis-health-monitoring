"""Rules engine (PRD M3): THRESHOLD, BASELINE, CUMULATIVE, COMPOUND.

Every result carries its evidence: signal, value, limit, limit source, window. No black-box scores.
Hysteresis: once a condition is active, the value must recover past the limit by `clear_margin`.
"""

import operator
import statistics
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from app.config import Config
from app.datasets.provenance import weakest
from app.db.store import SeriesStore
from app.domain.enums import SIGNALS, RuleType
from app.rules.models import Predicate, Rule
from app.util import parse_duration

OPS = {">": operator.gt, "<": operator.lt, ">=": operator.ge, "<=": operator.le}
AGGS = {"mean": statistics.fmean, "min": min, "max": max, "last": lambda v: v[0]}
BASELINE_MIN_SAMPLES = 100
BASELINE_REFRESH_TICKS = 60

Subject = str | None
Result = tuple[bool, dict[str, Any] | None]
ProvenanceLookup = Callable[[str, Subject], dict[str, Any]]
OverrideLookup = Callable[[Subject, str, datetime], list[float] | None]


def _no_provenance(_: str, __: Subject = None) -> dict[str, Any]:
    return {"provenance": "SYNTHETIC", "dataset_id": None}


def _no_override(_: Subject, __: str, ___: datetime) -> list[float] | None:
    return None


@dataclass
class Finding:
    rule: Rule
    crew_id: Subject
    firing: bool
    evidence: dict[str, Any]


class RuleEngine:
    def __init__(
        self, rules: list[Rule], cfg: Config, store: SeriesStore, crew_ids: list[str], tick_s: float = 60
    ) -> None:
        self.rules = rules
        self.cfg = cfg
        self.store = store
        self.crew_ids = crew_ids
        self.tick_h = tick_s / 3600
        self._by_id = {r.id: r for r in rules}
        self._active: dict[tuple[str, Subject], bool] = {}
        self._baseline: dict[tuple[str, Subject], tuple[int, float, float]] = {}
        self._ticks = 0
        self.provenance: ProvenanceLookup = _no_provenance  # World sets the live lookup (per signal and crew)
        # Block T: hand-measured values that replace the wearable stream for (crew, signal) right now, or None
        self.override: OverrideLookup = _no_override

    def scope(self, rule: Rule) -> str:
        if rule.type != RuleType.COMPOUND:
            return SIGNALS[str(rule.signal)].scope
        for m in rule.members:
            s = self.scope(self._by_id[m]) if isinstance(m, str) else SIGNALS[str(m.signal)].scope
            if s == "crew":
                return "crew"
        return "cabin"

    def _subjects(self, rule: Rule) -> list[Subject]:
        return list(self.crew_ids) if self.scope(rule) == "crew" else [None]

    @staticmethod
    def _mark_hold(evidence: dict[str, Any], firing: bool, op: str, value: float, limit: float) -> dict[str, Any]:
        """Flags evidence that is still firing only because of hysteresis (value back inside the limit)."""
        if firing and not OPS[op](value, limit):
            evidence["hysteresis_hold"] = True
        return evidence

    def _compare(self, key: tuple[str, Subject], op: str, value: float, limit: float, margin: float) -> bool:
        threshold = limit
        if self._active.get(key, False):
            threshold = limit * (1 - margin) if op in (">", ">=") else limit * (1 + margin)
        firing = bool(OPS[op](value, threshold))
        self._active[key] = firing
        return firing

    def _evidence(self, spec: Rule | Predicate, value: float, agg: str, unit: str | None = None,
                  subject: Subject = None) -> dict[str, Any]:
        limit = self.cfg.limit(str(spec.limit_ref))
        return {
            "signal": str(spec.signal),
            "value": round(value, 3),
            "unit": unit or SIGNALS[str(spec.signal)].unit,
            "op": spec.op,
            "limit": limit.value,
            "limit_ref": limit.ref,
            "limit_verified": limit.verified,
            "limit_source_ref": limit.source_ref,
            "window": spec.window,
            "agg": agg,
            **self._source(str(spec.signal), subject),
        }

    def _source(self, signal: str, subject: Subject = None) -> dict[str, Any]:
        subj = subject if SIGNALS[signal].scope == "crew" else None
        src = self.provenance(signal, subj)
        return {"provenance": src["provenance"], "dataset_id": src["dataset_id"], "basis": src.get("basis", ""),
                "dataset": src.get("dataset")}

    def _values(self, spec: Rule | Predicate, subject: Subject, window: str, now: datetime) -> list[float]:
        subj = subject if SIGNALS[str(spec.signal)].scope == "crew" else None
        manual = self.override(subj, str(spec.signal), now)
        if manual is not None:  # Block T: the hand measurement replaces the wearable stream (selftests.yaml setting)
            return manual
        return self.store.window(subj, str(spec.signal), now - parse_duration(window))

    def _threshold(self, key: tuple[str, Subject], spec: Rule | Predicate, subject: Subject, now: datetime,
                   margin: float) -> Result:
        values = self._values(spec, subject, spec.window, now)
        if not values:
            self._active[key] = False
            return False, None
        value = AGGS[spec.agg](values)
        limit = self.cfg.limit(str(spec.limit_ref)).value
        firing = self._compare(key, spec.op, value, limit, margin)
        evidence = self._evidence(spec, value, spec.agg, subject=subject)
        return firing, self._mark_hold(evidence, firing, spec.op, value, limit)

    def _baseline_rule(self, key: tuple[str, Subject], rule: Rule, subject: Subject, now: datetime) -> Result:
        recent = self._values(rule, subject, rule.window, now)
        cached = self._baseline.get(key)
        if cached is None or self._ticks - cached[0] >= BASELINE_REFRESH_TICKS:
            history = self._values(rule, subject, rule.baseline_window, now)
            if len(history) < BASELINE_MIN_SAMPLES:
                self._active[key] = False
                return False, None
            cached = (self._ticks, statistics.fmean(history), statistics.pstdev(history))
            self._baseline[key] = cached
        _, mean, sd = cached
        if not recent or sd <= 0:
            self._active[key] = False
            return False, None
        current = statistics.fmean(recent)
        z = (current - mean) / sd
        evidence = self._evidence(rule, z, "z_score", unit="z", subject=subject)
        evidence |= {
            "current": round(current, 3),
            "baseline_mean": round(mean, 3),
            "baseline_sd": round(sd, 3),
            "baseline_window": rule.baseline_window,
            "signal_unit": SIGNALS[str(rule.signal)].unit,
        }
        limit = self.cfg.limit(str(rule.limit_ref)).value
        firing = self._compare(key, rule.op, z, limit, rule.clear_margin)
        return firing, self._mark_hold(evidence, firing, rule.op, z, limit)

    def _cumulative(self, key: tuple[str, Subject], rule: Rule, subject: Subject, now: datetime) -> Result:
        values = self._values(rule, subject, rule.window, now)
        if not values:
            self._active[key] = False
            return False, None
        total = sum(values) * self.tick_h * rule.scale
        limit = self.cfg.limit(str(rule.limit_ref)).value
        firing = self._compare(key, rule.op, total, limit, rule.clear_margin)
        evidence = self._evidence(rule, total, "integral", unit=rule.unit, subject=subject)
        return firing, self._mark_hold(evidence, firing, rule.op, total, limit)

    def _compound(self, rule: Rule, subject: Subject, now: datetime, results: dict[tuple[str, Subject], Result]) -> Result:
        def member(i: int, m: str | Predicate) -> tuple[bool, dict[str, Any]]:
            if isinstance(m, str):
                ref = self._by_id[m]
                firing, ev = results.get((m, subject if self.scope(ref) == "crew" else None), (False, None))
                # F-011: name the member's signal even before it has data, so the evidence (and its redaction on
                # downlink) has the same shape whether or not a value was ever entered
                base = {"signal": str(ref.signal)} if ref.signal is not None and not ev else {}
                return firing, {"rule_id": m, "firing": firing, **base, **(ev or {})}
            firing, ev = self._threshold((f"{rule.id}#{i}", subject), m, subject, now, rule.clear_margin)
            return firing, {"firing": firing, **(ev or {"signal": str(m.signal)})}

        n_all, n_any = len(rule.all), len(rule.any)
        all_m = [member(i, m) for i, m in enumerate(rule.all)]
        any_m = [member(n_all + i, m) for i, m in enumerate(rule.any)]
        none_m = [member(n_all + n_any + i, m) for i, m in enumerate(rule.none)]
        for _, ev in none_m:
            ev["negated"] = True
        firing = (
            all(f for f, _ in all_m)
            and (not any_m or any(f for f, _ in any_m))
            and not any(f for f, _ in none_m)
        )
        members = [ev for _, ev in [*all_m, *any_m, *none_m]]
        satisfied = sum(f for f, _ in all_m) + (1 if any(f for f, _ in any_m) else 0) + sum(not f for f, _ in none_m)
        evidence: dict[str, Any] = {
            "signal": "compound",
            "logic": {"all": len(all_m), "any": len(any_m), "none": len(none_m)},
            "value": satisfied,
            "limit": len(all_m) + (1 if any_m else 0) + len(none_m),
            "limit_verified": all(m.get("limit_verified", False) for m in members),
            "window": "see members",
            "members": members,
            "provenance": weakest([m.get("provenance", "SYNTHETIC") for m in members]),
            "dataset_id": None,
        }
        if rule.context:
            evidence["context"] = {"group": rule.context, "branch": rule.branch}
        return firing, evidence

    def _apply_unless(self, key: tuple[str, Subject], rule: Rule, subject: Subject, now: datetime,
                      result: Result) -> Result:
        """P-1: a simple rule stands down while any `unless` predicate holds (e.g. the SPE dose-rate rule while the
        ISS crosses the South Atlantic Anomaly). The evidence says why, so a stood-down rule is never silent."""
        firing, evidence = result
        held: list[dict[str, Any]] = []
        for i, pred in enumerate(rule.unless):
            values = self._values(pred, subject, pred.window, now)
            if not values:
                continue
            value = AGGS[pred.agg](values)
            limit = self.cfg.limit(str(pred.limit_ref)).value
            if OPS[pred.op](value, limit):
                held.append(self._evidence(pred, value, pred.agg, subject=subject) | {"unless_index": i})
        if not held:
            return result
        self._active[key] = False  # a stood-down rule restarts from the plain limit, not the hysteresis band
        evidence = dict(evidence or {})
        evidence["stood_down"] = {"reason": "unless", "firing_without": firing, "by": held}
        return False, evidence

    def evaluate(self, now: datetime) -> list[Finding]:
        self._ticks += 1
        results: dict[tuple[str, Subject], Result] = {}
        simple = [r for r in self.rules if r.type != RuleType.COMPOUND]
        compound = [r for r in self.rules if r.type == RuleType.COMPOUND]
        for rule in simple:
            for subject in self._subjects(rule):
                key = (rule.id, subject)
                if rule.type == RuleType.THRESHOLD:
                    results[key] = self._threshold(key, rule, subject, now, rule.clear_margin)
                elif rule.type == RuleType.BASELINE:
                    results[key] = self._baseline_rule(key, rule, subject, now)
                else:
                    results[key] = self._cumulative(key, rule, subject, now)
                if rule.unless:
                    results[key] = self._apply_unless(key, rule, subject, now, results[key])
        for rule in compound:  # compound rules may reference simple rules, not other compound rules
            for subject in self._subjects(rule):
                results[(rule.id, subject)] = self._compound(rule, subject, now, results)
        return [
            Finding(self._by_id[rule_id], subject, firing, evidence or {})
            for (rule_id, subject), (firing, evidence) in results.items()
        ]
