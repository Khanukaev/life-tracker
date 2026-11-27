"""habit types check / count / bedtime and schedules daily / weekdays / cycle

Data moves, nothing is lost but the labels of two-flag habits:
* water   -> count, norm = glasses per day (ceil(target_l / glass_l)), step 1
* minutes -> count, norm = target minutes, step = the old button step
* dual    -> count, norm 2; a day's {"a", "b"} becomes 0, 1 or 2
* every N -> cycle "1" + "0" * (N - 1) anchored on the last day it was done (else the day
  it was created), so the next due day stays where it was

Revision ID: c7d2a5f81e33
Revises: b41c9e2d7a10
Create Date: 2026-11-27 13:00:00

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "c7d2a5f81e33"
down_revision: str | Sequence[str] | None = "b41c9e2d7a10"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

NEW_SCHEDULE = (
    "(sched_kind IN ('daily', 'weekdays') AND sched_pattern IS NULL)"
    " OR (sched_kind = 'cycle' AND sched_pattern ~ '^[01]*1[01]*$' AND sched_anchor IS NOT NULL)"
)
OLD_SCHEDULE = (
    "(sched_kind = 'daily') OR (sched_kind = 'every' AND sched_n BETWEEN 2 AND 365)"
    " OR (sched_kind = 'cycle' AND sched_pattern ~ '^[01]+$' AND sched_anchor IS NOT NULL)"
)


def _drop_checks() -> None:
    for name in ("ck_habits_habit_type", "ck_habits_schedule_kind", "ck_habits_schedule_valid"):
        op.drop_constraint(op.f(name), "habits", type_="check")


def upgrade() -> None:
    _drop_checks()
    op.execute(
        """
        UPDATE habit_logs l
           SET value = to_jsonb(((l.value->>'a')::boolean)::int + ((l.value->>'b')::boolean)::int)
          FROM habits h
         WHERE h.id = l.habit_id AND h.type = 'dual' AND jsonb_typeof(l.value) = 'object'
        """
    )
    op.execute(
        """
        UPDATE habits SET type = 'count', config = CASE type
            WHEN 'water' THEN jsonb_build_object(
                'norm', GREATEST(1, CEIL((config->>'target_l')::numeric
                                         / NULLIF((config->>'glass_l')::numeric, 0) - 1e-9))::int,
                'step', 1)
            WHEN 'minutes' THEN jsonb_build_object(
                'norm', COALESCE((config->>'target_min')::int, 20),
                'step', COALESCE((config->>'step_min')::int, 10))
            ELSE jsonb_build_object('norm', 2, 'step', 1)
        END
         WHERE type IN ('water', 'minutes', 'dual')
        """
    )
    op.execute(
        """
        UPDATE habits h
           SET sched_kind = 'cycle',
               sched_pattern = '1' || repeat('0', LEAST(h.sched_n, 31) - 1),
               sched_anchor = COALESCE(
                   (SELECT max(l.date) FROM habit_logs l
                     WHERE l.habit_id = h.id
                       AND l.value NOT IN ('false'::jsonb, '0'::jsonb, 'null'::jsonb)),
                   h.created_at::date)
         WHERE h.sched_kind = 'every'
        """
    )
    op.drop_column("habits", "sched_n")
    op.create_check_constraint(
        op.f("ck_habits_habit_type"), "habits", "type IN ('check', 'count', 'bedtime')"
    )
    op.create_check_constraint(
        op.f("ck_habits_schedule_kind"), "habits", "sched_kind IN ('daily', 'weekdays', 'cycle')"
    )
    op.create_check_constraint(op.f("ck_habits_schedule_valid"), "habits", NEW_SCHEDULE)


def downgrade() -> None:
    """Back to the old types: count habits become minutes counters, weekdays become daily."""
    _drop_checks()
    op.add_column("habits", sa.Column("sched_n", sa.SmallInteger(), nullable=True))
    op.execute(
        """
        UPDATE habits SET type = 'minutes', config = jsonb_build_object(
            'target_min', (config->>'norm')::int, 'step_min', (config->>'step')::int)
         WHERE type = 'count'
        """
    )
    op.execute("UPDATE habits SET sched_kind = 'daily' WHERE sched_kind = 'weekdays'")
    op.create_check_constraint(
        op.f("ck_habits_habit_type"),
        "habits",
        "type IN ('check', 'bedtime', 'water', 'minutes', 'dual')",
    )
    op.create_check_constraint(
        op.f("ck_habits_schedule_kind"), "habits", "sched_kind IN ('daily', 'every', 'cycle')"
    )
    op.create_check_constraint(op.f("ck_habits_schedule_valid"), "habits", OLD_SCHEDULE)
