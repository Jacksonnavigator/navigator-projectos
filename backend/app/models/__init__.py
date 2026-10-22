"""All ORM models. Import from here so Alembic sees every table."""

from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models import enums as E
from app.models.base import Base, Timestamps, UUIDPk, check_in, utcnow

# --------------------------------------------------------------------------- auth


class User(UUIDPk, Timestamps, Base):
    __tablename__ = "users"

    github_id: Mapped[int | None] = mapped_column(BigInteger, unique=True)
    login: Mapped[str] = mapped_column(String(100), nullable=False)
    name: Mapped[str | None] = mapped_column(String(200))
    avatar_url: Mapped[str | None] = mapped_column(String(500))
    timezone: Mapped[str] = mapped_column(String(64), default="Africa/Dar_es_Salaam", nullable=False)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class UserSession(UUIDPk, Base):
    __tablename__ = "sessions"

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    user_agent: Mapped[str | None] = mapped_column(String(300))

    user: Mapped[User] = relationship()


class GitHubConnection(UUIDPk, Timestamps, Base):
    """Encrypted GitHub OAuth token for the signed-in user."""

    __tablename__ = "github_connections"

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), unique=True, nullable=False)
    access_token_enc: Mapped[str] = mapped_column(Text, nullable=False)
    scopes: Mapped[str] = mapped_column(String(300), default="", nullable=False)


class AuditEvent(UUIDPk, Base):
    __tablename__ = "audit_events"

    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False, index=True)
    user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    action: Mapped[str] = mapped_column(String(80), nullable=False)
    target: Mapped[str | None] = mapped_column(String(200))
    ip: Mapped[str | None] = mapped_column(String(64))
    details: Mapped[dict[str, Any] | None] = mapped_column(JSONB)


# ------------------------------------------------------------------------ projects


class Project(UUIDPk, Timestamps, Base):
    __tablename__ = "projects"
    __table_args__ = (
        CheckConstraint(check_in("lifecycle", E.LIFECYCLES), name="lifecycle"),
        CheckConstraint(f"priority IS NULL OR {check_in('priority', E.PRIORITIES)}", name="priority"),
        CheckConstraint("parent_id IS NULL OR parent_id <> id", name="not_own_parent"),
        CheckConstraint("target_date IS NULL OR start_date IS NULL OR target_date >= start_date", name="dates"),
        Index("uq_projects_lower_name", text("lower(name)"), unique=True),
    )

    register_id: Mapped[int | None] = mapped_column(Integer, unique=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    category: Mapped[str | None] = mapped_column(String(200))
    project_type: Mapped[str | None] = mapped_column(String(200))
    lifecycle: Mapped[str] = mapped_column(String(20), default="planning", nullable=False)
    # Exactly as reported/imported, e.g. "Prototype / model troubleshooting".
    reported_status: Mapped[str | None] = mapped_column(Text)
    status_confidence: Mapped[str | None] = mapped_column(Text)
    purpose: Mapped[str | None] = mapped_column(Text)
    tech_stack: Mapped[str | None] = mapped_column(Text)
    repository_text: Mapped[str | None] = mapped_column(Text)
    remaining_work: Mapped[str | None] = mapped_column(Text)
    business_potential: Mapped[str | None] = mapped_column(Text)
    next_action: Mapped[str | None] = mapped_column(Text)
    evidence_notes: Mapped[str | None] = mapped_column(Text)
    priority: Mapped[str | None] = mapped_column(String(2))
    priority_rank: Mapped[int | None] = mapped_column(Integer)
    priority_label: Mapped[str | None] = mapped_column(String(100))
    priority_reason: Mapped[str | None] = mapped_column(Text)
    start_date: Mapped[date | None] = mapped_column(Date)
    target_date: Mapped[date | None] = mapped_column(Date)
    parent_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("projects.id", ondelete="SET NULL"), index=True)
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Set when the project moves to the "completed" stage.
    completed_on: Mapped[date | None] = mapped_column(Date)

    links: Mapped[list[ProjectLink]] = relationship(
        back_populates="project", cascade="all, delete-orphan", order_by="ProjectLink.created_at"
    )
    tags: Mapped[list[str]] = mapped_column(ARRAY(String(50)), default=list, server_default="{}", nullable=False)


class ProjectLink(UUIDPk, Timestamps, Base):
    __tablename__ = "project_links"
    __table_args__ = (
        CheckConstraint(check_in("kind", E.LINK_KINDS), name="kind"),
        UniqueConstraint("project_id", "url", name="uq_project_links_project_url"),
    )

    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    kind: Mapped[str] = mapped_column(String(20), nullable=False)
    url: Mapped[str] = mapped_column(String(1000), nullable=False)
    label: Mapped[str | None] = mapped_column(String(200))

    project: Mapped[Project] = relationship(back_populates="links")


