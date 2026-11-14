"""Per-signal provenance over time (PRD section 6 M0).

Starts from the registry defaults. A replay adapter (R-2 onwards) or an ingested Observation
can change a signal's source from a given timestamp, so a chart can show where each stretch
of a series came from. Keyed by signal, because a source feeds a signal for all crew at once.
"""

from datetime import datetime
from typing import Any

from app.datasets.registry import DatasetRegistry, SignalSource
from app.domain.enums import SIGNALS, Provenance
from app.util import iso

Segment = tuple[datetime | None, SignalSource]  # (since, source); since None = from the start


class ProvenanceTracker:
    def __init__(self, registry: DatasetRegistry) -> None:
        self.registry = registry
        self._segments: dict[str, list[Segment]] = {name: [(None, registry.source(name))] for name in SIGNALS}

    def set(self, signal: str, provenance: Provenance, dataset_id: str | None, since: datetime,
            basis: str = "") -> None:
        """Start a new segment if the source changed. A known dataset_id brings its manifest details, and
        stands in for an empty basis, so tapping any badge shows where the value came from (F-006)."""
        meta = self.registry.dataset_meta(dataset_id)
        if not basis and meta:
            basis = f"{meta['title']}. {meta['transform']}"
        current = self.current(signal)
        if (current.provenance, current.dataset_id, current.basis) == (provenance, dataset_id, basis):
            return
        self._segments[signal].append((since, SignalSource(provenance, dataset_id, basis, meta)))

    def current(self, signal: str) -> SignalSource:
        return self._segments[signal][-1][1]

    def at(self, signal: str, ts: datetime) -> SignalSource:
        found = self._segments[signal][0][1]
        for since, src in self._segments[signal]:
            if since is not None and since > ts:
                break
            found = src
        return found

    def segments(self, signal: str, start: datetime | None = None, end: datetime | None = None) -> list[dict[str, Any]]:
        """Segments overlapping [start, end], oldest first."""
        segs = self._segments[signal]
        out = []
        for i, (since, src) in enumerate(segs):
            until = segs[i + 1][0] if i + 1 < len(segs) else None
            if end is not None and since is not None and since > end:
                continue
            if start is not None and until is not None and until <= start:
                continue
            out.append({"since": iso(since) if since else None, **src.as_dict()})
        return out

    def snapshot(self) -> dict[str, dict[str, Any]]:
        return {name: self.current(name).as_dict() for name in SIGNALS}


def weakest(provenances: list[str]) -> str:
    """The least-real provenance of a group, e.g. for compound-rule evidence."""
    if not provenances:
        return Provenance.SYNTHETIC.value
    return min((Provenance(p) for p in provenances), key=lambda p: p.rank).value
