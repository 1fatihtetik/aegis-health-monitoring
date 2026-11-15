"""Countermeasure catalog (config/countermeasures.yaml, Block C, PRD section 6 M5).

Every item explains itself from here: why (RIDGE hazard + HRP risk), numbered onboard steps, the equipment, the
prescription (limit refs into limits.yaml, so the not-NASA marker comes along) and when to involve the CMO. An item
is on the plan through a daily exercise slot (`session`), a daily `schedule`, an open alert (`triggered_by`) or a Hold
on a readiness gate (`triggered_by_gate`). The loader refuses an item without hazards, HRP risks, steps or a
prescription; config.py refuses unknown limit refs, rules, tests and gates.
"""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.domain.enums import Hazard, HrpRisk
from app.selftests.catalog import Schedule, Setting

CmType = Literal["EXERCISE", "NUTRITION", "THIGH_CUFF", "LIGHT", "FLUID_LOADING"]
# Fixed order of the types on every chart (never sorted by a value).
TYPE_ORDER: tuple[CmType, ...] = ("EXERCISE", "NUTRITION", "THIGH_CUFF", "LIGHT", "FLUID_LOADING")


class Prescription(BaseModel):
    model_config = ConfigDict(extra="forbid")
    label: str
    limit_ref: str


class Countermeasure(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str
    title: str
    type: CmType
    equipment: str = Field(min_length=1)
    why: str = Field(min_length=1)
    hazards: list[Hazard] = Field(min_length=1)
    hrp_risks: list[HrpRisk] = Field(min_length=1)
    steps: list[str] = Field(min_length=1)
    prescription: list[Prescription] = Field(min_length=1)
    escalation: str = Field(min_length=1)
    session: int | None = None  # index into each crew member's exercise_hours (crew.yaml)
    due_window: str = "2h"  # session items: how long the slot is "now" before it shows as not logged (INFO)
    schedule: Schedule | None = None  # daily slot for non-exercise items
    log_minutes: bool = False  # Done also logs exercise_minutes (pre-filled with the session prescription)
    minutes_max: float = 240  # typing plausibility for exercise_minutes, not a medical limit
    done_by_test: str | None = None  # a self-test result that day counts as Done (e.g. the intake test)
    triggered_by: list[str] = Field(default_factory=list)  # rule ids: on the plan while one of them is open
    triggered_by_gate: list[Literal["LANDING", "EVA"]] = Field(default_factory=list)  # on the plan during a Hold

    @model_validator(mode="after")
    def _on_the_plan(self) -> "Countermeasure":
        if self.session is not None and self.schedule is not None:
            raise ValueError(f"{self.id}: use either session or schedule, not both")
        if self.session is None and self.schedule is None and not (self.triggered_by or self.triggered_by_gate):
            raise ValueError(f"{self.id}: needs a session, a schedule, triggered_by or triggered_by_gate")
        if self.session is not None and self.type != "EXERCISE":
            raise ValueError(f"{self.id}: only EXERCISE items use an exercise session slot")
        if self.log_minutes and self.type != "EXERCISE":
            raise ValueError(f"{self.id}: only EXERCISE items log minutes")
        return self


class CountermeasureCatalog(BaseModel):
    model_config = ConfigDict(extra="forbid")
    settings: dict[str, Setting] = Field(default_factory=dict)
    items: list[Countermeasure] = Field(min_length=1)

    @model_validator(mode="after")
    def _unique(self) -> "CountermeasureCatalog":
        ids = [i.id for i in self.items]
        if len(ids) != len(set(ids)):
            raise ValueError("countermeasures.yaml has duplicate item ids")
        sessions = [i.session for i in self.items if i.session is not None]
        if len(sessions) != len(set(sessions)):
            raise ValueError("countermeasures.yaml: two items use the same exercise session slot")
        return self

    def item(self, cm_id: str) -> Countermeasure:
        for i in self.items:
            if i.id == cm_id:
                return i
        raise KeyError(f"Unknown countermeasure '{cm_id}'")

    def for_session(self, index: int) -> Countermeasure | None:
        return next((i for i in self.items if i.session == index), None)

    def setting(self, name: str) -> str:
        return self.settings[name].value
