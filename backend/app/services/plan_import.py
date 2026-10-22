"""Apply a work plan (project updates, milestones, tasks, dependencies) from a JSON document.

Plans are idempotent: projects are matched by register ID or name, milestones and local tasks by title
within their project. Re-applying a plan updates planned fields (dates, criteria, milestone) but never
touches a task's status, so progress you've made is kept.
"""

from __future__ import annotations

import json
import uuid
from datetime import date
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, Field, model_validator
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.errors import NotFound, ValidationFailed
from app.models import Milestone, Project, Task, TaskDependency
from app.services.projects import record_activity
from app.services.tasks import would_create_cycle

PLANS_DIR = Path(__file__).resolve().parent.parent.parent / "plans"


class PlanTask(BaseModel):
    key: str = Field(min_length=1, max_length=50)
    title: str = Field(min_length=1, max_length=500)
    description: str | None = None
    acceptance_criteria: str | None = None
    priority: Literal["low", "medium", "high", "urgent"] = "medium"
    start_date: date | None = None
    due_date: date | None = None
    depends_on: list[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def _dates(self) -> PlanTask:
        if self.start_date and self.due_date and self.due_date < self.start_date:
            raise ValueError(f"Task '{self.title}': due date is before start date")
        return self


class PlanMilestone(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    due_date: date | None = None
    completion_criteria: str | None = None
    tasks: list[PlanTask] = Field(default_factory=list)


class PlanProjectUpdate(BaseModel):
    lifecycle: Literal["idea", "planning", "active", "testing", "deployed", "paused", "archived"] | None = None
    priority: Literal["P1", "P2", "P3", "P4"] | None = None
    start_date: date | None = None
    target_date: date | None = None
    next_action: str | None = None


class PlanProject(BaseModel):
    match: str = Field(min_length=1, max_length=200, description="Project name or register ID")
    update: PlanProjectUpdate = Field(default_factory=PlanProjectUpdate)
    milestones: list[PlanMilestone] = Field(default_factory=list)
    tasks: list[PlanTask] = Field(default_factory=list, description="Tasks without a milestone")


class Plan(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: str | None = None
    projects: list[PlanProject] = Field(max_length=100)

    @model_validator(mode="after")
    def _keys(self) -> Plan:
        keys: list[str] = []
        for p in self.projects:
            for t in [*p.tasks, *(t for m in p.milestones for t in m.tasks)]:
                keys.append(t.key)
        dupes = {k for k in keys if keys.count(k) > 1}
        if dupes:
            raise ValueError("Task keys must be unique: " + ", ".join(sorted(dupes)))
        unknown = {d for p in self.projects for t in [*p.tasks, *(t for m in p.milestones for t in m.tasks)]
                   for d in t.depends_on if d not in keys}  # fmt: skip
        if unknown:
            raise ValueError("depends_on refers to unknown task keys: " + ", ".join(sorted(unknown)))
        return self


def bundled_plans() -> list[dict[str, Any]]:
    out = []
    for path in sorted(PLANS_DIR.glob("*.json")):
        data = json.loads(path.read_text(encoding="utf-8"))
        out.append({"id": path.stem, "name": data.get("name", path.stem), "description": data.get("description")})
    return out


def load_bundled(plan_id: str) -> Plan:
    if not plan_id.replace("-", "").replace("_", "").isalnum():
        raise NotFound("Plan not found")
    path = PLANS_DIR / f"{plan_id}.json"
    if not path.is_file():
        raise NotFound("Plan not found")
    return Plan.model_validate_json(path.read_text(encoding="utf-8"))


def _find_project(db: Session, match: str) -> Project | None:
    if match.strip().isdigit():
        project = db.scalar(select(Project).where(Project.register_id == int(match)))
        if project:
            return project
    return db.scalar(select(Project).where(func.lower(Project.name) == match.strip().lower()))


def apply_plan(db: Session, plan: Plan, *, dry_run: bool) -> dict[str, Any]:
    """Apply (or preview, with dry_run) a plan. Returns a summary of what changes."""
    summary: dict[str, Any] = {
        "plan": plan.name,
        "dry_run": dry_run,
        "projects": [],
        "missing_projects": [],
        "counts": {
            "projects_updated": 0,
            "milestones_created": 0,
            "milestones_updated": 0,
            "tasks_created": 0,
            "tasks_updated": 0,
            "dependencies_added": 0,
        },  # fmt: skip
        "warnings": [],
    }
    counts = summary["counts"]
    task_ids: dict[str, uuid.UUID] = {}
    pending_deps: list[tuple[str, str, str]] = []  # (task key, depends-on key, task title)

    for pp in plan.projects:
        project = _find_project(db, pp.match)
        if project is None:
            summary["missing_projects"].append(pp.match)
            continue
        changes = {k: v for k, v in pp.update.model_dump(exclude_none=True).items() if getattr(project, k) != v}
        start = changes.get("start_date", project.start_date)
        target = changes.get("target_date", project.target_date)
        if start and target and target < start:
            raise ValidationFailed(f"{project.name}: target date is before start date")
        for key, value in changes.items():
            setattr(project, key, value)
        if changes:
            counts["projects_updated"] += 1
        entry: dict[str, Any] = {"project": project.name, "changes": sorted(changes), "milestones": [], "tasks": []}

        groups: list[tuple[PlanMilestone | None, list[PlanTask]]] = [(m, m.tasks) for m in pp.milestones]
        groups.append((None, pp.tasks))
        for pm, tasks in groups:
            milestone_id = None
            if pm is not None:
                ms = db.scalar(
                    select(Milestone).where(
                        Milestone.project_id == project.id,
                        Milestone.source == "local",
                        func.lower(Milestone.title) == pm.title.lower(),
                    )
                )
                if ms is None:
                    ms = Milestone(project_id=project.id, title=pm.title, source="local", status="open")
                    db.add(ms)
                    counts["milestones_created"] += 1
                    entry["milestones"].append({"title": pm.title, "action": "create"})
                else:
                    counts["milestones_updated"] += 1
                    entry["milestones"].append({"title": pm.title, "action": "update"})
                ms.due_date = pm.due_date
                ms.completion_criteria = pm.completion_criteria
                db.flush()
                milestone_id = ms.id
            for pt in tasks:
                task = db.scalar(
                    select(Task).where(
                        Task.project_id == project.id,
                        Task.source == "local",
                        Task.parent_task_id.is_(None),
                        func.lower(Task.title) == pt.title.lower(),
                    )
                )
                if task is None:
                    position = (
                        db.scalar(select(func.max(Task.position)).where(Task.project_id == project.id)) or 0
                    ) + 1
                    task = Task(project_id=project.id, title=pt.title, source="local", status="todo", position=position)
                    db.add(task)
                    counts["tasks_created"] += 1
                    entry["tasks"].append({"title": pt.title, "action": "create", "due": pt.due_date})
                else:
                    counts["tasks_updated"] += 1
                    entry["tasks"].append({"title": pt.title, "action": "update", "due": pt.due_date})
                # Planned fields only; status and completion are never changed by a plan.
                task.description = pt.description
                task.acceptance_criteria = pt.acceptance_criteria
                task.priority = pt.priority
                task.start_date = pt.start_date
                task.due_date = pt.due_date
                task.milestone_id = milestone_id
                db.flush()
                task_ids[pt.key] = task.id
                pending_deps.extend((pt.key, dep, pt.title) for dep in pt.depends_on)
        summary["projects"].append(entry)

    for key, dep_key, title in pending_deps:
        tid, did = task_ids.get(key), task_ids.get(dep_key)
        if tid is None or did is None:
            summary["warnings"].append(f"Dependency of '{title}' skipped: its project was not found")
            continue
        exists = db.scalar(
            select(TaskDependency.id).where(TaskDependency.task_id == tid, TaskDependency.depends_on_id == did)
        )
        if exists:
            continue
        if would_create_cycle(db, tid, did):
            summary["warnings"].append(f"Dependency of '{title}' skipped: it would create a cycle")
            continue
        db.add(TaskDependency(task_id=tid, depends_on_id=did))
        db.flush()
        counts["dependencies_added"] += 1

    if dry_run:
        db.rollback()
    else:
        record_activity(db, "plan.applied", f"Plan '{plan.name}' applied")
        db.commit()
    return summary
