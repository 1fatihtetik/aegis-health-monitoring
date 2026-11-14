"""Build-time only: download NASA snapshots into data/nasa/ and keep MANIFEST.yaml honest.

The AEGIS runtime never calls this and never touches the network (AGENTS.md rule 8).
Downloaded files are untrusted input: they are hashed and parsed, never executed.

Usage (from the repo root):
    python -P scripts/fetch_nasa_data.py verify
        Check every manifest file exists and matches its sha256.
    python -P scripts/fetch_nasa_data.py register --id ID --tier D2 --title "..." \\
        --source-url URL --terms "..." --transform "..." FILE [FILE ...]
        Add or replace a manifest entry for files already under data/nasa/ (hashes them).
    python -P scripts/fetch_nasa_data.py download --id ID URL DEST
        Download URL to data/nasa/raw/DEST (no manifest change; run `register` after normalizing).

    python -P scripts/fetch_nasa_data.py rad-cruise
        R-2: MSL/RAD cruise dosimetry (PDS PPI MSL-M-RAD-3-RDR-V1.0, 2012-04-10..19). Streams each daily
        RDR text file (~20 MB each, not bundled), keeps only the dosimetry totals, writes
        derived/msl_rad_cruise_2012.csv and registers it with the raw files' URL + sha256.
    python -P scripts/fetch_nasa_data.py rad-surface
        R-2: MSL/RAD Gale crater dosimetry (SPDF CDAWeb MSL_RAD_OBS-L2, 2013-03-23..04-01). Bundles the
        CDAWeb text listing in raw/ and writes derived/msl_rad_gale_2013.csv.

    python -P scripts/fetch_nasa_data.py rad-spe
        R-3: MSL/RAD March 2012 SPE (PDS cruise RDRs, DOY 067-070) + DONKI SEP records.
    python -P scripts/fetch_nasa_data.py horizons
        R-4: JPL Horizons daily Earth-Mars range + one-way light time (2026-08-01..2027-08-01).
    python -P scripts/fetch_nasa_data.py space-weather
        R-5: DONKI FLR + CME records (2012-03-06..10) and OMNI2 hourly >10/30/60 MeV proton flux.
    rad-spe fetches DONKI SEP via api.nasa.gov: set NASA_API_KEY (defaults to DEMO_KEY); the key is never written
    to disk. space-weather uses the CCMC DONKI web service, which needs no key.

    python -P scripts/fetch_nasa_data.py iss-radlab
        P-1: ISS Columbus DOSTEL-1 (DOSIS 3D) absorbed dose rate from NASA OSDR RadLab, 2019-01-03..10, with the
        station position of each record (bundled raw TSV + derived CSV with an SAA flag).
    python -P scripts/fetch_nasa_data.py crater
        P-2: LRO CRaTER D1+D2 hourly dose rate from NASA CCMC ISWA (already converted to water and altitude-corrected
        to the lunar surface by the CRaTER team), 2019-01-03..10. The 22 MB all-mission file is not bundled; its
        URL + sha256 are recorded.
    python -P scripts/fetch_nasa_data.py radnet
        P-3: US EPA RadNet fixed monitor, Houston TX, hourly gamma dose equivalent rate, 2024-06-03..12 (bundled raw
        CSV for 2024 + derived window). Non-NASA: manifest `agency: EPA`, label MEASURED_OTHER.
"""

import argparse
import csv
import hashlib
import json
import os
import re
import sys
import urllib.error
import urllib.request
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Any

import yaml

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data" / "nasa"
MANIFEST = DATA / "MANIFEST.yaml"
TIERS = ("D1", "D2", "D3", "D4", "D5", "D6", "D7")  # D6/D7: Block P (AGENTS.md section 2a)
USER_AGENT = "aegis-data-fetch/0.1 (build-time snapshot)"
MAX_BYTES = 50 * 1024 * 1024


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 16), b""):
            h.update(chunk)
    return h.hexdigest()


def load_manifest() -> dict[str, Any]:
    if not MANIFEST.exists():
        return {"datasets": []}
    data = yaml.safe_load(MANIFEST.read_text(encoding="utf-8")) or {}
    data.setdefault("datasets", [])
    return data


def save_manifest(data: dict[str, Any]) -> None:
    header = [line for line in MANIFEST.read_text(encoding="utf-8").splitlines() if line.startswith("#")] \
        if MANIFEST.exists() else []
    body = yaml.safe_dump({"datasets": data["datasets"]}, sort_keys=False, allow_unicode=True)
    MANIFEST.write_text("\n".join(header) + ("\n" if header else "") + body, encoding="utf-8")


def inside_data(path: Path) -> Path:
    resolved = path.resolve()
    if DATA.resolve() not in resolved.parents:
        sys.exit(f"{path} is not under {DATA}")
    return resolved


def cmd_verify(_: argparse.Namespace) -> int:
    bad = 0
    for entry in load_manifest()["datasets"]:
        for f in entry.get("files", []):
            path = DATA / f["path"]
            ok = path.is_file() and sha256(path) == f["sha256"]
            bad += not ok
            print(f"{'ok ' if ok else 'BAD'} {entry['id']}: {f['path']}")
    print("all files match" if not bad else f"{bad} file(s) missing or changed")
    return 1 if bad else 0


def cmd_register(args: argparse.Namespace) -> int:
    files = []
    for name in args.files:
        path = inside_data(Path(name) if Path(name).is_absolute() else ROOT / name)
        if not path.is_file():
            sys.exit(f"{name} not found")
        files.append({"path": path.relative_to(DATA.resolve()).as_posix(), "sha256": sha256(path)})
    entry = {
        "id": args.id, "tier": args.tier, "title": args.title, "source_url": args.source_url,
        "retrieved": args.retrieved or datetime.now(UTC).date().isoformat(),
        "terms": args.terms, "transform": args.transform, "files": files,
    }
    data = load_manifest()
    data["datasets"] = [d for d in data["datasets"] if d.get("id") != args.id] + [entry]
    save_manifest(data)
    print(f"registered {args.id} with {len(files)} file(s)")
    return 0


