import uuid
from collections.abc import Sequence

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from lifetracker.core.errors import ConflictError, NotFoundError
from lifetracker.db.models import Sphere
from lifetracker.schemas.spheres import SphereCreate, SphereUpdate
from lifetracker.services.common import apply_patch, get_owned, next_position, resolve_client_id


async def list_spheres(session: AsyncSession, user_id: uuid.UUID) -> Sequence[Sphere]:
    stmt = select(Sphere).where(Sphere.user_id == user_id).order_by(Sphere.position, Sphere.name)
    return (await session.scalars(stmt)).all()


async def ensure_sphere(
    session: AsyncSession, user_id: uuid.UUID, sphere_id: uuid.UUID | None
) -> None:
    """Validate that a referenced sphere belongs to the user (422-style 404 otherwise)."""
    if sphere_id is not None:
        found = await session.scalar(
            select(Sphere.id).where(Sphere.id == sphere_id, Sphere.user_id == user_id)
        )
        if found is None:
            raise NotFoundError("Sphere not found")


async def _name_taken(
    session: AsyncSession, user_id: uuid.UUID, name: str, exclude: uuid.UUID | None = None
) -> bool:
    stmt = select(Sphere.id).where(
        Sphere.user_id == user_id, func.lower(Sphere.name) == name.lower()
    )
    if exclude is not None:
        stmt = stmt.where(Sphere.id != exclude)
    return (await session.scalar(stmt)) is not None


async def create_sphere(session: AsyncSession, user_id: uuid.UUID, data: SphereCreate) -> Sphere:
    existing = await resolve_client_id(session, Sphere, data.id, user_id)
    if existing is not None:
        return existing
    if await _name_taken(session, user_id, data.name):
        raise ConflictError("Sphere with this name already exists")
    sphere = Sphere(
        user_id=user_id,
        name=data.name,
        position=data.position
        if data.position is not None
        else await next_position(session, Sphere, user_id),
    )
    if data.id is not None:
        sphere.id = data.id
    session.add(sphere)
    await session.commit()
    return sphere


async def update_sphere(
    session: AsyncSession, user_id: uuid.UUID, sphere_id: uuid.UUID, data: SphereUpdate
) -> Sphere:
    sphere = await get_owned(session, Sphere, sphere_id, user_id, what="Sphere")
    if data.name is not None and await _name_taken(session, user_id, data.name, exclude=sphere.id):
        raise ConflictError("Sphere with this name already exists")
    apply_patch(sphere, data.model_dump(exclude_unset=True))
    await session.commit()
    return sphere


async def delete_sphere(session: AsyncSession, user_id: uuid.UUID, sphere_id: uuid.UUID) -> None:
    """Habits, tasks and goals of the sphere stay, just without a sphere (FK SET NULL)."""
    sphere = await get_owned(session, Sphere, sphere_id, user_id, what="Sphere")
    await session.delete(sphere)
    await session.commit()
