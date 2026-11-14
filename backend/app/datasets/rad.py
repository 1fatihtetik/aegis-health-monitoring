"""Dose-rate replays (R-2 MSL/RAD; P-1 ISS DOSTEL, P-2 LRO CRaTER, P-3 EPA RadNet; PRD section 6 M0, AGENTS.md 2a).

Replays bundled dosimetry (data/nasa/derived/*.csv) onto the simulated clock. One adapter serves every
instrument; config/datasets.yaml says per replay which CSV column holds the value, whether it is an absorbed
dose rate (dose equivalent = value x <Q>) or already a dose equivalent rate (absorbed = value / <Q>), and which
provenance label the measured and derived signals carry.
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
from app.domain.enums import Provenance, Quality
from app.util import parse_duration, parse_ts

ADAPTER = "rad"  # every dose-rate replay uses this adapter (the name is historical)


MEASURES = ("absorbed", "equivalent")


@dataclass(frozen=True)
class RadSample:
    absorbed_uGy_h: float  # measured absorbed dose rate, or equivalent / <Q> (see the replay's `measures`)
    equivalent_uSv_h: float  # absorbed x published mean quality factor, or the measured dose equivalent rate
    quality: Quality
    dataset_ts: datetime  # the dataset time this simulated time maps to
    source_ts: datetime  # start of the observation whose value is used
    replay_id: str
    dataset_id: str
    saa: bool | None = None  # P-1: spacecraft inside the South Atlantic Anomaly box (None: not a LEO dataset)


Row = tuple[datetime, float, Quality, bool | None]


def load_rows(path: Path, value_column: str = "dose_e_uGy_h", saa_column: str | None = None) -> list[Row]:
    """(utc, value, quality, saa) from a derived dose-rate CSV; '#' lines are comments."""
    with path.open(encoding="utf-8") as fh:
        reader = csv.DictReader(line for line in fh if not line.startswith("#"))
        rows = [(parse_ts(r["utc"]), float(r[value_column]), Quality(r["quality"]),
                 (r[saa_column] == "1") if saa_column else None) for r in reader]
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
        self.event = str(spec["event"]) if spec.get("event") else None
        self.event_date = str(spec.get("event_date", ""))
        self.donki_id = str(spec.get("donki_id", ""))
        self.quality_factor = float(spec["quality_factor"])
        self.quality_factor_ref = str(spec.get("quality_factor_ref", ""))
        self.compression = float(spec.get("compression", 1))
        self.mode = str(spec.get("mode", "loop"))
        self.max_step = parse_duration(str(spec.get("max_step", "1h")))
        self.max_hold = parse_duration(str(spec.get("max_hold", "3h")))
        self.measures = str(spec.get("measures", "absorbed"))
        if self.measures not in MEASURES:
            raise ValueError(f"datasets.yaml replay {self.id}: measures must be one of {MEASURES}")
        # What the basis text and the radiation view call the instrument and its value (P-1..P-3).
        self.instrument = str(spec.get("instrument", "MSL/RAD tissue dose rate (E detector)"))
        self.measured_provenance = Provenance(spec.get("measured_provenance", "NASA_MEASURED"))
        self.derived_provenance = Provenance(spec.get("derived_provenance", "NASA_DERIVED"))
        nf = spec.get("neutron_fraction")
        self.neutron_fraction: float | None = float(nf) if nf is not None else None
        self.neutron_note = str(spec.get("neutron_note", ""))
        self.t0 = t0
        saa_column = spec.get("saa_column")
        rows = load_rows(path, str(spec.get("value_column", "dose_e_uGy_h")), str(saa_column) if saa_column else None)
        self.times = [r[0] for r in rows]
        self.values = [r[1] for r in rows]
        self.quality = [r[2] for r in rows]
        self.saa = [r[3] for r in rows]
        steps = sorted((b - a) for a, b in zip(self.times, self.times[1:], strict=False))
        self.cadence = steps[len(steps) // 2] if steps else timedelta(hours=1)
        self.first = self.times[0]
        self.length = (self.times[-1] - self.first) + self.cadence  # loop period
        self.start = parse_ts(str(spec["start"])) if spec.get("start") else self.first
        self.mean_value = self._time_weighted_mean()  # in the CSV's unit

    def _time_weighted_mean(self) -> float:
        """Mean of GOOD rows, each weighted by how long the replay holds it (up to `max_step`). Weighting matters
        for instruments with a variable cadence (ISS DOSTEL integrates 20 s inside the SAA, 100 s outside)."""
        total = weight = 0.0
        for i, (v, q) in enumerate(zip(self.values, self.quality, strict=True)):
            if q != Quality.GOOD:
                continue
            step = (self.times[i + 1] - self.times[i]) if i + 1 < len(self.times) else self.cadence
            w = min(step, self.max_step).total_seconds()
            total += v * w
            weight += w
        if weight <= 0:
            raise ValueError(f"replay {self.id}: no GOOD rows")
        return total / weight

    @property
    def mean_absorbed_uGy_h(self) -> float:
        return self.mean_value if self.measures == "absorbed" else self.mean_value / self.quality_factor

    @property
    def mean_equivalent_uSv_h(self) -> float:
        return self.mean_value * self.quality_factor if self.measures == "absorbed" else self.mean_value

    def dataset_time(self, t: datetime, origin: datetime | None = None) -> datetime:
        offset = (self.start - self.first) + (t - (origin or self.t0)) * self.compression
        if self.mode == "loop":
            offset = offset % self.length
        elif offset > self.times[-1] - self.first:
            return self.times[-1]
        return self.first + offset

    def sample(self, t: datetime, origin: datetime | None = None) -> RadSample | None:
        dt = self.dataset_time(t, origin)
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
        value = self.values[i]
        if self.measures == "absorbed":
            absorbed, equivalent = value, value * self.quality_factor
        else:
            absorbed, equivalent = value / self.quality_factor, value
        return RadSample(absorbed, equivalent, quality, dt, self.times[i], self.id, self.dataset_id, self.saa[i])


class RadiationReplays:
    """The active RAD replays, by mission phase. Built per scenario run; inactive replays are skipped."""

    def __init__(self, registry: DatasetRegistry, t0: datetime) -> None:
        self.by_phase: dict[str, RadReplay] = {}
        self.by_event: dict[str, RadReplay] = {}
        for status in registry.replays:
            if not status.active or status.spec.get("adapter") != ADAPTER:
                continue
            replay = RadReplay(status, registry.data_dir / str(status.spec["file"]), t0)
            for phase in replay.phases:
                self.by_phase[phase] = replay
            if replay.event:
                self.by_event[replay.event] = replay

    def for_phase(self, phase: str) -> RadReplay | None:
        return self.by_phase.get(phase)

    def for_event(self, event: str) -> RadReplay | None:
        return self.by_event.get(event)

    def sample(self, t: datetime, phase: str) -> RadSample | None:
        replay = self.by_phase.get(phase)
        return replay.sample(t) if replay else None

    def sample_event(self, t: datetime, event: str, origin: datetime) -> RadSample | None:
        replay = self.by_event.get(event)
        return replay.sample(t, origin) if replay else None
