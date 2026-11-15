"""Loads config/*.yaml. All medical limits come from limits.yaml and carry source_ref + verified."""

import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml

from app.datasets.registry import DATA_DIR, DatasetRegistry
from app.rules.models import Rule
from app.selftests.catalog import Catalog
from app.util import parse_duration

CONFIG_DIR = Path(__file__).resolve().parents[2] / "config"
# A verified limit must name a NASA-STD-3001 clause, e.g. "[V2 6004]" (AGENTS.md section 2a).
CLAUSE_ID = re.compile(r"\[V[12] \d{4,5}\]")


@dataclass(frozen=True)
class Limit:
    ref: str
    value: float
    source_ref: str
    verified: bool

    def as_dict(self) -> dict[str, Any]:
        return {"ref": self.ref, "value": self.value, "source_ref": self.source_ref, "verified": self.verified}


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
        self._validate()

    def limit(self, ref: str) -> Limit:
        """ref is 'section.name' (uses 'value') or 'section.name.min|max'."""
        parts = ref.split(".")
        try:
            entry = self.limits[parts[0]][parts[1]]
            field = parts[2] if len(parts) > 2 else "value"
            return Limit(ref, float(entry[field]), str(entry["source_ref"]), bool(entry["verified"]))
        except (KeyError, IndexError) as exc:
            raise KeyError(f"Unknown limit_ref '{ref}'") from exc

    def _validate(self) -> None:
        for section, entries in self.limits.items():
            for name, entry in entries.items():
                if "source_ref" not in entry or "verified" not in entry:
                    raise ValueError(f"limits.yaml {section}.{name} needs source_ref and verified")
                if entry["verified"] and not CLAUSE_ID.search(str(entry["source_ref"])):
                    raise ValueError(f"limits.yaml {section}.{name} is verified but source_ref names no clause id")
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
