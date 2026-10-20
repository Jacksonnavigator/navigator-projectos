"""Request IDs, request logging, security headers, CSRF protection and simple rate limiting."""

from __future__ import annotations

import logging
import secrets
import time
import uuid
from collections import defaultdict, deque

from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.responses import Response
from starlette.types import ASGIApp

from app.core.config import get_settings
from app.core.security import constant_time_equals

logger = logging.getLogger("app.request")

SESSION_COOKIE = "nav_session"
CSRF_COOKIE = "nav_csrf"
CSRF_HEADER = "x-csrf-token"
UNSAFE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}
# Routes that authenticate differently and are exempt from the CSRF cookie check.
CSRF_EXEMPT_PREFIXES = ("/api/v1/internal/",)

CSP = (
    "default-src 'self'; "
    "script-src 'self'; "
    "style-src 'self' 'unsafe-inline'; "
    "img-src 'self' data: https://avatars.githubusercontent.com; "
    "connect-src 'self'; "
    "font-src 'self' data:; "
    "object-src 'none'; "
    "base-uri 'self'; "
    "form-action 'self' https://github.com; "
    "frame-ancestors 'none'"
)


def client_ip(request: Request) -> str:
    if get_settings().trust_proxy_headers:
        forwarded = request.headers.get("x-forwarded-for")
        if forwarded:
            return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def _error(request: Request, status: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(
        {"error": {"code": code, "message": message, "details": None, "request_id": request.state.request_id}},
        status_code=status,
    )


class RequestContextMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        incoming = request.headers.get("x-request-id", "")
        request.state.request_id = incoming if 0 < len(incoming) <= 64 and incoming.isprintable() else uuid.uuid4().hex
        start = time.perf_counter()
        response = await call_next(request)
        duration_ms = round((time.perf_counter() - start) * 1000, 1)
        response.headers["X-Request-ID"] = request.state.request_id
        if request.url.path.startswith("/api/"):
            # Path only: query strings can carry OAuth codes.
            logger.info(
                "request",
                extra={
                    "request_id": request.state.request_id,
                    "method": request.method,
                    "path": request.url.path,
                    "status": response.status_code,
                    "duration_ms": duration_ms,
                },
            )
        return response


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        response = await call_next(request)
        path = request.url.path
        if not path.startswith("/api/docs"):
            response.headers.setdefault("Content-Security-Policy", CSP)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
        response.headers.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
        if get_settings().secure_cookies:
            response.headers.setdefault("Strict-Transport-Security", "max-age=31536000")
        if path.startswith("/api/"):
            response.headers.setdefault("Cache-Control", "no-store")
        return response


class CSRFMiddleware(BaseHTTPMiddleware):
    """Double-submit cookie: unsafe requests must echo the nav_csrf cookie in the X-CSRF-Token header."""

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        path = request.url.path
        if request.method in UNSAFE_METHODS and path.startswith("/api/") and not path.startswith(CSRF_EXEMPT_PREFIXES):
            cookie = request.cookies.get(CSRF_COOKIE, "")
            header = request.headers.get(CSRF_HEADER, "")
            if not cookie or not header or not constant_time_equals(cookie, header):
                return _error(request, 403, "csrf_failed", "Missing or invalid CSRF token. Reload the page and retry.")
        response = await call_next(request)
        # Make sure every browser has a CSRF cookie before its first unsafe request (e.g. dev login).
        if CSRF_COOKIE not in request.cookies and CSRF_COOKIE not in response.headers.get("set-cookie", ""):
            response.set_cookie(
                CSRF_COOKIE,
                secrets.token_urlsafe(16),
                httponly=False,
                secure=get_settings().secure_cookies,
                samesite="lax",
                path="/",
            )
        return response


class RateLimitMiddleware(BaseHTTPMiddleware):
    """In-memory sliding-window limiter for abuse-prone routes.

    The app runs as a single Render instance, so process memory is an acceptable store.
    Limits reset when the instance restarts, which is fine for login throttling.
    """

    RULES: tuple[tuple[str, int, int], ...] = (
        # (path prefix, max requests, window seconds)
        ("/api/v1/auth/github/", 30, 60),
        ("/api/v1/auth/dev-login", 30, 60),
        ("/api/v1/internal/", 20, 60),
        ("/api/v1/import/", 20, 60),
    )

    def __init__(self, app: ASGIApp) -> None:
        super().__init__(app)
        self._hits: dict[tuple[str, str], deque[float]] = defaultdict(deque)

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        path = request.url.path
        for prefix, limit, window in self.RULES:
            if path.startswith(prefix):
                key = (prefix, client_ip(request))
                now = time.monotonic()
                hits = self._hits[key]
                while hits and now - hits[0] > window:
                    hits.popleft()
                if len(hits) >= limit:
                    response = _error(request, 429, "rate_limited", "Too many requests. Wait a minute and retry.")
                    response.headers["Retry-After"] = str(window)
                    return response
                hits.append(now)
                break
        return await call_next(request)
