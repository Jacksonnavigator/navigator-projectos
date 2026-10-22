"""Timeline (Gantt) data. Every date carries its source so the UI never shows an invented date.

Bar start, first available of:  local start date -> GitHub Projects start field -> GitHub created_at -> local created_at
Bar end,   first available of:  local due date   -> GitHub Projects end field   -> milestone due date -> open-ended
"""

from __future__ import annotations

import uuid
from datetime import date, timedelta
from typing import Any

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.models import GitHubRepo, Milestone, Project, Release, Task, TaskDependency
from app.services.tasks import milestone_due


def task_bar(task: Task, milestones: dict[uuid.UUID, Milestone]) -> dict[str, Any]:
    if task.start_date:
        start, start_src = task.start_date, "local"
    elif task.gh_board_start:
        start, start_src = task.gh_board_start, "github_project"
    elif task.gh_created_at:
        start, start_src = task.gh_created_at.date(), "github_created"
    else:
        start, start_src = task.created_at.date(), "created"
    ms = milestones.get(task.milestone_id) if task.milestone_id else None
    end: date | None
    if task.due_date:
        end, end_src = task.due_date, "local"
    elif task.gh_board_end:
        end, end_src = task.gh_board_end, "github_project"
    elif ms is not None and milestone_due(ms):
        end, end_src = milestone_due(ms), "milestone"
    else:
        end, end_src = None, None
    # A due date before the inferred start (e.g. created after its milestone) would draw a negative bar.
    if end is not None and end < start:
        start, start_src = end, f"{start_src}_clamped"
    return {"start": start, "start_source": start_src, "end": end, "end_source": end_src}


def build_timeline(
    db: Session,
    *,
    window_start: date,
    window_end: date,
    project_ids: list[uuid.UUID] | None = None,
    category: str | None = None,
    repo_id: uuid.UUID | None = None,
    label: str | None = None,
    status: list[str] | None = None,
    priority: str | None = None,
    include_done: bool = True,
) -> dict[str, Any]:
    pstmt = select(Project).where(Project.archived_at.is_(None))
    if project_ids:
        pstmt = pstmt.where(Project.id.in_(project_ids))
    if category:
        pstmt = pstmt.where(Project.category.ilike(f"%{category}%"))
    if priority:
        pstmt = pstmt.where(Project.priority == priority)
    projects = list(
        db.scalars(pstmt.order_by(Project.priority.asc().nulls_last(), Project.priority_rank.asc().nulls_last()))
    )
    pids = [p.id for p in projects]

    tstmt = select(Task).where(Task.project_id.in_(pids), Task.parent_task_id.is_(None))
    if repo_id:
        tstmt = tstmt.where(Task.gh_repo_id == repo_id)
    if label:
        tstmt = tstmt.where(Task.gh_labels.contains([label]))
    if status:
        tstmt = tstmt.where(Task.status.in_(status))
    if not include_done:
        tstmt = tstmt.where(Task.status != "done")
    tasks = list(db.scalars(tstmt.order_by(Task.position)))
    milestones = {m.id: m for m in db.scalars(select(Milestone).where(Milestone.project_id.in_(pids)))}

    items: list[dict[str, Any]] = []
    today = date.today()
    for t in tasks:
        bar = task_bar(t, milestones)
        # Keep bars that overlap the window; open-ended bars count if they start before the window ends.
        if bar["start"] > window_end:
            continue
        if bar["end"] is not None and bar["end"] < window_start:
            continue
        if bar["end"] is None and t.status == "done" and (t.completed_at or t.gh_closed_at):
            closed = (t.completed_at or t.gh_closed_at).date()  # type: ignore[union-attr]
            if closed < window_start:
                continue
        items.append(
            {
                "id": t.id,
                "type": "task",
                "project_id": t.project_id,
                "milestone_id": t.milestone_id,
                "title": t.title,
                "status": t.status,
                "priority": t.priority,
                "source": t.source,
                "gh_kind": t.gh_kind,
                "gh_number": t.gh_number,
                "url": t.gh_url,
                "overdue": bool(bar["end"] and bar["end"] < today and t.status != "done"),
                **bar,
            }
        )

    ms_items = []
    for m in milestones.values():
        due = milestone_due(m)
        if due is None or not (window_start <= due <= window_end):
            continue
        ms_items.append(
            {
                "id": m.id,
                "type": "milestone",
                "project_id": m.project_id,
                "title": m.title,
                "date": due,
                "date_source": "local" if (m.local_due_date or m.source == "local") else "github_milestone",
                "status": m.status,
                "url": m.gh_url,
                "overdue": due < today and m.status != "done",
            }
        )

    task_ids = {i["id"] for i in items}
    deps = [
        {"from": dep, "to": tid}
        for tid, dep in db.execute(
            select(TaskDependency.task_id, TaskDependency.depends_on_id).where(TaskDependency.task_id.in_(task_ids))
        ).all()
        if dep in task_ids
    ]

    releases = []
    for rel, repo in db.execute(
        select(Release, GitHubRepo)
        .join(GitHubRepo, GitHubRepo.id == Release.gh_repo_id)
        .where(
            GitHubRepo.project_id.in_(pids),
            Release.draft.is_(False),
            Release.published_at >= window_start,
            Release.published_at < window_end + timedelta(days=1),
        )
    ).all():
        releases.append(
            {
                "id": rel.id,
                "project_id": repo.project_id,
                "title": rel.name or rel.tag,
                "date": rel.published_at.date() if rel.published_at else None,
                "url": rel.url,
            }
        )

    project_rows = []
    undated = []
    for p in projects:
        project_items = [i for i in items if i["project_id"] == p.id]
        project_ms = [m for m in ms_items if m["project_id"] == p.id]
        span_start = p.start_date or p.target_date
        span_end = p.target_date or p.start_date
        span_overlaps = bool(span_start and span_end and span_start <= window_end and span_end >= window_start)
        if not (project_items or project_ms or span_overlaps):
            # Projects with no dates at all are listed separately so nothing silently disappears.
            if p.start_date is None and p.target_date is None and p.lifecycle not in ("completed", "archived"):
                undated.append({"id": p.id, "name": p.name, "lifecycle": p.lifecycle, "priority": p.priority})
            if project_ids is None:
                continue
        project_rows.append(
            {
                "id": p.id,
                "name": p.name,
                "lifecycle": p.lifecycle,
                "priority": p.priority,
                "start_date": p.start_date,
                "target_date": p.target_date,
                "parent_id": p.parent_id,
            }
        )
    return {
        "window_start": window_start,
        "window_end": window_end,
        "today": today,
        "projects": project_rows,
        "undated_projects": undated,
        "items": items,
        "milestones": ms_items,
        "releases": releases,
        "dependencies": deps,
    }