class ProjectRelation(UUIDPk, Base):
    """Undirected "related to" link between two projects; stored with project_a_id < project_b_id."""

    __tablename__ = "project_relations"
    __table_args__ = (
        CheckConstraint("project_a_id < project_b_id", name="ordered"),
        UniqueConstraint("project_a_id", "project_b_id", name="uq_project_relations_pair"),
    )

    project_a_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    project_b_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    note: Mapped[str | None] = mapped_column(String(300))


# ------------------------------------------------------------------- GitHub mirror


class GitHubRepo(UUIDPk, Timestamps, Base):
    __tablename__ = "github_repos"

    github_id: Mapped[int] = mapped_column(BigInteger, unique=True, nullable=False)
    full_name: Mapped[str] = mapped_column(String(300), nullable=False)
    html_url: Mapped[str] = mapped_column(String(500), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    private: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    archived: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    default_branch: Mapped[str | None] = mapped_column(String(200))
    pushed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    project_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("projects.id", ondelete="SET NULL"), index=True)
    sync_enabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    last_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Incremental cursor: issues/PRs updated at or after this time are fetched next run.
    issues_since: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_sync_error: Mapped[str | None] = mapped_column(Text)

    project: Mapped[Project | None] = relationship()


class GitHubProjectBoard(UUIDPk, Timestamps, Base):
    """A GitHub Projects (v2) board."""

    __tablename__ = "github_project_boards"

    node_id: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    number: Mapped[int] = mapped_column(Integer, nullable=False)
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    url: Mapped[str] = mapped_column(String(500), nullable=False)
    owner_login: Mapped[str] = mapped_column(String(100), nullable=False)
    closed: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    project_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("projects.id", ondelete="SET NULL"), index=True)
    sync_enabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    # Names of the board's date fields to use for timeline start/end (chosen by the user).
    start_field: Mapped[str | None] = mapped_column(String(200))
    end_field: Mapped[str | None] = mapped_column(String(200))
    date_fields: Mapped[list[str]] = mapped_column(
        ARRAY(String(200)), default=list, server_default="{}", nullable=False
    )
    last_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_sync_error: Mapped[str | None] = mapped_column(Text)


class GitHubEtag(Base):
    """Conditional-request cache: last ETag seen per API URL."""

    __tablename__ = "github_etags"

    url: Mapped[str] = mapped_column(String(1000), primary_key=True)
    etag: Mapped[str] = mapped_column(String(300), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


# --------------------------------------------------------------- milestones/tasks


class Milestone(UUIDPk, Timestamps, Base):
    __tablename__ = "milestones"
    __table_args__ = (
        CheckConstraint(check_in("status", E.MILESTONE_STATUSES), name="status"),
        CheckConstraint(check_in("source", E.SOURCES), name="source"),
        CheckConstraint("source <> 'local' OR project_id IS NOT NULL", name="local_needs_project"),
        UniqueConstraint("gh_repo_id", "gh_number", name="uq_milestones_gh_repo_number"),
    )

    project_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    completion_criteria: Mapped[str | None] = mapped_column(Text)
    due_date: Mapped[date | None] = mapped_column(Date)
    status: Mapped[str] = mapped_column(String(10), default="open", nullable=False)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    source: Mapped[str] = mapped_column(String(10), default="local", nullable=False)
    gh_repo_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("github_repos.id", ondelete="CASCADE"))
    gh_number: Mapped[int | None] = mapped_column(Integer)
    gh_url: Mapped[str | None] = mapped_column(String(500))
    # GitHub's due_on, kept separate from any local due date.
    gh_due_on: Mapped[date | None] = mapped_column(Date)
    local_due_date: Mapped[date | None] = mapped_column(Date)


