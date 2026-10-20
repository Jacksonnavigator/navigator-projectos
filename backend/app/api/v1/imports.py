from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, File, Form, UploadFile

from app.api.deps import DB, CurrentUser
from app.core.errors import ValidationFailed
from app.services import register_import as svc
from app.services.auth import audit

router = APIRouter(prefix="/import", tags=["import"])


async def _read(upload: UploadFile) -> bytes:
    if not (upload.filename or "").lower().endswith(".xlsx"):
        raise ValidationFailed("Upload the register as an .xlsx file")
    content = await upload.read(svc.MAX_FILE_BYTES + 1)
    if len(content) > svc.MAX_FILE_BYTES:
        raise ValidationFailed("The file is larger than 5 MB")
    return content


@router.post("/register/preview")
async def preview(db: DB, _: CurrentUser, file: UploadFile = File(...)) -> dict[str, Any]:
    parsed = svc.parse_workbook(await _read(file))
    return svc.build_preview(db, parsed)


@router.post("/register/commit")
async def commit(
    db: DB,
    user: CurrentUser,
    file: UploadFile = File(...),
    sha256: str = Form(..., min_length=64, max_length=64),
    suggestions: str = Form(default="[]"),
) -> dict[str, Any]:
    try:
        chosen = json.loads(suggestions)
        if not isinstance(chosen, list) or not all(isinstance(s, dict) for s in chosen):
            raise ValueError
    except ValueError as exc:
        raise ValidationFailed("suggestions must be a JSON list") from exc
    parsed = svc.parse_workbook(await _read(file))
    result = svc.commit_import(db, parsed, sha256, chosen[:500])
    audit(db, "register.imported", user_id=user.id, target=file.filename, details=result)
    db.commit()
    return result
