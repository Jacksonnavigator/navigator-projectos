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
FINISHED_LIFECYCLES = ("completed", "archived")
THROUGHPUT_WEEKS = 8
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
        if p.lifecycle in ("deployed", *FINISHED_LIFECYCLES) or p.target_date is None:
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
            }
        )
    upcoming.sort(key=lambda x: x["date"])

    all_top = list(db.scalars(select(Project).where(live, Project.parent_id.is_(None))))
    completed = sorted(
        (p for p in all_top if p.lifecycle == "completed"),
        key=lambda p: p.completed_on or date.min,
        reverse=True,
    )
    projects = [p for p in all_top if p.lifecycle != "completed"]
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
        if p.target_date and p.target_date < today and p.lifecycle not in ("deployed", *FINISHED_LIFECYCLES):
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
    listed: set[Any] = set()

    def add_tasks(reason: str, candidates: list[Task], limit: int) -> None:
        fresh = [t for t in candidates if t.id not in listed][:limit]
        listed.update(t.id for t in fresh)
        next_actions.extend({"reason": reason, "task": t} for t in serialize_tasks(db, fresh))

    add_tasks("overdue", overdue, 5)
    week = today + timedelta(days=7)
    this_week = [x for x in due_soon if (d := x.due_date or x.gh_board_end) is not None and d <= week]
    add_tasks("due_this_week", this_week, 5)
    add_tasks("blocked", [x for x in in_progress if x.status == "blocked"], 3)
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
        "focus": _focus_cards(db, projects, stats, today),
        "week": _week_strip(db, today, active_project),
        "throughput": _throughput(db, today),
        "completed_projects": [
            {"id": p.id, "name": p.name, "completed_on": p.completed_on, "category": p.category} for p in completed
        ],
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


def _focus_cards(
    db: Session, projects: list[Project], stats: dict[Any, dict[str, Any]], today: date
) -> list[dict[str, Any]]:
    """One card per P1 project: progress, next milestone, next open task, verification."""
    cards = []
    p1 = sorted((p for p in projects if p.priority == "P1"), key=lambda p: (p.priority_rank or 999, p.name))
    for p in p1:
        s = stats.get(p.id, {})
        open_, done = s.get("open_tasks", 0), s.get("done_tasks", 0)
        milestones = [
            m
            for m in db.scalars(select(Milestone).where(Milestone.project_id == p.id, Milestone.status == "open"))
            if (m.local_due_date or m.due_date or m.gh_due_on)
        ]
        milestones.sort(key=lambda m: m.local_due_date or m.due_date or m.gh_due_on)  # type: ignore[arg-type,return-value]
        next_ms = milestones[0] if milestones else None
        ms_due = (next_ms.local_due_date or next_ms.due_date or next_ms.gh_due_on) if next_ms else None
        next_task = db.scalar(
            select(Task)
            .where(Task.project_id == p.id, Task.parent_task_id.is_(None), Task.status != "done")
            .order_by(
                (Task.status == "in_progress").desc(),
                _due_expr().asc().nulls_last(),
                Task.position,
            )
            .limit(1)
        )
        cards.append(
            {
                "id": p.id,
                "name": p.name,
                "lifecycle": p.lifecycle,
                "open_tasks": open_,
                "done_tasks": done,
                "progress": round(done / (open_ + done), 3) if (open_ + done) else None,
                "target_date": p.target_date,
                "days_to_target": (p.target_date - today).days if p.target_date else None,
                "last_verified_at": s.get("last_verified_at"),
                "next_milestone": (
                    {"id": next_ms.id, "title": next_ms.title, "date": ms_due, "days_left": (ms_due - today).days}
                    if next_ms and ms_due
                    else None
                ),
                "next_task": serialize_tasks(db, [next_task])[0] if next_task else None,
            }
        )
    return cards


def _week_strip(db: Session, today: date, active_project: Any) -> list[dict[str, Any]]:
    """Monday-Sunday of the current week, with tasks (done or not) and milestones due each day."""
    monday = today - timedelta(days=today.weekday())
    sunday = monday + timedelta(days=6)
    tasks = list(
        db.scalars(
            select(Task)
            .where(active_project, Task.parent_task_id.is_(None), _due_expr().between(monday, sunday))
            .order_by(Task.status == "done", Task.position)
        )
    )
    by_day: dict[date, list[dict[str, Any]]] = {monday + timedelta(days=i): [] for i in range(7)}
    for t in serialize_tasks(db, tasks):
        due = t["due_date"] or t["gh_board_end"]
        if due in by_day:
            by_day[due].append({"kind": "task", "task": t})
    for m, pname in db.execute(
        select(Milestone, Project.name)
        .join(Project, Project.id == Milestone.project_id)
        .where(Project.archived_at.is_(None))
    ).all():
        due = m.local_due_date or m.due_date or m.gh_due_on
        if due in by_day:
            by_day[due].append(
                {
                    "kind": "milestone",
                    "id": m.id,
                    "title": m.title,
                    "project_name": pname,
                    "project_id": m.project_id,
                    "status": m.status,
                }  # fmt: skip
            )
    return [{"date": d, "is_today": d == today, "items": items} for d, items in by_day.items()]


def _throughput(db: Session, today: date) -> list[dict[str, Any]]:
    """Top-level tasks completed per week (Monday-based) for the last THROUGHPUT_WEEKS weeks."""
    this_monday = today - timedelta(days=today.weekday())
    start = this_monday - timedelta(weeks=THROUGHPUT_WEEKS - 1)
    week = func.date_trunc("week", Task.completed_at)
    rows: dict[Any, int] = dict(
        db.execute(  # type: ignore[arg-type]
            select(week, func.count())
            .where(Task.completed_at >= start, Task.parent_task_id.is_(None), Task.status == "done")
            .group_by(week)
        ).all()
    )
    counts = {k.date(): v for k, v in rows.items() if k is not None}
    return [
        {"week_start": start + timedelta(weeks=i), "done": counts.get(start + timedelta(weeks=i), 0)}
        for i in range(THROUGHPUT_WEEKS)
    ]
