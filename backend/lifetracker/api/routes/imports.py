"""Import from the old app («Скопировать данные (JSON)»)."""

from typing import Any

from fastapi import APIRouter, Body

from lifetracker.api.deps import Now, SessionDep, UserId
from lifetracker.services import importer

router = APIRouter(tags=["import"])


@router.post("/import")
async def import_legacy(
    session: SessionDep,
    user_id: UserId,
    now: Now,
    export: dict[str, Any] = Body(..., description="The JSON copied from the old app"),  # noqa: B008
    dry_run: bool = False,
) -> dict[str, Any]:
    """Merge the export into the account. `dry_run=true` returns the same report and
    changes nothing, so the app can show a preview before the real import."""
    report = await importer.import_export(session, user_id, export, now, dry_run=dry_run)
    return report.as_dict()
