"""Tasks, subtasks, dependencies, milestones and comments.

Progress definitions (documented in docs/CONCEPTS.md):
- Project progress = done top-level tasks / all top-level tasks (subtasks are excluded so one task
  split into ten subtasks does not distort the figure). No tasks -> progress is "not measured", never 0%.
- Milestone progress = done tasks assigned to the milestone / tasks assigned to it.
- A GitHub issue/PR counts as done only when it is closed/merged on GitHub.
"""

from __future__ import annotations

import uuid
from collections import deque
from datetime import date
from typing import Any

from sqlalchemy import Select, func, or_, select
from sqlalchemy.orm import Session

from app.core.errors import Conflict, NotFound, ValidationFailed
from app.models import GitHubRepo, Milestone, Project, Task, TaskComment, TaskDependency
from app.models.base import utcnow
from app.schemas.work import MilestoneCreate, MilestoneUpdate, TaskCreate, TaskUpdate
from app.services.projects import get_project, record_activity

# Fields GitHub owns for synced issues/PRs; local edits to them are refused (v1 is read-only).
GITHUB_OWNED = {"title", "description", "parent_task_id"}


def get_task(db: Session, task_id: uuid.UUID) -> Task:
    task = db.get(Task, task_id)
    if task is None:
        raise NotFound("Task not found")
    return task


def get_milestone(db: Session, milestone_id: uuid.UUID) -> Milestone:
    ms = db.get(Milestone, milestone_id)
    if ms is None:
        raise NotFound("Milestone not found")
    return ms


def milestone_due(ms: Milestone) -> date | None:
    return ms.local_due_date or ms.due_date or ms.gh_due_on


def _check_relations(db: Session, task: Task | None, project_id: uuid.UUID | None, changes: dict[str, Any]) -> None:
    if changes.get("milestone_id"):
        ms = get_milestone(db, changes["milestone_id"])
        if ms.project_id != project_id:
            raise ValidationFailed("The milestone belongs to a different project")
    if changes.get("parent_task_id"):
        parent = get_task(db, changes["parent_task_id"])
        if parent.project_id != project_id:
            raise ValidationFailed("A subtask must be in the same project as its parent")
        if task is not None:
            # Prevent parent cycles: walk up from the new parent.
            current: Task | None = parent
            while current is not None:
                if current.id == task.id:
                    raise ValidationFailed("That parent would make the task a subtask of itself")
                current = db.get(Task, current.parent_task_id) if current.parent_task_id else None


def _apply_status(task: Task, status: str) -> None:
    if task.source == "github" and task.gh_kind != "draft":
        closed = task.gh_state in ("closed", "merged")
        if status == "done" and not closed:
            raise ValidationFailed("This item is open on GitHub. Close it on GitHub; the next sync marks it done.")
        if status != "done" and closed:
            raise ValidationFailed("This item is closed on GitHub. Reopen it on GitHub to change its status.")
    if status == "done" and task.status != "done":
        task.completed_at = utcnow()
    elif status != "done":
        task.completed_at = None
    task.status = status


def create_task(db: Session, data: TaskCreate) -> Task:
    project = get_project(db, data.project_id)
    payload = data.model_dump()
    _check_relations(db, None, project.id, payload)
    status = payload.pop("status")
    position = (db.scalar(select(func.max(Task.position)).where(Task.project_id == project.id)) or 0) + 1
    task = Task(**payload, position=position, source="local")
    _apply_status(task, status)
    db.add(task)
    db.flush()
    record_activity(db, "task.created", f"Task '{task.title}' added to {project.name}", project_id=project.id)
    db.commit()
    return task


def update_task(db: Session, task_id: uuid.UUID, data: TaskUpdate) -> Task:
    task = get_task(db, task_id)
    changes = data.model_dump(exclude_unset=True)
    if task.source == "github":
        locked = GITHUB_OWNED & changes.keys()
        if locked:
            raise ValidationFailed(
                f"{', '.join(sorted(locked))} come from GitHub and can only be changed there", code="github_owned"
            )
    if "title" in changes and not (changes["title"] or "").strip():
        raise ValidationFailed("Title is required")
    for key in ("status", "priority"):
        if key in changes and changes[key] is None:
            raise ValidationFailed(f"{key} cannot be empty")
    _check_relations(db, task, task.project_id, changes)
    start = changes.get("start_date", task.start_date)
    due = changes.get("due_date", task.due_date)
    if start and due and due < start:
        raise ValidationFailed("Due date must be on or after the start date")
    status = changes.pop("status", None)
    for key, value in changes.items():
        setattr(task, key, value.strip() if key == "title" else value)
    if status is not None and status != task.status:
        _apply_status(task, status)
        if status == "done":
            record_activity(db, "task.done", f"Task '{task.title}' completed", project_id=task.project_id)
    db.commit()
    return task


