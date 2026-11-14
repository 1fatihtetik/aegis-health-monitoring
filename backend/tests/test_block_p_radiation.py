"""Block P, P-1..P-3: measured radiation for LEO, the lunar surface and Earth (PRD section 6 M0, AGENTS.md 2a, 7)."""

import shutil
from datetime import UTC, datetime

import pytest
import yaml

from app.config import CONFIG_DIR, Config
from app.datasets.rad import RadReplay
from app.datasets.registry import DATA_DIR
from app.db.store import SeriesStore
from app.rules.engine import RuleEngine
from app.rules.models import Rule
from app.world import RAD_SIGNALS, World
from tests.conftest import T0, fill

PHASE_REPLAYS = {"LEO": ("iss_leo", "iss_dostel1_2019_01"),
                 "LUNAR_SURFACE": ("crater_lunar", "lro_crater_surface_2019_01"),
                 "POST_LANDING": ("radnet_earth", "radnet_houston_2024_06")}


def _manifest() -> dict[str, dict]:
    raw = yaml.safe_load((DATA_DIR / "MANIFEST.yaml").read_text(encoding="utf-8"))
    return {d["id"]: d for d in raw["datasets"]}


def _replay(cfg: Config, replay_id: str) -> RadReplay:
    status = cfg.datasets.replay(replay_id)
    assert status is not None and status.active, cfg.datasets.problems
    return RadReplay(status, DATA_DIR / status.spec["file"], datetime(2026, 11, 14, tzinfo=UTC))


def _world_in(cfg: Config, phase: str, ticks: int) -> World:
    w = World(cfg, "nominal", 42)
    w.sim.set_phase(phase)
    for _ in range(ticks):
        w.tick()
    return w


# ---- replay fidelity per phase (AGENTS.md section 7, Block P) -----------------------------------------------
@pytest.mark.parametrize("replay_id, dataset_id", [("iss_leo", "iss_dostel1_2019_01"),
                                                   ("crater_lunar", "lro_crater_surface_2019_01")])
def test_replay_mean_within_manifest_tolerance(cfg, replay_id, dataset_id):
    ref = _manifest()[dataset_id]["reference"]
    replay = _replay(cfg, replay_id)
    assert replay.quality_factor == ref["quality_factor"]
    mean_uSv_day = replay.mean_equivalent_uSv_h * 24
    assert abs(mean_uSv_day - ref["dose_equivalent_uSv_day"]) <= ref["tolerance_uSv_day"]
    # The manifest records what the bundled window actually gives (no silent drift after a re-fetch).
    assert mean_uSv_day == pytest.approx(ref["window_mean_dose_equivalent_uSv_day"], rel=0.01)


def test_crater_surface_dose_matches_the_value_quoted_by_zhang_2020(cfg):
    ref = _manifest()["lro_crater_surface_2019_01"]["reference"]
    replay = _replay(cfg, "crater_lunar")
    # Zhang et al. (2020) quote CRaTER (water, surface) 13.29 uGy/h for the same weeks; LND 13.2 +/- 1.4.
    assert abs(replay.mean_absorbed_uGy_h - ref["crater_water_surface_uGy_h"]) <= 1.4


def test_radnet_is_terrestrial_gamma_scale(cfg):
    replay = _replay(cfg, "radnet_earth")
    assert 0.02 < replay.mean_equivalent_uSv_h < 0.1  # ground-level gamma, ~1000x below the ISS


# ---- each phase replays its dataset with the right labels ----------------------------------------------------
def test_leo_replays_iss_dostel_with_nasa_labels(cfg):
    w = _world_in(cfg, "LEO", 5)
    prov = w.snapshot["provenance"]
    assert prov["area_dose_rate_absorbed"]["provenance"] == "NASA_MEASURED"
    for signal in RAD_SIGNALS[1:]:
        assert prov[signal]["provenance"] == "NASA_DERIVED", signal
        assert prov[signal]["dataset_id"] == "iss_dostel1_2019_01"
    assert prov["saa_transit"]["provenance"] == "NASA_DERIVED"
    assert "Berger" in prov["saa_transit"]["basis"]
    replay = w.snapshot["radiation"]["replay"]
    assert replay["label"] == "ISS DOSTEL-1 2019" and replay["agency"] == "NASA"
    assert "DOSTEL" in replay["instrument"] and replay["saa"] in (True, False)
    assert w.store.latest(None, "saa_transit") is not None


def test_lunar_surface_replays_crater_as_nasa_derived(cfg):
    w = _world_in(cfg, "LUNAR_SURFACE", 5)
    prov = w.snapshot["provenance"]
    for signal in RAD_SIGNALS:  # the surface correction is a transform: nothing here is NASA_MEASURED
        assert prov[signal]["provenance"] == "NASA_DERIVED", signal
        assert prov[signal]["dataset_id"] == "lro_crater_surface_2019_01"
    assert w.snapshot["radiation"]["replay"]["measured_provenance"] == "NASA_DERIVED"
    assert 10 < w.store.latest(None, "area_dose_rate_absorbed")[1] < 17
    assert w.store.latest(None, "saa_transit") is None  # no SAA flag outside LEO


