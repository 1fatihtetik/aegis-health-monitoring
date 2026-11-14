"""Data simulator (PRD M2). Deterministic for a given scenario + seed.

One step = one tick of simulated time (mission.yaml tick_s). Radiation comes from a dose-rate replay
(app.datasets.rad: MSL/RAD, ISS DOSTEL, LRO CRaTER, EPA RadNet) when one is active for the phase; everything
else is synthetic.
"""

import math
import random
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any

from app.clock import SimClock
from app.config import Config
from app.datasets.rad import RadiationReplays, RadSample

Sample = tuple[str | None, str, float]  # (crew_id or None for cabin, signal, value)
DatedSample = tuple[datetime, str | None, str, float]

EFFECT_TYPES = {"spe", "co2_ramp", "insomnia", "orthostatic", "symptom"}


@dataclass
class Effect:
    type: str
    start: datetime
    end: datetime
    params: dict[str, Any]


@dataclass
class CrewState:
    id: str
    cfg: dict[str, Any]
    sleep_log: deque[int]
    mission_dose_mSv: float
    sheltered: bool = False
    extra: dict[str, float] = field(default_factory=dict)


class Simulator:
    def __init__(self, cfg: Config, clock: SimClock, seed: int, phase: str, start_ts: datetime,
                 radiation: RadiationReplays | None = None) -> None:
        self.cfg = cfg
        self.clock = clock
        self.seed = seed
        self.rng = random.Random(seed)
        self.start_ts = start_ts
        mission = cfg.mission
        self.tick = timedelta(seconds=mission["tick_s"])
        self.tick_h = mission["tick_s"] / 3600
        self.params = mission["sim"]
        self.effects: list[Effect] = []
        self.radiation = radiation
        self.rad_sample: RadSample | None = None  # last replayed RAD value (None = synthetic radiation)
        self.spe_active = False
        self.spe_replay_active = False
        self.set_phase(phase)
        bone = cfg.limits["bone"]["bmd_loss_pct_per_month_expected_0g"]
        self._bmd_rate = (bone["min"] + bone["max"]) / 2
        log_len = int(24 * 3600 / mission["tick_s"])
        replay = radiation.for_phase(phase) if radiation else None
        # Dose before the scenario: mission days x the replay's mean RAD rate (or the phase constant if synthetic).
        daily_dose = (replay.mean_equivalent_uSv_h if replay else self.phase_cfg["radiation_uSv_h"]) * 24 / 1000
        self._daily_dose_mSv = daily_dose
        self.crew = [
            CrewState(c["id"], c, deque(maxlen=log_len), self.elapsed_days(clock.now()) * daily_dose)
            for c in cfg.crew
        ]

    # ---- control -------------------------------------------------------------------------
    def neutron_fraction(self, spe_replay: bool = False) -> float:
        """Neutron share of the area dose equivalent: the phase heuristic unless the active replay overrides it
        (P-3: RadNet gamma detectors do not see neutrons, so that replay sets 0 rather than invent a share)."""
        replay = None
        if self.radiation is not None and self.rad_sample is not None:
            replay = self.radiation.for_event("spe") if spe_replay else self.radiation.for_phase(self.phase)
        if replay is not None and replay.neutron_fraction is not None:
            return replay.neutron_fraction
        return float(self.phase_cfg["neutron_fraction"])

    def set_phase(self, name: str) -> None:
        self.phase = name
        self.phase_cfg = self.cfg.mission["phases"][name]

    def add_effect(self, type_: str, start: datetime, end: datetime, params: dict[str, Any]) -> None:
        if type_ not in EFFECT_TYPES:
            raise ValueError(f"Unknown effect type '{type_}'")
        self.effects.append(Effect(type_, start, end, params))

    def set_sheltered(self, crew_id: str, sheltered: bool) -> None:
        for c in self.crew:
            if c.id == crew_id:
                c.sheltered = sheltered
                return
        raise KeyError(crew_id)

    def elapsed_days(self, ts: datetime) -> float:
        return self.cfg.mission["mission_day"] + (ts - self.start_ts).total_seconds() / 86400

    # ---- generation ----------------------------------------------------------------------
    def _effect(self, type_: str, t: datetime, crew_id: str | None = None) -> Effect | None:
        for e in self.effects:
            if e.type == type_ and e.start <= t < e.end and e.params.get("crew") in (None, crew_id):
                return e
        return None

    @staticmethod
    def _spe_factor(e: Effect, t: datetime) -> float:
        peak = float(e.params.get("peak_factor", 60))
        total = (e.end - e.start).total_seconds()
        ramp = min(float(e.params.get("ramp_s", 1200)), total / 2)
        decay = total * 0.3
        x = (t - e.start).total_seconds()
        if x < ramp:
            shape = x / ramp
        elif x > total - decay:
            shape = max(0.0, (total - x) / decay)
        else:
            shape = 1.0
        return 1.0 + (peak - 1.0) * shape

    def _does_session(self, c: CrewState, ts: datetime, session: int) -> bool:
        """Whether a planned exercise session happens. Separate seeded RNG, so other streams don't shift."""
        key = f"{self.seed}:ex:{c.id}:{ts.date().isoformat()}:{session}"
        return random.Random(key).random() < c.cfg["exercise_adherence"]

    def _adherence_pct(self, c: CrewState, day_start: datetime) -> float:
        planned = len(c.cfg["exercise_hours"])
        done = sum(self._does_session(c, day_start, i) for i in range(planned))
        return 100.0 * done / planned if planned else 100.0

    def _night_sleep(self, c: CrewState, ts: datetime) -> float:
        """History only: synthetic hours slept in the 24 h before ts."""
        r = random.Random(f"{self.seed}:sleep:{c.id}:{int(self.elapsed_days(ts))}")
        return max(3.0, min(9.0, r.gauss(7.6, 0.45)))

    def _daily(self, c: CrewState, ts: datetime) -> list[Sample]:
        day = self.elapsed_days(ts)
        r = random.Random(f"{self.seed}:{c.id}:{int(day)}")
        adherence = c.cfg["exercise_adherence"]
        base = c.cfg["baseline"]
        protect = self.params["exercise_bmd_protection"]
        bmd = 100 - self._bmd_rate * (day / 30.44) * (1 - protect * adherence) + r.gauss(0, 0.05)
        vo2 = base["vo2max_proxy"] * (1 - 0.0008 * day * (1 - adherence)) + r.gauss(0, 0.2)
        mass = base["body_mass"] * (1 - 0.00015 * day) + r.gauss(0, 0.15)
        return [(c.id, "bmd_estimate", bmd), (c.id, "vo2max_proxy", vo2), (c.id, "body_mass", mass)]

    def history(self) -> list[DatedSample]:
        """Daily long-term trend points up to the simulator's current time."""
        out: list[DatedSample] = []
        midnight = self.clock.now().replace(hour=0, minute=0, second=0, microsecond=0)
        for d in range(self.cfg.mission["history_days"], 0, -1):
            ts = midnight - timedelta(days=d - 1)
            day = self.elapsed_days(ts)
            if day < 0:
                continue
            report = ts + timedelta(hours=self.cfg.mission["sleep_report_hour"])
            for c in self.crew:
                out += [(ts, cid, sig, val) for cid, sig, val in self._daily(c, ts)]
                out.append((ts, c.id, "dose_mission", day * self._daily_dose_mSv))
                out.append((ts, c.id, "exercise_adherence_pct", self._adherence_pct(c, ts - timedelta(days=1))))
                if report <= self.clock.now():
                    out.append((report, c.id, "sleep_night_h", self._night_sleep(c, report)))
        out.sort(key=lambda s: s[0])
        return out

    def step(self) -> list[Sample]:
        self.clock.advance(self.tick)
        t = self.clock.now()
        h = t.hour + t.minute / 60 + t.second / 3600
        g = self.rng.gauss
        out: list[Sample] = []

        # ---- cabin + area radiation
        spe = self._effect("spe", t)
        self.spe_active = spe is not None
        spe_rad = self.radiation.sample_event(t, "spe", spe.start) if (spe and self.radiation) else None
        self.spe_replay_active = spe_rad is not None
        if spe_rad is not None:
            rad = spe_rad
            factor = 1.0
        else:
            factor = self._spe_factor(spe, t) if spe else 1.0
            rad = self.radiation.sample(t, self.phase) if self.radiation else None
        self.rad_sample = rad
        area_noise = g(0, 0.02)  # drawn either way, so the other RNG streams do not shift with the data source
        if rad:
            area = rad.equivalent_uSv_h * factor
            area_absorbed = rad.absorbed_uGy_h * factor
            q = rad.equivalent_uSv_h / rad.absorbed_uGy_h if rad.absorbed_uGy_h else self.params["quality_factor"]
        else:
            area = self.phase_cfg["radiation_uSv_h"] * factor * (1 + area_noise)
            q = self.params["quality_factor"]
            area_absorbed = area / q
        cab = self.params["cabin"]  # mission.yaml sim.cabin; sources in mission.yaml `sources` (R-6)

        def diurnal(c: dict[str, Any]) -> float:  # peaks at c["peak_h"]
            return float(c["diurnal_amp"]) * math.sin(2 * math.pi * (h - (c["peak_h"] - 6)) / 24)

        co2c = cab["ppco2_mmHg"]
        co2 = co2c["mean"] + diurnal(co2c) + g(0, co2c["sd"])
        ramp = self._effect("co2_ramp", t)
        if ramp:
            hours = (t - ramp.start).total_seconds() / 3600
            co2 += min(float(ramp.params.get("max_rise", 1.5)), float(ramp.params.get("rate_per_h", 0.2)) * hours)
        noise = cab["noise_dBA"]
        day_shift = noise["day_start_h"] <= h < noise["day_end_h"]
        temp = cab["temp_C"]
        out += [
            (None, "ppco2", co2),
            (None, "ppo2", cab["ppo2_kPa"]["mean"] + g(0, cab["ppo2_kPa"]["sd"])),
            (None, "cabin_pressure", cab["pressure_kPa"]["mean"] + g(0, cab["pressure_kPa"]["sd"])),
            (None, "cabin_temp", temp["mean"] + diurnal(temp) + g(0, temp["sd"])),
            (None, "humidity", cab["humidity_pct"]["mean"] + g(0, cab["humidity_pct"]["sd"])),
            (None, "noise_level", (noise["day"] if day_shift else noise["night"]) + g(0, noise["sd"])),
            (None, "area_dose_rate_absorbed", area_absorbed),
            (None, "area_dose_rate_equivalent", area),
            # Neutron share: fixed fraction of the area dose equivalent (CSA LEO ~30%, heuristic). Its noise is drawn
            # either way (RNG stream unchanged) but only applied to the synthetic background.
            (None, "neutron_dose_equivalent_rate",
             area * self.neutron_fraction(spe_rad is not None) * (1 + (0.0 if rad else 1.0) * g(0, 0.03))),
        ]
        if rad is not None and rad.saa is not None:
            out.append((None, "saa_transit", 1.0 if rad.saa else 0.0))

        # ---- crew
        midnight = t.hour == 0 and t.minute == 0 and t.second == 0
        sleep_report = t.hour == self.cfg.mission["sleep_report_hour"] and t.minute == 0 and t.second == 0
        bp_due = t.minute % 15 == 0 and t.second == 0
        for c in self.crew:
            base = c.cfg["baseline"]
            asleep = ((h - c.cfg["sleep_start_h"]) % 24) < 8
            insomnia = self._effect("insomnia", t, c.id)
            if asleep and insomnia:
                asleep = self.rng.random() < float(insomnia.params.get("sleep_fraction", 0.45))
            exercising = (not asleep) and any(
                0 <= h - eh < 1 and self._does_session(c, t, i) for i, eh in enumerate(c.cfg["exercise_hours"])
            )
            ortho = self._effect("orthostatic", t, c.id) if not asleep else None
            symptom = self._effect("symptom", t, c.id) if not asleep else None

            hr = base["hr_rest"] + 4 * math.sin(2 * math.pi * (h - 9) / 24) + g(0, 1.5)
            hrv = base["hrv"] + g(0, 2.0)
            sbp, dbp = base["sbp"] + g(0, 3.0), base["dbp"] + g(0, 2.0)
            resp = 14 + g(0, 0.5)
            if asleep:
                hr, hrv, resp = hr - 8, hrv * 1.15, resp - 2
            if exercising:
                hr, hrv, resp, sbp = hr + 55, hrv * 0.5, resp + 10, sbp + 10
            if spe:
                hr, hrv = hr + 6, hrv * 0.85
            if ortho:
                hr += float(ortho.params.get("hr_rise", 45))
                sbp -= float(ortho.params.get("sbp_drop", 32))
                dbp -= 12
            headache = 0.0
            if symptom:
                hr += float(symptom.params.get("hr_rise", 0))
                headache = float(symptom.params.get("headache", 0))

            dose_rate = area * (1 + g(0, 0.02))
            if c.sheltered and spe:
                dose_rate *= self.params["shelter_dose_factor"]
            c.mission_dose_mSv += dose_rate * self.tick_h / 1000
            c.sleep_log.append(1 if asleep else 0)

            cid = c.id
            activity = max(0.0, (5 if asleep else 900 if exercising else 120) + g(0, 4 if asleep else 30))
            out += [
                (cid, "heart_rate", hr),
                (cid, "hrv_rmssd", max(5.0, hrv)),
                (cid, "spo2", min(100.0, 97.5 + g(0, 0.4))),
                (cid, "resp_rate", resp),
                (cid, "skin_temp", 36.6 + 0.3 * math.sin(2 * math.pi * (h - 16) / 24) + g(0, 0.05)),
                (cid, "activity_counts", activity),
                (cid, "sleep_state", 1.0 if asleep else 0.0),
                (cid, "sleep_hours_24h", sum(c.sleep_log) * self.tick_h),
                (cid, "symptom_headache", headache),
                (cid, "dose_rate_equivalent", dose_rate),
                (cid, "dose_rate_absorbed", dose_rate / q),
                (cid, "dose_mission", c.mission_dose_mSv),
            ]
            if bp_due:
                out += [(cid, "bp_systolic", sbp), (cid, "bp_diastolic", dbp)]
            if sleep_report:
                out.append((cid, "sleep_night_h", sum(c.sleep_log) * self.tick_h))
            if midnight:
                out += self._daily(c, t)
                out.append((cid, "exercise_adherence_pct", self._adherence_pct(c, t - self.tick)))
        return out
