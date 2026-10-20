from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles

from app.api.v1 import router as v1_router
from app.core.config import get_settings
from app.core.errors import install_error_handlers
from app.core.logging import configure_logging
from app.core.middleware import (
    CSRFMiddleware,
    RateLimitMiddleware,
    RequestContextMiddleware,
    SecurityHeadersMiddleware,
)


def create_app() -> FastAPI:
    settings = get_settings()
    configure_logging()
    docs_enabled = settings.environment != "production"
    app = FastAPI(
        title=settings.app_name,
        version="0.1.0",
        openapi_url="/api/openapi.json" if docs_enabled else None,
        docs_url="/api/docs" if docs_enabled else None,
        redoc_url=None,
    )
    install_error_handlers(app)
    # Order matters: the last added middleware runs first.
    app.add_middleware(CSRFMiddleware)
    app.add_middleware(RateLimitMiddleware)
    app.add_middleware(SecurityHeadersMiddleware)
    app.add_middleware(RequestContextMiddleware)

    app.include_router(v1_router, prefix="/api/v1")

    @app.api_route("/api/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"], include_in_schema=False)
    def api_not_found(request: Request, path: str) -> JSONResponse:
        return JSONResponse(
            {
                "error": {
                    "code": "not_found",
                    "message": "Unknown API route",
                    "details": None,
                    "request_id": request.state.request_id,
                }
            },
            status_code=404,
        )

    _mount_frontend(app, Path(settings.frontend_dist_dir))
    return app


def _mount_frontend(app: FastAPI, dist: Path) -> None:
    """Serve the built React app from the same origin as the API (keeps cookies first-party)."""
    dist = dist if dist.is_absolute() else (Path(__file__).resolve().parent.parent / dist).resolve()
    index = dist / "index.html"
    if (dist / "assets").is_dir():
        app.mount("/assets", StaticFiles(directory=dist / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str) -> Response:
        candidate = (dist / path).resolve()
        # Only serve real files inside dist (no path traversal); everything else gets index.html.
        if path and candidate.is_file() and dist in candidate.parents:
            return FileResponse(candidate)
        if index.is_file():
            return FileResponse(index, headers={"Cache-Control": "no-cache"})
        return JSONResponse({"message": "Frontend not built. Run `npm run build` in frontend/."}, status_code=503)


app = create_app()