class Task(UUIDPk, Timestamps, Base):
    __tablename__ = "tasks"
    __table_args__ = (
        CheckConstraint(check_in("status", E.TASK_STATUSES), name="status"),
        CheckConstraint(check_in("priority", E.TASK_PRIORITIES), name="priority"),
        CheckConstraint(check_in("source", E.SOURCES), name="source"),
        CheckConstraint(f"gh_kind IS NULL OR {check_in('gh_kind', E.GITHUB_KINDS)}", name="gh_kind"),
        CheckConstraint("source <> 'local' OR project_id IS NOT NULL", name="local_needs_project"),
        CheckConstraint("parent_task_id IS NULL OR parent_task_id <> id", name="not_own_parent"),
        CheckConstraint("due_date IS NULL OR start_date IS NULL OR due_date >= start_date", name="dates"),
        Index("ix_tasks_project_status", "project_id", "status"),
    )

    project_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"))
    milestone_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("milestones.id", ondelete="SET NULL"), index=True)
    parent_task_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    acceptance_criteria: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), default="todo", nullable=False)
    priority: Mapped[str] = mapped_column(String(10), default="medium", nullable=False)
    assignee: Mapped[str | None] = mapped_column(String(100))
    # Local planning dates (never overwritten by GitHub sync).
    start_date: Mapped[date | None] = mapped_column(Date)
    due_date: Mapped[date | None] = mapped_column(Date)
    position: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    source: Mapped[str] = mapped_column(String(10), default="local", nullable=False)
    gh_repo_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("github_repos.id", ondelete="CASCADE"), index=True)
    gh_node_id: Mapped[str | None] = mapped_column(String(100), unique=True)
    gh_kind: Mapped[str | None] = mapped_column(String(20))
    gh_number: Mapped[int | None] = mapped_column(Integer)
    gh_state: Mapped[str | None] = mapped_column(String(20))
    gh_url: Mapped[str | None] = mapped_column(String(500))
    gh_labels: Mapped[list[str]] = mapped_column(ARRAY(String(100)), default=list, server_default="{}", nullable=False)
    gh_assignees: Mapped[list[str]] = mapped_column(
        ARRAY(String(100)), default=list, server_default="{}", nullable=False
    )
    gh_created_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    gh_updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    gh_closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    gh_merged_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    gh_milestone_number: Mapped[int | None] = mapped_column(Integer)
    # Dates read from a GitHub Projects (v2) board's mapped date fields.
    gh_board_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("github_project_boards.id", ondelete="SET NULL"))
    gh_board_start: Mapped[date | None] = mapped_column(Date)
    gh_board_end: Mapped[date | None] = mapped_column(Date)
    gh_board_status: Mapped[str | None] = mapped_column(String(100))


class TaskDependency(UUIDPk, Base):
    """task_id cannot start/finish until depends_on_id is done."""

    __tablename__ = "task_dependencies"
    __table_args__ = (
        CheckConstraint("task_id <> depends_on_id", name="not_self"),
        UniqueConstraint("task_id", "depends_on_id", name="uq_task_dependencies_pair"),
    )

    task_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False, index=True)
    depends_on_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False, index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)


class TaskComment(UUIDPk, Timestamps, Base):
    __tablename__ = "task_comments"

    task_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False, index=True)
    body: Mapped[str] = mapped_column(Text, nullable=False)


class Release(UUIDPk, Base):
    __tablename__ = "releases"
    __table_args__ = (UniqueConstraint("gh_repo_id", "gh_release_id", name="uq_releases_repo_release"),)

    gh_repo_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("github_repos.id", ondelete="CASCADE"), nullable=False)
    gh_release_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    tag: Mapped[str] = mapped_column(String(200), nullable=False)
    name: Mapped[str | None] = mapped_column(String(300))
    url: Mapped[str] = mapped_column(String(500), nullable=False)
    draft: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    prerelease: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


# ---------------------------------------------------------------- health/evidence


class EvidenceRecord(UUIDPk, Timestamps, Base):
    __tablename__ = "evidence_records"
    __table_args__ = (
        CheckConstraint(check_in("kind", E.EVIDENCE_KINDS), name="kind"),
        CheckConstraint(check_in("result", E.EVIDENCE_RESULTS), name="result"),
        CheckConstraint(check_in("origin", E.EVIDENCE_ORIGINS), name="origin"),
        UniqueConstraint("source", "source_ref", name="uq_evidence_records_source_ref"),
        Index("ix_evidence_project_observed", "project_id", "observed_at"),
    )

    project_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"))
    gh_repo_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("github_repos.id", ondelete="CASCADE"))
    kind: Mapped[str] = mapped_column(String(30), nullable=False)
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    result: Mapped[str] = mapped_column(String(10), nullable=False)
    origin: Mapped[str] = mapped_column(String(10), nullable=False)
    # Where the record came from, e.g. "manual", "github_actions". source_ref de-duplicates imports.
    source: Mapped[str] = mapped_column(String(50), default="manual", nullable=False)
    source_ref: Mapped[str | None] = mapped_column(String(200))
    observed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    measured_value: Mapped[Decimal | None] = mapped_column(Numeric(18, 6))
    reference_value: Mapped[Decimal | None] = mapped_column(Numeric(18, 6))
    unit: Mapped[str | None] = mapped_column(String(30))
    url: Mapped[str | None] = mapped_column(String(500))
    notes: Mapped[str | None] = mapped_column(Text)
    document_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("documents.id", ondelete="SET NULL"))


# ------------------------------------------------------------------------ documents


