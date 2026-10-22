"""Project registry business logic."""

from __future__ import annotations

import re
import uuid
from datetime import date
from typing import Any

from sqlalchemy import Select, and_, case, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.core.errors import Conflict, NotFound, ValidationFailed
from app.models import (
    ActivityEvent,
    EvidenceRecord,
    GitHubRepo,
    Project,
    ProjectLink,
    ProjectRelation,
    Task,
)
from app.models.base import utcnow
from app.schemas.projects import LinkIn, ProjectCreate, ProjectUpdate

_URL_RE = re.compile(r"https?://[^\s;,)]+")
_LOCAL_PATH_RE = re.compile(
    r"(?:(?<![A-Za-z0-9])[A-Za-z]:[\\/][^\s;,]+|(?<![\w:/.])/(?:media|home|mnt|opt|srv)/[^\s;,]+)"
)
NOT_CONFIRMED = {"not confirmed", "n/a", "none", "-", ""}


def detect_link_kind(url: str) -> str:
    lowered = url.lower()
    if "github.com/" in lowered:
        return "github_repo"
    if "huggingface.co/" in lowered:
        return "huggingface"
    if "firebase" in lowered:
        return "firebase"
    if lowered.startswith(("http://", "https://")):
        return "website"
    return "local_path"


def extract_links(text: str | None) -> list[tuple[str, str]]:
    """Find URLs and local paths in free text like the register's 'Repository / URL' column."""
    if not text or text.strip().lower() in NOT_CONFIRMED:
        return []
    found: list[tuple[str, str]] = []
    for url in _URL_RE.findall(text):
        url = url.rstrip(".")
        found.append((detect_link_kind(url), url))
    for path in _LOCAL_PATH_RE.findall(_URL_RE.sub(" ", text)):
        found.append(("local_path", path.rstrip(".")))
    seen: set[str] = set()
    return [(k, u) for k, u in found if not (u in seen or seen.add(u))]  # type: ignore[func-returns-value]


def get_project(db: Session, project_id: uuid.UUID) -> Project:
    project = db.get(Project, project_id, options=[selectinload(Project.links)])
    if project is None:
        raise NotFound("Project not found")
    return project


def _ensure_parent_ok(db: Session, project_id: uuid.UUID | None, parent_id: uuid.UUID | None) -> None:
    if parent_id is None:
        return
    if parent_id == project_id:
        raise ValidationFailed("A project cannot be its own parent")
    parent = db.get(Project, parent_id)
    if parent is None:
        raise ValidationFailed("Parent project does not exist")
    # Walk up the chain to prevent cycles (A -> B -> A).
    seen = {parent_id}
    current = parent
    while current.parent_id is not None:
        if current.parent_id == project_id or current.parent_id in seen:
            raise ValidationFailed("That parent would create a cycle of parent projects")
        seen.add(current.parent_id)
        nxt = db.get(Project, current.parent_id)
        if nxt is None:
            break
        current = nxt


def _name_taken(db: Session, name: str, exclude_id: uuid.UUID | None = None) -> bool:
    stmt = select(Project.id).where(func.lower(Project.name) == name.lower())
    if exclude_id:
        stmt = stmt.where(Project.id != exclude_id)
    return db.scalar(stmt) is not None


def record_activity(
    db: Session,
    kind: str,
    message: str,
    *,
    project_id: uuid.UUID | None = None,
    url: str | None = None,
    occurred_at: Any = None,
    dedupe_key: str | None = None,
) -> None:
    if dedupe_key and db.scalar(select(ActivityEvent.id).where(ActivityEvent.dedupe_key == dedupe_key)):
        return
    db.add(
        ActivityEvent(
            kind=kind,
            message=message[:500],
            project_id=project_id,
            url=url,
            occurred_at=occurred_at or utcnow(),
            dedupe_key=dedupe_key,
        )
    )


def create_project(db: Session, data: ProjectCreate) -> Project:
    if _name_taken(db, data.name):
        raise Conflict(f"A project named '{data.name}' already exists")
    _ensure_parent_ok(db, None, data.parent_id)
    project = Project(**data.model_dump())
    mark_completion(project)
    db.add(project)
    db.flush()
    for kind, url in extract_links(data.repository_text):
        project.links.append(ProjectLink(kind=kind, url=url))
    record_activity(db, "project.created", f"Project '{project.name}' created", project_id=project.id)
    db.commit()
    return get_project(db, project.id)


