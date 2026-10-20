"""PostgreSQL-backed job queue (no Redis, no worker process).

Render's free plan has no background workers, so jobs run inside the web process when:
  * a user action needs one (e.g. "Sync now"), or
  * the scheduled GitHub Actions workflow calls POST /api/v1/internal/sync.

Guarantees:
  * Deduplication: a partial unique index allows only one queued/running job per idempotency_key.
  * Locking: claim_next() uses SELECT ... FOR UPDATE SKIP LOCKED, so two requests never run the same job.
  * Retries: failures are retried with backoff (1, 5, 15 min) up to max_attempts, then marked failed.
  * Recovery: a job left "running" for more than STALE_LOCK (e.g. the instance went to sleep mid-job)
    is put back in the queue, or failed if it has used all attempts.
  * Idempotent handlers: sync jobs upsert by GitHub IDs, so re-running one never duplicates data.
"""

from __future__ import annotations

import logging
import time
import uuid
from collections.abc import Callable
from datetime import timedelta
from typing import Any

from sqlalchemy import or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import BackgroundJob
from app.models.base import utcnow

logger = logging.getLogger("app.jobs")

STALE_LOCK = timedelta(minutes=10)
BACKOFF = (timedelta(minutes=1), timedelta(minutes=5), timedelta(minutes=15))

Handler = Callable[[Session, dict[str, Any], float], dict[str, Any]]
HANDLERS: dict[str, Handler] = {}


def handler(kind: str) -> Callable[[Handler], Handler]:
    def register(fn: Handler) -> Handler:
        HANDLERS[kind] = fn
        return fn

    return register


def enqueue(
    db: Session,
    kind: str,
    payload: dict[str, Any] | None = None,
    *,
    idempotency_key: str | None = None,
    max_attempts: int = 3,
) -> BackgroundJob:
    """Queue a job, or return the already-active job with the same idempotency key."""
    if idempotency_key:
        existing = db.scalar(
            select(BackgroundJob).where(
                BackgroundJob.idempotency_key == idempotency_key, BackgroundJob.status.in_(["queued", "running"])
            )
        )
        if existing:
            return existing
    job = BackgroundJob(kind=kind, payload=payload or {}, idempotency_key=idempotency_key, max_attempts=max_attempts)
    db.add(job)
    try:
        db.commit()
    except IntegrityError:
        # Lost a race with a concurrent enqueue of the same key.
        db.rollback()
        existing = db.scalar(
            select(BackgroundJob).where(
                BackgroundJob.idempotency_key == idempotency_key, BackgroundJob.status.in_(["queued", "running"])
            )
        )
        if existing is None:
            raise
        return existing
    return job


def recover_stale(db: Session) -> int:
    cutoff = utcnow() - STALE_LOCK
    stale = list(
        db.scalars(
            select(BackgroundJob)
            .where(BackgroundJob.status == "running", BackgroundJob.locked_at < cutoff)
            .with_for_update(skip_locked=True)
        )
    )
    for job in stale:
        job.locked_at = None
        if job.attempts >= job.max_attempts:
            job.status, job.finished_at = "failed", utcnow()
            job.last_error = (job.last_error or "") + "\nAbandoned: the server stopped while the job was running."
        else:
            job.status = "queued"
    db.commit()
    return len(stale)


def claim_next(db: Session, kinds: list[str] | None = None) -> BackgroundJob | None:
    stmt = (
        select(BackgroundJob)
        .where(BackgroundJob.status == "queued", BackgroundJob.run_after <= utcnow())
        .order_by(BackgroundJob.run_after, BackgroundJob.created_at)
        .limit(1)
        .with_for_update(skip_locked=True)
    )
    if kinds:
        stmt = stmt.where(BackgroundJob.kind.in_(kinds))
    job = db.scalar(stmt)
    if job is None:
        db.rollback()
        return None
    job.status, job.locked_at = "running", utcnow()
    job.attempts += 1
    db.commit()
    return job


def run_job(db: Session, job: BackgroundJob, deadline: float) -> None:
    fn = HANDLERS.get(job.kind)
    try:
        if fn is None:
            raise RuntimeError(f"No handler for job kind '{job.kind}'")
        result = fn(db, dict(job.payload), deadline)
    except Exception as exc:  # noqa: BLE001 - every failure is recorded on the job
        db.rollback()
        job = db.get(BackgroundJob, job.id)  # type: ignore[assignment]
        job.last_error = f"{type(exc).__name__}: {exc}"[:2000]
        job.locked_at = None
        if job.attempts >= job.max_attempts:
            job.status, job.finished_at = "failed", utcnow()
        else:
            job.status = "queued"
            job.run_after = utcnow() + BACKOFF[min(job.attempts - 1, len(BACKOFF) - 1)]
        logger.warning("job_failed", extra={"job_id": str(job.id), "kind": job.kind, "attempt": job.attempts})
        db.commit()
        return
    job.status, job.finished_at, job.locked_at = "succeeded", utcnow(), None
    job.result = result
    job.last_error = None
    db.commit()


def run_pending(db: Session, budget_seconds: float, kinds: list[str] | None = None) -> list[uuid.UUID]:
    """Run queued jobs until the queue is empty or the time budget is used."""
    deadline = time.monotonic() + budget_seconds
    recover_stale(db)
    ran: list[uuid.UUID] = []
    while time.monotonic() < deadline:
        job = claim_next(db, kinds)
        if job is None:
            break
        run_job(db, job, deadline)
        ran.append(job.id)
    return ran


def recent_jobs(db: Session, limit: int = 20, kind: str | None = None) -> list[BackgroundJob]:
    stmt = select(BackgroundJob).order_by(BackgroundJob.created_at.desc()).limit(limit)
    if kind:
        stmt = stmt.where(or_(BackgroundJob.kind == kind))
    return list(db.scalars(stmt))
