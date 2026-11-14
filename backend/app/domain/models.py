"""Pydantic models shared across the backend (AGENTS.md section 4)."""

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field

from app.domain.enums import AlertState, Hazard, HrpRisk, Quality, Severity, Signal


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
