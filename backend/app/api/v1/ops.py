"""Health & evidence, documents, business tracking, export and account deletion."""

from __future__ import annotations

import uuid
from collections import defaultdict
from datetime import timedelta
from decimal import Decimal
from typing import Any, Literal
from urllib.parse import quote

from fastapi import APIRouter, File, Form, Query, Request, Response, UploadFile
from pydantic import BaseModel
from pydantic import ValidationError as PydanticValidationError
from sqlalchemy import func, select

from app.api.deps import DB, CurrentUser
from app.core.errors import NotFound, ValidationFailed
from app.core.middleware import SESSION_COOKIE, client_ip
from app.models import BusinessEntry, Document, DocumentVersion, EvidenceRecord, Project
from app.models.base import utcnow
from app.schemas.common import Page
from app.schemas.ops import (
    BusinessCreate,
    BusinessOut,
    BusinessUpdate,
    DocumentCreate,
    DocumentOut,
    DocumentUpdate,
    EvidenceCreate,
    EvidenceOut,
    VersionOut,
)
from app.services import documents as docs
from app.services import export as export_svc
from app.services.auth import audit
from app.services.projects import get_project, record_activity
from app.storage import StorageError, get_storage

router = APIRouter(tags=["operations"])

STALE_DAYS = 30


def _names(db: DB, ids: set[uuid.UUID | None]) -> dict[uuid.UUID, str]:
    ids = {i for i in ids if i}
    if not ids:
        return {}
    return dict(db.execute(select(Project.id, Project.name).where(Project.id.in_(ids))).all())  # type: ignore[arg-type]


# --------------------------------------------------------------------- evidence


@router.get("/evidence", response_model=Page[EvidenceOut])
def list_evidence(
    db: DB,
    _: CurrentUser,
    project_id: uuid.UUID | None = None,
    kind: str | None = None,
    origin: str | None = None,
    result: str | None = None,
    limit: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
) -> dict[str, Any]:
    stmt = select(EvidenceRecord)
    if project_id:
        stmt = stmt.where(EvidenceRecord.project_id == project_id)
    if kind:
        stmt = stmt.where(EvidenceRecord.kind == kind)
    if origin:
        stmt = stmt.where(EvidenceRecord.origin == origin)
    if result:
        stmt = stmt.where(EvidenceRecord.result == result)
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    items = list(db.scalars(stmt.order_by(EvidenceRecord.observed_at.desc()).limit(limit).offset(offset)))
    return {"items": items, "total": total, "limit": limit, "offset": offset}


@router.post("/evidence", response_model=EvidenceOut, status_code=201)
def create_evidence(body: EvidenceCreate, db: DB, _: CurrentUser) -> Any:
    project = get_project(db, body.project_id)
    if body.document_id and db.get(Document, body.document_id) is None:
        raise ValidationFailed("Attached document does not exist")
    if body.observed_at > utcnow() + timedelta(minutes=5):
        raise ValidationFailed("Observed time cannot be in the future")
    record = EvidenceRecord(**body.model_dump(), source="manual")
    db.add(record)
    record_activity(
        db,
        "evidence.added",
        f"{body.kind.replace('_', ' ')} recorded for {project.name}: {body.title}",
        project_id=project.id,
    )
    db.commit()
    return record


@router.delete("/evidence/{evidence_id}", status_code=204)
def delete_evidence(evidence_id: uuid.UUID, db: DB, _: CurrentUser) -> Response:
    record = db.get(EvidenceRecord, evidence_id)
    if record is None:
        raise NotFound("Evidence record not found")
    if record.source != "manual":
        raise ValidationFailed("Automated records come from integrations and can't be deleted here")
    db.delete(record)
    db.commit()
    return Response(status_code=204)


