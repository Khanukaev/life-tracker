"""drop habits.is_key: importance is a task notion, every habit weighs the same

Revision ID: a7e3f0c2b915
Revises: d1c21523d8e9
Create Date: 2026-11-23 12:00:00

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "a7e3f0c2b915"
down_revision: str | Sequence[str] | None = "d1c21523d8e9"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_column("habits", "is_key")


def downgrade() -> None:
    op.add_column(
        "habits",
        sa.Column("is_key", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
