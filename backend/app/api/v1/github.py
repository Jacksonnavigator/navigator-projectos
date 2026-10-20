from __future__ import annotations

import uuid
from datetime import timedelta
from typing import Any

from fastapi import APIRouter, BackgroundTasks, Header, Response
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select

from app.api.deps import DB, CurrentUser
from app.core.config import get_settings
from app.core.db import get_sessionmaker
from app.core.errors import NotFound, Unauthorized, ValidationFailed
from app.core.security import constant_time_equals
from app.integrations.github import oauth
from app.integrations.github.client import GitHubAuthError, GitHubRateLimited
from app.models import BackgroundJob, GitHubConnection, GitHubProjectBoard, GitHubRepo, Project
from app.models.base import utcnow
from app.services import github_sync as sync
from app.services import jobs
from app.services.auth import audit, get_github_token

router = APIRouter(prefix="/github", tags=["github"])
internal = APIRouter(prefix="/internal", tags=["internal"])


def _repo_out(repo: GitHubRepo, names: dict[uuid.UUID, str]) -> dict[str, Any]:
    return {
        "id": repo.id,
        "github_id": repo.github_id,
        "full_name": repo.full_name,
        "html_url": repo.html_url,
        "description": repo.description,
        "private": repo.private,
        "archived": repo.archived,
        "pushed_at": repo.pushed_at,
        "project_id": repo.project_id,
        "project_name": names.get(repo.project_id) if repo.project_id else None,
        "sync_enabled": repo.sync_enabled,
        "last_synced_at": repo.last_synced_at,
        "last_sync_error": repo.last_sync_error,
    }


def _board_out(board: GitHubProjectBoard, names: dict[uuid.UUID, str]) -> dict[str, Any]:
    return {
        "id": board.id,
        "number": board.number,
        "title": board.title,
        "url": board.url,
        "owner_login": board.owner_login,
        "closed": board.closed,
        "project_id": board.project_id,
        "project_name": names.get(board.project_id) if board.project_id else None,
        "sync_enabled": board.sync_enabled,
        "date_fields": board.date_fields,
        "start_field": board.start_field,
        "end_field": board.end_field,
        "last_synced_at": board.last_synced_at,
        "last_sync_error": board.last_sync_error,
    }


def _names(db: DB) -> dict[uuid.UUID, str]:
    return dict(db.execute(select(Project.id, Project.name)).all())  # type: ignore[arg-type]


def _job_out(job: BackgroundJob | None) -> dict[str, Any] | None:
    if job is None:
        return None
    return {
        "id": job.id,
        "kind": job.kind,
        "status": job.status,
        "attempts": job.attempts,
        "created_at": job.created_at,
        "finished_at": job.finished_at,
        "last_error": job.last_error,
        "result": job.result,
    }


@router.get("/status")
def status(db: DB, user: CurrentUser) -> dict[str, Any]:
    conn = db.scalar(select(GitHubConnection).where(GitHubConnection.user_id == user.id))
    last_job = db.scalar(
        select(BackgroundJob).where(BackgroundJob.kind == "github_sync_all").order_by(BackgroundJob.created_at.desc())
    )
    return {
        "connected": conn is not None,
        "scopes": conn.scopes if conn else None,
        "login": user.login,
        "repos_total": db.scalar(select(func.count()).select_from(GitHubRepo)) or 0,
        "repos_synced": db.scalar(select(func.count()).where(GitHubRepo.sync_enabled.is_(True))) or 0,
        "boards_total": db.scalar(select(func.count()).select_from(GitHubProjectBoard)) or 0,
        "boards_synced": db.scalar(select(func.count()).where(GitHubProjectBoard.sync_enabled.is_(True))) or 0,
        "last_synced_at": db.scalar(select(func.max(GitHubRepo.last_synced_at))),
        "last_job": _job_out(last_job),
        "stale_minutes": get_settings().sync_stale_minutes,
    }


def _github_call(fn: Any, db: DB) -> Any:
    try:
        return fn(db)
    except GitHubAuthError as exc:
        raise ValidationFailed(str(exc), code="github_auth_failed") from exc
    except GitHubRateLimited as exc:
        when = exc.reset_at.isoformat() if exc.reset_at else "later"
        raise ValidationFailed(f"GitHub rate limit reached; try again after {when}", code="rate_limited") from exc


@router.post("/repos/refresh")
def refresh_repos(db: DB, _: CurrentUser) -> dict[str, Any]:
    return _github_call(sync.refresh_repos, db)  # type: ignore[no-any-return]


@router.get("/repos")
def list_repos(db: DB, _: CurrentUser) -> list[dict[str, Any]]:
    names = _names(db)
    repos = db.scalars(
        select(GitHubRepo).order_by(GitHubRepo.sync_enabled.desc(), GitHubRepo.pushed_at.desc().nulls_last())
    )
    return [_repo_out(r, names) for r in repos]


class RepoUpdate(BaseModel):
    project_id: uuid.UUID | None = None
    sync_enabled: bool | None = None