def update_project(db: Session, project_id: uuid.UUID, data: ProjectUpdate) -> Project:
    project = get_project(db, project_id)
    changes = data.model_dump(exclude_unset=True)
    if "name" in changes:
        if changes["name"] is None:
            raise ValidationFailed("Name cannot be empty")
        changes["name"] = changes["name"].strip()
        if _name_taken(db, changes["name"], exclude_id=project.id):
            raise Conflict(f"A project named '{changes['name']}' already exists")
    if "lifecycle" in changes and changes["lifecycle"] is None:
        raise ValidationFailed("Lifecycle cannot be empty")
    if "tags" in changes:
        changes["tags"] = [t.strip().lower()[:50] for t in (changes["tags"] or []) if t.strip()]
    if "parent_id" in changes:
        _ensure_parent_ok(db, project.id, changes["parent_id"])
    start = changes.get("start_date", project.start_date)
    target = changes.get("target_date", project.target_date)
    if start and target and target < start:
        raise ValidationFailed("Target date must be on or after the start date")
    for key, value in changes.items():
        setattr(project, key, value)
    if "lifecycle" in changes:
        mark_completion(project)
    db.commit()
    return get_project(db, project.id)


def mark_completion(project: Project) -> None:
    """Keep completed_on in step with the lifecycle."""
    if project.lifecycle == "completed" and project.completed_on is None:
        project.completed_on = date.today()
    elif project.lifecycle != "completed":
        project.completed_on = None


def set_archived(db: Session, project_id: uuid.UUID, archived: bool) -> Project:
    project = get_project(db, project_id)
    project.archived_at = utcnow() if archived else None
    if archived:
        project.lifecycle = "archived"
    elif project.lifecycle == "archived":
        project.lifecycle = "paused"
    record_activity(
        db,
        "project.archived" if archived else "project.restored",
        f"Project '{project.name}' {'archived' if archived else 'restored'}",
        project_id=project.id,
    )
    db.commit()
    return get_project(db, project.id)


def duplicate_project(db: Session, project_id: uuid.UUID, include_tasks: bool = True) -> Project:
    """Copy a project (and optionally its local tasks/milestones) — used for templates too."""
    from app.services.tasks import copy_project_work

    source = get_project(db, project_id)
    base = f"{source.name} (copy)"
    name, n = base, 2
    while _name_taken(db, name):
        name, n = f"{base} {n}", n + 1
    fields = {
        c: getattr(source, c)
        for c in (
            "category",
            "project_type",
            "purpose",
            "tech_stack",
            "remaining_work",
            "business_potential",
            "next_action",
            "priority",
            "parent_id",
            "tags",
        )
    }
    copy = Project(name=name, lifecycle="planning", **fields)
    db.add(copy)
    db.flush()
    for link in source.links:
        copy.links.append(ProjectLink(kind=link.kind, url=link.url, label=link.label))
    if include_tasks:
        copy_project_work(db, source.id, copy.id)
    record_activity(db, "project.created", f"Project '{name}' duplicated from '{source.name}'", project_id=copy.id)
    db.commit()
    return get_project(db, copy.id)


def delete_project(db: Session, project_id: uuid.UUID) -> None:
    project = get_project(db, project_id)
    db.delete(project)
    db.commit()


def add_link(db: Session, project_id: uuid.UUID, data: LinkIn) -> ProjectLink:
    get_project(db, project_id)
    link = ProjectLink(
        project_id=project_id, url=data.url, kind=data.kind or detect_link_kind(data.url), label=data.label
    )
    db.add(link)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise Conflict("That link is already on this project") from exc
    return link


def remove_link(db: Session, project_id: uuid.UUID, link_id: uuid.UUID) -> None:
    link = db.get(ProjectLink, link_id)
    if link is None or link.project_id != project_id:
        raise NotFound("Link not found")
    db.delete(link)
    db.commit()


def add_relation(db: Session, project_id: uuid.UUID, other_id: uuid.UUID, note: str | None = None) -> None:
    if project_id == other_id:
        raise ValidationFailed("A project cannot be related to itself")
    get_project(db, project_id)
    get_project(db, other_id)
    a, b = sorted([project_id, other_id])
    exists = db.scalar(
        select(ProjectRelation.id).where(ProjectRelation.project_a_id == a, ProjectRelation.project_b_id == b)
    )
    if not exists:
        db.add(ProjectRelation(project_a_id=a, project_b_id=b, note=note))
        db.commit()


def remove_relation(db: Session, project_id: uuid.UUID, other_id: uuid.UUID) -> None:
    a, b = sorted([project_id, other_id])
    rel = db.scalar(select(ProjectRelation).where(ProjectRelation.project_a_id == a, ProjectRelation.project_b_id == b))
    if rel is None:
        raise NotFound("Relation not found")
    db.delete(rel)
    db.commit()


def related_projects(db: Session, project_id: uuid.UUID) -> list[Project]:
    rels = db.scalars(
        select(ProjectRelation).where(
            or_(ProjectRelation.project_a_id == project_id, ProjectRelation.project_b_id == project_id)
        )
    ).all()
    ids = [r.project_b_id if r.project_a_id == project_id else r.project_a_id for r in rels]
    if not ids:
        return []
    return list(db.scalars(select(Project).where(Project.id.in_(ids)).order_by(Project.name)))


SORTS = {
    "priority": (Project.priority.asc().nulls_last(), Project.priority_rank.asc().nulls_last(), Project.name),
    "name": (Project.name,),
    "updated": (Project.updated_at.desc(),),
    "target": (Project.target_date.asc().nulls_last(), Project.name),
    "register": (Project.register_id.asc().nulls_last(), Project.name),
}


