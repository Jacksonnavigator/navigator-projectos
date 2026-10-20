from __future__ import annotations

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from sqlalchemy import text

from app.api.deps import DB

router = APIRouter(prefix="/health", tags=["health"])


@router.get("/live")
def live() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/ready")
def ready(db: DB) -> JSONResponse:
    try:
        db.execute(text("SELECT 1"))
        version = db.execute(text("SELECT version_num FROM alembic_version")).scalar()
    except Exception:  # noqa: BLE001 - report not-ready rather than crash
        return JSONResponse({"status": "unavailable", "database": "unreachable"}, status_code=503)
    return JSONResponse({"status": "ok", "database": "ok", "migration": version})
