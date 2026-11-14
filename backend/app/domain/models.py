"""Pydantic models shared across the backend (AGENTS.md section 4)."""

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field, model_validator

from app.domain.enums import AlertState, Hazard, HrpRisk, Provenance, Quality, Severity, Signal


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

    @model_validator(mode="after")
    def _nasa_needs_dataset(self) -> "Observation":
        if self.provenance in (Provenance.NASA_MEASURED, Provenance.NASA_DERIVED) and not self.dataset_id:
            raise ValueError(f"provenance {self.provenance} needs a dataset_id (data/nasa/MANIFEST.yaml)")
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