class Document(UUIDPk, Timestamps, Base):
    __tablename__ = "documents"
    __table_args__ = (CheckConstraint(check_in("category", E.DOC_CATEGORIES), name="category"),)

    project_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    category: Mapped[str] = mapped_column(String(20), default="other", nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    # Markdown notes (knowledge base entries may have no file at all).
    body_markdown: Mapped[str | None] = mapped_column(Text)

    versions: Mapped[list[DocumentVersion]] = relationship(
        back_populates="document", cascade="all, delete-orphan", order_by="DocumentVersion.version_no.desc()"
    )


class DocumentVersion(UUIDPk, Base):
    __tablename__ = "document_versions"
    __table_args__ = (UniqueConstraint("document_id", "version_no", name="uq_document_versions_doc_version"),)

    document_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("documents.id", ondelete="CASCADE"), nullable=False)
    version_no: Mapped[int] = mapped_column(Integer, nullable=False)
    storage_key: Mapped[str] = mapped_column(String(200), unique=True, nullable=False)
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    content_type: Mapped[str] = mapped_column(String(100), nullable=False)
    size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)
    sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    uploaded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)

    document: Mapped[Document] = relationship(back_populates="versions")


# ------------------------------------------------------------------------ business


class BusinessEntry(UUIDPk, Timestamps, Base):
    __tablename__ = "business_entries"
    __table_args__ = (
        CheckConstraint(check_in("kind", E.BUSINESS_KINDS), name="kind"),
        CheckConstraint(check_in("status", E.BUSINESS_STATUSES), name="status"),
        CheckConstraint("amount IS NULL OR amount >= 0", name="amount_non_negative"),
        CheckConstraint("currency ~ '^[A-Z]{3}$'", name="currency_code"),
    )

    project_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    kind: Mapped[str] = mapped_column(String(20), nullable=False)
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    amount: Mapped[Decimal | None] = mapped_column(Numeric(16, 2))
    currency: Mapped[str] = mapped_column(String(3), default="TZS", nullable=False)
    status: Mapped[str] = mapped_column(String(10), default="estimated", nullable=False)
    counterparty: Mapped[str | None] = mapped_column(String(200))
    entry_date: Mapped[date | None] = mapped_column(Date)
    notes: Mapped[str | None] = mapped_column(Text)


# --------------------------------------------------------------- activity and jobs


class ActivityEvent(UUIDPk, Base):
    __tablename__ = "activity_events"
    __table_args__ = (
        UniqueConstraint("dedupe_key", name="uq_activity_events_dedupe_key"),
        Index("ix_activity_occurred", "occurred_at"),
    )

    project_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(50), nullable=False)
    message: Mapped[str] = mapped_column(String(500), nullable=False)
    url: Mapped[str | None] = mapped_column(String(500))
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    # Prevents the same GitHub event being recorded twice across re-syncs.
    dedupe_key: Mapped[str | None] = mapped_column(String(300))


class BackgroundJob(UUIDPk, Timestamps, Base):
    __tablename__ = "background_jobs"
    __table_args__ = (
        CheckConstraint(check_in("status", E.JOB_STATUSES), name="status"),
        CheckConstraint("attempts >= 0 AND attempts <= max_attempts", name="attempts"),
        Index("ix_jobs_runnable", "status", "run_after"),
    )

    kind: Mapped[str] = mapped_column(String(50), nullable=False)
    # Only one queued/running job per key; finished jobs release the key (see services/jobs.py).
    idempotency_key: Mapped[str | None] = mapped_column(String(200))
    status: Mapped[str] = mapped_column(String(10), default="queued", nullable=False)
    attempts: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    max_attempts: Mapped[int] = mapped_column(Integer, default=3, nullable=False)
    run_after: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    locked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_error: Mapped[str | None] = mapped_column(Text)
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict, nullable=False)
    result: Mapped[dict[str, Any] | None] = mapped_column(JSONB)


Index(
    "uq_jobs_active_idempotency",
    BackgroundJob.idempotency_key,
    unique=True,
    postgresql_where=BackgroundJob.status.in_(["queued", "running"]),
)


class AppSetting(Base):
    __tablename__ = "app_settings"

    key: Mapped[str] = mapped_column(String(100), primary_key=True)
    value: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


__all__ = [
    "ActivityEvent",
    "AppSetting",
    "AuditEvent",
    "BackgroundJob",
    "Base",
    "BusinessEntry",
    "Document",
    "DocumentVersion",
    "EvidenceRecord",
    "GitHubConnection",
    "GitHubEtag",
    "GitHubProjectBoard",
    "GitHubRepo",
    "Milestone",
    "Project",
    "ProjectLink",
    "ProjectRelation",
    "Release",
    "Task",
    "TaskComment",
    "TaskDependency",
    "User",
    "UserSession",
]
