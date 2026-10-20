from __future__ import annotations

import uuid
from datetime import date, timedelta
from typing import Any

from fastapi import APIRouter, Query

from app.api.deps import DB, CurrentUser
from app.core.errors import ValidationFailed
from app.services.dashboard import build_dashboard
from app.services.timeline import build_timeline, calendar_items

router = APIRouter(tags=["views"])

MAX_WINDOW_DAYS = 3 * 366


def _window(start: date | None, end: date | None, default_before: int, default_after: int) -> tuple[date, date]:
    today = date.today()
    start = start or today - timedelta(days=default_before)
    end = end or today + timedelta(days=default_after)
    if end < start:
        raise ValidationFailed("end must be on or after start")
    if (end - start).days > MAX_WINDOW_DAYS:
        raise ValidationFailed("The date window can be at most 3 years")
    return start, end


@router.get("/dashboard")
def dashboard(db: DB, _: CurrentUser) -> dict[str, Any]:
    return build_dashboard(db)


@router.get("/timeline")
def timeline(
    db: DB,
    _: CurrentUser,
    start: date | None = None,
    end: date | None = None,
    project_id: list[uuid.UUID] | None = Query(default=None),
    category: str | None = None,
    repo_id: uuid.UUID | None = None,
    label: str | None = None,
    status: list[str] | None = Query(default=None),
    priority: str | None = None,
    include_done: bool = True,
) -> dict[str, Any]:
    window_start, window_end = _window(start, end, 30, 90)
    return build_timeline(
        db,
        window_start=window_start,
        window_end=window_end,
        project_ids=project_id,
        category=category,
        repo_id=repo_id,
        label=label,
        status=status,
        priority=priority,
        include_done=include_done,
    )


@router.get("/calendar")
def calendar(db: DB, _: CurrentUser, start: date | None = None, end: date | None = None) -> list[dict[str, Any]]:
    window_start, window_end = _window(start, end, 0, 42)
    return calendar_items(db, window_start, window_end)