@router.get("/health-overview")
def health_overview(db: DB, _: CurrentUser) -> list[dict[str, Any]]:
    """Per project: what is *reported* vs what is *verified* by evidence."""
    projects = list(db.scalars(select(Project).where(Project.archived_at.is_(None)).order_by(Project.name)))
    rows = db.execute(
        select(
            EvidenceRecord.project_id,
            EvidenceRecord.origin,
            func.count(),
            func.max(EvidenceRecord.observed_at),
            func.count().filter(EvidenceRecord.result == "fail"),
        ).group_by(EvidenceRecord.project_id, EvidenceRecord.origin)
    ).all()
    agg: dict[uuid.UUID, dict[str, Any]] = defaultdict(dict)
    for pid, origin, count, last, fails in rows:
        if pid:
            agg[pid][origin] = {"count": count, "last": last, "fails": fails}
    latest: dict[uuid.UUID, EvidenceRecord] = {}
    for rec in db.scalars(
        select(EvidenceRecord)
        .where(EvidenceRecord.origin.in_(["automated", "measured"]))
        .order_by(EvidenceRecord.observed_at.desc())
        .limit(2000)
    ):
        if rec.project_id and rec.project_id not in latest:
            latest[rec.project_id] = rec
    cutoff = utcnow() - timedelta(days=STALE_DAYS)
    out = []
    for p in projects:
        a = agg.get(p.id, {})
        verified_last = max((a[o]["last"] for o in ("automated", "measured") if o in a), default=None)
        last_rec = latest.get(p.id)
        out.append(
            {
                "project_id": p.id,
                "name": p.name,
                "lifecycle": p.lifecycle,
                "reported_status": p.reported_status,
                "status_confidence": p.status_confidence,
                "evidence_notes": p.evidence_notes,
                "verified_count": sum(a[o]["count"] for o in ("automated", "measured") if o in a),
                "reported_count": a.get("reported", {}).get("count", 0),
                "last_verified_at": verified_last,
                "last_result": last_rec.result if last_rec else None,
                "last_title": last_rec.title if last_rec else None,
                "stale": p.lifecycle in ("active", "testing", "deployed")
                and (verified_last is None or verified_last < cutoff),
            }
        )
    return out


# -------------------------------------------------------------------- documents


def _doc_out(db: DB, doc: Document) -> dict[str, Any]:
    names = _names(db, {doc.project_id})
    return {
        **{
            c: getattr(doc, c)
            for c in (
                "id",
                "project_id",
                "title",
                "category",
                "description",
                "body_markdown",
                "created_at",
                "updated_at",
            )
        },
        "project_name": names.get(doc.project_id) if doc.project_id else None,
        "versions": doc.versions,
    }


