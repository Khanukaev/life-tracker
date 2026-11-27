"""reminders of the redesign: per task and habit, a morning time, a Sunday note

* tasks.remind_at, habits.remind_at: a bot message at that time (on the task's date, or
  on the habit's working days while it is not done)
* users.morning_time replaces morning_ping (it was "usual wake + 30 min"): the morning
  message now carries the day's plan, at a time the user picks
* users.week_note_time: on Sundays, a nudge to write «неделя словами» for Claude
* deliveries.ref: which task or habit an item reminder was about (the nil UUID for the
  rest), part of the key so every item is still sent exactly once a day

Revision ID: f5a7c9e2d813
Revises: e3f8a6d21b54
Create Date: 2026-11-27 16:00:00

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "f5a7c9e2d813"
down_revision: str | Sequence[str] | None = "e3f8a6d21b54"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

NIL = "'00000000-0000-0000-0000-000000000000'::uuid"
NEW_KINDS = "kind IN ('evening', 'morning', 'week_note', 'task', 'habit')"


def upgrade() -> None:
    op.add_column("tasks", sa.Column("remind_at", sa.Time(), nullable=True))
    op.add_column("habits", sa.Column("remind_at", sa.Time(), nullable=True))

    op.add_column("users", sa.Column("morning_time", sa.Time(), nullable=True))
    op.add_column("users", sa.Column("week_note_time", sa.Time(), nullable=True))
    op.execute(
        "UPDATE users u SET morning_time = (s.usual_wake + interval '30 minutes')::time"
        " FROM user_settings s WHERE s.user_id = u.id AND u.morning_ping"
    )
    op.drop_column("users", "morning_ping")

    op.add_column(
        "deliveries",
        sa.Column("ref", sa.Uuid(), nullable=False, server_default=sa.text(NIL)),
    )
    op.drop_constraint(op.f("pk_deliveries"), "deliveries", type_="primary")
    op.create_primary_key(op.f("pk_deliveries"), "deliveries", ["user_id", "kind", "date", "ref"])
    op.drop_constraint(op.f("ck_deliveries_delivery_kind"), "deliveries", type_="check")
    op.create_check_constraint(op.f("ck_deliveries_delivery_kind"), "deliveries", NEW_KINDS)


def downgrade() -> None:
    op.execute("DELETE FROM deliveries WHERE kind NOT IN ('evening', 'morning')")
    op.drop_constraint(op.f("ck_deliveries_delivery_kind"), "deliveries", type_="check")
    op.create_check_constraint(
        op.f("ck_deliveries_delivery_kind"), "deliveries", "kind IN ('evening', 'morning')"
    )
    op.drop_constraint(op.f("pk_deliveries"), "deliveries", type_="primary")
    op.create_primary_key(op.f("pk_deliveries"), "deliveries", ["user_id", "kind", "date"])
    op.drop_column("deliveries", "ref")

    op.add_column(
        "users",
        sa.Column("morning_ping", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.execute("UPDATE users SET morning_ping = morning_time IS NOT NULL")
    op.alter_column("users", "morning_ping", server_default=None)
    op.drop_column("users", "week_note_time")
    op.drop_column("users", "morning_time")
    op.drop_column("habits", "remind_at")
    op.drop_column("tasks", "remind_at")
