"""Self-test catalog (config/selftests.yaml, PRD section 6 M11).

Every test explains itself from here: why it exists (RIDGE hazard + HRP risk), numbered steps, the normal band
(limit refs into limits.yaml, so the unverified marker comes along), and when to involve the CMO or the ground.
No test text lives in a component. The loader refuses an entry without hazards, HRP risks, steps or with an unknown
limit ref or signal.
"""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.domain.enums import SIGNALS, Hazard, HrpRisk
from app.domain.models import EntryMethod
from app.util import parse_duration

TestKind = Literal["measurement", "report", "pvt", "questionnaire", "stand_test", "amsler"]


class Setting(BaseModel):
    model_config = ConfigDict(extra="forbid")
    value: str
    source_ref: str


class Field_(BaseModel):
    """One value the crew enters. input_min/max is a plausibility range for typing, not a medical limit."""

    model_config = ConfigDict(extra="forbid")
    signal: str
    label: str
    input_min: float
    input_max: float
    step: float = 1.0
    hint: str = ""

    @field_validator("signal")
    @classmethod
    def _known_signal(cls, v: str) -> str:
        if v not in SIGNALS:
            raise ValueError(f"unknown signal '{v}'")
        return v

    @model_validator(mode="after")
    def _range(self) -> "Field_":
        if self.input_min >= self.input_max:
            raise ValueError(f"{self.signal}: input_min must be below input_max")
        return self


class Schedule(BaseModel):
    """T-1: a slot every `every`, starting at `at` (UTC, sim clock); due for `due_window`, then overdue (INFO)."""

    model_config = ConfigDict(extra="forbid")
    every: str
    at: str = "00:00"
    due_window: str = "3h"

    @model_validator(mode="after")
    def _durations(self) -> "Schedule":
        parse_duration(self.every)
        parse_duration(self.due_window)
        hh, mm = self.at.split(":")
        if not (0 <= int(hh) < 24 and 0 <= int(mm) < 60):
            raise ValueError(f"bad time of day '{self.at}'")
        return self


class SelfTest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str
    title: str
    kind: TestKind
    entry_method: EntryMethod
    fields: list[Field_] = Field(default_factory=list)
    why: str = Field(min_length=1)
    hazards: list[Hazard] = Field(min_length=1)
    hrp_risks: list[HrpRisk] = Field(min_length=1)
    steps: list[str] = Field(min_length=1)
    limit_refs: list[str] = Field(default_factory=list)
    escalation: str = Field(min_length=1)
    protocol: str = ""  # named method and source, e.g. "PVT-B (Basner et al. 2011)"
    schedule: Schedule | None = None
    after_gravity_increase: bool = False  # T-1: extra check after a gravity increase
    onboard_only: bool = False  # T-4: answers never leave the spacecraft


class Catalog(BaseModel):
    model_config = ConfigDict(extra="forbid")
    settings: dict[str, Setting] = Field(default_factory=dict)
    tests: list[SelfTest]

    @model_validator(mode="after")
    def _unique(self) -> "Catalog":
        ids = [t.id for t in self.tests]
        if len(ids) != len(set(ids)):
            raise ValueError("selftests.yaml has duplicate test ids")
        return self

    def test(self, test_id: str) -> SelfTest:
        for t in self.tests:
            if t.id == test_id:
                return t
        raise KeyError(f"Unknown self-test '{test_id}'")

    def setting(self, name: str) -> str:
        return self.settings[name].value
