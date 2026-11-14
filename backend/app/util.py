"""Small helpers: durations and timestamps."""

import re
from datetime import datetime, timedelta
from functools import lru_cache

_UNITS = {"s": 1, "m": 60, "h": 3600, "d": 86400}
_PART = re.compile(r"(\d+(?:\.\d+)?)([smhd])")


@lru_cache(maxsize=256)
def parse_duration(text: str | int | float) -> timedelta:
    """'90s', '30m', '1h', '2d', '23h30m', '-24h', or a bare number of seconds."""
    s = str(text).strip()
    sign = -1 if s.startswith("-") else 1
    parts = _PART.findall(s)
    if not parts:
        return timedelta(seconds=float(s))
    if "".join(n + u for n, u in parts) != s.lstrip("-"):
        raise ValueError(f"Bad duration '{text}'")
    return sign * timedelta(seconds=sum(float(n) * _UNITS[u] for n, u in parts))


def iso(ts: datetime) -> str:
    return ts.isoformat().replace("+00:00", "Z")


def parse_ts(text: str) -> datetime:
    return datetime.fromisoformat(text.replace("Z", "+00:00"))
