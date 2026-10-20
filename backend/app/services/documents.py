"""Documents and knowledge base: metadata in PostgreSQL, file bytes in private storage."""

from __future__ import annotations

import hashlib
import io
import re
import unicodedata
import uuid
import zipfile

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.errors import NotFound, ValidationFailed
from app.models import Document, DocumentVersion, EvidenceRecord, Project
from app.storage import get_storage, new_key

# Allowed types are recognised from the file's content, not its name. HTML/SVG/scripts are refused
# because they could execute in the browser.
INLINE_SAFE = {"application/pdf", "image/png", "image/jpeg", "image/gif", "image/webp"}
OFFICE_TYPES = {
    "word/": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "xl/": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "ppt/": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
}
TEXT_EXTENSIONS = {".txt": "text/plain", ".md": "text/markdown", ".csv": "text/csv", ".json": "application/json",
                   ".ino": "text/plain", ".py": "text/plain", ".c": "text/plain", ".h": "text/plain",
                   ".yaml": "text/plain", ".yml": "text/plain", ".log": "text/plain"}  # fmt: skip


def sniff_content_type(data: bytes, filename: str) -> str:
    if data.startswith(b"%PDF-"):
        return "application/pdf"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if data[:6] in (b"GIF87a", b"GIF89a"):
        return "image/gif"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    if data.startswith(b"PK\x03\x04"):
        try:
            with zipfile.ZipFile(io.BytesIO(data)) as zf:
                names = zf.namelist()
        except zipfile.BadZipFile as exc:
            raise ValidationFailed("The file looks like a damaged archive") from exc
        if "[Content_Types].xml" in names:
            for prefix, ctype in OFFICE_TYPES.items():
                if any(n.startswith(prefix) for n in names):
                    return ctype
        return "application/zip"
    ext = ("." + filename.rsplit(".", 1)[-1].lower()) if "." in filename else ""
    if ext in TEXT_EXTENSIONS and b"\x00" not in data[:8192]:
        try:
            data.decode("utf-8")
        except UnicodeDecodeError as exc:
            raise ValidationFailed("Text files must be UTF-8") from exc
        return TEXT_EXTENSIONS[ext]
    raise ValidationFailed(
        "Unsupported file type. Allowed: PDF, PNG, JPEG, GIF, WebP, Word/Excel/PowerPoint, ZIP, and UTF-8 text files."
    )


def safe_filename(name: str) -> str:
    """Display/download name only — never used as a storage path."""
    name = unicodedata.normalize("NFKC", name).replace("\\", "/").split("/")[-1]
    name = re.sub(r"[\x00-\x1f\x7f\"<>|:*?]", "", name).strip(" .")
    return (name or "file")[:200]


def get_document(db: Session, doc_id: uuid.UUID) -> Document:
    doc = db.get(Document, doc_id)
    if doc is None:
        raise NotFound("Document not found")
    return doc


def _check_project(db: Session, project_id: uuid.UUID | None) -> None:
    if project_id is not None and db.get(Project, project_id) is None:
        raise ValidationFailed("Project does not exist")


def add_version(db: Session, doc: Document, filename: str, data: bytes) -> DocumentVersion:
    limit = get_settings().max_upload_mb * 1024 * 1024
    if not data:
        raise ValidationFailed("The file is empty")
    if len(data) > limit:
        raise ValidationFailed(f"The file is larger than {get_settings().max_upload_mb} MB")
    ctype = sniff_content_type(data, filename)
    key = new_key()
    get_storage().put(key, data, ctype)
    number = (
        db.scalar(select(func.max(DocumentVersion.version_no)).where(DocumentVersion.document_id == doc.id)) or 0
    ) + 1
    version = DocumentVersion(
        document_id=doc.id,
        version_no=number,
        storage_key=key,
        filename=safe_filename(filename),
        content_type=ctype,
        size_bytes=len(data),
        sha256=hashlib.sha256(data).hexdigest(),
    )
    db.add(version)
    try:
        db.commit()
    except Exception:
        db.rollback()
        get_storage().delete(key)  # don't leave orphaned files
        raise
    return version


def delete_document(db: Session, doc_id: uuid.UUID) -> None:
    """Deletes metadata and every stored version. Evidence records keep existing but lose the link."""
    doc = get_document(db, doc_id)
    keys = [v.storage_key for v in doc.versions]
    db.query(EvidenceRecord).filter(EvidenceRecord.document_id == doc.id).update({"document_id": None})
    db.delete(doc)
    db.commit()
    for key in keys:
        get_storage().delete(key)


def search_documents(
    db: Session, q: str | None, project_id: uuid.UUID | None, category: str | None, limit: int, offset: int
) -> tuple[list[Document], int]:
    stmt = select(Document)
    if project_id:
        stmt = stmt.where(Document.project_id == project_id)
    if category:
        stmt = stmt.where(Document.category == category)
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(
            Document.title.ilike(like) | Document.description.ilike(like) | Document.body_markdown.ilike(like)
        )
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    docs = list(db.scalars(stmt.order_by(Document.updated_at.desc()).limit(limit).offset(offset)))
    return docs, total


def create_document(db: Session, **fields: object) -> Document:
    _check_project(db, fields.get("project_id"))  # type: ignore[arg-type]
    doc = Document(**fields)
    db.add(doc)
    db.commit()
    return doc


def update_document(db: Session, doc_id: uuid.UUID, changes: dict[str, object]) -> Document:
    doc = get_document(db, doc_id)
    if "project_id" in changes:
        _check_project(db, changes["project_id"])  # type: ignore[arg-type]
    for key, value in changes.items():
        if key in ("title", "category") and value is None:
            raise ValidationFailed(f"{key} cannot be empty")
        setattr(doc, key, value)
    db.commit()
    return doc