@router.get("/documents", response_model=Page[DocumentOut])
def list_documents(
    db: DB,
    _: CurrentUser,
    q: str | None = Query(default=None, max_length=200),
    project_id: uuid.UUID | None = None,
    category: str | None = None,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> dict[str, Any]:
    items, total = docs.search_documents(db, q, project_id, category, limit, offset)
    return {"items": [_doc_out(db, d) for d in items], "total": total, "limit": limit, "offset": offset}


@router.post("/documents", response_model=DocumentOut, status_code=201)
def create_document(body: DocumentCreate, db: DB, _: CurrentUser) -> dict[str, Any]:
    return _doc_out(db, docs.create_document(db, **body.model_dump()))


@router.get("/documents/{doc_id}", response_model=DocumentOut)
def get_document(doc_id: uuid.UUID, db: DB, _: CurrentUser) -> dict[str, Any]:
    return _doc_out(db, docs.get_document(db, doc_id))


@router.patch("/documents/{doc_id}", response_model=DocumentOut)
def update_document(doc_id: uuid.UUID, body: DocumentUpdate, db: DB, _: CurrentUser) -> dict[str, Any]:
    return _doc_out(db, docs.update_document(db, doc_id, body.model_dump(exclude_unset=True)))


@router.delete("/documents/{doc_id}", status_code=204)
def delete_document(doc_id: uuid.UUID, db: DB, user: CurrentUser) -> Response:
    doc = docs.get_document(db, doc_id)
    audit(db, "document.deleted", user_id=user.id, target=doc.title)
    docs.delete_document(db, doc_id)
    return Response(status_code=204)


@router.post("/documents/{doc_id}/versions", response_model=VersionOut, status_code=201)
async def upload_version(doc_id: uuid.UUID, db: DB, _: CurrentUser, file: UploadFile = File(...)) -> Any:
    doc = docs.get_document(db, doc_id)
    from app.core.config import get_settings

    data = await file.read(get_settings().max_upload_mb * 1024 * 1024 + 1)
    try:
        return docs.add_version(db, doc, file.filename or "file", data)
    except StorageError as exc:
        raise ValidationFailed(f"Storage is unavailable: {exc}", code="storage_error", status_code=503) from exc


@router.post("/documents/upload", response_model=DocumentOut, status_code=201)
async def upload_new_document(
    db: DB,
    _: CurrentUser,
    file: UploadFile = File(...),
    title: str = Form(default="", max_length=300),
    project_id: uuid.UUID | None = Form(default=None),
    category: str = Form(default="other"),
) -> dict[str, Any]:
    """Create a document and its first version in one step."""
    try:
        body = DocumentCreate.model_validate(
            {
                "project_id": project_id,
                "title": title or docs.safe_filename(file.filename or "file"),
                "category": category,
            }
        )
    except PydanticValidationError as exc:
        raise ValidationFailed("Invalid document details", details=exc.errors(include_url=False)) from exc
    from app.core.config import get_settings

    data = await file.read(get_settings().max_upload_mb * 1024 * 1024 + 1)
    # Validate before creating the document so a rejected file leaves nothing behind.
    docs.sniff_content_type(data, file.filename or "") if data else None
    doc = docs.create_document(db, **body.model_dump())
    try:
        docs.add_version(db, doc, file.filename or "file", data)
    except Exception:
        db.delete(doc)
        db.commit()
        raise
    db.refresh(doc)
    return _doc_out(db, doc)


@router.get("/documents/{doc_id}/versions/{version_id}/download")
def download_version(
    doc_id: uuid.UUID, version_id: uuid.UUID, db: DB, _: CurrentUser, inline: bool = False
) -> Response:
    version = db.get(DocumentVersion, version_id)
    if version is None or version.document_id != doc_id:
        raise NotFound("File not found")
    try:
        data = get_storage().get(version.storage_key)
    except StorageError as exc:
        raise NotFound("The stored file is missing") from exc
    disposition = "inline" if inline and version.content_type in docs.INLINE_SAFE else "attachment"
    ascii_name = version.filename.encode("ascii", "ignore").decode().replace('"', "") or "file"
    utf8_name = quote(version.filename)
    return Response(
        content=data,
        media_type=version.content_type,
        headers={
            "Content-Disposition": f"{disposition}; filename=\"{ascii_name}\"; filename*=UTF-8''{utf8_name}",
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": "sandbox; default-src 'none'; img-src 'self'; style-src 'unsafe-inline'",
            "Cache-Control": "private, no-store",
        },
    )


# --------------------------------------------------------------------- business


def _biz_out(db: DB, items: list[BusinessEntry]) -> list[dict[str, Any]]:
    names = _names(db, {i.project_id for i in items})
    return [
        {
            **{
                c: getattr(i, c)
                for c in (
                    "id",
                    "project_id",
                    "kind",
                    "title",
                    "amount",
                    "currency",
                    "status",
                    "counterparty",
                    "entry_date",
                    "notes",
                    "created_at",
                )
            },
            "project_name": names.get(i.project_id),
        }
        for i in items
    ]


@router.get("/business", response_model=list[BusinessOut])
def list_business(
    db: DB, _: CurrentUser, project_id: uuid.UUID | None = None, kind: str | None = None
) -> list[dict[str, Any]]:
    stmt = select(BusinessEntry)
    if project_id:
        stmt = stmt.where(BusinessEntry.project_id == project_id)
    if kind:
        stmt = stmt.where(BusinessEntry.kind == kind)
    return _biz_out(db, list(db.scalars(stmt.order_by(BusinessEntry.entry_date.desc().nulls_last()).limit(1000))))


@router.post("/business", response_model=BusinessOut, status_code=201)
def create_business(body: BusinessCreate, db: DB, _: CurrentUser) -> dict[str, Any]:
    get_project(db, body.project_id)
    entry = BusinessEntry(**body.model_dump())
    db.add(entry)
    db.commit()
    return _biz_out(db, [entry])[0]


@router.patch("/business/{entry_id}", response_model=BusinessOut)
def update_business(entry_id: uuid.UUID, body: BusinessUpdate, db: DB, _: CurrentUser) -> dict[str, Any]:
    entry = db.get(BusinessEntry, entry_id)
    if entry is None:
        raise NotFound("Entry not found")
    for key, value in body.model_dump(exclude_unset=True).items():
        if key in ("kind", "title", "currency", "status") and value is None:
            raise ValidationFailed(f"{key} cannot be empty")
        setattr(entry, key, value)
    db.commit()
    return _biz_out(db, [entry])[0]


@router.delete("/business/{entry_id}", status_code=204)
def delete_business(entry_id: uuid.UUID, db: DB, _: CurrentUser) -> Response:
    entry = db.get(BusinessEntry, entry_id)
    if entry is None:
        raise NotFound("Entry not found")
    db.delete(entry)
    db.commit()
    return Response(status_code=204)


@router.get("/business/summary")
def business_summary(db: DB, _: CurrentUser, project_id: uuid.UUID | None = None) -> list[dict[str, Any]]:
    """Totals per project, currency, kind and status. Currencies are never added together."""
    stmt = select(
        BusinessEntry.project_id, BusinessEntry.currency, BusinessEntry.kind, BusinessEntry.status,
        func.coalesce(func.sum(BusinessEntry.amount), 0), func.count(),
    ).group_by(BusinessEntry.project_id, BusinessEntry.currency, BusinessEntry.kind, BusinessEntry.status)  # fmt: skip
    if project_id:
        stmt = stmt.where(BusinessEntry.project_id == project_id)
    rows = db.execute(stmt).all()
    names = _names(db, {r[0] for r in rows})
    return [
        {
            "project_id": pid,
            "project_name": names.get(pid),
            "currency": cur,
            "kind": kind,
            "status": status,
            "total": Decimal(total or 0),
            "count": count,
        }
        for pid, cur, kind, status, total, count in rows
    ]


# ------------------------------------------------------------ export / deletion


@router.get("/export/json")
def export_json(db: DB, user: CurrentUser) -> Response:
    audit(db, "export.json", user_id=user.id)
    db.commit()
    stamp = utcnow().strftime("%Y%m%d-%H%M")
    return Response(
        content=export_svc.export_json(db),
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="projectos-export-{stamp}.json"'},
    )


@router.get("/export/register.xlsx")
def export_register(db: DB, _: CurrentUser) -> Response:
    stamp = utcnow().strftime("%Y%m%d")
    return Response(
        content=export_svc.export_register_xlsx(db),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="project-register-{stamp}.xlsx"'},
    )


class DeleteAll(BaseModel):
    confirm: Literal["DELETE EVERYTHING"]


@router.post("/account/delete-all")
def delete_all(body: DeleteAll, request: Request, db: DB, user: CurrentUser) -> Response:
    from app.integrations.github import oauth
    from app.services.auth import get_github_token

    token = get_github_token(db, user.id)
    if token:
        oauth.revoke_grant(token)
    result = export_svc.delete_everything(db)
    response = Response(content=str(result), media_type="text/plain")
    response.delete_cookie(SESSION_COOKIE, path="/")
    audit(db, "account.deleted_all", ip=client_ip(request), details=result)
    db.commit()
    return response