def calendar_items(db: Session, start: date, end: date) -> list[dict[str, Any]]:
    """Everything with a date in [start, end]: task due dates, milestones, project targets, releases."""
    timeline = build_timeline(db, window_start=start, window_end=end)
    names = {p["id"]: p["name"] for p in timeline["projects"]}
    out: list[dict[str, Any]] = []
    for item in timeline["items"]:
        if item["end"] and start <= item["end"] <= end:
            out.append(
                {
                    "date": item["end"],
                    "kind": "task_due",
                    "title": item["title"],
                    "id": item["id"],
                    "project_id": item["project_id"],
                    "project_name": names.get(item["project_id"]),
                    "status": item["status"],
                    "date_source": item["end_source"],
                    "url": item["url"],
                    "overdue": item["overdue"],
                }
            )
    for m in timeline["milestones"]:
        out.append(
            {
                "date": m["date"],
                "kind": "milestone",
                "title": m["title"],
                "id": m["id"],
                "project_id": m["project_id"],
                "project_name": names.get(m["project_id"]),
                "status": m["status"],
                "date_source": m["date_source"],
                "url": m["url"],
                "overdue": m["overdue"],
            }
        )
    for r in timeline["releases"]:
        out.append(
            {
                "date": r["date"],
                "kind": "release",
                "title": r["title"],
                "id": r["id"],
                "project_id": r["project_id"],
                "project_name": names.get(r["project_id"]),
                "status": None,
                "date_source": "github_release",
                "url": r["url"],
                "overdue": False,
            }
        )
    for p in db.scalars(
        select(Project).where(
            Project.archived_at.is_(None),
            or_(Project.target_date.between(start, end), Project.start_date.between(start, end)),
        )
    ):
        if p.target_date and start <= p.target_date <= end:
            out.append(
                {
                    "date": p.target_date,
                    "kind": "project_target",
                    "title": f"{p.name} target date",
                    "id": p.id,
                    "project_id": p.id,
                    "project_name": p.name,
                    "status": p.lifecycle,
                    "date_source": "local",
                    "url": None,
                    "overdue": p.target_date < date.today() and p.lifecycle not in ("deployed", "archived"),
                }
            )
    out.sort(key=lambda x: (x["date"], x["kind"], x["title"]))
    return out
