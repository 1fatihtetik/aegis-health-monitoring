"""Rule definitions loaded from config/rules.yaml."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.domain.enums import SIGNALS, Hazard, HrpRisk, RuleType, Severity, Signal

Op = Literal[">", "<", ">=", "<="]
Agg = Literal["mean", "min", "max", "last"]


class Predicate(BaseModel):
    """Inline signal predicate used inside a COMPOUND rule."""

    model_config = ConfigDict(extra="forbid")
    signal: Signal
    op: Op
    limit_ref: str
    window: str = "10m"
    agg: Agg = "mean"


class Rule(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str
    type: RuleType
    title: str
    signal: Signal | None = None
    op: Op = ">"
    limit_ref: str | None = None
    window: str = "10m"
    agg: Agg = "mean"
    baseline_window: str = "48h"
    scale: float = 1.0  # CUMULATIVE: converts the integral into the limit's unit
    unit: str | None = None
    all: list[str | Predicate] = Field(default_factory=list)
    any: list[str | Predicate] = Field(default_factory=list)
    none: list[str | Predicate] = Field(default_factory=list)  # COMPOUND: members that must NOT fire
    unless: list[Predicate] = Field(default_factory=list)  # simple rules: stand down while any of these holds
    context: str | None = None  # COMPOUND: groups rules that branch on context (same symptom, different cause)
    branch: str | None = None  # COMPOUND: this rule's branch within `context`
    severity: Severity
    hazards: list[Hazard] = Field(min_length=1)
    hrp_risks: list[HrpRisk] = Field(min_length=1)
    rationale: str
    action: str
    checklist: list[str] = Field(default_factory=list)
    alert: bool = True  # False: used only as a member of compound rules
    clear_margin: float = 0.03  # hysteresis: fraction of the limit the value must recover by

    @model_validator(mode="after")
    def _check_shape(self) -> "Rule":
        if self.type == RuleType.COMPOUND:
            if not (self.all or self.any):  # `none` alone would fire on silence
                raise ValueError(f"{self.id}: COMPOUND rule needs 'all' or 'any'")
            if self.unless:
                raise ValueError(f"{self.id}: COMPOUND rules use 'none', not 'unless'")
        elif self.signal is None or self.limit_ref is None:
            raise ValueError(f"{self.id}: {self.type} rule needs 'signal' and 'limit_ref'")
        return self

    @property
    def members(self) -> list[str | Predicate]:
        return [*self.all, *self.any, *self.none]

    @property
    def onboard_only(self) -> bool:
        """T-4: a simple rule on a questionnaire signal; its alert stays on board. A compound rule is sent with the
        questionnaire members redacted instead (world.py)."""
        return self.signal is not None and SIGNALS[str(self.signal)].onboard_only

    @property
    def limit_refs(self) -> list[str]:
        refs = [self.limit_ref] if self.limit_ref else []
        refs += [m.limit_ref for m in [*self.members, *self.unless] if isinstance(m, Predicate)]
        return refs
