import uuid
from collections.abc import Sequence

from fastapi import APIRouter, status

from lifetracker.api.deps import SessionDep, UserId
from lifetracker.db.models import Sphere
from lifetracker.schemas.spheres import SphereCreate, SphereOut, SphereUpdate
from lifetracker.services import spheres

router = APIRouter(prefix="/spheres", tags=["spheres"])


@router.get("", response_model=list[SphereOut])
async def list_spheres(session: SessionDep, user_id: UserId) -> Sequence[Sphere]:
    return await spheres.list_spheres(session, user_id)


@router.post("", response_model=SphereOut, status_code=status.HTTP_201_CREATED)
async def create_sphere(body: SphereCreate, session: SessionDep, user_id: UserId) -> Sphere:
    return await spheres.create_sphere(session, user_id, body)


@router.patch("/{sphere_id}", response_model=SphereOut)
async def update_sphere(
    sphere_id: uuid.UUID, body: SphereUpdate, session: SessionDep, user_id: UserId
) -> Sphere:
    return await spheres.update_sphere(session, user_id, sphere_id, body)


@router.delete("/{sphere_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_sphere(sphere_id: uuid.UUID, session: SessionDep, user_id: UserId) -> None:
    await spheres.delete_sphere(session, user_id, sphere_id)
