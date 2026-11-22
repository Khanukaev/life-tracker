"""Declarative base, naming conventions and column helpers."""

import enum
import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import DateTime, Enum, MetaData, func
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
from uuid_utils.compat import uuid7

# Stable constraint names make Alembic diffs predictable.
NAMING_CONVENTION = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_N_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_N_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING_CONVENTION)
    # Fetch server-generated values (created_at/updated_at) via RETURNING on INSERT/UPDATE,
    # so they never trigger lazy loads (forbidden in async code).
    __mapper_args__ = {"eager_defaults": True}  # noqa: RUF012


def new_id() -> uuid.UUID:
    """UUIDv7: time-ordered (index friendly) and safe to generate on the client."""
    return uuid7()


def str_enum(enum_cls: type[enum.StrEnum], name: str) -> Enum:
    """Store enums as VARCHAR + CHECK: easier to evolve than native PG enums."""
    return Enum(
        enum_cls,
        name=name,
        native_enum=False,
        create_constraint=True,
        length=16,
        values_callable=lambda e: [m.value for m in e],
        validate_strings=True,
    )


def created_at_col() -> Mapped[datetime]:
    return mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


def updated_at_col() -> Mapped[datetime]:
    return mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


def uuid_pk() -> Mapped[uuid.UUID]:
    return mapped_column(primary_key=True, default=new_id)


JSON = dict[str, Any]