def delete_task(db: Session, task_id: uuid.UUID) -> None:
    task = get_task(db, task_id)
    if task.source == "github":
        raise ValidationFailed("GitHub items can't be deleted here. Unlink or disable the repository instead.")
    db.delete(task)
    db.commit()


def would_create_cycle(db: Session, task_id: uuid.UUID, depends_on_id: uuid.UUID) -> bool:
    """True if depends_on_id already (transitively) depends on task_id."""
    queue: deque[uuid.UUID] = deque([depends_on_id])
    seen: set[uuid.UUID] = set()
    while queue:
        current = queue.popleft()
        if current == task_id:
            return True
        if current in seen:
            continue
        seen.add(current)
        queue.extend(db.scalars(select(TaskDependency.depends_on_id).where(TaskDependency.task_id == current)))
    return False


def add_dependency(db: Session, task_id: uuid.UUID, depends_on_id: uuid.UUID) -> None:
    if task_id == depends_on_id:
        raise ValidationFailed("A task cannot depend on itself")
    get_task(db, task_id)
    get_task(db, depends_on_id)
    exists = db.scalar(
        select(TaskDependency.id).where(
            TaskDependency.task_id == task_id, TaskDependency.depends_on_id == depends_on_id
        )
    )
    if exists:
        raise Conflict("That dependency already exists")
    if would_create_cycle(db, task_id, depends_on_id):
        raise ValidationFailed("That dependency would create a cycle", code="dependency_cycle")
    db.add(TaskDependency(task_id=task_id, depends_on_id=depends_on_id))
    db.commit()


def remove_dependency(db: Session, task_id: uuid.UUID, depends_on_id: uuid.UUID) -> None:
    dep = db.scalar(
        select(TaskDependency).where(TaskDependency.task_id == task_id, TaskDependency.depends_on_id == depends_on_id)
    )
    if dep is None:
        raise NotFound("Dependency not found")
    db.delete(dep)
    db.commit()


def add_comment(db: Session, task_id: uuid.UUID, body: str) -> TaskComment:
    get_task(db, task_id)
    comment = TaskComment(task_id=task_id, body=body)
    db.add(comment)
    db.commit()
    return comment


def list_comments(db: Session, task_id: uuid.UUID) -> list[TaskComment]:
    get_task(db, task_id)
    return list(db.scalars(select(TaskComment).where(TaskComment.task_id == task_id).order_by(TaskComment.created_at)))


def delete_comment(db: Session, task_id: uuid.UUID, comment_id: uuid.UUID) -> None:
    comment = db.get(TaskComment, comment_id)
    if comment is None or comment.task_id != task_id:
        raise NotFound("Comment not found")
    db.delete(comment)
    db.commit()


# ------------------------------------------------------------------ listing tasks


def effective_due(task: Task, milestones: dict[uuid.UUID, Milestone]) -> tuple[date | None, str | None]:
    if task.due_date:
        return task.due_date, "local"
    if task.gh_board_end:
        return task.gh_board_end, "github_project"
    ms = milestones.get(task.milestone_id) if task.milestone_id else None
    if ms and milestone_due(ms):
        return milestone_due(ms), "milestone"
    return None, None


def task_query(
    *,
    project_id: uuid.UUID | None = None,
    status: list[str] | None = None,
    priority: str | None = None,
    milestone_id: uuid.UUID | None = None,
    repo_id: uuid.UUID | None = None,
    label: str | None = None,
    q: str | None = None,
    source: str | None = None,
    top_level_only: bool = False,
    include_unassigned: bool = False,
    include_archived_projects: bool = False,
) -> Select[Task]:
    stmt = select(Task)
    if not include_archived_projects:
        stmt = stmt.outerjoin(Project, Project.id == Task.project_id).where(
            or_(Project.archived_at.is_(None), Task.project_id.is_(None))
        )
    if project_id:
        stmt = stmt.where(Task.project_id == project_id)
    elif not include_unassigned:
        stmt = stmt.where(Task.project_id.is_not(None))
    if status:
        stmt = stmt.where(Task.status.in_(status))
    if priority:
        stmt = stmt.where(Task.priority == priority)
    if milestone_id:
        stmt = stmt.where(Task.milestone_id == milestone_id)
    if repo_id:
        stmt = stmt.where(Task.gh_repo_id == repo_id)
    if label:
        stmt = stmt.where(Task.gh_labels.contains([label]))
    if source:
        stmt = stmt.where(Task.source == source)
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(or_(Task.title.ilike(like), Task.description.ilike(like)))
    if top_level_only:
        stmt = stmt.where(Task.parent_task_id.is_(None))
    return stmt