def _filtered(
    q: str | None,
    category: str | None,
    lifecycle: str | None,
    priority: str | None,
    include_archived: bool,
    top_level_only: bool,
    tag: str | None,
) -> Select[Project]:
    stmt = select(Project)
    if not include_archived:
        stmt = stmt.where(Project.archived_at.is_(None))
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(
            or_(
                Project.name.ilike(like),
                Project.purpose.ilike(like),
                Project.tech_stack.ilike(like),
                Project.category.ilike(like),
                Project.next_action.ilike(like),
            )
        )
    if category:
        stmt = stmt.where(Project.category.ilike(f"%{category}%"))
    if lifecycle:
        stmt = stmt.where(Project.lifecycle == lifecycle)
    if priority:
        stmt = stmt.where(Project.priority == priority)
    if top_level_only:
        stmt = stmt.where(Project.parent_id.is_(None))
    if tag:
        stmt = stmt.where(Project.tags.contains([tag.lower()]))
    return stmt


def list_projects(
    db: Session,
    *,
    q: str | None = None,
    category: str | None = None,
    lifecycle: str | None = None,
    priority: str | None = None,
    include_archived: bool = False,
    top_level_only: bool = False,
    tag: str | None = None,
    sort: str = "priority",
    limit: int = 100,
    offset: int = 0,
) -> tuple[list[dict[str, Any]], int]:
    base = _filtered(q, category, lifecycle, priority, include_archived, top_level_only, tag)
    total = db.scalar(select(func.count()).select_from(base.subquery())) or 0
    rows = db.scalars(base.order_by(*SORTS.get(sort, SORTS["priority"])).limit(limit).offset(offset)).all()
    stats = project_stats(db, [p.id for p in rows])
    return [summary_dict(p, stats.get(p.id, {})) for p in rows], total


def project_stats(db: Session, ids: list[uuid.UUID]) -> dict[uuid.UUID, dict[str, Any]]:
    if not ids:
        return {}
    today = date.today()
    effective_due = func.coalesce(Task.due_date, Task.gh_board_end)
    task_rows = db.execute(
        select(
            Task.project_id,
            func.count().filter(Task.status != "done"),
            func.count().filter(Task.status == "done"),
            func.count().filter(and_(Task.status != "done", effective_due < today)),
        )
        .where(Task.project_id.in_(ids), Task.parent_task_id.is_(None))
        .group_by(Task.project_id)
    ).all()
    stats: dict[uuid.UUID, dict[str, Any]] = {i: {} for i in ids}
    for pid, open_, done, overdue in task_rows:
        if pid is not None:
            stats[pid].update(open_tasks=open_, done_tasks=done, overdue_tasks=overdue)
    for pid, count in db.execute(
        select(GitHubRepo.project_id, func.count())
        .where(GitHubRepo.project_id.in_(ids))
        .group_by(GitHubRepo.project_id)
    ).all():
        if pid is not None:
            stats[pid]["repo_count"] = count
    verified = case((EvidenceRecord.origin.in_(["automated", "measured"]), EvidenceRecord.observed_at))
    for pid, last in db.execute(
        select(EvidenceRecord.project_id, func.max(verified))
        .where(EvidenceRecord.project_id.in_(ids))
        .group_by(EvidenceRecord.project_id)
    ).all():
        if pid is not None:
            stats[pid]["last_verified_at"] = last
    return stats


SUMMARY_FIELDS = (
    "id",
    "register_id",
    "name",
    "category",
    "project_type",
    "lifecycle",
    "reported_status",
    "status_confidence",
    "priority",
    "priority_rank",
    "priority_label",
    "next_action",
    "start_date",
    "target_date",
    "parent_id",
    "tags",
    "archived_at",
    "completed_on",
    "updated_at",
)


def summary_dict(project: Project, stats: dict[str, Any]) -> dict[str, Any]:
    out = {f: getattr(project, f) for f in SUMMARY_FIELDS}
    out.update(stats)
    return out


def project_detail(db: Session, project_id: uuid.UUID) -> dict[str, Any]:
    project = get_project(db, project_id)
    out = summary_dict(project, project_stats(db, [project.id]).get(project.id, {}))
    for f in (
        "purpose",
        "tech_stack",
        "repository_text",
        "remaining_work",
        "business_potential",
        "evidence_notes",
        "priority_reason",
        "created_at",
    ):
        out[f] = getattr(project, f)
    out["links"] = project.links
    out["parent"] = db.get(Project, project.parent_id) if project.parent_id else None
    out["children"] = list(db.scalars(select(Project).where(Project.parent_id == project.id).order_by(Project.name)))
    out["related"] = related_projects(db, project.id)
    return out


def categories(db: Session) -> list[str]:
    return [c for c in db.scalars(select(Project.category).distinct().order_by(Project.category)) if c]
