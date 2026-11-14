"""In-memory time-series store: one ring buffer per (crew_id | None, signal)."""

from collections import deque
from datetime import datetime

Point = tuple[datetime, float]
Key = tuple[str | None, str]


class SeriesStore:
    def __init__(self, maxlen: int = 20000) -> None:
        self._maxlen = maxlen
        self._d: dict[Key, deque[Point]] = {}

    def add(self, crew_id: str | None, signal: str, ts: datetime, value: float) -> None:
        key = (crew_id, str(signal))
        series = self._d.get(key)
        if series is None:
            series = self._d[key] = deque(maxlen=self._maxlen)
        series.append((ts, value))

    def latest(self, crew_id: str | None, signal: str) -> Point | None:
        series = self._d.get((crew_id, str(signal)))
        return series[-1] if series else None

    def window(self, crew_id: str | None, signal: str, since: datetime) -> list[float]:
        """Values with ts in (since, latest], newest first."""
        series = self._d.get((crew_id, str(signal)))
        out: list[float] = []
        if series:
            for ts, value in reversed(series):
                if ts <= since:
                    break
                out.append(value)
        return out

    def points(
        self, crew_id: str | None, signal: str, start: datetime | None = None, end: datetime | None = None
    ) -> list[Point]:
        series = self._d.get((crew_id, str(signal)), ())
        return [p for p in series if (start is None or p[0] >= start) and (end is None or p[0] <= end)]

    def value_at(self, crew_id: str | None, signal: str, ts: datetime) -> float | None:
        """Value of the last point at or before ts."""
        found: float | None = None
        for point_ts, value in self._d.get((crew_id, str(signal)), ()):
            if point_ts > ts:
                break
            found = value
        return found

    def copy(self, exclude: frozenset[str] = frozenset()) -> "SeriesStore":
        clone = SeriesStore(self._maxlen)
        clone._d = {k: deque(v, maxlen=self._maxlen) for k, v in self._d.items() if k[1] not in exclude}
        return clone
