"""Helpers shared by services: ownership lookups and PATCH application."""

import uuid
from collections.abc import Iterable
from typing import Any, TypeVar

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import InstrumentedAttribute

from lifetracker.core.errors import ConflictError, DomainValidationError, NotFoundError

T = TypeVar("T")


async def get_owned[T](
    session: AsyncSession,
    model: type[T],
    obj_id: uuid.UUID,
    user_id: uuid.UUID,
    *,
    what: str,
    for_update: bool = False,
) -> T:
    """Fetch a row by id *and* owner. Someone else's row is indistinguishable from none."""
    id_col: InstrumentedAttribute[Any] = model.id  # type: ignore[attr-defined]
    owner_col: InstrumentedAttribute[Any] = model.user_id  # type: ignore[attr-defined]
    stmt = select(model).where(id_col == obj_id, owner_col == user_id)
    if for_update:
        stmt = stmt.with_for_update()
    obj = (await session.execute(stmt)).scalar_one_or_none()
    if obj is None:
        raise NotFoundError(f"{what} not found")
    return obj


async def resolve_client_id[T](
    session: AsyncSession, model: type[T], obj_id: uuid.UUID | None, user_id: uuid.UUID
) -> T | None:
    """Make creation with a client-generated id idempotent.

    The Mini App creates objects optimistically with its own UUIDv7 and may retry the
    request after a network error. A retry returns the already created row; an id that
    belongs to someone else is a conflict (practically impossible with random UUIDs).
    """
    if obj_id is None:
        return None
    obj = await session.get(model, obj_id)
    if obj is None:
        return None
    if obj.user_id != user_id:  # type: ignore[attr-defined]
        raise ConflictError("Id is already in use")
    return obj


async def next_position(session: AsyncSession, model: type[Any], user_id: uuid.UUID) -> int:
    current = await session.scalar(select(func.max(model.position)).where(model.user_id == user_id))
    return 0 if current is None else int(current) + 1


def apply_patch(obj: object, data: dict[str, Any], *, nullable: Iterable[str] = ()) -> set[str]:
    """Copy PATCH fields onto ``obj``; explicit ``null`` is allowed only for nullable fields.

    Returns the names of fields whose value actually changed.
    """
    allowed_null = set(nullable)
    changed: set[str] = set()
    for key, value in data.items():
        if value is None and key not in allowed_null:
            raise DomainValidationError(f"{key} cannot be null")
        if getattr(obj, key) != value:
            setattr(obj, key, value)
            changed.add(key)
    return changed
