import uuid

from pydantic import Field

from lifetracker.schemas.common import ApiModel, InputModel


class SphereOut(ApiModel):
    id: uuid.UUID
    name: str
    position: int


class SphereCreate(InputModel):
    id: uuid.UUID | None = None  # optional client-generated id (optimistic UI)
    name: str = Field(min_length=1, max_length=40)
    position: int | None = None


class SphereUpdate(InputModel):
    name: str | None = Field(default=None, min_length=1, max_length=40)
    position: int | None = None
