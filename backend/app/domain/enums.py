"""Domain enums (PRD section 7)."""

from dataclasses import dataclass
from enum import StrEnum


class Hazard(StrEnum):
    RADIATION = "RADIATION"
    ISOLATION_CONFINEMENT = "ISOLATION_CONFINEMENT"
    DISTANCE_FROM_EARTH = "DISTANCE_FROM_EARTH"
    GRAVITY_FIELDS = "GRAVITY_FIELDS"
    HOSTILE_CLOSED_ENV = "HOSTILE_CLOSED_ENV"


# HRP-01 .. HRP-17 (PRD section 7.2)
HrpRisk = StrEnum("HrpRisk", {f"HRP_{i:02d}": f"HRP-{i:02d}" for i in range(1, 18)})  # type: ignore[misc]


class Severity(StrEnum):
    INFO = "INFO"
    CAUTION = "CAUTION"
    WARNING = "WARNING"
    EMERGENCY = "EMERGENCY"

    @property
    def rank(self) -> int:
        return list(Severity).index(self)


class AlertState(StrEnum):
    RAISED = "RAISED"
    ACKNOWLEDGED = "ACKNOWLEDGED"
    IN_TREATMENT = "IN_TREATMENT"
    RESOLVED = "RESOLVED"


class RuleType(StrEnum):
    THRESHOLD = "THRESHOLD"
    BASELINE = "BASELINE"
    CUMULATIVE = "CUMULATIVE"
    COMPOUND = "COMPOUND"


class Quality(StrEnum):
    GOOD = "GOOD"
    SUSPECT = "SUSPECT"
    BAD = "BAD"


@dataclass(frozen=True)
class SignalMeta:
    unit: str
    scope: str  # "crew" or "cabin"
    device: str
    daily: bool = False  # emitted once per day (long-term trend signals)


# Canonical units per signal (PRD section 7.3). Adapters convert; the engine never converts.
SIGNALS: dict[str, SignalMeta] = {
    "heart_rate": SignalMeta("bpm", "crew", "biomonitor"),
    "hrv_rmssd": SignalMeta("ms", "crew", "biomonitor"),
    "spo2": SignalMeta("%", "crew", "biomonitor"),
    "resp_rate": SignalMeta("/min", "crew", "biomonitor"),
    "skin_temp": SignalMeta("°C", "crew", "biomonitor"),
    "bp_systolic": SignalMeta("mmHg", "crew", "biomonitor"),
    "bp_diastolic": SignalMeta("mmHg", "crew", "biomonitor"),
    "activity_counts": SignalMeta("counts/min", "crew", "actigraphy"),
    "sleep_state": SignalMeta("0=awake,1=asleep", "crew", "actigraphy"),
    "sleep_hours_24h": SignalMeta("h", "crew", "actigraphy"),
    "symptom_headache": SignalMeta("0-3", "crew", "self_report"),
    "dose_rate_equivalent": SignalMeta("µSv/h", "crew", "dosimeter"),
    "dose_rate_absorbed": SignalMeta("µGy/h", "crew", "dosimeter"),
    "dose_mission": SignalMeta("mSv", "crew", "dosimeter"),
    "bmd_estimate": SignalMeta("% of baseline", "crew", "model", daily=True),
    "body_mass": SignalMeta("kg", "crew", "manual", daily=True),
    "vo2max_proxy": SignalMeta("ml/kg/min", "crew", "model", daily=True),
    "sleep_night_h": SignalMeta("h", "crew", "actigraphy", daily=True),
    "exercise_adherence_pct": SignalMeta("%", "crew", "exercise_log", daily=True),
    "ppco2": SignalMeta("mmHg", "cabin", "cabin"),
    "ppo2": SignalMeta("kPa", "cabin", "cabin"),
    "cabin_pressure": SignalMeta("kPa", "cabin", "cabin"),
    "cabin_temp": SignalMeta("°C", "cabin", "cabin"),
    "humidity": SignalMeta("%RH", "cabin", "cabin"),
    "noise_level": SignalMeta("dBA", "cabin", "cabin"),
    "area_dose_rate_equivalent": SignalMeta("µSv/h", "cabin", "area_dosimeter"),
    "neutron_dose_equivalent_rate": SignalMeta("µSv/h", "cabin", "neutron_spectrometer"),
}

Signal = StrEnum("Signal", {name.upper(): name for name in SIGNALS})  # type: ignore[misc]
