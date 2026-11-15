"""Loads config/*.yaml. All medical limits come from limits.yaml and carry source_ref + verified."""

import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml

from app.countermeasures.catalog import CountermeasureCatalog
from app.datasets.registry import DATA_DIR, DatasetRegistry
from app.rules.models import Rule
from app.selftests.catalog import Catalog
from app.util import parse_duration

CONFIG_DIR = Path(__file__).resolve().parents[2] / "config"
# A verified limit must name a NASA-STD-3001 clause, e.g. "[V2 6004]" (AGENTS.md section 2a).
CLAUSE_ID = re.compile(r"\[V[12] \d{4,5}\]")
# Block L: what an unverified number IS (ROADMAP section 0a). Required on every verified: false entry, refused on a
# verified: true one. The UI shows "Not a NASA limit · <label>".
SOURCE_KINDS = {
    "published": "Published source",
    "clinical": "Clinical guideline",
    "design": "AEGIS design setting",
    "nasa_reference": "NASA reference, not a standard",
}


@dataclass(frozen=True)
class Limit:
    ref: str
    value: float
    source_ref: str
    verified: bool
    source_kind: str | None = None  # Block L: set exactly when verified is False

    def as_dict(self) -> dict[str, Any]:
        return {"ref": self.ref, "value": self.value, "source_ref": self.source_ref, "verified": self.verified,
                "source_kind": self.source_kind}


def _load(path: Path) -> Any:
    with path.open(encoding="utf-8") as fh:
        return yaml.safe_load(fh)


class Config:
    def __init__(self, config_dir: Path = CONFIG_DIR, data_dir: Path = DATA_DIR) -> None:
        self.limits: dict[str, dict[str, dict[str, Any]]] = _load(config_dir / "limits.yaml")
        self.mission: dict[str, Any] = _load(config_dir / "mission.yaml")
        self.crew: list[dict[str, Any]] = _load(config_dir / "crew.yaml")["crew"]
        self.readiness: dict[str, Any] = _load(config_dir / "readiness.yaml")
        self.rules: list[Rule] = [Rule(**r) for r in _load(config_dir / "rules.yaml")["rules"]]
        self.datasets = DatasetRegistry(config_dir / "datasets.yaml", data_dir)
        self.selftests = Catalog(**_load(config_dir / "selftests.yaml"))  # Block T
        self.countermeasures = CountermeasureCatalog(**_load(config_dir / "countermeasures.yaml"))  # Block C
        self._validate()

    def limit(self, ref: str) -> Limit:
        """ref is 'section.name' (uses 'value') or 'section.name.min|max'."""
        parts = ref.split(".")
        try:
            entry = self.limits[parts[0]][parts[1]]
            field = parts[2] if len(parts) > 2 else "value"
            return Limit(ref, float(entry[field]), str(entry["source_ref"]), bool(entry["verified"]),
                         entry.get("source_kind"))
        except (KeyError, IndexError) as exc:
            raise KeyError(f"Unknown limit_ref '{ref}'") from exc

    def _validate(self) -> None:
        for section, entries in self.limits.items():
            for name, entry in entries.items():
                if "source_ref" not in entry or "verified" not in entry:
                    raise ValueError(f"limits.yaml {section}.{name} needs source_ref and verified")
                if entry["verified"] and not CLAUSE_ID.search(str(entry["source_ref"])):
                    raise ValueError(f"limits.yaml {section}.{name} is verified but source_ref names no clause id")
                kind = entry.get("source_kind")
                if entry["verified"] and kind is not None:
                    raise ValueError(f"limits.yaml {section}.{name} is verified and must not carry source_kind")
                if not entry["verified"] and kind not in SOURCE_KINDS:
                    raise ValueError(
                        f"limits.yaml {section}.{name} is unverified and needs source_kind, one of {sorted(SOURCE_KINDS)}"
                    )
        ids = {r.id for r in self.rules}
        if len(ids) != len(self.rules):
            raise ValueError("rules.yaml has duplicate rule ids")
        for rule in self.rules:
            for ref in rule.limit_refs:
                self.limit(ref)
            for member in rule.members:
                if isinstance(member, str) and member not in ids:
                    raise ValueError(f"{rule.id}: unknown member rule '{member}'")
        for test in self.selftests.tests:  # Block T: every normal band must exist in limits.yaml
            band_refs = [r for f in test.fields for r in (f.band_low, f.band_high) if r]
            for ref in [*test.limit_refs, *band_refs]:
                try:
                    self.limit(ref)
                except KeyError as exc:
                    raise ValueError(f"selftests.yaml {test.id}: {exc.args[0]}") from exc
        for region in self.selftests.body_map:  # T-6: a region links only to rules that exist
            unknown = [r for r in region.rules if r not in ids]
            if unknown:
                raise ValueError(f"selftests.yaml body map region {region.id}: unknown rule(s) {unknown}")
        self._validate_countermeasures(ids)
        parse_duration(self.selftests.setting("manual_override"))
        parse_duration(self.selftests.setting("after_gravity_window"))
        for kind, spec in self.readiness["kinds"].items():
            if not spec.get("hazards") or not spec.get("hrp_risks"):
                raise ValueError(f"readiness.yaml {kind} needs hazards and hrp_risks")
            for comp in spec["components"].values():
                self.limit(comp["limit_ref"])
            if "go_min_ref" in spec:
                self.limit(spec["go_min_ref"])
            for rule_id in spec.get("hold_rules", []):
                if rule_id not in ids:
                    raise ValueError(f"readiness.yaml {kind}: unknown hold rule '{rule_id}'")

    def _validate_countermeasures(self, rule_ids: set[str]) -> None:
        """Block C: every prescription, trigger, test and gate an item names must exist."""
        test_ids = {t.id for t in self.selftests.tests}
        gates = {k for k, spec in self.readiness["kinds"].items() if "go_min_ref" in spec}
        for item in self.countermeasures.items:
            where = f"countermeasures.yaml {item.id}"
            for p in item.prescription:
                try:
                    self.limit(p.limit_ref)
                except KeyError as exc:
                    raise ValueError(f"{where}: {exc.args[0]}") from exc
            unknown = [r for r in item.triggered_by if r not in rule_ids]
            if unknown:
                raise ValueError(f"{where}: unknown rule(s) {unknown}")
            if item.done_by_test and item.done_by_test not in test_ids:
                raise ValueError(f"{where}: unknown self-test '{item.done_by_test}'")
            bad = [g for g in item.triggered_by_gate if g not in gates]
            if bad:
                raise ValueError(f"{where}: readiness kind(s) {bad} have no Go/Hold gate")
            if item.session is not None and any(item.session >= len(c["exercise_hours"]) for c in self.crew):
                raise ValueError(f"{where}: session {item.session} is not in every crew member's exercise_hours")
            parse_duration(item.due_window)
        parse_duration(self.countermeasures.setting("rollup_every"))
        int(self.countermeasures.setting("adherence_days"))
