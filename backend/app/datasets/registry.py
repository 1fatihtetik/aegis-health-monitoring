"""Bundled NASA dataset registry (PRD section 6 M0, AGENTS.md section 2a).

Reads `config/datasets.yaml` (which source feeds which signal) and `data/nasa/MANIFEST.yaml`
(what each bundled file is, where it came from, its sha256). Nothing here touches the network.

A missing, unlisted or tampered file never stops the crew app: the replay is marked inactive,
the reason is logged, and its signals stay on the synthetic generator with provenance SYNTHETIC.
"""

import hashlib
import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

from app.domain.enums import SIGNALS, Provenance

log = logging.getLogger("aegis.datasets")

ROOT = Path(__file__).resolve().parents[3]
DATA_DIR = ROOT / "data" / "nasa"
TIERS = {"D1", "D2", "D3", "D4", "D5", "D6", "D7"}  # D6/D7: Block P (AGENTS.md section 2a)
MANIFEST_KEYS = {"id", "tier", "title", "source_url", "retrieved", "terms", "transform", "files"}


@dataclass(frozen=True)
class SignalSource:
    """Provenance of one signal when no replay overrides it."""

    provenance: Provenance
    dataset_id: str | None = None
    basis: str = ""
    dataset: dict[str, Any] | None = None  # manifest details (label, title, source_url, retrieved, transform)

    def as_dict(self) -> dict[str, Any]:
        return {"provenance": self.provenance.value, "dataset_id": self.dataset_id, "basis": self.basis,
                "dataset": self.dataset}


@dataclass
class ReplayStatus:
    id: str
    dataset_id: str
    signals: list[str]
    active: bool
    reason: str = ""
    spec: dict[str, Any] = field(default_factory=dict)


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 16), b""):
            h.update(chunk)
    return h.hexdigest()


def agency(entry: dict[str, Any]) -> str:
    """Who measured the data (P-0). Manifest entries without an `agency` field are NASA archives."""
    return str(entry.get("agency") or "NASA")


def _load_yaml(path: Path) -> Any:
    with path.open(encoding="utf-8") as fh:
        return yaml.safe_load(fh)


