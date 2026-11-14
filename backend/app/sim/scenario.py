"""Scenario files: backend/app/sim/scenarios/*.yaml.

Each event has `at` (offset from scenario start, may be negative to act during the prewarm history),
`type`, optional `duration`, and `params`.
Control events: speed {speed}, pause, phase {name}, blackout {active} (comm link). Effect events: see sim.core.EFFECT_TYPES.
"""

from pathlib import Path
from typing import Any

import yaml

from app.sim.core import EFFECT_TYPES

SCENARIO_DIR = Path(__file__).resolve().parent / "scenarios"
CONTROL_TYPES = {"speed", "pause", "phase", "blackout"}


def list_scenarios() -> list[dict[str, str]]:
    out = []
    for path in sorted(SCENARIO_DIR.glob("*.yaml")):
        data = yaml.safe_load(path.read_text(encoding="utf-8"))
        out.append({"name": path.stem, "description": data.get("description", "")})
    return out


def load_scenario(name: str) -> dict[str, Any]:
    path = SCENARIO_DIR / f"{name}.yaml"
    if not path.is_file() or path.parent != SCENARIO_DIR:
        raise KeyError(f"Unknown scenario '{name}'")
    data: dict[str, Any] = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    data["name"] = name
    data.setdefault("events", [])
    for event in data["events"]:
        if event["type"] not in EFFECT_TYPES | CONTROL_TYPES:
            raise ValueError(f"{name}: unknown event type '{event['type']}'")
        event.setdefault("params", {})
    return data
