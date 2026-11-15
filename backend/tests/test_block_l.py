"""Block L (ROADMAP section 0a): every unverified limit says what it IS via source_kind; data and flags unchanged."""

import shutil

import pytest

from app.config import CONFIG_DIR, SOURCE_KINDS, Config


def _copy_config(tmp_path, old: str, new: str):
    for f in CONFIG_DIR.glob("*.yaml"):
        shutil.copy(f, tmp_path / f.name)
    text = (tmp_path / "limits.yaml").read_text(encoding="utf-8")
    assert old in text
    (tmp_path / "limits.yaml").write_text(text.replace(old, new, 1), encoding="utf-8")


def test_every_unverified_limit_has_a_known_source_kind(cfg):
    for section, entries in cfg.limits.items():
        for name, entry in entries.items():
            if entry["verified"]:
                assert "source_kind" not in entry, f"{section}.{name}"
            else:
                assert entry["source_kind"] in SOURCE_KINDS, f"{section}.{name}"


def test_verified_count_unchanged_by_block_l(cfg):
    verified = sum(e["verified"] for entries in cfg.limits.values() for e in entries.values())
    assert verified == 14


def test_nasa_reference_kind_only_for_nasa_pages_that_are_not_standards(cfg):
    """The HRP bone-loss rate and (Block C) the ISS daily exercise time come from NASA pages, not NASA-STD clauses."""
    refs = [f"{s}.{n}" for s, es in cfg.limits.items() for n, e in es.items() if e.get("source_kind") == "nasa_reference"]
    assert refs == ["bone.bmd_loss_pct_per_month_expected_0g", "countermeasures.exercise_min_day"]


def test_unverified_limit_without_source_kind_fails_to_load(tmp_path):
    _copy_config(tmp_path, "verified: false, source_kind: design }", "verified: false }")
    with pytest.raises(ValueError, match="needs source_kind"):
        Config(tmp_path)


def test_unknown_source_kind_fails_to_load(tmp_path):
    _copy_config(tmp_path, "source_kind: design }", "source_kind: trustme }")
    with pytest.raises(ValueError, match="needs source_kind"):
        Config(tmp_path)


def test_verified_limit_with_source_kind_fails_to_load(tmp_path):
    _copy_config(tmp_path, "via OCHMO-TB-004 Rev D\", verified: true }",
                 "via OCHMO-TB-004 Rev D\", verified: true, source_kind: published }")
    with pytest.raises(ValueError, match="must not carry source_kind"):
        Config(tmp_path)


def test_limit_and_evidence_carry_source_kind(cfg):
    assert cfg.limit("physiology.spo2_pct_min").source_kind == "clinical"
    assert cfg.limit("physiology.spo2_pct_min").as_dict()["source_kind"] == "clinical"
    assert cfg.limit("environment.ppco2_mmHg_1h_max").source_kind is None


def test_limits_endpoint_exposes_source_kind():
    from fastapi.testclient import TestClient

    from app.main import create_app

    with TestClient(create_app(run_loop=False)) as client:
        body = client.get("/api/v1/limits").json()
    assert body["limits"]["physiology"]["spo2_pct_min"]["source_kind"] == "clinical"
    spo2 = [b for b in body["by_signal"]["spo2"] if b["ref"] == "physiology.spo2_pct_min"]
    assert spo2 and spo2[0]["source_kind"] == "clinical"