def cmd_download(args: argparse.Namespace) -> int:
    if not args.url.startswith("https://"):
        sys.exit("only https URLs are allowed")
    dest = inside_data(DATA / "raw" / args.dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    req = urllib.request.Request(args.url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=120) as resp:  # https only, checked above
        data = resp.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        sys.exit(f"{args.url} is larger than {MAX_BYTES} bytes; bundle a smaller window")
    dest.write_bytes(data)
    print(f"{args.id}: {len(data)} bytes -> {dest.relative_to(ROOT).as_posix()} sha256={sha256(dest)}")
    return 0


# ---- MSL/RAD (R-2) ---------------------------------------------------------------------------
RAD_TERMS = ("NASA PDS / SPDF public data. Cite: Hassler et al. (2012) Space Sci Rev 170:503 (instrument); "
             "MSL RAD team, D. Hassler (PI), SwRI.")
PDS_CRUISE = "https://pds-ppi.igpp.ucla.edu/data/MSL-M-RAD-3-RDR-V1.0/DATA/CRUISE/"
CRUISE_DAYS = (date(2012, 4, 10), date(2012, 4, 19))  # inclusive; quiet GCR between the March and May 2012 SEPs
CDAWEB = "https://cdaweb.gsfc.nasa.gov/WS/cdasr/1/dataviews/sp_phys/datasets/MSL_RAD_OBS-L2/data/"
SURFACE_RANGE = ("20130323T000000Z", "20130402T000000Z")  # Gale crater, inside the Hassler et al. 2014 window
DERIVED_HEADER = ["utc", "dose_e_uGy_h", "dose_b_uGy_h", "duration_s", "quality"]
NUMBER = re.compile(r"-?\d+(\.\d+)?([eE][+-]?\d+)?")


def _get(url: str, accept: str = "*/*") -> bytes:
    if not url.startswith("https://"):
        sys.exit("only https URLs are allowed")
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": accept})
    with urllib.request.urlopen(req, timeout=300) as resp:  # https only, checked above
        data = resp.read(MAX_BYTES * 3 + 1)
    if len(data) > MAX_BYTES * 3:
        sys.exit(f"{url} is unexpectedly large; refusing")
    return bytes(data)


def parse_rad_rdr(text: str) -> list[dict[str, Any]]:
    """Dosimetry totals from one PDS RAD RDR text file. Numbers are parsed; nothing is evaluated."""
    obs_list: list[dict[str, Any]] = []
    obs: dict[str, Any] | None = None
    section = ""
    for raw in text.splitlines():
        line = raw.strip()
        if line.startswith("["):
            section = line
            if line.startswith("[OBSERVATION"):
                obs = {"utc": None, "qc": "", "duration_s": 0, "e": None, "b": None}
                obs_list.append(obs)
            continue
        if obs is None or not line:
            continue
        if line.startswith("START_OBS_UTC="):
            stamp = line.split("=", 1)[1].strip('"')
            obs["utc"] = datetime.strptime(stamp, "%Y-%j %H:%M:%S").replace(tzinfo=UTC)
        elif line.startswith("QC="):
            obs["qc"] = line.split("=", 1)[1]
        elif section.startswith("[COUNTER_L1") and line[0].isdigit() and '"' in line:
            cols = line.split('"')[-1].split()
            if len(cols) >= 3 and cols[2].isdigit():
                obs["duration_s"] = max(obs["duration_s"], int(cols[2]))
        elif section.startswith("[DOSIMETRY_TOTAL_DOSE_E") and obs["e"] is None and NUMBER.fullmatch(line):
            obs["e"] = float(line)
        elif section.startswith("[DOSIMETRY_TOTAL_DOSE_B") and obs["b"] is None and NUMBER.fullmatch(line):
            obs["b"] = float(line)
    out = []
    for o in obs_list:
        if o["utc"] is None or o["e"] is None:
            continue
        good = o["qc"].strip("0") == "" and o["e"] > 0 and o["duration_s"] > 0
        out.append({
            "utc": o["utc"].strftime("%Y-%m-%dT%H:%M:%SZ"), "dose_e_uGy_h": round(o["e"], 5),
            "dose_b_uGy_h": round(o["b"], 5) if o["b"] is not None else "",
            "duration_s": o["duration_s"], "quality": "GOOD" if good else "SUSPECT",
        })
    return out


def parse_cdaweb_text(text: str) -> list[dict[str, Any]]:
    """CDAWeb text listing of MSL_RAD_OBS-L2: EPOCH, ALIVE_TIME, FLAGGED_DATA, dose B, RTG-corrected B, dose E."""
    out = []
    stamp = re.compile(r"^(\d\d)-(\d\d)-(\d{4}) (\d\d:\d\d:\d\d)\.\S+\s+(.*)$")
    for line in text.splitlines():
        m = stamp.match(line)
        if not m:
            continue
        cols = m.group(5).split()
        nums = [c for c in cols if NUMBER.fullmatch(c)]
        if len(nums) < 4:
            continue
        alive, b, _b_rtg, e = (float(x) for x in nums[-4:])
        flagged = len(cols) > len(nums)
        ok = not flagged and 0 < e < 1e5 and alive > 0
        out.append({
            "utc": f"{m.group(3)}-{m.group(2)}-{m.group(1)}T{m.group(4)}Z",
            "dose_e_uGy_h": round(e / 24, 5), "dose_b_uGy_h": round(b / 24, 5),
            "duration_s": round(alive), "quality": "GOOD" if ok else "SUSPECT",
        })
    return out


DROPOUT_FRACTION = 0.5  # an observation below half the window median is an instrument dropout, not GCR


def flag_dropouts(rows: list[dict[str, Any]], floor_uGy_h: float | None = None) -> int:
    """Mark dropouts SUSPECT (documented in the manifest transform). Returns how many were flagged."""
    if floor_uGy_h is None:
        good = sorted(float(r["dose_e_uGy_h"]) for r in rows if r["quality"] == "GOOD")
        floor_uGy_h = DROPOUT_FRACTION * good[len(good) // 2]
    flagged = 0
    for r in rows:
        if r["quality"] == "GOOD" and float(r["dose_e_uGy_h"]) < floor_uGy_h:
            r["quality"] = "SUSPECT"
            flagged += 1
    return flagged


def _write_csv(path: Path, rows: list[dict[str, Any]], comment: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as fh:
        fh.write(f"# {comment}\n")
        writer = csv.DictWriter(fh, fieldnames=DERIVED_HEADER, lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)


def _upsert(entry: dict[str, Any]) -> None:
    data = load_manifest()
    data["datasets"] = [d for d in data["datasets"] if d.get("id") != entry["id"]] + [entry]
    save_manifest(data)


def _mean_e_day(rows: list[dict[str, Any]]) -> float:
    good = [float(r["dose_e_uGy_h"]) for r in rows if r["quality"] == "GOOD"]
    return 24 * sum(good) / len(good)


SPE_DAYS = (date(2012, 3, 7), date(2012, 3, 10))  # inclusive; March 7-9, 2012 SEP measured in cruise
DONKI_SEP_URL = "https://api.nasa.gov/DONKI/SEP"
DONKI_SEP_ID = "2012-03-07T01:44:00-SEP-001"


def _fetch_pds_cruise_days(start_day: date, end_day: date) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    listing = _get(PDS_CRUISE).decode("utf-8", "replace")
    rows: list[dict[str, Any]] = []
    raws: list[dict[str, Any]] = []
    day = start_day
    while day <= end_day:
        doy = day.timetuple().tm_yday
        names = sorted(set(re.findall(rf"RAD_RDR_{day.year}_{doy:03d}_\d\d_\d\d_C\d+_V00\.TXT", listing)))
        for name in names:
            blob = _get(PDS_CRUISE + name)
            raws.append({"url": PDS_CRUISE + name, "bytes": len(blob), "sha256": hashlib.sha256(blob).hexdigest()})
            parsed = parse_rad_rdr(blob.decode("ascii", "replace"))
            rows += parsed
            print(f"{name}: {len(blob)} bytes, {len(parsed)} observations")
        day += timedelta(days=1)
    rows.sort(key=lambda r: r["utc"])
    return rows, raws


def cmd_rad_cruise(_: argparse.Namespace) -> int:
    rows, raws = _fetch_pds_cruise_days(*CRUISE_DAYS)
    dropouts = flag_dropouts(rows)
    rel = "derived/msl_rad_cruise_2012.csv"
    _write_csv(DATA / rel, rows, "MSL/RAD cruise dosimetry from PDS MSL-M-RAD-3-RDR-V1.0; one row per RAD "
               "observation; dose_e = TOTAL_DOSE_E (tissue-equivalent plastic), dose_b = TOTAL_DOSE_B (silicon); "
               "microGray/hour")
    mean = _mean_e_day(rows)
    _upsert({
        "id": "msl_rad_cruise_2012", "tier": "D2", "label": "MSL/RAD cruise 2012",
        "title": "MSL Curiosity RAD dose rate in Mars cruise, 2012-04-10 to 2012-04-19 (quiet GCR)",
        "source_url": PDS_CRUISE, "retrieved": datetime.now(UTC).date().isoformat(), "terms": RAD_TERMS,
        "transform": ("Kept START_OBS_UTC, QC, L1 counter duration and DOSIMETRY_TOTAL_DOSE_E/B of every RDR "
                      "observation (no averaging); QC != 0 or dose_e < 50% of the window median (instrument dropout) -> quality "
                      "SUSPECT. Replay holds each observation until "
                      "the next one (~32 min cadence) and holds the last GOOD value over SUSPECT rows and gaps (marked SUSPECT). Dose equivalent = dose_e x mean quality factor <Q> 3.82 "
                      "(Zeitlin et al. 2013) -> NASA_DERIVED."),
        "reference": {
            "citation": "Zeitlin et al. (2013) Science 340:1080; MSL/RAD cruise Dec 2011 - Jul 2012",
            "dose_rate_uGy_day": 481, "dose_equivalent_mSv_day": 1.84, "tolerance_mSv_day": 0.33,
            "quality_factor": 3.82, "window_mean_dose_e_uGy_day": round(mean, 1),
        },
        "raw_sources": raws,
        "files": [{"path": rel, "sha256": sha256(DATA / rel)}],
    })
    print(f"{len(rows)} rows ({dropouts} dropouts flagged), mean GOOD dose_e {mean:.1f} uGy/day -> {rel}")
    return 0


def cmd_rad_surface(_: argparse.Namespace) -> int:
    query = f"{CDAWEB}{SURFACE_RANGE[0]},{SURFACE_RANGE[1]}/DOSIMETRY_TOTAL,ALIVE_TIME,FLAGGED_DATA?format=text"
    meta = json.loads(_get(query, accept="application/json"))
    blob = _get(str(meta["FileDescription"][0]["Name"]))
    raw_rel = "raw/msl_rad_obs-l2_20130323_20130401.txt"
    (DATA / raw_rel).parent.mkdir(parents=True, exist_ok=True)
    (DATA / raw_rel).write_bytes(blob)
    rows = parse_cdaweb_text(blob.decode("ascii", "replace"))
    dropouts = flag_dropouts(rows)
    rel = "derived/msl_rad_gale_2013.csv"
    _write_csv(DATA / rel, rows, "MSL/RAD Gale crater dosimetry from SPDF CDAWeb MSL_RAD_OBS-L2; one row per RAD "
               "observation; dose_e = TOTAL_DOSE_E (tissue-equivalent plastic), dose_b = TOTAL_DOSE_B (silicon, "
               "incl. MMRTG); microGray/day / 24 = microGray/hour")
    mean = _mean_e_day(rows)
    _upsert({
        "id": "msl_rad_gale_2013", "tier": "D2", "label": "MSL/RAD Gale crater 2013",
        "title": "MSL Curiosity RAD dose rate on the Mars surface (Gale crater), 2013-03-23 to 2013-04-01",
        "source_url": query, "retrieved": datetime.now(UTC).date().isoformat(), "terms": RAD_TERMS,
        "transform": ("CDAWeb text listing (raw/, as downloaded) -> one row per observation; uGy/day / 24 -> "
                      "uGy/h; FLAGGED_DATA set or dose_e < 50% of the window median -> quality SUSPECT. Replay holds each observation until the next "
                      "one (~1 h cadence). Dose equivalent = dose_e x mean quality factor <Q> 3.05 "
                      "(Hassler et al. 2014) -> NASA_DERIVED."),
        "reference": {
            "citation": "Hassler et al. (2014) Science 343:1244797; Gale crater Aug 2012 - Jun 2013",
            "dose_rate_uGy_day": 210, "dose_equivalent_mSv_day": 0.64, "tolerance_mSv_day": 0.12,
            "quality_factor": 3.05, "window_mean_dose_e_uGy_day": round(mean, 1),
        },
        "files": [{"path": raw_rel, "sha256": sha256(DATA / raw_rel)}, {"path": rel, "sha256": sha256(DATA / rel)}],
    })
    print(f"{len(rows)} rows ({dropouts} dropouts flagged), mean GOOD dose_e {mean:.1f} uGy/day -> {rel}")
    return 0


def cmd_rad_spe(_: argparse.Namespace) -> int:
    rows, raws = _fetch_pds_cruise_days(*SPE_DAYS)
    quiet = sorted(float(r["dose_e_uGy_h"]) for r in rows if r["quality"] == "GOOD" and r["utc"] < "2012-03-07T03:00:00Z")
    floor = DROPOUT_FRACTION * quiet[len(quiet) // 2]
    dropouts = flag_dropouts(rows, floor_uGy_h=floor)
    rel = "derived/msl_rad_spe_2012_03.csv"
    _write_csv(DATA / rel, rows, "MSL/RAD March 7-9, 2012 solar particle event (cruise) from PDS MSL-M-RAD-3-RDR-V1.0; "
               "one row per RAD observation; dose_e = TOTAL_DOSE_E (tissue-equivalent plastic), "
               "dose_b = TOTAL_DOSE_B (silicon); microGray/hour")
    good_e = [float(r["dose_e_uGy_h"]) for r in rows if r["quality"] == "GOOD"]
    peak_e = max(good_e)
    _upsert({
        "id": "msl_rad_spe_2012_03", "tier": "D2", "label": "MSL/RAD SPE Mar 2012",
        "title": "MSL Curiosity RAD dose rate during the March 7-9, 2012 solar particle event (cruise)",
        "source_url": PDS_CRUISE, "retrieved": datetime.now(UTC).date().isoformat(), "terms": RAD_TERMS,
        "transform": ("Kept START_OBS_UTC, QC, L1 counter duration and DOSIMETRY_TOTAL_DOSE_E/B of every RDR "
                      f"observation (no averaging); QC != 0 or dose_e < {floor:.1f} uGy/h (50% of pre-event quiet GCR "
                      "median) -> quality SUSPECT. Replay holds each observation until the next one (~17-32 min cadence) "
                      "and holds the last GOOD value over SUSPECT rows and gaps (marked SUSPECT). Dose equivalent = "
                      "dose_e x SEP peak quality factor <Q> 1.17 (Zeitlin et al. 2013) -> NASA_DERIVED."),
        "reference": {
            "citation": "Zeitlin et al. (2013) Science 340:1080; MSL/RAD March 7, 2012 SEP",
            "event_date": "2012-03-07",
            "donki_id": DONKI_SEP_ID,
            "quality_factor": 1.17,
            "peak_dose_e_uGy_h": round(peak_e, 2),
        },
        "raw_sources": raws,
        "files": [{"path": rel, "sha256": sha256(DATA / rel)}],
    })

    key = os.environ.get("NASA_API_KEY", "DEMO_KEY")
    sep_url = f"{DONKI_SEP_URL}?startDate=2012-03-06&endDate=2012-03-10"
    sep_blob = _get(f"{sep_url}&api_key={key}", accept="application/json")
    sep_rel = "derived/donki_sep_2012_03.json"
    (DATA / sep_rel).parent.mkdir(parents=True, exist_ok=True)
    (DATA / sep_rel).write_bytes(json.dumps(json.loads(sep_blob), indent=2).encode("utf-8") + b"\n")
    _upsert({
        "id": "donki_sep_2012_03", "tier": "D3", "label": "NASA DONKI SEP Mar 2012",
        "title": "NASA CCMC DONKI Solar Energetic Particle (SEP) records, 2012-03-06 to 2012-03-10",
        "source_url": sep_url, "retrieved": datetime.now(UTC).date().isoformat(),
        "terms": "NASA CCMC DONKI public space weather database (ccmc.gsfc.nasa.gov).",
        "transform": "Fetched DONKI SEP JSON for 2012-03-06..2012-03-10 via api.nasa.gov and formatted with indent=2.",
        "reference": {"event_date": "2012-03-07", "donki_id": DONKI_SEP_ID},
        "files": [{"path": sep_rel, "sha256": sha256(DATA / sep_rel)}],
    })
    print(f"{len(rows)} rows ({dropouts} dropouts flagged), peak GOOD dose_e {peak_e:.2f} uGy/h -> {rel}; {sep_rel}")
    return 0


# ---- JPL Horizons light time (R-4) -----------------------------------------------------------
HORIZONS_API = "https://ssd.jpl.nasa.gov/api/horizons.api"
HORIZONS_RANGE = ("2026-08-01", "2027-08-01")  # covers start_ts 2026-11-14, its 180-day history and the demo
LT_HEADER = ["date_utc", "delta_au", "one_way_lt_s"]
HORIZONS_ROW = re.compile(r"^\s*(\d{4}-[A-Za-z]{3}-\d\d) (\d\d:\d\d)\s+(\S+)\s+(\S+)\s+(\S+)\s*$")


def parse_horizons(text: str) -> list[dict[str, Any]]:
    """Rows between $$SOE and $$EOE of a Horizons OBSERVER table with quantities 20 (delta, deldot) and 21 (1-way LT)."""
    if "$$SOE" not in text or "$$EOE" not in text:
        sys.exit("Horizons reply has no $$SOE/$$EOE table")
    body = text.split("$$SOE", 1)[1].split("$$EOE", 1)[0]
    out = []
    for line in body.splitlines():
        m = HORIZONS_ROW.match(line)
        if not m:
            continue
        ts = datetime.strptime(f"{m.group(1)} {m.group(2)}", "%Y-%b-%d %H:%M").replace(tzinfo=UTC)
        delta_au, lt_min = float(m.group(3)), float(m.group(5))
        out.append({"date_utc": ts.strftime("%Y-%m-%dT%H:%M:%SZ"), "delta_au": f"{delta_au:.10f}",
                    "one_way_lt_s": f"{lt_min * 60:.3f}"})
    return out


def cmd_horizons(_: argparse.Namespace) -> int:
    params = {
        "format": "text", "COMMAND": "'499'", "OBJ_DATA": "'NO'", "MAKE_EPHEM": "'YES'", "EPHEM_TYPE": "'OBSERVER'",
        "CENTER": "'500@399'", "START_TIME": f"'{HORIZONS_RANGE[0]}'", "STOP_TIME": f"'{HORIZONS_RANGE[1]}'",
        "STEP_SIZE": "'1%20d'", "QUANTITIES": "'20,21'",
    }
    url = HORIZONS_API + "?" + "&".join(f"{k}={v}" for k, v in params.items())
    blob = _get(url)
    raw_rel = "raw/horizons_earth_mars_20260801_20270801.txt"
    (DATA / raw_rel).parent.mkdir(parents=True, exist_ok=True)
    (DATA / raw_rel).write_bytes(blob)
    rows = parse_horizons(blob.decode("utf-8", "replace"))
    rel = "derived/horizons_earth_mars_lt.csv"
    (DATA / rel).parent.mkdir(parents=True, exist_ok=True)
    with (DATA / rel).open("w", encoding="utf-8", newline="") as fh:
        fh.write("# JPL Horizons OBSERVER table, target Mars (499), center Earth geocenter (500@399), daily at 00:00 UT; "
                 "delta = Earth-Mars range (au), one_way_lt_s = 1-way down-leg light time (Horizons quantity 21) x 60\n")
        writer = csv.DictWriter(fh, fieldnames=LT_HEADER, lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)
    _upsert({
        "id": "horizons_earth_mars_2026", "tier": "D4", "label": "JPL Horizons Earth-Mars",
        "title": f"JPL Horizons Earth-Mars range and one-way light time, daily, {HORIZONS_RANGE[0]} to {HORIZONS_RANGE[1]}",
        "source_url": url.replace("%20", " "), "retrieved": datetime.now(UTC).date().isoformat(),
        "terms": "NASA/JPL Solar System Dynamics, Horizons system (public). Ephemerides DE441 / mar099.",
        "transform": ("Horizons text reply (raw/, as downloaded) -> rows between $$SOE and $$EOE: date, delta (au), "
                      "1-way down-leg light time (min) x 60 -> seconds. The link uses the light time linearly "
                      "interpolated between the daily ephemeris points (smooth orbit geometry, not a data gap) -> "
                      "NASA_DERIVED. Earth-Mars range stands in for the spacecraft range in MARS_TRANSIT/RETURN."),
        "reference": {"citation": "Giorgini et al., JPL Horizons On-Line Ephemeris System",
                      "rows": len(rows), "min_lt_s": min(float(r["one_way_lt_s"]) for r in rows),
                      "max_lt_s": max(float(r["one_way_lt_s"]) for r in rows)},
        "files": [{"path": raw_rel, "sha256": sha256(DATA / raw_rel)}, {"path": rel, "sha256": sha256(DATA / rel)}],
    })
    print(f"{len(rows)} daily rows -> {rel}")
    return 0


# ---- Space weather context (R-5) -------------------------------------------------------------
DONKI_BASE = "https://ccmc.gsfc.nasa.gov/DONKI/WS/get/"  # CCMC's own DONKI web service; no API key needed
SW_DAYS = ("2012-03-06", "2012-03-10")
OMNI_RANGE = ("20120305T000000Z", "20120313T000000Z")
OMNI_VARS = "PR-FLX_101800,PR-FLX_301800,PR-FLX_601800"
OMNI_HEADER = ["utc", "flux_gt10MeV_pfu", "flux_gt30MeV_pfu", "flux_gt60MeV_pfu", "quality"]
OMNI_FILL = 99999.0  # OMNI2 fill values are 99999.99 / 9999.99 style; anything at or above this is missing


def parse_omni_text(text: str) -> list[dict[str, Any]]:
    """CDAWeb text listing of OMNI2_H0_MRG1HR: EPOCH_1800 then the >10, >30, >60 MeV proton fluxes."""
    out = []
    stamp = re.compile(r"^(\d\d)-(\d\d)-(\d{4}) (\d\d:\d\d:\d\d)\.\S+\s+(.*)$")
    for line in text.splitlines():
        m = stamp.match(line)
        if not m:
            continue
        nums = [c for c in m.group(5).split() if NUMBER.fullmatch(c)]
        if len(nums) < 3:
            continue
        vals = [float(x) for x in nums[:3]]
        ok = all(0 <= v < OMNI_FILL for v in vals)
        out.append({
            "utc": f"{m.group(3)}-{m.group(2)}-{m.group(1)}T{m.group(4)}Z",
            **{k: (f"{v:g}" if 0 <= v < OMNI_FILL else "") for k, v in zip(OMNI_HEADER[1:4], vals, strict=True)},
            "quality": "GOOD" if ok else "SUSPECT",
        })
    return out


def _keep(record: dict[str, Any], keys: tuple[str, ...]) -> dict[str, Any]:
    return {k: record.get(k) for k in keys}


def cmd_space_weather(_: argparse.Namespace) -> int:
    window = f"startDate={SW_DAYS[0]}&endDate={SW_DAYS[1]}"
    cme = json.loads(_get(f"{DONKI_BASE}CME?{window}", accept="application/json"))
    flr_note = ""
    try:
        flr = json.loads(_get(f"{DONKI_BASE}FLR?{window}", accept="application/json"))
    except urllib.error.HTTPError as exc:
        flr, flr_note = [], f" FLR endpoint returned HTTP {exc.code}; flare ids come from SEP/CME linkedEvents only."
    # Keep the fields the ground card shows; CME analyses keep only the most accurate one (speed, type).
    cmes = []
    for c in cme:
        best = next((a for a in c.get("cmeAnalyses") or [] if a.get("isMostAccurate")), None)
        cmes.append({**_keep(c, ("activityID", "startTime", "sourceLocation", "note", "link")),
                     "linked": [e.get("activityID") for e in c.get("linkedEvents") or []],
                     "analysis": _keep(best, ("speed", "type", "halfAngle", "latitude", "longitude")) if best else None})
    flares = [_keep(f, ("flrID", "beginTime", "peakTime", "endTime", "classType", "sourceLocation", "activeRegionNum",
                        "link")) for f in flr]
    rel_events = "derived/donki_flr_cme_2012_03.json"
    (DATA / rel_events).write_text(json.dumps({"flr": flares, "cme": cmes}, indent=2) + "\n", encoding="utf-8")
    _upsert({
        "id": "donki_flr_cme_2012_03", "tier": "D3", "label": "NASA DONKI FLR/CME Mar 2012",
        "title": f"NASA CCMC DONKI solar flare (FLR) and CME records, {SW_DAYS[0]} to {SW_DAYS[1]}",
        "source_url": f"{DONKI_BASE}FLR?{window} ; {DONKI_BASE}CME?{window}",
        "retrieved": datetime.now(UTC).date().isoformat(),
        "terms": "NASA CCMC DONKI public space weather database (ccmc.gsfc.nasa.gov).",
        "transform": ("DONKI FLR and CME JSON from the CCMC DONKI web service; kept id, times, class, source "
                      "location, linked activity ids, link; CME keeps only the analysis marked isMostAccurate "
                      "(speed, type, half angle)." + flr_note),
        "reference": {"event_date": "2012-03-07", "flares": len(flares), "cmes": len(cmes)},
        "files": [{"path": rel_events, "sha256": sha256(DATA / rel_events)}],
    })

    query = f"{CDAWEB.replace('MSL_RAD_OBS-L2', 'OMNI2_H0_MRG1HR')}{OMNI_RANGE[0]},{OMNI_RANGE[1]}/{OMNI_VARS}?format=text"
    meta = json.loads(_get(query, accept="application/json"))
    blob = _get(str(meta["FileDescription"][0]["Name"]))
    raw_rel = "raw/omni2_h0_mrg1hr_20120305_20120312.txt"
    (DATA / raw_rel).write_bytes(blob)
    rows = parse_omni_text(blob.decode("ascii", "replace"))
    rel = "derived/omni2_proton_flux_2012_03.csv"
    with (DATA / rel).open("w", encoding="utf-8", newline="") as fh:
        fh.write("# OMNI2 hourly near-Earth (1 AU) integral proton flux from SPDF CDAWeb OMNI2_H0_MRG1HR; "
                 "pfu = protons/(cm2 sr s); timestamps are hour midpoints\n")
        writer = csv.DictWriter(fh, fieldnames=OMNI_HEADER, lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)
    peak = max(rows, key=lambda r: float(r["flux_gt10MeV_pfu"] or 0))
    _upsert({
        "id": "omni2_proton_flux_2012_03", "tier": "D3", "label": "NASA OMNI2 proton flux Mar 2012",
        "title": "OMNI2 hourly near-Earth >10/>30/>60 MeV proton flux, 2012-03-05 to 2012-03-12",
        "source_url": query, "retrieved": datetime.now(UTC).date().isoformat(),
        "terms": "NASA GSFC SPDF OMNIWeb / CDAWeb public data (J.H. King, N. Papitashvili). Proton fluxes are "
                 "GOES-sourced.",
        "transform": ("CDAWeb text listing (raw/, as downloaded) -> one row per hour: >10, >30, >60 MeV integral "
                      "proton flux (pfu); OMNI fill values -> empty, row quality SUSPECT. No interpolation."),
        "reference": {"event_date": "2012-03-07", "peak_gt10MeV_pfu": float(peak["flux_gt10MeV_pfu"]),
                      "peak_utc": peak["utc"]},
        "files": [{"path": raw_rel, "sha256": sha256(DATA / raw_rel)}, {"path": rel, "sha256": sha256(DATA / rel)}],
    })
    print(f"{len(flares)} flares, {len(cmes)} CMEs -> {rel_events}; {len(rows)} OMNI2 rows, peak >10 MeV "
          f"{peak['flux_gt10MeV_pfu']} pfu at {peak['utc']} -> {rel}")
    return 0


# ---- Block P (P-1..P-3) --------------------------------------------------------------------------------------
RADLAB_API = "https://visualization.osdr.nasa.gov/radlab/api/"
ISS_WINDOW = ("2019-01-03", "2019-01-11")  # Chang'E 4 first lunar day (Zhang et al. 2020), half-open
SAA_BOX = {"lon": (-80.0, -10.0), "lat": (-45.0, -5.0)}  # Berger et al. (2017) JSWSC 7:A8, "roughly"
ISS_Q = 2.26  # 647 uSv/day / 286 uGy/day, DOSTEL-1 end of May 2016 (Berger et al. 2017)
ISWA_CRATER = "https://iswa.gsfc.nasa.gov/iswa_data_tree/observation/planetary/LRO/CRaTER/dose-rate/all/"
CRATER_DOY = (2019, 3, 10)  # year, first DOY, last DOY (inclusive) = 2019-01-03..10
CRATER_Q = 3.82  # free-space GCR <Q>, MSL/RAD cruise (Zeitlin et al. 2013)
RADNET_URL = "https://radnet.epa.gov/cdx-radnet-rest/api/rest/csv/2024/fixed/TX/HOUSTON"
RADNET_WINDOW = ("2024-06-03", "2024-06-13")  # half-open


def _write_rows(path: Path, header: list[str], rows: list[dict[str, Any]], comment: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as fh:
        fh.write(f"# {comment}\n")
        writer = csv.DictWriter(fh, fieldnames=header, lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)


def _time_weighted_mean(rows: list[dict[str, Any]], key: str, cap_s: float) -> float:
    """Mean of GOOD rows, each held until the next row (at most cap_s), like the replay does."""
    times = [datetime.fromisoformat(r["utc"]) for r in rows]
    total = weight = 0.0
    for i, r in enumerate(rows):
        if r["quality"] != "GOOD":
            continue
        step = (times[i + 1] - times[i]).total_seconds() if i + 1 < len(rows) else cap_s
        w = min(step, cap_s)
        total += float(r[key]) * w
        weight += w
    return total / weight


def in_saa(lat: float, lon: float) -> bool:
    return SAA_BOX["lat"][0] <= lat <= SAA_BOX["lat"][1] and SAA_BOX["lon"][0] <= lon <= SAA_BOX["lon"][1]


def parse_radlab_tsv(text: str) -> list[dict[str, Any]]:
    """RadLab API TSV (quoted strings, bare numbers). Parsed as data; nothing is evaluated."""
    lines = text.splitlines()
    header = [h.strip() for h in lines[0].split("\t")]
    rows = []
    for line in lines[1:]:
        cells = dict(zip(header, (c.strip().strip('"') for c in line.split("\t")), strict=False))
        if not cells.get("timestamp"):
            continue
        value = cells.get("absorbed_dose_rate", "")
        lat, lon, alt = cells.get("latitude", ""), cells.get("longitude", ""), cells.get("altitude", "")
        ok = bool(NUMBER.fullmatch(value)) and float(value) > 0 and all(NUMBER.fullmatch(x) for x in (lat, lon))
        rows.append({
            "utc": datetime.fromisoformat(cells["timestamp"]).replace(tzinfo=UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "dose_si_uGy_h": float(value) if NUMBER.fullmatch(value) else "",
            "saa": int(in_saa(float(lat), float(lon))) if ok else "",
            "lat": lat, "lon": lon, "alt_km": alt,
            "quality": "GOOD" if ok else "SUSPECT",
        })
    rows.sort(key=lambda r: r["utc"])
    return rows


def cmd_iss_radlab(_: argparse.Namespace) -> int:
    query = (f"{RADLAB_API}?instrument=DosTel1&timestamp>={ISS_WINDOW[0]}&timestamp<{ISS_WINDOW[1]}"
             "&absorbed_dose_rate&latitude&longitude&altitude&format=tsv")
    blob = _get(query)
    raw_rel = "raw/radlab_dostel1_20190103_20190110.tsv"
    (DATA / raw_rel).write_bytes(blob)
    rows = parse_radlab_tsv(blob.decode("utf-8", "replace"))
    rel = "derived/iss_dostel1_2019_01.csv"
    _write_rows(DATA / rel, ["utc", "dose_si_uGy_h", "saa", "lat", "lon", "alt_km", "quality"], rows,
                "ISS Columbus DOSTEL-1 (DLR, DOSIS 3D) absorbed dose rate in silicon from NASA OSDR RadLab; one row "
                "per record (100 s cadence, 20 s inside the SAA); saa = 1 if lat/lon inside 10-80 W, 5-45 S "
                "(Berger et al. 2017); microGray/hour")
    mean_day = 24 * _time_weighted_mean(rows, "dose_si_uGy_h", 600)
    saa_share = sum(1 for r in rows if r["saa"] == 1) / len(rows)
    _upsert({
        "id": "iss_dostel1_2019_01", "tier": "D6", "label": "ISS DOSTEL-1 2019",
        "title": "ISS Columbus DOSTEL-1 (DOSIS 3D) absorbed dose rate, 2019-01-03 to 2019-01-10, via NASA OSDR RadLab",
        "source_url": query, "retrieved": datetime.now(UTC).date().isoformat(),
        "terms": ("NASA Open Science Data Repository (OSDR) RadLab, public. Instrument: DOSTEL-1 of the DOSIS 3D "
                  "experiment (DLR / ESA, PI T. Berger), archived and served by NASA OSDR. Cite: Berger et al. (2017) "
                  "J. Space Weather Space Clim. 7:A8."),
        "transform": ("RadLab API TSV (raw/, as downloaded) -> one row per record: UTC, absorbed dose rate in silicon "
                      "(uGy/h, unchanged), ISS lat/lon/alt; saa = 1 inside the SAA box 10-80 deg W, 5-45 deg S (Berger "
                      "et al. 2017). Rows without a value or position -> SUSPECT. Replay holds each record until the "
                      f"next one. Dose equivalent = DOSTEL dose x <Q> {ISS_Q} = 647 uSv/day / 286 uGy/day, the "
                      "DOSTEL-1 total published for end of May 2016 (Berger et al. 2017) -> NASA_DERIVED. Not ISS-RAD: "
                      "RadLab served no ISS-RAD, REM or TEPC series for this window (checked 2026-11-14)."),
        "reference": {
            "citation": ("Zhang et al. (2020) Sci. Adv. 6:eaaz1334 (non-NASA paper; reference check only): DOSIS 3D "
                         "DOSTEL on ISS, same period as Chang'E 4 first lunar day, 731 uSv/day (GCR 523, SAA ~208). "
                         "Q from Berger et al. (2017) JSWSC 7:A8."),
            "dose_equivalent_uSv_day": 731, "tolerance_uSv_day": 150,
            "tolerance_note": ("~20%: <Q> 2.26 comes from May 2016 (higher solar activity, more SAA weight); "
                               "Jan 2019 is near solar minimum with a larger GCR share and so a higher true <Q>. "
                               "The published value may also average DOSTEL-1 and -2."),
            "quality_factor": ISS_Q, "window_mean_dose_si_uGy_day": round(mean_day, 1),
            "window_mean_dose_equivalent_uSv_day": round(mean_day * ISS_Q, 1),
            "window_saa_row_share": round(saa_share, 3),
        },
        "files": [{"path": raw_rel, "sha256": sha256(DATA / raw_rel)}, {"path": rel, "sha256": sha256(DATA / rel)}],
    })
    print(f"{len(rows)} rows, mean {mean_day:.1f} uGy/day (Si) -> {mean_day * ISS_Q:.0f} uSv/day; "
          f"SAA rows {saa_share:.1%} -> {rel}")
    return 0


def _jd_to_utc(jd: float) -> datetime:
    return datetime(2000, 1, 1, 12, tzinfo=UTC) + timedelta(days=jd - 2451545.0)


def _latest_crater_file() -> str:
    years = sorted(set(re.findall(r'href="(\d{4})/"', _get(ISWA_CRATER).decode("utf-8", "replace"))))
    for year in reversed(years):
        months = sorted(set(re.findall(r'href="(\d\d)/"', _get(f"{ISWA_CRATER}{year}/").decode("utf-8", "replace"))))
        for month in reversed(months):
            base = f"{ISWA_CRATER}{year}/{month}/"
            names = sorted(set(re.findall(r'href="(doserates_standard_\d+_alldays_allevents\.txt)"',
                                          _get(base).decode("utf-8", "replace"))))
            if names:
                return base + names[-1]
    sys.exit("no ISWA CRaTER all-days file found")


def cmd_crater(_: argparse.Namespace) -> int:
    url = _latest_crater_file()
    blob = _get(url)
    year, first, last = CRATER_DOY
    rows = []
    for line in blob.decode("ascii", "replace").splitlines():
        if line.startswith("#") or not line.strip():
            continue
        cells = [c.strip() for c in line.split("\t")]
        if len(cells) < 8 or not all(NUMBER.fullmatch(c) for c in cells[:8]):
            continue
        if int(cells[1]) != year or not first <= int(cells[2]) <= last:
            continue
        dose = float(cells[7]) * 10000 / 24  # cGy/day -> uGy/h
        rows.append({
            "utc": _jd_to_utc(float(cells[0])).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "dose_h2o_uGy_h": round(dose, 4), "h2o_factor": cells[4], "alt_factor": cells[5],
            "quality": "GOOD" if dose > 0 and float(cells[6]) == 1.0 else "SUSPECT",
        })
    rows.sort(key=lambda r: r["utc"])
    rel = "derived/lro_crater_surface_2019_01.csv"
    _write_rows(DATA / rel, ["utc", "dose_h2o_uGy_h", "h2o_factor", "alt_factor", "quality"], rows,
                "LRO CRaTER D1+D2 hourly dose rate from NASA CCMC ISWA, as published: silicon->water (x1.333) and "
                "altitude-corrected to the lunar surface by the CRaTER team; cGy/day x 10000 / 24 = microGray/hour")
    mean_h = _time_weighted_mean(rows, "dose_h2o_uGy_h", 7200)
    _upsert({
        "id": "lro_crater_surface_2019_01", "tier": "D6", "label": "LRO CRaTER 2019 (surface-corrected)",
        "title": "LRO CRaTER D1+D2 dose rate corrected to the lunar surface, hourly, 2019-01-03 to 2019-01-10",
        "source_url": url, "retrieved": datetime.now(UTC).date().isoformat(),
        "terms": ("NASA CCMC ISWA, public. Instrument: LRO CRaTER (PI N. Schwadron, UNH). Cite: Spence et al. (2010) "
                  "Space Sci Rev 150:243; dose method Schwadron et al. (2012) JGR 117:E00H13."),
        "transform": ("ISWA all-mission text file (not bundled, URL + sha256 below) -> rows for 2019 DOY 3-10: Julian "
                      "date -> UTC; D1&2 dose rate (cGy/day, already x1.333 silicon->water and x altitude factor to the "
                      "lunar surface, both factors kept as columns) x 10000 / 24 -> uGy/h. Good-event factor != 1 -> "
                      "SUSPECT. The surface correction is the CRaTER team's transform, so the absorbed value is "
                      f"NASA_DERIVED. Dose equivalent = surface dose x free-space GCR <Q> {CRATER_Q} from MSL/RAD cruise "
                      "(Zeitlin et al. 2013) -> NASA_DERIVED; lunar albedo neutrons are not in this <Q>."),
        "reference": {
            "citation": ("Zhang et al. (2020) Sci. Adv. 6:eaaz1334 (Chang'E 4 LND, non-NASA; reference check only): "
                         "1369 uSv/day on the lunar surface, Jan-Feb 2019; charged dose 13.2 +/- 1.4 uGy/h in water, "
                         "<Q> 4.3 +/- 0.7; the paper quotes CRaTER (water, surface) 13.29 uGy/h for the same period."),
            "dose_equivalent_uSv_day": 1369, "tolerance_uSv_day": 267,
            "tolerance_note": ("19.5% = LND dose (10.6%) and <Q> (16.3%) uncertainties in quadrature. Same weeks as "
                               "LND, near solar minimum (GCR high); a solar-maximum window would read ~30-40% lower."),
            "crater_water_surface_uGy_h": 13.29, "quality_factor": CRATER_Q,
            "window_mean_dose_h2o_uGy_h": round(mean_h, 3),
            "window_mean_dose_equivalent_uSv_day": round(mean_h * CRATER_Q * 24, 1),
        },
        "raw_sources": [{"url": url, "bytes": len(blob), "sha256": hashlib.sha256(blob).hexdigest()}],
        "files": [{"path": rel, "sha256": sha256(DATA / rel)}],
    })
    print(f"{len(rows)} rows from {url}; mean {mean_h:.2f} uGy/h -> {mean_h * CRATER_Q * 24:.0f} uSv/day -> {rel}")
    return 0


def cmd_radnet(_: argparse.Namespace) -> int:
    blob = _get(RADNET_URL)
    raw_rel = "raw/radnet_houston_tx_2024.csv"
    (DATA / raw_rel).write_bytes(blob)
    rows = []
    for r in csv.DictReader(blob.decode("utf-8", "replace").splitlines()):
        stamp = datetime.strptime(r["SAMPLE COLLECTION TIME"].strip(), "%m/%d/%Y %H:%M:%S").replace(tzinfo=UTC)
        if not RADNET_WINDOW[0] <= stamp.date().isoformat() < RADNET_WINDOW[1]:
            continue
        value = r["DOSE EQUIVALENT RATE (nSv/h)"].strip()
        ok = bool(NUMBER.fullmatch(value)) and float(value) > 0 and r["STATUS"].strip() == "APPROVED"
        rows.append({"utc": stamp.strftime("%Y-%m-%dT%H:%M:%SZ"),
                     "h_uSv_h": round(float(value) / 1000, 4) if NUMBER.fullmatch(value) else "",
                     "status": r["STATUS"].strip(), "quality": "GOOD" if ok else "SUSPECT"})
    rows.sort(key=lambda r: r["utc"])
    rel = "derived/radnet_houston_2024_06.csv"
    _write_rows(DATA / rel, ["utc", "h_uSv_h", "status", "quality"], rows,
                "US EPA RadNet fixed monitor TX: HOUSTON, gamma dose equivalent rate; nSv/h / 1000 = microSievert/hour; "
                "timestamps as published (the CSV does not state a time zone; read as UTC)")
    mean_h = _time_weighted_mean(rows, "h_uSv_h", 7200)
    _upsert({
        "id": "radnet_houston_2024_06", "tier": "D7", "agency": "EPA", "label": "EPA RadNet Houston 2024",
        "title": "US EPA RadNet fixed monitor, Houston TX: hourly gamma dose equivalent rate, 2024-06-03 to 2024-06-12",
        "source_url": RADNET_URL, "retrieved": datetime.now(UTC).date().isoformat(),
        "terms": "US EPA RadNet, public data (radnet.epa.gov). Not NASA data.",
        "transform": ("RadNet CSV for 2024 (raw/, as downloaded) -> rows 2024-06-03..12: DOSE EQUIVALENT RATE (nSv/h) "
                      "/ 1000 -> uSv/h; STATUS != APPROVED or no value -> SUSPECT. RadNet's NaI detectors measure "
                      "terrestrial gamma radiation at ground level, not space radiation and not neutrons. Absorbed = "
                      "dose equivalent / Q 1 (photons, ICRP 60). Label MEASURED_OTHER (agency EPA)."),
        "reference": {"station": "TX: HOUSTON", "window_mean_uSv_h": round(mean_h, 4),
                      "window_mean_uSv_day": round(mean_h * 24, 3)},
        "files": [{"path": raw_rel, "sha256": sha256(DATA / raw_rel)}, {"path": rel, "sha256": sha256(DATA / rel)}],
    })
    print(f"{len(rows)} rows, mean {mean_h:.4f} uSv/h -> {rel}")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("verify").set_defaults(fn=cmd_verify)
    reg = sub.add_parser("register")
    reg.add_argument("--id", required=True)
    reg.add_argument("--tier", required=True, choices=TIERS)
    reg.add_argument("--title", required=True)
    reg.add_argument("--source-url", required=True)
    reg.add_argument("--terms", required=True)
    reg.add_argument("--transform", required=True)
    reg.add_argument("--retrieved", help="YYYY-MM-DD; defaults to today (UTC)")
    reg.add_argument("files", nargs="+")
    reg.set_defaults(fn=cmd_register)
    dl = sub.add_parser("download")
    dl.add_argument("--id", required=True)
    dl.add_argument("url")
    dl.add_argument("dest")
    dl.set_defaults(fn=cmd_download)
    sub.add_parser("rad-cruise").set_defaults(fn=cmd_rad_cruise)
    sub.add_parser("rad-surface").set_defaults(fn=cmd_rad_surface)
    sub.add_parser("rad-spe").set_defaults(fn=cmd_rad_spe)
    sub.add_parser("horizons").set_defaults(fn=cmd_horizons)
    sub.add_parser("space-weather").set_defaults(fn=cmd_space_weather)
    sub.add_parser("iss-radlab").set_defaults(fn=cmd_iss_radlab)
    sub.add_parser("crater").set_defaults(fn=cmd_crater)
    sub.add_parser("radnet").set_defaults(fn=cmd_radnet)
    args = parser.parse_args(argv)
    return int(args.fn(args))


if __name__ == "__main__":
    raise SystemExit(main())
