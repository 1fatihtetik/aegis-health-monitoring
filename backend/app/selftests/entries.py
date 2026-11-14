"""Self-test entries (Block T): who entered which value, when and how. In memory only, never written to disk.

A value a person enters on the tablet is CREW_ENTERED; a result scripted for the synthetic crew stays SYNTHETIC
("scripted self-test result"). Both go through the normal observation path; this log only remembers their source per
(crew, signal), so alert evidence and badges name the right label for that crew member, and groups the values of
one submission into a result for the schedule (T-1).

A hand measurement of a signal the wearables also stream (BP, SpO2, heart rate, headache) replaces that crew
member's stream for `manual_override` (selftests.yaml), so the rules judge the hand measurement.
"""

from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

from app.datasets.registry import SignalSource
from app.domain.enums import SIGNALS, Provenance
from app.domain.models import Observation
from app.util import iso

ENTRY_BASIS = "Entered by the crew on the onboard tablet ({method}). Kept in memory only, not a NASA record."
SCRIPTED_BASIS = "Scripted self-test result for the synthetic crew (scenario {scenario}); not entered by a person."


@dataclass
class Entry:
    ts: datetime
    crew_id: str
    signal: str
    value: float
    source: SignalSource
    test_id: str | None
    method: str | None


class EntryLog:
    def __init__(self, override: timedelta) -> None:
        self.override = override
        self.latest: dict[tuple[str, str], Entry] = {}
        self._recent: dict[tuple[str, str], list[Entry]] = {}  # newest last, trimmed to the override span
        self.results: list[dict[str, Any]] = []  # one per submission (test_id, crew, ts), oldest first

    def record(self, obs: Observation, scenario: str) -> Entry | None:
        """Remembers a crew-entered value or a scripted self-test result. Other observations return None."""
        crew_entered = obs.provenance == Provenance.CREW_ENTERED
        if obs.crew_id is None or not (crew_entered or obs.test_id):
            return None
        signal = obs.signal.value
        if crew_entered:
            source = SignalSource(Provenance.CREW_ENTERED, None, ENTRY_BASIS.format(method=obs.entry_method))
        else:
            source = SignalSource(obs.provenance, obs.dataset_id, SCRIPTED_BASIS.format(scenario=scenario))
        entry = Entry(obs.ts, obs.crew_id, signal, obs.value, source, obs.test_id, obs.entry_method)
        key = (obs.crew_id, signal)
        self.latest[key] = entry
        recent = [e for e in self._recent.get(key, []) if e.ts > entry.ts - self.override]
        self._recent[key] = sorted([*recent, entry], key=lambda e: e.ts)
        if obs.test_id:
            self._add_result(entry)
        return entry

    def _add_result(self, entry: Entry) -> None:
        last = self.results[-1] if self.results else None
        if (last and last["test_id"] == entry.test_id and last["crew_id"] == entry.crew_id
                and last["ts"] == iso(entry.ts)):
            last["values"][entry.signal] = entry.value
            return
        self.results.append({
            "test_id": entry.test_id, "crew_id": entry.crew_id, "ts": iso(entry.ts),
            "values": {entry.signal: entry.value}, "provenance": entry.source.provenance.value,
            "entry_method": entry.method, "basis": entry.source.basis,
        })

    def override_start(self, crew_id: str | None, signal: str, now: datetime) -> datetime | None:
        """Start of a hand measurement that still replaces the wearable stream, else None."""
        if crew_id is None or SIGNALS[signal].entry_only:
            return None
        entry = self.latest.get((crew_id, signal))
        if entry is not None and entry.ts <= now < entry.ts + self.override:
            return entry.ts
        return None

    def override_values(self, crew_id: str | None, signal: str, now: datetime) -> list[float] | None:
        """While a hand measurement replaces the wearable stream: the hand values of that span, newest first (what
        the rules judge instead of the store window). None when no override is active."""
        if self.override_start(crew_id, signal, now) is None:
            return None
        assert crew_id is not None
        return [e.value for e in reversed(self._recent[(crew_id, signal)]) if e.ts > now - self.override]

    def source(self, crew_id: str | None, signal: str, now: datetime, latest_ts: datetime | None) -> SignalSource | None:
        """The entry's source while it is the value being judged: during the override, or while no newer point."""
        entry = self.latest.get((crew_id, signal)) if crew_id else None
        if entry is None:
            return None
        if self.override_start(crew_id, signal, now) is not None or latest_ts is None or latest_ts <= entry.ts:
            return entry.source
        return None

    def results_for(self, crew_id: str | None = None) -> list[dict[str, Any]]:
        return [r for r in self.results if crew_id is None or r["crew_id"] == crew_id]
