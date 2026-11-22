"""One request per screen (Day, Now, Review) plus helpers used by sheets."""

import uuid
from datetime import date
from typing import Annotated, Literal

from fastapi import APIRouter, Query

from lifetracker.api.deps import Now, SessionDep, UserId
from lifetracker.domain.enums import EnergyZone
from lifetracker.domain.templates import HABIT_TEMPLATES
from lifetracker.schemas.views import (
    DayView,
    FeelIn,
    FeelOut,
    FeelResultOut,
    GoalsView,
    NowView,
    ProfileView,
    ReviewView,
    SlotView,
    TasksView,
)
from lifetracker.services import feel, screens, views

router = APIRouter(tags=["views"])


@router.get("/views/day", response_model=DayView)
async def day_view(
    session: SessionDep,
    user_id: UserId,
    now: Now,
    day: Annotated[date | None, Query(alias="date")] = None,
) -> DayView:
    """Everything the Day screen needs: score, habits, tasks, timeline with energy."""
    return await views.day_view(session, user_id, now, day)


@router.get("/views/now", response_model=NowView)
async def now_view(session: SessionDep, user_id: UserId, now: Now) -> NowView:
    """Energy index now, windows, factors and modelled hormones."""
    return await views.now_view(session, user_id, now)


@router.get("/views/review", response_model=ReviewView)
async def review_view(
    session: SessionDep,
    user_id: UserId,
    now: Now,
    period: Literal["week", "month"] = "month",
    anchor: date | None = None,
) -> ReviewView:
    """Calendar week (Mon–Sun) or month containing `anchor` (default: today)."""
    return await views.review_view(session, user_id, now, period, anchor)


@router.get("/views/slot", response_model=SlotView)
async def slot_view(
    session: SessionDep,
    user_id: UserId,
    now: Now,
    day: Annotated[date, Query(alias="date")],
    dur: Annotated[int, Query(ge=5, le=1440)] = 30,
    energy: EnergyZone = EnergyZone.STEADY,
    exclude: uuid.UUID | None = None,
) -> SlotView:
    """Best free slot for a task; if the day fits poorly, also an alternative on the next day."""
    return await views.slot_view(session, user_id, now, day, dur, energy, exclude)


@router.post("/feel", response_model=FeelResultOut)
async def record_feel(
    body: FeelIn, session: SessionDep, user_id: UserId, now: Now
) -> FeelResultOut:
    """ "How do you feel?" now: compares with the model and adjusts the personal correction."""
    res = await feel.record_feel(session, user_id, body.v, now)
    return FeelResultOut(
        feel=FeelOut(t=res.rec.t, v=res.rec.v, pred=res.rec.pred, err=res.rec.err),
        message=res.message,
        bias=res.bias,
        model_n=res.model_n,
    )


@router.get("/views/profile", response_model=ProfileView)
async def profile_view(session: SessionDep, user_id: UserId, now: Now) -> ProfileView:
    """Goals preview, task counters, habits and spheres for the Profile tab."""
    return await screens.profile_view(session, user_id, now)


@router.get("/views/tasks", response_model=TasksView)
async def tasks_view(
    session: SessionDep,
    user_id: UserId,
    now: Now,
    view: Literal["inbox", "today", "overdue", "upcoming", "done", "energy"] = "today",
) -> TasksView:
    """A task tab with counters for all tabs; `energy` adds tasks-vs-windows loads."""
    return await screens.tasks_view(session, user_id, now, view)


@router.get("/views/goals", response_model=GoalsView)
async def goals_view(session: SessionDep, user_id: UserId, now: Now) -> GoalsView:
    """Goal cards with progress, recent history across goals and the archive."""
    return await screens.goals_view(session, user_id, now)


@router.get("/habit-templates")
async def habit_templates(_: UserId) -> list[dict[str, object]]:
    """Optional starter habits for onboarding (neutral, editable after creation)."""
    return HABIT_TEMPLATES