def serialize_tasks(db: Session, tasks: list[Task]) -> list[dict[str, Any]]:
    if not tasks:
        return []
    ids = [t.id for t in tasks]
    project_ids = {t.project_id for t in tasks if t.project_id}
    names = dict(db.execute(select(Project.id, Project.name).where(Project.id.in_(project_ids))).all())
    repo_ids = {t.gh_repo_id for t in tasks if t.gh_repo_id}
    repos = dict(db.execute(select(GitHubRepo.id, GitHubRepo.full_name).where(GitHubRepo.id.in_(repo_ids))).all())
    ms_ids = {t.milestone_id for t in tasks if t.milestone_id}
    milestones = {m.id: m for m in db.scalars(select(Milestone).where(Milestone.id.in_(ms_ids)))}
    deps: dict[uuid.UUID, list[uuid.UUID]] = {}
    for tid, dep in db.execute(
        select(TaskDependency.task_id, TaskDependency.depends_on_id).where(TaskDependency.task_id.in_(ids))
    ).all():
        deps.setdefault(tid, []).append(dep)
    all_dep_ids = {d for ds in deps.values() for d in ds}
    dep_status = dict(db.execute(select(Task.id, Task.status).where(Task.id.in_(all_dep_ids))).all())
    sub_counts = {
        pid: (total, done)
        for pid, total, done in db.execute(
            select(Task.parent_task_id, func.count(), func.count().filter(Task.status == "done"))
            .where(Task.parent_task_id.in_(ids))
            .group_by(Task.parent_task_id)
        ).all()
    }
    today = date.today()
    out = []
    for t in tasks:
        due, due_src = effective_due(t, milestones)
        row = {c: getattr(t, c) for c in TASK_FIELDS}
        row.update(
            project_name=names.get(t.project_id) if t.project_id else None,
            repo_full_name=repos.get(t.gh_repo_id) if t.gh_repo_id else None,
            depends_on=deps.get(t.id, []),
            blocked_by_open=sum(1 for d in deps.get(t.id, []) if dep_status.get(d) != "done"),
            subtask_count=sub_counts.get(t.id, (0, 0))[0],
            subtasks_done=sub_counts.get(t.id, (0, 0))[1],
            effective_due=due,
            effective_due_source=due_src,
            overdue=bool(due and due < today and t.status != "done"),
        )
        out.append(row)
    return out


TASK_FIELDS = (
    "id",
    "project_id",
    "milestone_id",
    "parent_task_id",
    "title",
    "description",
    "acceptance_criteria",
    "status",
    "priority",
    "assignee",
    "start_date",
    "due_date",
    "position",
    "completed_at",
    "created_at",
    "updated_at",
    "source",
    "gh_kind",
    "gh_number",
    "gh_state",
    "gh_url",
    "gh_labels",
    "gh_assignees",
    "gh_created_at",
    "gh_closed_at",
    "gh_merged_at",
    "gh_board_start",
    "gh_board_end",
    "gh_board_status",
)


# -------------------------------------------------------------------- milestones


def create_milestone(db: Session, data: MilestoneCreate) -> Milestone:
    project = get_project(db, data.project_id)
    ms = Milestone(**data.model_dump(), source="local", status="open")
    db.add(ms)
    db.flush()
    record_activity(db, "milestone.created", f"Milestone '{ms.title}' added to {project.name}", project_id=project.id)
    db.commit()
    return ms


def milestone_counts(db: Session, ids: list[uuid.UUID]) -> dict[uuid.UUID, tuple[int, int]]:
    if not ids:
        return {}
    return {
        mid: (total, done)  # type: ignore[misc]
        for mid, total, done in db.execute(
            select(Task.milestone_id, func.count(), func.count().filter(Task.status == "done"))
            .where(Task.milestone_id.in_(ids))
            .group_by(Task.milestone_id)
        ).all()
    }


