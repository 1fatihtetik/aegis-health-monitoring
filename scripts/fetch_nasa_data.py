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

Dataset-specific fetchers (MSL/RAD, DONKI, OMNI2, Horizons) are added per work item, R-2 onwards.
"""

import argparse
import hashlib
import sys
import urllib.request
from datetime import UTC, datetime
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
    with urllib.request.urlopen(req, timeout=120) as resp:  # noqa: S310 (https checked above)
        data = resp.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        sys.exit(f"{args.url} is larger than {MAX_BYTES} bytes; bundle a smaller window")
    dest.write_bytes(data)
    print(f"{args.id}: {len(data)} bytes -> {dest.relative_to(ROOT).as_posix()} sha256={sha256(dest)}")
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
    args = parser.parse_args(argv)
    return int(args.fn(args))


if __name__ == "__main__":
    raise SystemExit(main())
