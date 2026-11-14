"""Loads config/*.yaml. All medical limits come from limits.yaml and carry source_ref + verified."""

from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml

from app.datasets.registry import DATA_DIR, DatasetRegistry
from app.rules.models import Rule

CONFIG_DIR = Path(__file__).resolve().parents[2] / "config"


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
        ids = {r.id for r in self.rules}
        if len(ids) != len(self.rules):
            raise ValueError("rules.yaml has duplicate rule ids")
        for rule in self.rules:
            for ref in rule.limit_refs:
                self.limit(ref)
            for member in rule.members:
                if isinstance(member, str) and member not in ids:
                    raise ValueError(f"{rule.id}: unknown member rule '{member}'")
        for kind, spec in self.readiness["kinds"].items():
            if not spec.get("hazards") or not spec.get("hrp_risks"):
                raise ValueError(f"readiness.yaml {kind} needs hazards and hrp_risks")
            for comp in spec["components"].values():
                self.limit(comp["limit_ref"])