def test_post_landing_replays_radnet_as_measured_other(cfg):
    w = _world_in(cfg, "POST_LANDING", 5)
    prov = w.snapshot["provenance"]
    for signal in RAD_SIGNALS:
        assert prov[signal]["provenance"] == "MEASURED_OTHER", signal  # never NASA, even when computed
        assert prov[signal]["dataset_id"] == "radnet_houston_2024_06"
        assert prov[signal]["dataset"]["agency"] == "EPA"
    assert prov["area_dose_rate_equivalent"]["basis"].startswith("EPA RadNet")
    assert "do not see neutrons" in prov["neutron_dose_equivalent_rate"]["basis"]
    assert w.store.latest(None, "neutron_dose_equivalent_rate")[1] == 0.0
    replay = w.snapshot["radiation"]["replay"]
    assert replay["agency"] == "EPA" and replay["measures"] == "equivalent"
    equivalent = w.store.latest(None, "area_dose_rate_equivalent")[1]
    assert w.store.latest(None, "area_dose_rate_absorbed")[1] == pytest.approx(equivalent)  # Q = 1 (photons)


@pytest.mark.parametrize("phase", sorted(PHASE_REPLAYS))
def test_tampered_block_p_file_falls_back_to_synthetic(tmp_path, phase):
    replay_id, dataset_id = PHASE_REPLAYS[phase]
    data = tmp_path / "nasa"
    shutil.copytree(DATA_DIR, data)
    rel = next(f["path"] for f in _manifest()[dataset_id]["files"] if f["path"].startswith("derived/"))
    path = data / rel
    path.write_text(path.read_text(encoding="utf-8").replace("GOOD", "GOOD ", 1), encoding="utf-8")
    cfg = Config(CONFIG_DIR, data)
    assert not cfg.datasets.replay(replay_id).active
    assert any(replay_id in p and "sha256" in p for p in cfg.datasets.problems)
    w = _world_in(cfg, phase, 3)
    assert w.snapshot["provenance"]["area_dose_rate_equivalent"]["provenance"] == "SYNTHETIC"
    assert w.snapshot["radiation"]["replay"] is None
    assert w.store.latest(None, "area_dose_rate_equivalent")[1] > 0


def test_replays_are_deterministic(cfg):
    a, b = _world_in(cfg, "LEO", 30), _world_in(cfg, "LEO", 30)
    assert a.store.points(None, "area_dose_rate_equivalent") == b.store.points(None, "area_dose_rate_equivalent")


# ---- SAA: real trapped-proton spikes must not raise the SPE emergency -----------------------------------------
def test_saa_crossings_do_not_raise_the_spe_emergency(cfg):
    w = _world_in(cfg, "LEO", 6 * 60)  # 6 h: several SAA passes
    values = [v for _, v in w.store.points(None, "area_dose_rate_equivalent")][-6 * 60:]
    limit = cfg.limit("radiation.spe_alert_dose_rate_uSv_h").value
    peak_5m = max(sum(values[i:i + 5]) / 5 for i in range(len(values) - 5))
    assert peak_5m > limit  # the real data does cross the SPE threshold inside the SAA...
    assert 1.0 in [v for _, v in w.store.points(None, "saa_transit")]
    raised = [a.rule_id for a in w.alerts.alerts.values()]
    assert "rad.spe.dose_rate" not in raised  # ...but the rule stands down there


def test_unless_stands_down_a_threshold_rule_with_evidence(cfg):
    rule = next(r for r in cfg.rules if r.id == "rad.spe.dose_rate")
    store = SeriesStore()
    fill(store, None, "area_dose_rate_equivalent", [600.0] * 10)
    engine = RuleEngine([rule], cfg, store, ["C1"])
    (finding,) = engine.evaluate(T0)
    assert finding.firing and "stood_down" not in finding.evidence  # no saa_transit signal: fires as before
    fill(store, None, "saa_transit", [0.0] * 9 + [1.0])
    (finding,) = engine.evaluate(T0)
    assert not finding.firing
    stood = finding.evidence["stood_down"]
    assert stood["firing_without"] is True and stood["by"][0]["signal"] == "saa_transit"
    assert finding.evidence["value"] == 600.0  # the dose evidence is still shown


def test_compound_rules_cannot_use_unless():
    with pytest.raises(ValueError, match="unless"):
        Rule.model_validate({
            "id": "x", "type": "COMPOUND", "title": "x", "all": ["a"], "severity": "INFO",
            "hazards": ["RADIATION"], "hrp_risks": ["HRP-17"], "rationale": "x", "action": "x",
            "unless": [{"signal": "saa_transit", "op": ">", "limit_ref": "radiation.saa_transit_flag"}],
        })
