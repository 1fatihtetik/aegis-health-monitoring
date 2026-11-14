"""JPL Horizons light-time adapter (R-4, AGENTS.md section 2a D4).

Replays the bundled daily Earth-Mars one-way light time (derived/horizons_earth_mars_lt.csv) as the comm delay
for the phases listed in config/datasets.yaml. Between two daily ephemeris points the delay is linearly
interpolated (orbit geometry is smooth; this is not a data gap). Outside the bundled window, or when the file is
missing or fails its sha256 check, it returns None and the link uses the mission.yaml phase constant.
A pure function of (dataset, simulated time): the same date always gives the same delay.
"""

import bisect
import csv
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

from app.datasets.registry import DatasetRegistry, ReplayStatus
from app.domain.enums import Provenance
from app.util import parse_ts

ADAPTER = "horizons"


@dataclass(frozen=True)
class LightTime:
    delay_s: float
    provenance: Provenance
    dataset_id: str | None
    basis: str
    date: str | None  # ephemeris date (UTC) of the simulated time, e.g. "2026-11-14"
    dataset: dict[str, Any] | None = None  # manifest details for the DataSourceBadge popover

    def as_dict(self) -> dict[str, Any]:
        return {"delay_s": self.delay_s, "provenance": self.provenance.value, "dataset_id": self.dataset_id,
                "basis": self.basis, "date": self.date, "dataset": self.dataset}


class HorizonsLightTime:
    def __init__(self, status: ReplayStatus, path: Path) -> None:
        self.id = status.id
        self.dataset_id = status.dataset_id
        self.phases = set(status.spec.get("phases", []))
        self.times: list[datetime] = []
        self.values: list[float] = []
        with path.open(encoding="utf-8") as fh:
            rows = csv.DictReader(line for line in fh if not line.startswith("#"))
            for row in rows:
                self.times.append(parse_ts(row["date_utc"]))
                self.values.append(float(row["one_way_lt_s"]))

    def delay_s(self, t: datetime) -> float | None:
        if not self.times or t < self.times[0] or t > self.times[-1]:
            return None
        i = bisect.bisect_right(self.times, t) - 1
        if i >= len(self.times) - 1:
            return self.values[-1]
        span = (self.times[i + 1] - self.times[i]).total_seconds()
        f = (t - self.times[i]).total_seconds() / span
        return self.values[i] + f * (self.values[i + 1] - self.values[i])


class CommDelay:
    """The one-way comm delay for a phase and time: Horizons when active for the phase, else the phase constant."""

    def __init__(self, registry: DatasetRegistry, phases: dict[str, dict[str, Any]]) -> None:
        self.phases = phases
        self.replay: HorizonsLightTime | None = None
        self.label = ""
        self.meta: dict[str, Any] | None = None
        for status in registry.replays:
            if status.active and status.spec.get("adapter") == ADAPTER:
                self.replay = HorizonsLightTime(status, registry.data_dir / str(status.spec["file"]))
                self.meta = registry.dataset_meta(status.dataset_id)
                self.label = str((self.meta or {}).get("label", status.dataset_id))
                break

    def at(self, phase: str, t: datetime) -> LightTime:
        if self.replay is not None and phase in self.replay.phases:
            value = self.replay.delay_s(t)
            if value is not None:
                date = t.date().isoformat()
                basis = (f"Earth-Mars one-way light time on {date} from the {self.label} ephemeris (range / c), "
                         "linearly interpolated between daily points.")
                return LightTime(round(value, 1), Provenance.NASA_DERIVED, self.replay.dataset_id, basis, date,
                                 self.meta)
        const = float(self.phases[phase]["comm_delay_s"])
        why = ("outside the bundled Horizons window or the Horizons file is inactive"
               if self.replay is not None and phase in self.replay.phases else "fixed phase value")
        return LightTime(const, Provenance.SYNTHETIC, None, f"mission.yaml {phase}.comm_delay_s ({why}).", None)
