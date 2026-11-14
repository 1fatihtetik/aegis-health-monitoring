"""P-6: Inspiration4 aggregate CBC/CMP reference panel (ROADMAP 0.3, AGENTS.md section 2a D5 and section 7)."""

import csv
import shutil

import yaml
from fastapi.testclient import TestClient

from app.config import CONFIG_DIR, Config
from app.datasets.inspiration4 import MIN_CELL_N, check_aggregate, load_inspiration4
from app.datasets.registry import DATA_DIR
from app.main import app

DATASET = "osdr_inspiration4_cbc_cmp"
REL = "derived/inspiration4_cbc_cmp_aggregate.csv"


def _rows() -> tuple[list[str], list[dict[str, str]]]:
    with (DATA_DIR / REL).open(encoding="utf-8") as fh:
        reader = csv.DictReader(ln for ln in fh if not ln.startswith("#"))
        return list(reader.fieldnames or []), list(reader)


def test_bundled_file_has_no_per_person_rows():
    header, rows = _rows()
    lowered = {h.lower() for h in header}
    assert not lowered & {"subject_id", "subject", "sex", "value", "crew_id", "name"}
    assert rows and all(int(r["n"]) >= MIN_CELL_N for r in rows)
    keys = [(r["panel"], r["analyte"], r["timepoint"]) for r in rows]
    assert len(keys) == len(set(keys)), "one row per analyte and time point"
    # No subject codes anywhere in the file (OSDR uses C001..C004).
    text = (DATA_DIR / REL).read_text(encoding="utf-8")
    assert not any(f"C00{i}" in text for i in range(1, 10))


def test_per_person_raw_files_are_not_bundled():
    raw = yaml.safe_load((DATA_DIR / "MANIFEST.yaml").read_text(encoding="utf-8"))
    entry = next(d for d in raw["datasets"] if d["id"] == DATASET)
    assert [f["path"] for f in entry["files"]] == [REL]
    assert all(s["sha256"] and s["url"].startswith("https://osdr.nasa.gov/") for s in entry["raw_sources"])
    assert "agency" not in entry  # NASA OSDR archive -> NASA_MEASURED (aggregate reference)
    assert not list((DATA_DIR / "raw").glob("*Blood*")) and not list((DATA_DIR / "raw").glob("*CMP*"))


def test_panel_loads_with_nasa_provenance(cfg):
    panel = load_inspiration4(cfg.datasets)
    assert panel["available"], panel["problem"]
    assert panel["provenance"] == "NASA_MEASURED" and panel["dataset"]["id"] == DATASET
    assert panel["crew_n"] == 4
    names = {a["analyte"] for a in panel["analytes"]}
    assert {"HEMOGLOBIN", "WHITE BLOOD CELL COUNT", "GLUCOSE", "CALCIUM"} <= names
    assert not any(n.startswith("eGFR") for n in names)
    hgb = next(a for a in panel["analytes"] if a["analyte"] == "HEMOGLOBIN")
    assert [p["timepoint"] for p in hgb["points"]] == panel["timepoints"]  # sorted L-92 .. R+194
    assert hgb["ref_note"]  # male and female intervals differ and are both named


def test_check_aggregate_refuses_per_person_files():
    row = {"panel": "CBC", "analyte": "X", "timepoint": "L-3", "n": "4"}
    assert check_aggregate(["panel", "analyte", "SUBJECT_ID", "VALUE"], [row]).startswith("refused")
    cols = ["panel", "analyte", "unit", "timepoint", "n", "mean", "sd", "ref_low", "ref_high", "ref_note"]
    assert check_aggregate(cols, [row]) == ""
    assert "n=1" in check_aggregate(cols, [{**row, "n": "1"}])
    assert "duplicate" in check_aggregate(cols, [row, row])


def test_tampered_file_makes_panel_unavailable(tmp_path):
    data = tmp_path / "nasa"
    shutil.copytree(DATA_DIR, data)
    path = data / REL
    path.write_text(path.read_text(encoding="utf-8").replace(",4,", ",1,", 1), encoding="utf-8")
    cfg = Config(CONFIG_DIR, data)
    assert any("inspiration4" in p and "sha256" in p for p in cfg.datasets.problems)
    panel = load_inspiration4(cfg.datasets)
    assert not panel["available"] and panel["analytes"] == [] and "sha256" in panel["problem"]


def test_api_serves_panel_on_both_nodes():
    with TestClient(app) as client:
        for node in ("onboard", "ground"):
            res = client.get(f"/api/v1/reference/inspiration4?node={node}")
            assert res.status_code == 200
            panel = res.json()["panel"]
            assert panel["available"] and panel["provenance"] == "NASA_MEASURED"
