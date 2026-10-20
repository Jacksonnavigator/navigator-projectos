from __future__ import annotations

import uuid
from typing import Any, Literal

from fastapi import APIRouter, Query, Response

from app.api.deps import DB, CurrentUser
from app.schemas.common import Page
from app.schemas.projects import (
    LinkIn,
    LinkOut,
    ProjectCreate,
    ProjectOut,
    ProjectSummary,
    ProjectUpdate,
    RelationIn,
)
from app.services import projects as svc

router = APIRouter(prefix="/projects", tags=["projects"])


@router.get("", response_model=Page[ProjectSummary])
def list_projects(
    db: DB,
    _: CurrentUser,
    q: str | None = Query(default=None, max_length=200),
    category: str | None = None,
    lifecycle: str | None = None,
    priority: str | None = None,
    tag: str | None = None,
    include_archived: bool = False,
    top_level_only: bool = False,
    sort: Literal["priority", "name", "updated", "target", "register"] = "priority",
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
) -> dict[str, Any]:
    items, total = svc.list_projects(
        db,
        q=q,
        category=category,
        lifecycle=lifecycle,
        priority=priority,
        tag=tag,
        include_archived=include_archived,
        top_level_only=top_level_only,
        sort=sort,
        limit=limit,
        offset=offset,
    )
    return {"items": items, "total": total, "limit": limit, "offset": offset}


@router.get("/categories", response_model=list[str])
def list_categories(db: DB, _: CurrentUser) -> list[str]:
    return svc.categories(db)


@router.post("", response_model=ProjectOut, status_code=201)
def create_project(body: ProjectCreate, db: DB, _: CurrentUser) -> dict[str, Any]:
    project = svc.create_project(db, body)
    return svc.project_detail(db, project.id)


@router.get("/{project_id}", response_model=ProjectOut)
def get_project(project_id: uuid.UUID, db: DB, _: CurrentUser) -> dict[str, Any]:
    return svc.project_detail(db, project_id)


@router.patch("/{project_id}", response_model=ProjectOut)
def update_project(project_id: uuid.UUID, body: ProjectUpdate, db: DB, _: CurrentUser) -> dict[str, Any]:
    svc.update_project(db, project_id, body)
    return svc.project_detail(db, project_id)


@router.post("/{project_id}/archive", response_model=ProjectOut)
def archive_project(project_id: uuid.UUID, db: DB, _: CurrentUser) -> dict[str, Any]:
    svc.set_archived(db, project_id, True)
    return svc.project_detail(db, project_id)


@router.post("/{project_id}/restore", response_model=ProjectOut)
def restore_project(project_id: uuid.UUID, db: DB, _: CurrentUser) -> dict[str, Any]:
    svc.set_archived(db, project_id, False)
    return svc.project_detail(db, project_id)


@router.post("/{project_id}/duplicate", response_model=ProjectOut, status_code=201)
def duplicate_project(project_id: uuid.UUID, db: DB, _: CurrentUser, include_tasks: bool = True) -> dict[str, Any]:
    project = svc.duplicate_project(db, project_id, include_tasks=include_tasks)
    return svc.project_detail(db, project.id)


@router.delete("/{project_id}", status_code=204)
def delete_project(project_id: uuid.UUID, db: DB, user: CurrentUser) -> Response:
    from app.services.auth import audit

    project = svc.get_project(db, project_id)
    audit(db, "project.deleted", user_id=user.id, target=project.name)
    svc.delete_project(db, project_id)
    return Response(status_code=204)


@router.post("/{project_id}/links", response_model=LinkOut, status_code=201)
def add_link(project_id: uuid.UUID, body: LinkIn, db: DB, _: CurrentUser) -> Any:
    return svc.add_link(db, project_id, body)


@router.delete("/{project_id}/links/{link_id}", status_code=204)
def remove_link(project_id: uuid.UUID, link_id: uuid.UUID, db: DB, _: CurrentUser) -> Response:
    svc.remove_link(db, project_id, link_id)
    return Response(status_code=204)


@router.post("/{project_id}/related", status_code=204)
def add_related(project_id: uuid.UUID, body: RelationIn, db: DB, _: CurrentUser) -> Response:
    svc.add_relation(db, project_id, body.project_id, body.note)
    return Response(status_code=204)


@router.delete("/{project_id}/related/{other_id}", status_code=204)
def remove_related(project_id: uuid.UUID, other_id: uuid.UUID, db: DB, _: CurrentUser) -> Response:
    svc.remove_relation(db, project_id, other_id)
    return Response(status_code=204)