class DatasetRegistry:
    def __init__(self, datasets_yaml: Path, data_dir: Path = DATA_DIR) -> None:
        self.data_dir = data_dir
        self.problems: list[str] = []
        spec: dict[str, Any] = _load_yaml(datasets_yaml) or {}
        self.default = SignalSource(Provenance(spec.get("default_provenance", "SYNTHETIC")))
        self.signals: dict[str, SignalSource] = {}
        for name, entry in (spec.get("signals") or {}).items():
            if name not in SIGNALS:
                raise ValueError(f"datasets.yaml: unknown signal '{name}'")
            prov = Provenance(entry["provenance"])
            if prov.needs_dataset:
                raise ValueError(f"datasets.yaml {name}: {prov} comes only from an active replay, not a default")
            if prov == Provenance.SYNTHETIC_CALIBRATED and not entry.get("basis"):
                raise ValueError(f"datasets.yaml {name}: SYNTHETIC_CALIBRATED needs a 'basis' citing its NASA source")
            self.signals[name] = SignalSource(prov, None, str(entry.get("basis", "")))
        self.manifest: dict[str, dict[str, Any]] = self._load_manifest()
        self.file_ok: dict[str, bool] = {}
        for entry in self.manifest.values():
            for f in entry["files"]:
                self.file_ok[f["path"]] = self._check_file(entry["id"], f)
        self.replays = [self._check_replay(r) for r in (spec.get("replays") or [])]
        # R-5 space-weather sources: {part: (dataset_id, file, reason)}; reason "" means the file is usable.
        self.space_weather_spec: dict[str, Any] = dict(spec.get("space_weather") or {})
        self.space_weather_files: dict[str, tuple[str, str, str]] = {}
        for part in ("sep", "events", "flux"):
            src = self.space_weather_spec.get(part)
            if not src:
                continue
            did, rel = str(src["dataset_id"]), str(src["file"])
            reason = self.file_problem(did, rel)
            if reason:
                self.problems.append(f"space_weather {part} unavailable: {reason}")
            self.space_weather_files[part] = (did, rel, reason)
        for problem in self.problems:
            log.warning("NASA data: %s", problem)

    # ---- loading -------------------------------------------------------------------------
    def _load_manifest(self) -> dict[str, dict[str, Any]]:
        path = self.data_dir / "MANIFEST.yaml"
        if not path.exists():
            self.problems.append(f"{path} not found; all signals use the synthetic generator")
            return {}
        try:
            raw = _load_yaml(path) or {}
        except yaml.YAMLError as exc:
            self.problems.append(f"MANIFEST.yaml is not valid YAML ({exc}); ignoring it")
            return {}
        out: dict[str, dict[str, Any]] = {}
        for entry in raw.get("datasets") or []:
            missing = MANIFEST_KEYS - set(entry)
            if missing:
                self.problems.append(f"manifest entry {entry.get('id', '?')} lacks {sorted(missing)}; ignored")
                continue
            if entry["tier"] not in TIERS:
                self.problems.append(f"manifest entry {entry['id']} has unknown tier {entry['tier']}; ignored")
                continue
            out[str(entry["id"])] = entry
        return out

    def _check_file(self, dataset_id: str, f: dict[str, Any]) -> bool:
        path = self.data_dir / str(f.get("path", ""))
        if not f.get("path") or not f.get("sha256"):
            self.problems.append(f"{dataset_id}: file entry needs path and sha256")
            return False
        if not path.is_file():
            self.problems.append(f"{dataset_id}: {f['path']} is missing")
            return False
        if sha256_file(path) != f["sha256"]:
            self.problems.append(f"{dataset_id}: {f['path']} sha256 does not match the manifest")
            return False
        return True

    def file_problem(self, dataset_id: str, rel: str | None) -> str:
        """Why a datasets.yaml file reference is unusable, or "" if it is listed and matches its sha256."""
        entry = self.manifest.get(dataset_id)
        if entry is None:
            return f"dataset '{dataset_id}' is not in MANIFEST.yaml"
        if rel not in {f["path"] for f in entry["files"]}:
            return f"file '{rel}' is not listed under dataset '{dataset_id}'"
        if not self.file_ok.get(str(rel), False):
            return f"file '{rel}' is missing or fails its sha256 check"
        return ""

    def _check_replay(self, r: dict[str, Any]) -> ReplayStatus:
        rid, did = str(r["id"]), str(r["dataset_id"])
        signals = [str(s) for s in r.get("signals", [])]
        for s in signals:
            if s not in SIGNALS:
                raise ValueError(f"datasets.yaml replay {rid}: unknown signal '{s}'")
        reason = self.file_problem(did, r.get("file"))
        if reason:
            self.problems.append(f"replay {rid} inactive, synthetic fallback: {reason}")
        return ReplayStatus(rid, did, signals, not reason, reason, r)

    # ---- queries -------------------------------------------------------------------------
    def source(self, signal: str) -> SignalSource:
        return self.signals.get(signal, self.default)

    def dataset_meta(self, dataset_id: str | None) -> dict[str, Any] | None:
        """What a DataSourceBadge shows on tap (AGENTS.md section 8): the manifest entry, minus file hashes."""
        entry = self.manifest.get(dataset_id) if dataset_id else None
        if entry is None:
            return None
        return {
            "id": entry["id"], "label": str(entry.get("label") or entry["title"]), "title": entry["title"],
            "source_url": entry["source_url"], "retrieved": str(entry["retrieved"]), "terms": entry["terms"],
            "transform": entry["transform"], "agency": agency(entry),
        }

    def replay(self, replay_id: str) -> ReplayStatus | None:
        return next((r for r in self.replays if r.id == replay_id), None)

    def datasets(self) -> list[dict[str, Any]]:
        out = []
        for entry in self.manifest.values():
            files = [{"path": f["path"], "sha256_ok": self.file_ok.get(f["path"], False)} for f in entry["files"]]
            out.append({
                "id": entry["id"], "tier": entry["tier"], "label": str(entry.get("label") or entry["title"]),
                "title": entry["title"], "reference": entry.get("reference"), "agency": agency(entry),
                "source_url": entry["source_url"], "retrieved": str(entry["retrieved"]),
                "terms": entry["terms"], "transform": entry["transform"],
                "files": files, "sha256_ok": all(f["sha256_ok"] for f in files),
            })
        return out

    def status(self) -> dict[str, Any]:
        return {
            "datasets": self.datasets(),
            "replays": [
                {"id": r.id, "dataset_id": r.dataset_id, "signals": r.signals, "active": r.active, "reason": r.reason}
                for r in self.replays
            ],
            "problems": list(self.problems),
        }
