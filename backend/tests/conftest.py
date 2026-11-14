from datetime import UTC, datetime, timedelta

import pytest

from app.config import Config
from app.db.store import SeriesStore
from app.world import World

T0 = datetime(2026, 11, 14, 12, 0, tzinfo=UTC)


@pytest.fixture(scope="session")
def cfg() -> Config:
    return Config()


@pytest.fixture
def store() -> SeriesStore:
    return SeriesStore()


def fill(store: SeriesStore, crew_id: str | None, signal: str, values: list[float], end: datetime = T0) -> datetime:
    """Adds one value per minute, the last one at `end`. Returns `end`."""
    start = end - timedelta(minutes=len(values) - 1)
    for i, value in enumerate(values):
        store.add(crew_id, signal, start + timedelta(minutes=i), value)
    return end


def run(cfg: Config, scenario: str, hours: float, seed: int = 42) -> World:
    world = World(cfg, scenario, seed)
    for _ in range(int(hours * 3600 / cfg.mission["tick_s"])):
        world.tick()
    return world
