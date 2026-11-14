"""R-6: every simulator constant in mission.yaml / crew.yaml names its source or says it is a heuristic."""

import fnmatch
from pathlib import Path
from typing import Any

import pytest
import yaml

from app.config import CONFIG_DIR

CITATION = ("heuristic", "setting", "physical", "NASA", "OCHMO", "HRP", "Horizons", "CSA", "[V1", "[V2")


def numeric_leaves(node: Any, path: str = "") -> list[str]:
    if isinstance(node, bool):
        return []
    if isinstance(node, int | float):
        return [path]
    if isinstance(node, dict):
        return [p for k, v in node.items() for p in numeric_leaves(v, f"{path}.{k}" if path else str(k))]
    if isinstance(node, list):
        out = [p for i, v in enumerate(node) for p in numeric_leaves(v, f"{path}.{i}")]
        return out or []
    return []


@pytest.mark.parametrize("name", ["mission.yaml", "crew.yaml"])
def test_every_constant_has_a_source(name):
    data = yaml.safe_load(Path(CONFIG_DIR / name).read_text(encoding="utf-8"))
    sources: dict[str, str] = data.pop("sources")
    for pattern, text in sources.items():
        assert any(tok in text for tok in CITATION), f"{name} {pattern}: source must cite or say heuristic"
    # A list of numbers (exercise_hours) counts as one value; a pattern on the list path covers its items.
    missing = [
        leaf for leaf in numeric_leaves(data)
        if not any(fnmatch.fnmatchcase(leaf, p) or fnmatch.fnmatchcase(leaf.rsplit(".", 1)[0], p)
                   for p in sources)
    ]
    assert missing == [], f"{name}: no `sources` entry for {missing}"


def test_co2_nominal_cites_tb004(cfg):
    src = yaml.safe_load((CONFIG_DIR / "mission.yaml").read_text(encoding="utf-8"))["sources"]
    assert "TB-004" in src["sim.cabin.ppco2_mmHg.mean"]
    assert cfg.mission["sim"]["cabin"]["ppco2_mmHg"]["mean"] < cfg.limit("environment.ppco2_mmHg_1h_max").value
    assert cfg.datasets.source("ppco2").provenance.value == "SYNTHETIC_CALIBRATED"
