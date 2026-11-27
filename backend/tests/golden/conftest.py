"""Golden fixtures: the original JS functions' outputs (golden/expected) vs the Python port."""

import dataclasses
import json
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Any

import pytest

from lifetracker.domain.dates import js_round
from lifetracker.domain.legacy import LegacyData, convert, parse_now
from lifetracker.domain.model import Ctx

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

    @property
    def approx(self) -> set[str]:
        """Habits whose "every N days" schedule became an approximate cycle: the original's
        statuses for them are not expected to match, so they are left out of comparisons."""
        return self.data.approx_schedule

    @property
    def exact_ctx(self) -> Ctx:
        """The context without the approximated habits."""
        ctx = self.data.ctx
        return dataclasses.replace(ctx, habits=[h for h in ctx.habits if h.id not in self.approx])

    @property
    def approx_names(self) -> tuple[str, ...]:
        return tuple(h.name for h in self.data.ctx.habits if h.id in self.approx)


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


def equal_weights(
    items: list[list[Any]], drop: set[str] | frozenset[str] = frozenset()
) -> tuple[list[list[Any]], int, int]:
    """The original's score items with this app's weights: every habit ×1, tasks unchanged.

    The old app weighted sleep/study/orders ×3; here importance belongs to tasks only.
    Item order and values stay the original's, so they are still compared exactly.
    `drop` leaves out habits that have no exact equivalent here.
    """
    out = [[k, w if k == "tasks" else 1, v] for k, w, v in items if k not in drop]
    total = sum(w for _, w, _ in out)
    got = sum(w * v for _, w, v in out)
    return out, (js_round(got / total * 100) if total else 0), total
