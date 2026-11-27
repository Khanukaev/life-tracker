"""Claude features of the redesign: notes, day plans, review flags and a journal

* notes: the user's own words about a week or a month («Неделя словами»)
* reviews: kinds month and plan; used_note («Учёл твою заметку»), changes (what Claude
  changed since its previous review), items and applied_at (a plan's tasks)
* claude_actions: every change Claude makes through MCP, one line each

Revision ID: e3f8a6d21b54
Revises: d9e1b3c40f27
Create Date: 2026-11-27 15:00:00

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "e3f8a6d21b54"
down_revision: str | Sequence[str] | None = "d9e1b3c40f27"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_constraint(op.f("ck_reviews_review_kind"), "reviews", type_="check")
    op.create_check_constraint(
        op.f("ck_reviews_review_kind"), "reviews", "kind IN ('day', 'week', 'month', 'plan')"
    )
    op.add_column(
        "reviews", sa.Column("used_note", sa.Boolean(), nullable=False, server_default=sa.false())
    )
    op.add_column(
        "reviews",
        sa.Column(
            "changes", postgresql.JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")
        ),
    )
    op.add_column("reviews", sa.Column("items", postgresql.JSONB(), nullable=True))
    op.add_column("reviews", sa.Column("applied_at", sa.DateTime(timezone=True), nullable=True))
    op.alter_column("reviews", "used_note", server_default=None)
    op.alter_column("reviews", "changes", server_default=None)

    op.create_table(
        "notes",
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column(
            "kind",
            sa.Enum("week", "month", name="note_kind", native_enum=False, create_constraint=True,
                    length=16),
            nullable=False,
        ),  # fmt: skip
        sa.Column("start", sa.Date(), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"),
            nullable=False,
        ),  # fmt: skip
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name=op.f("fk_notes_user_id_users"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("user_id", "kind", "start", name=op.f("pk_notes")),
    )
    op.create_table(
        "claude_actions",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=False), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column(
            "at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
        ),
        sa.Column("what", sa.Text(), nullable=False),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name=op.f("fk_claude_actions_user_id_users"),
            ondelete="CASCADE",
        ),  # fmt: skip
        sa.PrimaryKeyConstraint("id", name=op.f("pk_claude_actions")),
    )
    op.create_index(
        "ix_claude_actions_user_at", "claude_actions", ["user_id", sa.literal_column("at DESC")]
    )


def downgrade() -> None:
    op.drop_index("ix_claude_actions_user_at", table_name="claude_actions")
    op.drop_table("claude_actions")
    op.drop_table("notes")
    op.execute("DELETE FROM reviews WHERE kind IN ('month', 'plan')")
    for col in ("applied_at", "items", "changes", "used_note"):
        op.drop_column("reviews", col)
    op.drop_constraint(op.f("ck_reviews_review_kind"), "reviews", type_="check")
    op.create_check_constraint(op.f("ck_reviews_review_kind"), "reviews", "kind IN ('day', 'week')")