@router.patch("/repos/{repo_id}")
def update_repo(repo_id: uuid.UUID, body: RepoUpdate, db: DB, _: CurrentUser) -> dict[str, Any]:
    repo = db.get(GitHubRepo, repo_id)
    if repo is None:
        raise NotFound("Repository not found")
    fields = body.model_fields_set
    if "project_id" in fields:
        sync.set_repo_project(db, repo, body.project_id)
    if "sync_enabled" in fields and body.sync_enabled is not None:
        repo.sync_enabled = body.sync_enabled
    db.commit()
    return _repo_out(repo, _names(db))


@router.post("/boards/refresh")
def refresh_boards(db: DB, _: CurrentUser) -> dict[str, Any]:
    return _github_call(sync.refresh_boards, db)  # type: ignore[no-any-return]


@router.get("/boards")
def list_boards(db: DB, _: CurrentUser) -> list[dict[str, Any]]:
    names = _names(db)
    boards = db.scalars(select(GitHubProjectBoard).order_by(GitHubProjectBoard.closed, GitHubProjectBoard.title))
    return [_board_out(b, names) for b in boards]


class BoardUpdate(BaseModel):
    project_id: uuid.UUID | None = None
    sync_enabled: bool | None = None
    start_field: str | None = Field(default=None, max_length=200)
    end_field: str | None = Field(default=None, max_length=200)


@router.patch("/boards/{board_id}")
def update_board(board_id: uuid.UUID, body: BoardUpdate, db: DB, _: CurrentUser) -> dict[str, Any]:
    board = db.get(GitHubProjectBoard, board_id)
    if board is None:
        raise NotFound("Board not found")
    fields = body.model_fields_set
    for name in ("start_field", "end_field"):
        if name in fields:
            value = getattr(body, name)
            if value is not None and value not in board.date_fields:
                raise ValidationFailed(f"'{value}' is not a date field on this board")
            setattr(board, name, value)
    if "project_id" in fields:
        sync.set_board_project(db, board, body.project_id)
    if "sync_enabled" in fields and body.sync_enabled is not None:
        board.sync_enabled = body.sync_enabled
    db.commit()
    return _board_out(board, _names(db))


def _run_sync_in_background() -> None:
    db = get_sessionmaker()()
    try:
        jobs.run_pending(db, get_settings().sync_time_budget_seconds, kinds=["github_sync_all"])
    finally:
        db.close()


@router.post("/sync", status_code=202)
def start_sync(db: DB, _: CurrentUser, background: BackgroundTasks, if_stale: bool = False) -> dict[str, Any]:
    """Queue a sync and run it after responding. With if_stale=true, skip if data is fresh."""
    if get_github_token(db, _.id) is None:
        raise ValidationFailed("Sign in with GitHub to connect your account first.", code="github_not_connected")
    if if_stale:
        last = db.scalar(select(func.max(GitHubRepo.last_synced_at)).where(GitHubRepo.sync_enabled.is_(True)))
        if last and utcnow() - last < timedelta(minutes=get_settings().sync_stale_minutes):
            return {"started": False, "reason": "fresh", "last_synced_at": last}
    job = jobs.enqueue(db, "github_sync_all", idempotency_key=sync.SYNC_ALL_KEY)
    background.add_task(_run_sync_in_background)
    return {"started": True, "job": _job_out(job)}


@router.get("/jobs")
def list_jobs(db: DB, _: CurrentUser) -> list[dict[str, Any]]:
    return [_job_out(j) for j in jobs.recent_jobs(db, 20)]  # type: ignore[misc]


@router.delete("/connection", status_code=204)
def disconnect(db: DB, user: CurrentUser) -> Response:
    """Revoke the OAuth grant on GitHub and delete the stored token. Synced data is kept."""
    token = get_github_token(db, user.id)
    revoked = oauth.revoke_grant(token) if token else True
    db.execute(delete(GitHubConnection).where(GitHubConnection.user_id == user.id))
    audit(db, "github.disconnected", user_id=user.id, details={"revoked_on_github": revoked})
    db.commit()
    return Response(status_code=204)


@internal.post("/sync")
def internal_sync(db: DB, authorization: str = Header(default="")) -> dict[str, Any]:
    """Called by the scheduled GitHub Actions workflow with `Authorization: Bearer <INTERNAL_SYNC_SECRET>`."""
    secret = get_settings().internal_sync_secret
    supplied = authorization.removeprefix("Bearer ").strip()
    if len(secret) < 16 or not constant_time_equals(supplied, secret):
        raise Unauthorized("Invalid sync credentials")
    if any_token(db) is None:
        return {"ran": 0, "reason": "github_not_connected"}
    jobs.enqueue(db, "github_sync_all", idempotency_key=sync.SYNC_ALL_KEY)
    ran = jobs.run_pending(db, get_settings().sync_time_budget_seconds, kinds=["github_sync_all"])
    return {"ran": len(ran), "jobs": [_job_out(db.get(BackgroundJob, j)) for j in ran]}


def any_token(db: DB) -> str | None:
    from app.services.auth import any_github_token

    return any_github_token(db)
