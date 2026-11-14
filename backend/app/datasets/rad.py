"""MSL/RAD dose-rate replay (R-2, PRD section 6 M0, AGENTS.md section 2a).

Replays the bundled RAD dosimetry (data/nasa/derived/msl_rad_*.csv) onto the simulated clock.
A replay is a pure function of (dataset, simulated time, scenario start): no RNG, no wall clock, no network.

Time mapping (config/datasets.yaml): the scenario start T0 maps to `start` in the dataset; simulated time
then runs through the dataset at `compression` dataset-seconds per simulated second, looping over the
window (`mode: loop`) or holding the last value (`mode: hold`).

Gaps: each observation counts as the current value for up to `max_step` (the instrument cadence). Past that,
or over a row marked SUSPECT, the last GOOD value is held for up to `max_hold` and marked SUSPECT. After that
the replay returns None and the simulator's synthetic generator takes over (provenance SYNTHETIC).
"""

import bisect
import csv
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

from app.datasets.registry import DatasetRegistry, ReplayStatus
from app.domain.enums import Quality
from app.util import parse_duration, parse_ts

ADAPTER = "rad"


@dataclass(frozen=True)
class RadSample:
    absorbed_uGy_h: float  # RAD E detector (tissue-equivalent plastic): NASA_MEASURED
    equivalent_uSv_h: float  # absorbed x published mean quality factor: NASA_DERIVED
    quality: Quality
    dataset_ts: datetime  # the dataset time this simulated time maps to
    source_ts: datetime  # start of the RAD observation whose value is used
    replay_id: str
    dataset_id: str


def load_rows(path: Path) -> list[tuple[datetime, float, Quality]]:
    """(utc, dose_e_uGy_h, quality) from a derived RAD CSV; '#' lines are comments."""
    with path.open(encoding="utf-8") as fh:
        reader = csv.DictReader(line for line in fh if not line.startswith("#"))
        rows = [(parse_ts(r["utc"]), float(r["dose_e_uGy_h"]), Quality(r["quality"])) for r in reader]
    rows.sort(key=lambda r: r[0])
    if not rows:
        raise ValueError(f"{path}: no rows")
    return rows


class RadReplay:
    def __init__(self, status: ReplayStatus, path: Path, t0: datetime) -> None:
        spec: dict[str, Any] = status.spec
        self.id = status.id
        self.dataset_id = status.dataset_id
        self.phases = [str(p) for p in spec.get("phases", [])]
        self.quality_factor = float(spec["quality_factor"])
        self.quality_factor_ref = str(spec.get("quality_factor_ref", ""))
        self.compression = float(spec.get("compression", 1))
        self.mode = str(spec.get("mode", "loop"))
        self.max_step = parse_duration(str(spec.get("max_step", "1h")))
        self.max_hold = parse_duration(str(spec.get("max_hold", "3h")))
        self.t0 = t0
        rows = load_rows(path)
        self.times = [r[0] for r in rows]
        self.values = [r[1] for r in rows]
        self.quality = [r[2] for r in rows]
        steps = sorted((b - a) for a, b in zip(self.times, self.times[1:], strict=False))
        self.cadence = steps[len(steps) // 2] if steps else timedelta(hours=1)
        self.first = self.times[0]
        self.length = (self.times[-1] - self.first) + self.cadence  # loop period
        self.start = parse_ts(str(spec["start"])) if spec.get("start") else self.first
        good = [v for v, q in zip(self.values, self.quality, strict=True) if q == Quality.GOOD]
        self.mean_absorbed_uGy_h = sum(good) / len(good)

    @property
    def mean_equivalent_uSv_h(self) -> float:
        return self.mean_absorbed_uGy_h * self.quality_factor

    def dataset_time(self, t: datetime) -> datetime:
        offset = (self.start - self.first) + (t - self.t0) * self.compression
        if self.mode == "loop":
            offset = offset % self.length
        return self.first + offset

    def sample(self, t: datetime) -> RadSample | None:
        dt = self.dataset_time(t)
        i = bisect.bisect_right(self.times, dt) - 1
        if i < 0:
            return None
        if self.quality[i] == Quality.GOOD and dt - self.times[i] <= self.max_step:
            return self._sample(i, dt, Quality.GOOD)
        j = i
        while j >= 0 and self.quality[j] != Quality.GOOD:
            j -= 1
        if j >= 0 and dt - self.times[j] <= self.max_hold:
            return self._sample(j, dt, Quality.SUSPECT)
        return None

    def _sample(self, i: int, dt: datetime, quality: Quality) -> RadSample:
        absorbed = self.values[i]
        return RadSample(absorbed, absorbed * self.quality_factor, quality, dt, self.times[i], self.id, self.dataset_id)


class RadiationReplays:
    """The active RAD replays, by mission phase. Built per scenario run; inactive replays are skipped."""

    def __init__(self, registry: DatasetRegistry, t0: datetime) -> None:
        self.by_phase: dict[str, RadReplay] = {}
        for status in registry.replays:
            if not status.active or status.spec.get("adapter") != ADAPTER:
                continue
            replay = RadReplay(status, registry.data_dir / str(status.spec["file"]), t0)
            for phase in replay.phases:
                self.by_phase[phase] = replay

    def for_phase(self, phase: str) -> RadReplay | None:
        return self.by_phase.get(phase)

    def sample(self, t: datetime, phase: str) -> RadSample | None:
        replay = self.by_phase.get(phase)
        return replay.sample(t) if replay else None
