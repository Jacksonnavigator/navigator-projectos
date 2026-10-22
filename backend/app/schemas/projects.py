from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field, HttpUrl, field_validator, model_validator

from app.schemas.common import ORM

Lifecycle = Literal["idea", "planning", "active", "testing", "deployed", "completed", "paused", "archived"]
Priority = Literal["P1", "P2", "P3", "P4"]
LinkKind = Literal["github_repo", "huggingface", "website", "firebase", "docs", "local_path", "other"]


class ProjectBase(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    category: str | None = Field(default=None, max_length=200)
    project_type: str | None = Field(default=None, max_length=200)
    lifecycle: Lifecycle = "planning"
    reported_status: str | None = None
    status_confidence: str | None = None
    purpose: str | None = None
    tech_stack: str | None = None
    repository_text: str | None = None
    remaining_work: str | None = None
    business_potential: str | None = None
    next_action: str | None = None
    evidence_notes: str | None = None
    priority: Priority | None = None
    priority_rank: int | None = Field(default=None, ge=1, le=10000)
    priority_reason: str | None = None
    start_date: date | None = None
    target_date: date | None = None
    parent_id: uuid.UUID | None = None
    tags: list[str] = Field(default_factory=list, max_length=20)

    @field_validator("name")
    @classmethod
    def _strip_name(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Name is required")
        return v

    @field_validator("tags")
    @classmethod
    def _clean_tags(cls, v: list[str]) -> list[str]:
        out: list[str] = []
        for tag in v:
            tag = tag.strip().lower()[:50]
            if tag and tag not in out:
                out.append(tag)
        return out

    @model_validator(mode="after")
    def _dates(self) -> ProjectBase:
        if self.start_date and self.target_date and self.target_date < self.start_date:
            raise ValueError("Target date must be on or after the start date")
        return self


class ProjectCreate(ProjectBase):
    pass


class ProjectUpdate(BaseModel):
    """Partial update: only fields that are present are changed."""

    name: str | None = Field(default=None, min_length=1, max_length=200)
    category: str | None = None
    project_type: str | None = None
    lifecycle: Lifecycle | None = None
    reported_status: str | None = None
    status_confidence: str | None = None
    purpose: str | None = None
    tech_stack: str | None = None
    repository_text: str | None = None
    remaining_work: str | None = None
    business_potential: str | None = None
    next_action: str | None = None
    evidence_notes: str | None = None
    priority: Priority | None = None
    priority_rank: int | None = Field(default=None, ge=1, le=10000)
    priority_reason: str | None = None
    start_date: date | None = None
    target_date: date | None = None
    parent_id: uuid.UUID | None = None
    tags: list[str] | None = None


class LinkIn(BaseModel):
    url: str = Field(min_length=1, max_length=1000)
    kind: LinkKind | None = None
    label: str | None = Field(default=None, max_length=200)

    @field_validator("url")
    @classmethod
    def _url(cls, v: str) -> str:
        v = v.strip()
        if v.startswith(("http://", "https://")):
            HttpUrl(v)  # validates
        elif not (v.startswith("/") or (len(v) > 2 and v[1] == ":")):
            raise ValueError("Use an http(s) URL or a local path")
        return v


class LinkOut(ORM):
    id: uuid.UUID
    kind: str
    url: str
    label: str | None


class ProjectRef(ORM):
    id: uuid.UUID
    name: str


class ProjectSummary(ORM):
    id: uuid.UUID
    register_id: int | None
    name: str
    category: str | None
    project_type: str | None
    lifecycle: str
    reported_status: str | None
    status_confidence: str | None
    priority: str | None
    priority_rank: int | None
    priority_label: str | None
    next_action: str | None
    start_date: date | None
    target_date: date | None
    parent_id: uuid.UUID | None
    tags: list[str]
    archived_at: datetime | None
    completed_on: date | None = None
    updated_at: datetime
    # Computed (see services/projects.py)
    open_tasks: int = 0
    done_tasks: int = 0
    overdue_tasks: int = 0
    repo_count: int = 0
    last_verified_at: datetime | None = None


class ProjectOut(ProjectSummary):
    purpose: str | None
    tech_stack: str | None
    repository_text: str | None
    remaining_work: str | None
    business_potential: str | None
    evidence_notes: str | None
    priority_reason: str | None
    created_at: datetime
    links: list[LinkOut]
    parent: ProjectRef | None = None
    children: list[ProjectRef] = []
    related: list[ProjectRef] = []


class RelationIn(BaseModel):
    project_id: uuid.UUID
    note: str | None = Field(default=None, max_length=300)
