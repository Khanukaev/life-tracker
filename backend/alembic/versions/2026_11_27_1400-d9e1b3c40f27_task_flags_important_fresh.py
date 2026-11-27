"""tasks: importance -> important flag, energy zone -> fresh flag

The redesign has one switch «Важное» (top of the list, ×3 in the score) and one
«Нужна свежая голова» (goes to the energy peak):
* important = the old importance was important or critical
* fresh     = the old energy zone was focus (steady and recharge become the default)

Revision ID: d9e1b3c40f27
Revises: c7d2a5f81e33
Create Date: 2026-11-27 14:00:00

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "d9e1b3c40f27"
down_revision: str | Sequence[str] | None = "c7d2a5f81e33"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "tasks", sa.Column("important", sa.Boolean(), nullable=False, server_default=sa.false())
    )
    op.add_column(
        "tasks", sa.Column("fresh", sa.Boolean(), nullable=False, server_default=sa.false())
    )
    op.execute(
        "UPDATE tasks SET important = importance IN ('important', 'critical'),"
        " fresh = energy = 'focus'"
    )
    op.alter_column("tasks", "important", server_default=None)
    op.alter_column("tasks", "fresh", server_default=None)
    op.drop_column("tasks", "importance")  # its CHECK constraint goes with it
    op.drop_column("tasks", "energy")


def downgrade() -> None:
    op.add_column(
        "tasks",
        sa.Column(
            "energy",
            sa.Enum("focus", "steady", "recharge", name="energy_zone", native_enum=False,
                    create_constraint=True, length=16),
            nullable=False,
            server_default="steady",
        ),
    )  # fmt: skip
    op.add_column(
        "tasks",
        sa.Column(
            "importance",
            sa.Enum("normal", "important", "critical", name="importance", native_enum=False,
                    create_constraint=True, length=16),
            nullable=False,
            server_default="normal",
        ),
    )  # fmt: skip
    op.execute(
        "UPDATE tasks SET importance = CASE WHEN important THEN 'critical' ELSE 'normal' END,"
        " energy = CASE WHEN fresh THEN 'focus' ELSE 'steady' END"
    )
    op.drop_column("tasks", "important")
    op.drop_column("tasks", "fresh")
