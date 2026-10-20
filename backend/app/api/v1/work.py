from __future__ import annotations

import uuid
from typing import Any, Literal

from fastapi import APIRouter, Query, Response
from sqlalchemy import case, func, select

from app.api.deps import DB, CurrentUser
from app.models import Milestone, Task
from app.schemas.common import Page
from app.schemas.work import (
    CommentIn,
    CommentOut,
    DependencyIn,
    MilestoneCreate,
    MilestoneOut,
    MilestoneUpdate,
    TaskCreate,
    TaskOut,
    TaskUpdate,
)
from app.services import tasks as svc

router = APIRouter(tags=["tasks"])

TASK_SORTS = {
    "position": (Task.position, Task.created_at),
    "due": (func.coalesce(Task.due_date, Task.gh_board_end).asc().nulls_last(), Task.position),
    "updated": (Task.updated_at.desc(),),
    "created": (Task.created_at.desc(),),
    "priority": (
        case({"urgent": 0, "high": 1, "medium": 2, "low": 3}, value=Task.priority),
        Task.position,
    ),
}


@router.get("/tasks", response_model=Page[TaskOut])
def list_tasks(
    db: DB,
    _: CurrentUser,
    project_id: uuid.UUID | None = None,
    status: list[str] | None = Query(default=None),
    priority: str | None = None,
    milestone_id: uuid.UUID | None = None,
    repo_id: uuid.UUID | None = None,
    label: str | None = None,
    source: Literal["local", "github"] | None = None,
    q: str | None = Query(default=None, max_length=200),
    parent_task_id: uuid.UUID | None = None,
    top_level_only: bool = False,
    include_unassigned: bool = False,
    sort: Literal["position", "due", "updated", "created", "priority"] = "position",
    limit: int = Query(default=200, ge=1, le=1000),
    offset: int = Query(default=0, ge=0),
) -> dict[str, Any]:
    stmt = svc.task_query(
        project_id=project_id,
        status=status,
        priority=priority,
        milestone_id=milestone_id,
        repo_id=repo_id,
        label=label,
        q=q,
        source=source,
        top_level_only=top_level_only,
        include_unassigned=include_unassigned,
    )
    if parent_task_id:
        stmt = stmt.where(Task.parent_task_id == parent_task_id)
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows: list[Task] = list(db.scalars(stmt.order_by(*TASK_SORTS[sort]).limit(limit).offset(offset)))
    return {"items": svc.serialize_tasks(db, rows), "total": total, "limit": limit, "offset": offset}


@router.post("/tasks", response_model=TaskOut, status_code=201)
def create_task(body: TaskCreate, db: DB, _: CurrentUser) -> dict[str, Any]:
    task = svc.create_task(db, body)
    return svc.serialize_tasks(db, [task])[0]


@router.get("/tasks/{task_id}", response_model=TaskOut)
def get_task(task_id: uuid.UUID, db: DB, _: CurrentUser) -> dict[str, Any]:
    return svc.serialize_tasks(db, [svc.get_task(db, task_id)])[0]


@router.patch("/tasks/{task_id}", response_model=TaskOut)
def update_task(task_id: uuid.UUID, body: TaskUpdate, db: DB, _: CurrentUser) -> dict[str, Any]:
    task = svc.update_task(db, task_id, body)
    return svc.serialize_tasks(db, [task])[0]


@router.delete("/tasks/{task_id}", status_code=204)
def delete_task(task_id: uuid.UUID, db: DB, _: CurrentUser) -> Response:
    svc.delete_task(db, task_id)
    return Response(status_code=204)


@router.post("/tasks/{task_id}/dependencies", status_code=204)
def add_dependency(task_id: uuid.UUID, body: DependencyIn, db: DB, _: CurrentUser) -> Response:
    svc.add_dependency(db, task_id, body.depends_on_id)
    return Response(status_code=204)


@router.delete("/tasks/{task_id}/dependencies/{depends_on_id}", status_code=204)
def remove_dependency(task_id: uuid.UUID, depends_on_id: uuid.UUID, db: DB, _: CurrentUser) -> Response:
    svc.remove_dependency(db, task_id, depends_on_id)
    return Response(status_code=204)


@router.get("/tasks/{task_id}/comments", response_model=list[CommentOut])
def list_comments(task_id: uuid.UUID, db: DB, _: CurrentUser) -> Any:
    return svc.list_comments(db, task_id)


@router.post("/tasks/{task_id}/comments", response_model=CommentOut, status_code=201)
def add_comment(task_id: uuid.UUID, body: CommentIn, db: DB, _: CurrentUser) -> Any:
    return svc.add_comment(db, task_id, body.body)


@router.delete("/tasks/{task_id}/comments/{comment_id}", status_code=204)
def delete_comment(task_id: uuid.UUID, comment_id: uuid.UUID, db: DB, _: CurrentUser) -> Response:
    svc.delete_comment(db, task_id, comment_id)
    return Response(status_code=204)


@router.get("/milestones", response_model=list[MilestoneOut])
def list_milestones(
    db: DB,
    _: CurrentUser,
    project_id: uuid.UUID | None = None,
    status: Literal["open", "done"] | None = None,
) -> list[dict[str, Any]]:
    stmt = select(Milestone).where(Milestone.project_id.is_not(None))
    if project_id:
        stmt = stmt.where(Milestone.project_id == project_id)
    if status:
        stmt = stmt.where(Milestone.status == status)
    stmt = stmt.order_by(
        func.coalesce(Milestone.local_due_date, Milestone.due_date, Milestone.gh_due_on).asc().nulls_last(),
        Milestone.title,
    )
    return svc.serialize_milestones(db, list(db.scalars(stmt.limit(500))))


@router.post("/milestones", response_model=MilestoneOut, status_code=201)
def create_milestone(body: MilestoneCreate, db: DB, _: CurrentUser) -> dict[str, Any]:
    return svc.serialize_milestones(db, [svc.create_milestone(db, body)])[0]


@router.patch("/milestones/{milestone_id}", response_model=MilestoneOut)
def update_milestone(milestone_id: uuid.UUID, body: MilestoneUpdate, db: DB, _: CurrentUser) -> dict[str, Any]:
    return svc.serialize_milestones(db, [svc.update_milestone(db, milestone_id, body)])[0]


@router.delete("/milestones/{milestone_id}", status_code=204)
def delete_milestone(milestone_id: uuid.UUID, db: DB, _: CurrentUser) -> Response:
    svc.delete_milestone(db, milestone_id)
    return Response(status_code=204)
