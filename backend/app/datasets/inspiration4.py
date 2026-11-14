"""Inspiration4 aggregate blood-panel reference (P-6, AGENTS.md section 2a D5; ROADMAP section 0.3).

Reads the bundled AGGREGATE CBC/CMP file listed under `reference_panels.inspiration4` in config/datasets.yaml
(NASA OSDR OSD-569 / OSD-575, built by `scripts/fetch_nasa_data.py inspiration4`). AEGIS has no lab signals, so
this is reference context only: it never feeds the engine, rules or alerts.

Aggregate only (ROADMAP 0.2 rule 4): the loader refuses a file that has a per-person column (subject id, sex,
individual value) or a cell with fewer than `MIN_CELL_N` crew, so a wrong file can never put one person's
values on screen. A missing, tampered or refused file makes the panel unavailable with the reason; nothing
else depends on it.
"""

import csv
from typing import Any

from app.datasets.registry import DatasetRegistry

MIN_CELL_N = 3
COLUMNS = ("panel", "analyte", "unit", "timepoint", "n", "mean", "sd", "ref_low", "ref_high", "ref_note")
PER_PERSON = {"subject_id", "subject", "sex", "value", "crew_id", "name"}


def _float(text: str) -> float | None:
    try:
        return float(text) if text.strip() else None
    except ValueError:
        return None


def check_aggregate(header: list[str], rows: list[dict[str, str]]) -> str:
    """Why the file is not a usable aggregate, or "" if it is."""
    lowered = {h.strip().lower() for h in header}
    bad = sorted(lowered & PER_PERSON)
    if bad:
        return f"refused: per-person column(s) {bad} (aggregate only)"
    missing = [c for c in COLUMNS if c not in lowered]
    if missing:
        return f"refused: missing column(s) {missing}"
    seen: set[tuple[str, str, str]] = set()
    for r in rows:
        n = _float(r.get("n", ""))
        if n is None or n < MIN_CELL_N:
            return f"refused: {r.get('analyte')} {r.get('timepoint')} has n={r.get('n')} (< {MIN_CELL_N})"
        key = (r["panel"], r["analyte"], r["timepoint"])
        if key in seen:
            return f"refused: duplicate row {key} (one row per analyte and time point)"
        seen.add(key)
    return ""


def load_inspiration4(reg: DatasetRegistry) -> dict[str, Any]:
    spec = reg.reference_panels.get("inspiration4") or {}
    did, rel = str(spec.get("dataset_id", "")), str(spec.get("file", ""))
    panel: dict[str, Any] = {
        "available": False, "title": spec.get("title", "Inspiration4 crew blood panels"),
        "provenance": "NASA_MEASURED", "dataset_id": did or None, "dataset": reg.dataset_meta(did),
        "basis": spec.get("basis", ""), "timepoints": list(spec.get("timepoints") or []), "crew_n": None,
        "min_cell_n": MIN_CELL_N, "analytes": [], "problem": "",
    }
    if not spec:
        panel["problem"] = "no reference_panels.inspiration4 entry in datasets.yaml"
        return panel
    problem = reg.file_problem(did, rel)
    if not problem:
        with (reg.data_dir / rel).open(encoding="utf-8") as fh:
            lines = [ln for ln in fh if not ln.startswith("#")]
        reader = csv.DictReader(lines)
        rows = list(reader)
        problem = check_aggregate(list(reader.fieldnames or []), rows)
    if problem:
        panel["problem"] = problem
        return panel
    by_analyte: dict[tuple[str, str], dict[str, Any]] = {}
    for r in rows:
        a = by_analyte.setdefault((r["panel"], r["analyte"]), {
            "panel": r["panel"], "analyte": r["analyte"], "unit": r["unit"], "ref_low": _float(r["ref_low"]),
            "ref_high": _float(r["ref_high"]), "ref_note": r["ref_note"], "points": [],
        })
        a["points"].append({"timepoint": r["timepoint"], "n": int(float(r["n"])), "mean": _float(r["mean"]),
                            "sd": _float(r["sd"])})
    order = {tp: i for i, tp in enumerate(panel["timepoints"])}
    for a in by_analyte.values():
        a["points"].sort(key=lambda p: order.get(p["timepoint"], len(order)))
    panel["analytes"] = list(by_analyte.values())
    panel["crew_n"] = max((p["n"] for a in panel["analytes"] for p in a["points"]), default=None)
    panel["available"] = bool(panel["analytes"])
    return panel
