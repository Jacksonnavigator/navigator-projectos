"""Data export ("Export everything") and full data deletion.

The JSON export contains every user-owned record but never secrets: GitHub tokens, session hashes and
HTTP caches are excluded. The Excel export uses the same columns as the import, so it round-trips.
"""

from __future__ import annotations

import io
import json
from datetime import date, datetime
from decimal import Decimal
from typing import Any
from uuid import UUID

from openpyxl import Workbook
from sqlalchemy import inspect, select, text
from sqlalchemy.orm import Session

from app.models import (
    ActivityEvent,
    AuditEvent,
    BusinessEntry,
    Document,
    DocumentVersion,
    EvidenceRecord,
    GitHubProjectBoard,
    GitHubRepo,
    Milestone,
    Project,
    ProjectLink,
    ProjectRelation,
    Release,
    Task,
    TaskComment,
    TaskDependency,
)
from app.models.base import utcnow
from app.storage import get_storage

EXPORTED = [
    Project, ProjectLink, ProjectRelation, Milestone, Task, TaskDependency, TaskComment, GitHubRepo,
    GitHubProjectBoard, Release, EvidenceRecord, Document, DocumentVersion, BusinessEntry, ActivityEvent, AuditEvent,
]  # fmt: skip
# Never exported: users' GitHub tokens, sessions, ETag cache, job payloads.


def _jsonable(value: Any) -> Any:
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, (UUID, Decimal)):
        return str(value)
    return value


def export_json(db: Session) -> bytes:
    out: dict[str, Any] = {"exported_at": utcnow().isoformat(), "format": "navigator-projectos/1", "tables": {}}
    for model in EXPORTED:
        cols = [c.key for c in inspect(model).mapper.column_attrs]
        out["tables"][model.__tablename__] = [
            {c: _jsonable(getattr(row, c)) for c in cols} for row in db.scalars(select(model))
        ]
    return json.dumps(out, indent=1).encode()


REGISTER_COLUMNS = [
    ("ID", "register_id"), ("Project", "name"), ("Category", "category"), ("Type", "project_type"),
    ("Status", "reported_status"), ("Status confidence", "status_confidence"), ("Purpose / scope", "purpose"),
    ("Known tech stack", "tech_stack"), ("Repository / URL", "repository_text"),
    ("Known remaining work", "remaining_work"), ("Business potential", "business_potential"),
    ("Suggested next action", "next_action"), ("Evidence / notes", "evidence_notes"),
]  # fmt: skip


def export_register_xlsx(db: Session) -> bytes:
    wb = Workbook()
    ws = wb.active
    assert ws is not None
    ws.title = "Master Register"
    ws.append([h for h, _ in REGISTER_COLUMNS] + ["Lifecycle", "Parent project"])
    projects = list(db.scalars(select(Project).order_by(Project.register_id.asc().nulls_last(), Project.name)))
    names = {p.id: p.name for p in projects}
    for p in projects:
        ws.append(
            [getattr(p, f) for _, f in REGISTER_COLUMNS]
            + [p.lifecycle, names.get(p.parent_id) if p.parent_id else None]
        )
    plan = wb.create_sheet("Priority Plan")
    plan.append(["Rank", "Project", "Suggested priority", "Reason", "First next action"])
    ranked = sorted((p for p in projects if p.priority), key=lambda p: (p.priority_rank or 9999, p.priority or ""))
    for p in ranked:
        label = f"{p.priority} — {p.priority_label}" if p.priority_label else p.priority
        plan.append([p.priority_rank, p.name, label, p.priority_reason, p.next_action])
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def delete_everything(db: Session) -> dict[str, int]:
    """Irreversibly delete all application data and stored files. Users/sessions are removed too."""
    keys = list(db.scalars(select(DocumentVersion.storage_key)))
    tables = [
        r[0]
        for r in db.execute(
            text(
                "SELECT tablename FROM pg_tables WHERE schemaname = current_schema() AND tablename <> 'alembic_version'"
            )
        )
    ]
    db.execute(text("TRUNCATE " + ", ".join(f'"{t}"' for t in tables) + " CASCADE"))
    db.commit()
    failed = 0
    storage = get_storage()
    for key in keys:
        try:
            storage.delete(key)
        except Exception:  # noqa: BLE001 - report, keep going
            failed += 1
    return {"tables_cleared": len(tables), "files_deleted": len(keys) - failed, "files_failed": failed}
