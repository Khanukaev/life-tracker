"""drop users.theme: the redesign has one dark theme

Revision ID: 9c4e7b1f2a63
Revises: f5a7c9e2d813
Create Date: 2026-11-27 17:00:00

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "9c4e7b1f2a63"
down_revision: str | Sequence[str] | None = "f5a7c9e2d813"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_column("users", "theme")  # its CHECK constraint goes with it


def downgrade() -> None:
    op.add_column(
        "users",
        sa.Column(
            "theme",
            sa.Enum("base", "glass", name="theme", native_enum=False, create_constraint=True,
                    length=16),
            nullable=True,
        ),
    )  # fmt: skip
