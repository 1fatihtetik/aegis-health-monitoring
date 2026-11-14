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

Further fetchers (DONKI, OMNI2, Horizons) are added per work item, R-3 onwards.
"""

import argparse
import csv
import hashlib
import json
import re
import sys
import urllib.request
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Any

import yaml

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data" / "nasa"
MANIFEST = DATA / "MANIFEST.yaml"
TIERS = ("D1", "D2", "D3", "D4", "D5")
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


def flag_dropouts(rows: list[dict[str, Any]]) -> int:
    """Mark dropouts SUSPECT (documented in the manifest transform). Returns how many were flagged."""
    good = sorted(float(r["dose_e_uGy_h"]) for r in rows if r["quality"] == "GOOD")
    median = good[len(good) // 2]
    flagged = 0
    for r in rows:
        if r["quality"] == "GOOD" and float(r["dose_e_uGy_h"]) < DROPOUT_FRACTION * median:
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


def cmd_rad_cruise(_: argparse.Namespace) -> int:
    listing = _get(PDS_CRUISE).decode("utf-8", "replace")
    rows: list[dict[str, Any]] = []
    raws: list[dict[str, Any]] = []
    day = CRUISE_DAYS[0]
    while day <= CRUISE_DAYS[1]:
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
    args = parser.parse_args(argv)
    return int(args.fn(args))


if __name__ == "__main__":
    raise SystemExit(main())
