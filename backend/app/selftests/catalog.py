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
    # Normal band for the form when no single-value rule judges this field (e.g. diastolic BP): limit refs into
    # limits.yaml, shown with the unverified marker. Display only; rules still come from rules.yaml.
    band_low: str | None = None
    band_high: str | None = None
    anchors: dict[int, str] = Field(default_factory=dict)  # words on tap-scale buttons (F-010), e.g. 1: "Mild"

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


class Item(BaseModel):
    """T-4: one questionnaire item. The answers combine into the test's single field by `score`."""

    model_config = ConfigDict(extra="forbid")
    label: str
    min: float
    max: float
    step: float = 1.0
    anchors: dict[int, str] = Field(default_factory=dict)  # verbal labels at some scale points

    @model_validator(mode="after")
    def _range(self) -> "Item":
        if self.min >= self.max:
            raise ValueError(f"item '{self.label}': min must be below max")
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
    # Protocol parameters the test screen runs with (e.g. PVT-B duration and gaps). Medical limits stay in limits.yaml.
    params: dict[str, float] = Field(default_factory=dict)
    short_mode_note: str = ""  # a demo-length variant must say it is not the real protocol
    schedule: Schedule | None = None
    after_gravity_increase: bool = False  # T-1: extra check after a gravity increase
    onboard_only: bool = False  # T-4: answers never leave the spacecraft
    items: list[Item] = Field(default_factory=list)  # T-4 questionnaire items
    score: Literal["mean"] | None = None  # how the item answers combine into the single field
    checkpoints_min: list[float] = Field(default_factory=list)  # T-5: standing reading times (minutes)
    stop_steps: list[str] = Field(default_factory=list)  # T-5: what to do at once after tapping STOP

    @model_validator(mode="after")
    def _consistent(self) -> "SelfTest":
        for f in self.fields:  # a questionnaire signal must be in an onboard-only test and nowhere else
            if SIGNALS[f.signal].onboard_only != self.onboard_only:
                raise ValueError(f"{self.id}: {f.signal} onboard_only does not match the test")
        if self.kind == "questionnaire":
            if not self.items or self.score is None or len(self.fields) != 1:
                raise ValueError(f"{self.id}: a questionnaire needs items, a score and exactly one field")
            f = self.fields[0]
            if min(i.min for i in self.items) < f.input_min or max(i.max for i in self.items) > f.input_max:
                raise ValueError(f"{self.id}: item ranges must fit the field range")
        if self.kind == "stand_test":
            need = {"supine_s", "stand_s", "min_gravity_g", "time_scale"}
            if not need <= set(self.params) or not self.checkpoints_min or not self.stop_steps:
                raise ValueError(f"{self.id}: a stand test needs params {sorted(need)}, checkpoints_min and stop_steps")
            if self.checkpoints_min != sorted(self.checkpoints_min) or self.checkpoints_min[-1] * 60 != self.params["stand_s"]:
                raise ValueError(f"{self.id}: checkpoints must rise and the last one must end the stand")
            if self.params["time_scale"] != 1 and not self.short_mode_note:
                raise ValueError(f"{self.id}: a shortened stand test must say it is not the real protocol")
        return self


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
