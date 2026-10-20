"""Command Dashboard aggregates. All numbers are counts of stored records; nothing is estimated."""

from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import ActivityEvent, GitHubProjectBoard, GitHubRepo, Milestone, Project, Task
from app.models.base import utcnow
from app.services.projects import project_stats
from app.services.tasks import serialize_tasks

STALE_AFTER_DAYS = 30
ACTIVE_LIFECYCLES = ("active", "testing", "deployed")
PRIORITY_ORDER = {"P1": 0, "P2": 1, "P3": 2, "P4": 3}


def _due_expr() -> Any:
    return func.coalesce(Task.due_date, Task.gh_board_end)


def build_dashboard(db: Session) -> dict[str, Any]:
    today = date.today()
    soon = today + timedelta(days=14)
    live = Project.archived_at.is_(None)

    lifecycle_counts = dict(
        db.execute(
            select(Project.lifecycle, func.count()).where(live, Project.parent_id.is_(None)).group_by(Project.lifecycle)
        ).all()
    )
    top_level = sum(lifecycle_counts.values())
    sub_projects = db.scalar(select(func.count()).where(live, Project.parent_id.is_not(None))) or 0

    active_project = Task.project_id.in_(select(Project.id).where(live))
    open_task_filter = (Task.status != "done", active_project)
    counts = {
        "projects": top_level,
        "sub_projects": sub_projects,
        "by_lifecycle": lifecycle_counts,
        "open_tasks": db.scalar(select(func.count()).where(*open_task_filter)) or 0,
        "in_progress": db.scalar(select(func.count()).where(Task.status == "in_progress", active_project)) or 0,
        "blocked": db.scalar(select(func.count()).where(Task.status == "blocked", active_project)) or 0,
        "overdue": db.scalar(select(func.count()).where(*open_task_filter, _due_expr() < today)) or 0,
    }

    overdue = list(
        db.scalars(select(Task).where(*open_task_filter, _due_expr() < today).order_by(_due_expr()).limit(15))
    )
    due_soon = list(
        db.scalars(
            select(Task).where(*open_task_filter, _due_expr().between(today, soon)).order_by(_due_expr()).limit(15)
        )
    )
    in_progress = list(
        db.scalars(
            select(Task)
            .where(Task.status.in_(["in_progress", "blocked", "in_review"]), active_project)
            .order_by(Task.updated_at.desc())
            .limit(15)
        )
    )

    upcoming: list[dict[str, Any]] = []
    for m, pname in db.execute(
        select(Milestone, Project.name)
        .join(Project, Project.id == Milestone.project_id)
        .where(live, Milestone.status == "open")
    ).all():
        due = m.local_due_date or m.due_date or m.gh_due_on
        if due and due <= soon:
            upcoming.append(
                {
                    "kind": "milestone",
                    "id": m.id,
                    "title": m.title,
                    "date": due,
                    "project_name": pname,
                    "project_id": m.project_id,
                    "overdue": due < today,
                }
            )
    for p in db.scalars(select(Project).where(live, Project.target_date.is_not(None), Project.target_date <= soon)):
        if p.lifecycle in ("deployed", "archived"):
            continue
        upcoming.append(
            {
                "kind": "project_target",
                "id": p.id,
                "title": f"{p.name} target",
                "date": p.target_date,
                "project_name": p.name,
                "project_id": p.id,
                "overdue": p.target_date < today,
            }  # type: ignore[operator]
        )
    upcoming.sort(key=lambda x: x["date"])

    projects = list(db.scalars(select(Project).where(live, Project.parent_id.is_(None))))
    stats = project_stats(db, [p.id for p in projects])
    stale_cutoff = utcnow() - timedelta(days=STALE_AFTER_DAYS)
    health = []
    for p in projects:
        s = stats.get(p.id, {})
        last: datetime | None = s.get("last_verified_at")
        open_, done = s.get("open_tasks", 0), s.get("done_tasks", 0)
        flags = []
        if p.lifecycle in ACTIVE_LIFECYCLES and (last is None or last < stale_cutoff):
            flags.append("no_recent_evidence")
        if s.get("overdue_tasks"):
            flags.append("overdue_tasks")
        if p.target_date and p.target_date < today and p.lifecycle not in ("deployed", "archived"):
            flags.append("past_target_date")
        health.append(
            {
                "id": p.id,
                "name": p.name,
                "lifecycle": p.lifecycle,
                "priority": p.priority,
                "reported_status": p.reported_status,
                "open_tasks": open_,
                "done_tasks": done,
                "overdue_tasks": s.get("overdue_tasks", 0),
                # None when the project has no tasks: progress is not measured, not 0%.
                "progress": round(done / (open_ + done), 3) if (open_ + done) else None,
                "last_verified_at": last,
                "flags": flags,
                "next_action": p.next_action,
            }
        )
    health.sort(key=lambda h: (PRIORITY_ORDER.get(h["priority"] or "", 9), -len(h["flags"]), h["name"]))

    activity = [
        {
            "id": a.id,
            "kind": a.kind,
            "message": a.message,
            "url": a.url,
            "occurred_at": a.occurred_at,
            "project_id": a.project_id,
        }
        for a in db.scalars(select(ActivityEvent).order_by(ActivityEvent.occurred_at.desc()).limit(20))
    ]

    # "What should I work on next" — a transparent rule, not a prediction:
    # 1) overdue tasks, 2) tasks due within 7 days, 3) blocked tasks, 4) next actions of P1/P2 projects.
    next_actions: list[dict[str, Any]] = []
    for t in serialize_tasks(db, overdue[:5]):
        next_actions.append({"reason": "overdue", "task": t})
    week = today + timedelta(days=7)
    for t in serialize_tasks(
        db, [x for x in due_soon if (x.due_date or x.gh_board_end) and (x.due_date or x.gh_board_end) <= week][:5]
    ):  # type: ignore[operator]
        next_actions.append({"reason": "due_this_week", "task": t})
    for t in serialize_tasks(db, [x for x in in_progress if x.status == "blocked"][:3]):
        next_actions.append({"reason": "blocked", "task": t})
    for p in sorted(projects, key=lambda p: (PRIORITY_ORDER.get(p.priority or "", 9), p.priority_rank or 999)):
        if p.priority in ("P1", "P2") and p.next_action:
            next_actions.append(
                {"reason": f"{p.priority}_next_action", "project": {"id": p.id, "name": p.name}, "text": p.next_action}
            )

    sync = {
        "repos_synced": db.scalar(select(func.count()).where(GitHubRepo.sync_enabled.is_(True))) or 0,
        "boards_synced": db.scalar(select(func.count()).where(GitHubProjectBoard.sync_enabled.is_(True))) or 0,
        "last_synced_at": db.scalar(select(func.max(GitHubRepo.last_synced_at))),
        "errors": db.scalar(select(func.count()).where(GitHubRepo.last_sync_error.is_not(None))) or 0,
    }

    return {
        "counts": counts,
        "overdue": serialize_tasks(db, overdue),
        "due_soon": serialize_tasks(db, due_soon),
        "in_progress": serialize_tasks(db, in_progress),
        "upcoming": upcoming[:20],
        "health": health,
        "activity": activity,
        "next_actions": next_actions[:15],
        "sync": sync,
        "generated_at": utcnow(),
    }
