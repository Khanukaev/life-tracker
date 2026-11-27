"""«Неделя словами»: one free text per calendar week or month, in the user's own words.

Claude reads it when it writes a review and marks the review «Учёл твою заметку».
"""

import uuid
from datetime import date, timedelta

from sqlalchemy import delete
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from lifetracker.db.models import Note
from lifetracker.domain.enums import NoteKind

NOTE_MAX = 4000


def period_start(kind: NoteKind, anchor: date) -> date:
    """The first day of the calendar week (Monday) or month that contains `anchor`."""
    if kind == NoteKind.WEEK:
        return anchor - timedelta(days=anchor.weekday())
    return anchor.replace(day=1)


async def get_note(
    session: AsyncSession, user_id: uuid.UUID, kind: NoteKind, anchor: date
) -> Note | None:
    return await session.get(Note, (user_id, kind, period_start(kind, anchor)))


async def save_note(
    session: AsyncSession, user_id: uuid.UUID, kind: NoteKind, anchor: date, body: str
) -> Note | None:
    """Upsert the period's note; an empty text deletes it."""
    start = period_start(kind, anchor)
    text = body.strip()[:NOTE_MAX]
    if not text:
        await session.execute(
            delete(Note).where(Note.user_id == user_id, Note.kind == kind, Note.start == start)
        )
        await session.commit()
        return None
    stmt = insert(Note).values(user_id=user_id, kind=kind, start=start, body=text)
    await session.execute(
        stmt.on_conflict_do_update(index_elements=["user_id", "kind", "start"], set_={"body": text})
    )
    await session.commit()
    return await session.get(Note, (user_id, kind, start), populate_existing=True)