def update_milestone(db: Session, milestone_id: uuid.UUID, data: MilestoneUpdate) -> Milestone:
    ms = get_milestone(db, milestone_id)
    changes = data.model_dump(exclude_unset=True)
    if ms.source == "github":
        locked = {"title", "description", "due_date", "status"} & changes.keys()
        if locked:
            raise ValidationFailed(
                "GitHub milestones are read-only here (except a local due date and completion criteria)",
                code="github_owned",
            )
    status = changes.pop("status", None)
    for key, value in changes.items():
        setattr(ms, key, value)
    if status == "done" and ms.status != "done":
        total, done = milestone_counts(db, [ms.id]).get(ms.id, (0, 0))
        if done < total:
            raise ValidationFailed(
                f"{total - done} of {total} tasks in this milestone are not done yet", code="milestone_incomplete"
            )
        ms.status, ms.completed_at = "done", utcnow()
        record_activity(db, "milestone.done", f"Milestone '{ms.title}' completed", project_id=ms.project_id)
    elif status == "open":
        ms.status, ms.completed_at = "open", None
    db.commit()
    return ms


def delete_milestone(db: Session, milestone_id: uuid.UUID) -> None:
    ms = get_milestone(db, milestone_id)
    if ms.source == "github":
        raise ValidationFailed("GitHub milestones can't be deleted here")
    db.delete(ms)
    db.commit()


def serialize_milestones(db: Session, items: list[Milestone]) -> list[dict[str, Any]]:
    counts = milestone_counts(db, [m.id for m in items])
    names = dict(
        db.execute(
            select(Project.id, Project.name).where(Project.id.in_({m.project_id for m in items if m.project_id}))
        ).all()
    )
    out = []
    for m in items:
        total, done = counts.get(m.id, (0, 0))
        out.append(
            {
                **{c: getattr(m, c) for c in MILESTONE_FIELDS},
                "project_name": names.get(m.project_id) if m.project_id else None,
                "effective_due": milestone_due(m),
                "task_total": total,
                "task_done": done,
            }
        )
    return out


MILESTONE_FIELDS = (
    "id",
    "project_id",
    "title",
    "description",
    "completion_criteria",
    "due_date",
    "local_due_date",
    "gh_due_on",
    "status",
    "completed_at",
    "source",
    "gh_url",
)


def copy_project_work(db: Session, source_id: uuid.UUID, target_id: uuid.UUID) -> None:
    """Copy local milestones, tasks (with subtasks) and dependencies into another project, reset to not-started."""
    ms_map: dict[uuid.UUID, uuid.UUID] = {}
    for ms in db.scalars(select(Milestone).where(Milestone.project_id == source_id, Milestone.source == "local")):
        new_ms = Milestone(
            project_id=target_id,
            title=ms.title,
            description=ms.description,
            completion_criteria=ms.completion_criteria,
            source="local",
            status="open",
        )
        db.add(new_ms)
        db.flush()
        ms_map[ms.id] = new_ms.id
    tasks = list(
        db.scalars(
            select(Task)
            .where(Task.project_id == source_id, Task.source == "local")
            .order_by(Task.parent_task_id.is_not(None), Task.position)
        )
    )
    task_map: dict[uuid.UUID, uuid.UUID] = {}
    pending = tasks
    # Parents first: loop until every task whose parent is copied has been copied.
    while pending:
        remaining = []
        for t in pending:
            if t.parent_task_id and t.parent_task_id not in task_map:
                remaining.append(t)
                continue
            new = Task(
                project_id=target_id,
                title=t.title,
                description=t.description,
                acceptance_criteria=t.acceptance_criteria,
                priority=t.priority,
                status="todo",
                position=t.position,
                milestone_id=ms_map.get(t.milestone_id) if t.milestone_id else None,
                parent_task_id=task_map.get(t.parent_task_id) if t.parent_task_id else None,
                source="local",
            )
            db.add(new)
            db.flush()
            task_map[t.id] = new.id
        if len(remaining) == len(pending):  # orphaned parents (shouldn't happen) — stop
            break
        pending = remaining
    for dep in db.scalars(select(TaskDependency).where(TaskDependency.task_id.in_(task_map.keys()))):
        if dep.depends_on_id in task_map:
            db.add(TaskDependency(task_id=task_map[dep.task_id], depends_on_id=task_map[dep.depends_on_id]))
