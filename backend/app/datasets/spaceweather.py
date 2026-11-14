"""Space-weather context for the replayed SPE (R-5, AGENTS.md section 2a D3).

Reads the bundled DONKI SEP/FLR/CME records and the OMNI2 hourly near-Earth proton flux listed under
`space_weather` in config/datasets.yaml. Nothing here touches the network. A missing or tampered file only drops
its part of the card (the reason is reported); the crew app never depends on this.

Ground knowledge: the ground console shows it and can forward a plain-language brief to the crew through the
delayed link (World.send_recommendation). The onboard engine never reads it.
"""

import csv
import json
from typing import Any

from app.config import Config
from app.datasets.registry import DatasetRegistry

S_LEVELS = ("s1", "s2", "s3", "s4", "s5")


def _hhmm(ts: str | None) -> str:
    """'2012-03-07T00:24Z' -> '00:24 UTC'."""
    return f"{ts[11:16]} UTC" if ts and len(ts) >= 16 else "time unknown"


class SpaceWeather:
    def __init__(self, cfg: Config) -> None:
        reg: DatasetRegistry = cfg.datasets
        spec = reg.space_weather_spec
        self.s_scale = [
            {"level": lvl.upper(), **cfg.limit(f"space_weather.proton_flux_{lvl}_pfu").as_dict()} for lvl in S_LEVELS
        ]
        self.event: dict[str, Any] = {
            "available": False, "event_date": spec.get("event_date"), "title": spec.get("title", ""),
            "provenance": "NASA_MEASURED", "sep": [], "flares": [], "cmes": [], "flux": None,
            "s_scale": self.s_scale, "sources": {}, "problems": [],
        }
        for part, (did, rel, reason) in reg.space_weather_files.items():
            if reason:
                self.event["problems"].append(f"{part}: {reason}")
                continue
            path = reg.data_dir / rel
            self.event["sources"][part] = reg.dataset_meta(did)
            if part == "sep":
                self.event["sep"] = [self._sep(r) for r in json.loads(path.read_text(encoding="utf-8"))]
            elif part == "events":
                data = json.loads(path.read_text(encoding="utf-8"))
                self.event["flares"] = [self._flare(f) for f in data.get("flr", [])]
                self.event["cmes"] = [self._cme(c) for c in data.get("cme", [])]
            elif part == "flux":
                self.event["flux"] = self._flux(path)
        self.event["available"] = bool(self.event["sources"])
        spe = next((r.spec for r in reg.replays if r.spec.get("event") == "spe"), {})
        self._link_primary(str(spe.get("donki_id", "")))

    # ---- parsing -------------------------------------------------------------------------
    @staticmethod
    def _sep(r: dict[str, Any]) -> dict[str, Any]:
        return {
            "id": r.get("sepID"), "time": r.get("eventTime"),
            "instruments": [i.get("displayName") for i in r.get("instruments") or []],
            "linked": [e.get("activityID") for e in r.get("linkedEvents") or []], "link": r.get("link"),
        }

    @staticmethod
    def _flare(f: dict[str, Any]) -> dict[str, Any]:
        return {"id": f.get("flrID"), "class": f.get("classType"), "begin": f.get("beginTime"),
                "peak": f.get("peakTime"), "location": f.get("sourceLocation"), "region": f.get("activeRegionNum"),
                "link": f.get("link")}

    @staticmethod
    def _cme(c: dict[str, Any]) -> dict[str, Any]:
        a = c.get("analysis") or {}
        return {"id": c.get("activityID"), "start": c.get("startTime"), "speed_km_s": a.get("speed"),
                "type": a.get("type"), "half_angle_deg": a.get("halfAngle"), "linked": c.get("linked", []),
                "link": c.get("link")}

    def _flux(self, path: Any) -> dict[str, Any]:
        points: list[list[Any]] = []
        with path.open(encoding="utf-8") as fh:
            for row in csv.DictReader(line for line in fh if not line.startswith("#")):
                value = row["flux_gt10MeV_pfu"]
                points.append([row["utc"], float(value) if value else None, row["quality"]])
        good = [p for p in points if p[1] is not None]
        peak = max(good, key=lambda p: p[1]) if good else None
        return {
            "label": ">10 MeV integral proton flux, near Earth (1 AU)", "unit": "pfu",
            "points": [[p[0], p[1]] for p in points], "suspect": [p[0] for p in points if p[2] != "GOOD"],
            "peak_pfu": peak[1] if peak else None, "peak_utc": peak[0] if peak else None,
            "peak_level": self.level(peak[1]) if peak else None,
        }

    def level(self, pfu: float) -> str | None:
        """NOAA S-scale level reached by a >10 MeV flux (from limits.yaml space_weather, unverified)."""
        reached = [s["level"] for s in self.s_scale if pfu >= s["value"]]
        return reached[-1] if reached else None

    def _link_primary(self, donki_id: str) -> None:
        """The SEP the RAD replay is tied to (datasets.yaml rad_spe donki_id), with its linked flare and CME."""
        ev = self.event
        primary = next((s for s in ev["sep"] if s["id"] == donki_id), ev["sep"][0] if ev["sep"] else None)
        linked = set(primary["linked"]) if primary else set()
        flare = next((f for f in ev["flares"] if f["id"] in linked), None)
        cmes = [c for c in ev["cmes"] if c["id"] in linked]
        cme = max(cmes, key=lambda c: c["speed_km_s"] or 0, default=None)
        ev["primary"] = {"sep": primary, "flare": flare, "cme": cme}

    # ---- crew brief ----------------------------------------------------------------------
    def crew_brief(self) -> tuple[str, list[str]]:
        """Plain-language text + checklist for the crew. Decision support, not an order (AGENTS.md rule 6)."""
        ev, p = self.event, self.event.get("primary") or {}
        parts = [f"Ground space-weather brief (NASA DONKI + OMNI2) for the {ev['event_date']} event."]
        if p.get("flare"):
            f = p["flare"]
            parts.append(f"Solar flare class {f['class']} peaked at {_hhmm(f['peak'])} (region {f['region']}).")
        if p.get("cme"):
            parts.append(f"Linked CME at about {p['cme']['speed_km_s']:.0f} km/s, launched {_hhmm(p['cme']['start'])}.")
        if p.get("sep"):
            parts.append(f"Particle event onset {_hhmm(p['sep']['time'])} (DONKI {p['sep']['id']}).")
        flux = ev.get("flux")
        if flux and flux.get("peak_pfu") is not None:
            level = f" (NOAA level {flux['peak_level']})" if flux.get("peak_level") else ""
            parts.append(f"Near-Earth >10 MeV protons peaked at {flux['peak_pfu']:.0f} pfu on {flux['peak_utc'][:10]} "
                         f"{_hhmm(flux['peak_utc'])}{level}. Levels like this can stay high for a day or more.")
        checklist = [
            "Stay in the storm shelter until the onboard cabin dose rate is back below the SPE alert limit.",
            "Keep personal dosimeters on and readable.",
            "Report each crew member's dose at the next link window.",
            "Act on the onboard alert now; this brief is one comm delay old.",
        ]
        return " ".join(parts), checklist
