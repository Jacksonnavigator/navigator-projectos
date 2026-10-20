from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

from app.schemas.common import ORM

TaskStatus = Literal["backlog", "todo", "in_progress", "blocked", "in_review", "done"]
TaskPriority = Literal["low", "medium", "high", "urgent"]


class TaskCreate(BaseModel):
    project_id: uuid.UUID
    title: str = Field(min_length=1, max_length=500)
    description: str | None = None
    acceptance_criteria: str | None = None
    status: TaskStatus = "todo"
    priority: TaskPriority = "medium"
    assignee: str | None = Field(default=None, max_length=100)
    start_date: date | None = None
    due_date: date | None = None
    milestone_id: uuid.UUID | None = None
    parent_task_id: uuid.UUID | None = None

    @field_validator("title")
    @classmethod
    def _title(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Title is required")
        return v

    @model_validator(mode="after")
    def _dates(self) -> TaskCreate:
        if self.start_date and self.due_date and self.due_date < self.start_date:
            raise ValueError("Due date must be on or after the start date")
        return self


class TaskUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=500)
    description: str | None = None
    acceptance_criteria: str | None = None
    status: TaskStatus | None = None
    priority: TaskPriority | None = None
    assignee: str | None = Field(default=None, max_length=100)
    start_date: date | None = None
    due_date: date | None = None
    milestone_id: uuid.UUID | None = None
    parent_task_id: uuid.UUID | None = None
    position: int | None = Field(default=None, ge=0, le=1_000_000)


class TaskOut(ORM):
    id: uuid.UUID
    project_id: uuid.UUID | None
    project_name: str | None = None
    milestone_id: uuid.UUID | None
    parent_task_id: uuid.UUID | None
    title: str
    description: str | None
    acceptance_criteria: str | None
    status: str
    priority: str
    assignee: str | None
    start_date: date | None
    due_date: date | None
    position: int
    completed_at: datetime | None
    created_at: datetime
    updated_at: datetime
    source: str
    gh_kind: str | None
    gh_number: int | None
    gh_state: str | None
    gh_url: str | None
    gh_labels: list[str]
    gh_assignees: list[str]
    gh_created_at: datetime | None
    gh_closed_at: datetime | None
    gh_merged_at: datetime | None
    gh_board_start: date | None
    gh_board_end: date | None
    gh_board_status: str | None
    repo_full_name: str | None = None
    depends_on: list[uuid.UUID] = []
    blocked_by_open: int = 0
    subtask_count: int = 0
    subtasks_done: int = 0
    effective_due: date | None = None
    effective_due_source: str | None = None
    overdue: bool = False


class DependencyIn(BaseModel):
    depends_on_id: uuid.UUID


class CommentIn(BaseModel):
    body: str = Field(min_length=1, max_length=20000)


class CommentOut(ORM):
    id: uuid.UUID
    task_id: uuid.UUID
    body: str
    created_at: datetime
    updated_at: datetime


class MilestoneCreate(BaseModel):
    project_id: uuid.UUID
    title: str = Field(min_length=1, max_length=300)
    description: str | None = None
    completion_criteria: str | None = None
    due_date: date | None = None


class MilestoneUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=300)
    description: str | None = None
    completion_criteria: str | None = None
    due_date: date | None = None
    local_due_date: date | None = None
    status: Literal["open", "done"] | None = None


class MilestoneOut(ORM):
    id: uuid.UUID
    project_id: uuid.UUID | None
    project_name: str | None = None
    title: str
    description: str | None
    completion_criteria: str | None
    due_date: date | None
    local_due_date: date | None
    gh_due_on: date | None
    effective_due: date | None = None
    status: str
    completed_at: datetime | None
    source: str
    gh_url: str | None
    task_total: int = 0
    task_done: int = 0
