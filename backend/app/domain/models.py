"""Pydantic models shared across the backend (AGENTS.md section 4)."""

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field, model_validator

from app.domain.enums import AlertState, Hazard, HrpRisk, Provenance, Quality, Severity, Signal

# Block T: how a CREW_ENTERED value was entered on the tablet.
EntryMethod = Literal["form", "tap", "pvt", "questionnaire", "stand_test", "amsler"]


class Observation(BaseModel):
    id: str
    ts: datetime
    crew_id: str | None = None
    location: str | None = None
    device_id: str
    signal: Signal
    value: float
    unit: str
    quality: Quality = Quality.GOOD
    phase: str | None = None
    provenance: Provenance = Provenance.SYNTHETIC
    dataset_id: str | None = None
    entry_method: EntryMethod | None = None  # Block T: required for CREW_ENTERED
    test_id: str | None = None  # Block T: the self-test (config/selftests.yaml) this value is a result of
    countermeasure_id: str | None = None  # Block C: the countermeasure (config/countermeasures.yaml) logged as done

    @model_validator(mode="after")
    def _nasa_needs_dataset(self) -> "Observation":
        if self.provenance.needs_dataset and not self.dataset_id:
            raise ValueError(f"provenance {self.provenance} needs a dataset_id (data/nasa/MANIFEST.yaml)")
        if self.provenance == Provenance.CREW_ENTERED:
            if self.dataset_id:
                raise ValueError("CREW_ENTERED values come from a person, not a dataset; dataset_id must be null")
            if not self.entry_method:
                raise ValueError("CREW_ENTERED values must record their entry_method")
            if not self.crew_id:
                raise ValueError("CREW_ENTERED values must name the crew member (crew_id)")
        elif self.entry_method:
            raise ValueError("entry_method is only for CREW_ENTERED values")
        return self


class Alert(BaseModel):
    id: str
    rule_id: str
    title: str
    crew_id: str | None
    severity: Severity
    state: AlertState = AlertState.RAISED
    raised_ts: datetime
    ack_ts: datetime | None = None
    resolved_ts: datetime | None = None
    hazards: list[Hazard]
    hrp_risks: list[HrpRisk]
    evidence: dict[str, Any]
    rationale: str
    action: str
    checklist: list[str] = Field(default_factory=list)
    notes: list[dict[str, Any]] = Field(default_factory=list)
    origin: str = "ONBOARD"
    onboard_only: bool = False  # T-4: raised from a questionnaire answer; never sent to the ground
