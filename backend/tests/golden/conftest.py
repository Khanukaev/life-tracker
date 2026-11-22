"""Golden fixtures: the original JS functions' outputs (golden/expected) vs the Python port."""

import json
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Any

import pytest

from lifetracker.domain.legacy import LegacyData, convert, parse_now

ROOT = Path(__file__).resolve().parents[3] / "golden"
NAMES = sorted(p.stem for p in (ROOT / "fixtures").glob("*.json"))


@dataclass
class Case:
    name: str
    data: LegacyData
    expected: dict[str, Any]
    raw: dict[str, Any]

    @property
    def today(self) -> date:
        return self.data.ctx.today


def load_case(name: str) -> Case:
    raw = json.loads((ROOT / "fixtures" / f"{name}.json").read_text(encoding="utf-8"))
    expected = json.loads((ROOT / "expected" / f"{name}.json").read_text(encoding="utf-8"))
    today, now_min = parse_now(raw["now"])
    return Case(name, convert(raw, today=today, now_min=now_min), expected, raw)


@pytest.fixture(params=NAMES)
def case(request: pytest.FixtureRequest) -> Case:
    return load_case(request.param)


def r6(x: float | None) -> float | None:
    """Same rounding the harness applies: Math.round(x * 1e6) / 1e6."""
    if x is None:
        return None
    from lifetracker.domain.dates import js_round

    return js_round(x * 1e6) / 1e6
