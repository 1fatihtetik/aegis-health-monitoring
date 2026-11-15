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


class Provenance(StrEnum):
    """Where a value comes from (PRD section 6 M0). Ordered from least to most real."""

    SYNTHETIC = "SYNTHETIC"  # simulated, heuristic parameters
    SYNTHETIC_CALIBRATED = "SYNTHETIC_CALIBRATED"  # simulated, parameters cite a NASA source
    # Block T, T-0: a value a person typed or tapped in the onboard UI (self-test, questionnaire, headache report).
    # No dataset; the entry method is recorded. Kept in memory only. Ranks above the simulated labels (a person
    # really entered it) and below every replayed measurement (it is not an instrument record from an archive).
    CREW_ENTERED = "CREW_ENTERED"
    # Block P, P-0: replayed measurement from a non-NASA agency (e.g. EPA RadNet). It ranks below the NASA
    # labels so a group with a non-NASA member (weakest(), compound evidence) is never labelled NASA.
    MEASURED_OTHER = "MEASURED_OTHER"
    NASA_DERIVED = "NASA_DERIVED"  # computed from NASA data by a formula named in the manifest
    NASA_MEASURED = "NASA_MEASURED"  # replayed value from a NASA archive

    @property
    def rank(self) -> int:
        return list(Provenance).index(self)

    @property
    def needs_dataset(self) -> bool:
        """Measured or derived values must name the bundled dataset they come from."""
        return self in (Provenance.MEASURED_OTHER, Provenance.NASA_DERIVED, Provenance.NASA_MEASURED)


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
    entry_only: bool = False  # Block T: only crew entries or scripted self-test results produce it (never the simulator)
    onboard_only: bool = False  # Block T, T-4: never leaves the spacecraft (link/ strips it, also from alert evidence)


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
    "area_dose_rate_absorbed": SignalMeta("µGy/h", "cabin", "area_dosimeter"),
    "area_dose_rate_equivalent": SignalMeta("µSv/h", "cabin", "area_dosimeter"),
    "neutron_dose_equivalent_rate": SignalMeta("µSv/h", "cabin", "neutron_spectrometer"),
    # P-1: 1 while the spacecraft is inside the South Atlantic Anomaly box, else 0. Emitted only while a LEO
    # replay with position data is active. Lets the SPE rule stand down for trapped-proton spikes.
    "saa_transit": SignalMeta("0=out,1=in", "cabin", "navigation"),
    # Block T, T-7: days the crew has spent below 1 g (mission timeline; resets at 1 g). Feeds the SANS watch rule.
    "low_g_days": SignalMeta("days", "cabin", "mission_timeline"),
    # Block T, T-3: guided measurements the crew takes by hand (entry_only: the simulator never produces them).
    "body_temp": SignalMeta("°C", "crew", "self_test", entry_only=True),
    "glucose": SignalMeta("mg/dL", "crew", "self_test", entry_only=True),
    "fluid_intake": SignalMeta("mL", "crew", "self_test", daily=True, entry_only=True),
    "sodium_intake": SignalMeta("mg", "crew", "self_test", daily=True, entry_only=True),
    # T-2: PVT-B reaction-time test results (Basner et al. 2011), one value each per test.
    "pvt_mean_rt": SignalMeta("ms", "crew", "self_test", entry_only=True),
    "pvt_lapses": SignalMeta("count", "crew", "self_test", entry_only=True),
    "pvt_false_starts": SignalMeta("count", "crew", "self_test", entry_only=True),
    # T-5: stand test summary (Lee et al. 2015, wall-lean adaptation), computed on the tablet from the supine
    # reading and the 1/3/5/10 min standing readings. Drops/rises are supine minus worst standing (may be negative).
    "stand_sbp_drop": SignalMeta("mmHg", "crew", "self_test", entry_only=True),
    "stand_dbp_drop": SignalMeta("mmHg", "crew", "self_test", entry_only=True),
    "stand_hr_rise": SignalMeta("bpm", "crew", "self_test", entry_only=True),
    "stand_pulse_pressure_min": SignalMeta("mmHg", "crew", "self_test", entry_only=True),
    "stand_pulse_pressure_pct": SignalMeta("% of SBP", "crew", "self_test", entry_only=True),
    "stand_early_stop": SignalMeta("0=no,1=stopped", "crew", "self_test", entry_only=True),
    "stand_minutes": SignalMeta("min", "crew", "self_test", entry_only=True),
    # T-4: questionnaire answers. Onboard only: link/ never sends them, not even inside alert evidence or rollups.
    "kss": SignalMeta("1-9", "crew", "questionnaire", entry_only=True, onboard_only=True),
    "tlx_workload": SignalMeta("0-100", "crew", "questionnaire", entry_only=True, onboard_only=True),
    "motion_sickness": SignalMeta("0-10", "crew", "questionnaire", entry_only=True, onboard_only=True),
    "mood": SignalMeta("1-5", "crew", "questionnaire", entry_only=True, onboard_only=True),
}

Signal = StrEnum("Signal", {name.upper(): name for name in SIGNALS})  # type: ignore[misc]
