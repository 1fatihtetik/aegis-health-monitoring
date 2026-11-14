"""Radiation summary and SPE state (PRD M6)."""

from datetime import datetime, timedelta
from typing import Any

from app.config import Config
from app.db.store import SeriesStore
from app.domain.enums import AlertState
from app.domain.models import Alert
from app.util import iso

SPE_RULE_ID = "rad.spe.dose_rate"
HAZARDS = ["RADIATION"]
HRP_RISKS = ["HRP-17"]


def _dose_mSv(store: SeriesStore, crew_id: str, since: datetime, tick_h: float) -> float:
    return sum(store.window(crew_id, "dose_rate_equivalent", since)) * tick_h / 1000


def radiation_summary(
    cfg: Config, store: SeriesStore, alerts: list[Alert], sheltered: dict[str, bool], now: datetime
) -> dict[str, Any]:
    tick_h = cfg.mission["tick_s"] / 3600
    career = cfg.limit("radiation.career_effective_dose_mSv")
    limit_24h = cfg.limit("radiation.dose_24h_mSv_max")
    spe_limit = cfg.limit("radiation.spe_alert_dose_rate_uSv_h")

    spe_alerts = sorted((a for a in alerts if a.rule_id == SPE_RULE_ID), key=lambda a: a.raised_ts)
    last = spe_alerts[-1] if spe_alerts else None
    active = last is not None and last.state != AlertState.RESOLVED

    crew: dict[str, Any] = {}
    for c in cfg.crew:
        cid = c["id"]
        rate = store.latest(cid, "dose_rate_equivalent")
        mission = store.latest(cid, "dose_mission")
        mission_mSv = mission[1] if mission else 0.0
        ago_30d = store.value_at(cid, "dose_mission", now - timedelta(days=30))
        career_mSv = c["career_dose_prior_mSv"] + mission_mSv
        entry: dict[str, Any] = {
            "dose_rate_uSv_h": round(rate[1], 2) if rate else None,
            "dose_24h_mSv": round(_dose_mSv(store, cid, now - timedelta(hours=24), tick_h), 3),
            "dose_30d_mSv": round(mission_mSv - ago_30d, 2) if ago_30d is not None else None,
            "dose_mission_mSv": round(mission_mSv, 2),
            "dose_career_mSv": round(career_mSv, 2),
            "career_pct_of_limit": round(100 * career_mSv / career.value, 1),
            "sheltered": sheltered.get(cid, False),
        }
        if last is not None:
            # Dose received between the SPE alert being raised and resolved (or now).
            values = store.window(cid, "dose_rate_equivalent", last.raised_ts)
            if last.resolved_ts:
                values = values[len(store.window(cid, "dose_rate_equivalent", last.resolved_ts)):]
            entry["event_dose_mSv"] = round(sum(values) * tick_h / 1000, 3)
        crew[cid] = entry

    area = store.latest(None, "area_dose_rate_equivalent")
    neutron = store.latest(None, "neutron_dose_equivalent_rate")
    spectrum = [
        {
            "energy_range": b["energy_range"],
            "flux_fraction": b["fraction"],
            "quality_factor": b["quality_factor"],
            "dose_rate_uSv_h": round(neutron[1] * b["fraction"], 3) if neutron else None,
        }
        for b in cfg.mission["sim"]["neutron_spectrum"]
    ]
    spe: dict[str, Any] = {"active": active, "threshold": spe_limit.as_dict()}
    if last is not None:
        spe |= {
            "alert_id": last.id,
            "since": iso(last.raised_ts),
            "ended": iso(last.resolved_ts) if last.resolved_ts else None,
            "elapsed_s": ((last.resolved_ts or now) - last.raised_ts).total_seconds(),
            "checklist": last.checklist,
            "headcount": {cid: sheltered.get(cid, False) for cid in crew},
            "all_sheltered": all(sheltered.get(cid, False) for cid in crew),
        }
    return {
        "crew": crew,
        "area": {
            "dose_rate_uSv_h": round(area[1], 2) if area else None,
            "neutron_rate_uSv_h": round(neutron[1], 2) if neutron else None,
            "neutron_fraction": round(neutron[1] / area[1], 3) if area and neutron and area[1] else None,
            "neutron_spectrum": spectrum,
            "neutron_spectrum_note": "Synthetic split of the neutron dose rate (simulator parameter, unverified).",
        },
        "limits": {"career": career.as_dict(), "dose_24h": limit_24h.as_dict(), "spe_dose_rate": spe_limit.as_dict()},
        "spe": spe,
        "hazards": HAZARDS,
        "hrp_risks": HRP_RISKS,
    }
