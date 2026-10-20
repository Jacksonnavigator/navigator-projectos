from __future__ import annotations

import logging
from urllib.parse import urlencode

from fastapi import APIRouter, Request, Response
from fastapi.responses import RedirectResponse
from pydantic import BaseModel

from app.api.deps import DB, CurrentUser
from app.core.config import get_settings
from app.core.errors import AppError, Forbidden, NotFound
from app.core.middleware import CSRF_COOKIE, SESSION_COOKIE, client_ip
from app.core.security import constant_time_equals, new_token
from app.integrations.github import oauth
from app.integrations.github.client import GitHubError
from app.integrations.github.oauth import GitHubIdentity
from app.models import User
from app.schemas.common import UserOut
from app.services import auth as auth_service

router = APIRouter(prefix="/auth", tags=["auth"])
logger = logging.getLogger("app.auth")

STATE_COOKIE = "nav_oauth_state"


def _set_session_cookies(response: Response, token: str) -> None:
    s = get_settings()
    max_age = s.session_ttl_hours * 3600
    response.set_cookie(
        SESSION_COOKIE, token, max_age=max_age, httponly=True, secure=s.secure_cookies, samesite="lax", path="/"
    )
    # Readable by the frontend; echoed back in X-CSRF-Token (double-submit).
    response.set_cookie(
        CSRF_COOKIE, new_token(16), max_age=max_age, httponly=False, secure=s.secure_cookies, samesite="lax", path="/"
    )


def _clear_session_cookies(response: Response) -> None:
    response.delete_cookie(SESSION_COOKIE, path="/")
    response.delete_cookie(CSRF_COOKIE, path="/")


def _login_redirect(error: str, **extra: str) -> RedirectResponse:
    return RedirectResponse("/login?" + urlencode({"error": error, **extra}), status_code=303)


class AuthConfig(BaseModel):
    github_configured: bool
    dev_login_enabled: bool


@router.get("/config", response_model=AuthConfig)
def auth_config() -> AuthConfig:
    s = get_settings()
    return AuthConfig(
        github_configured=bool(s.github_client_id and s.github_client_secret),
        dev_login_enabled=s.dev_login_enabled and s.environment != "production",
    )


@router.get("/github/login")
def github_login() -> RedirectResponse:
    s = get_settings()
    if not (s.github_client_id and s.github_client_secret):
        return _login_redirect("github_not_configured")
    state = new_token(24)
    response = RedirectResponse(oauth.authorize_url(state), status_code=303)
    response.set_cookie(
        STATE_COOKIE, state, max_age=600, httponly=True, secure=s.secure_cookies, samesite="lax", path="/api/v1/auth"
    )
    return response


@router.get("/github/callback")
def github_callback(request: Request, db: DB, code: str = "", state: str = "", error: str = "") -> Response:
    expected = request.cookies.get(STATE_COOKIE, "")
    if error:
        response: Response = _login_redirect("github_denied")
    elif not code or not state or not expected or not constant_time_equals(state, expected):
        response = _login_redirect("invalid_state")
    else:
        response = _complete_login(request, db, code)
    response.delete_cookie(STATE_COOKIE, path="/api/v1/auth")
    return response


def _complete_login(request: Request, db: DB, code: str) -> Response:
    ip = client_ip(request)
    try:
        token = oauth.exchange_code(code)
        identity = oauth.fetch_identity(token.access_token)
    except GitHubError as exc:
        logger.warning("github_login_failed", extra={"reason": str(exc)})
        return _login_redirect("github_error")
    try:
        auth_service.ensure_allowed(identity)
    except Forbidden:
        auth_service.audit(db, "login.rejected", ip=ip, details={"github_id": identity.id, "login": identity.login})
        db.commit()
        return _login_redirect("not_allowed", github_id=str(identity.id), login=identity.login)
    user = auth_service.upsert_github_user(db, identity)
    auth_service.store_github_token(db, user, token.access_token, token.scopes)
    session_token = auth_service.create_session(db, user, request.headers.get("user-agent"))
    auth_service.audit(db, "login.success", user_id=user.id, ip=ip, details={"scopes": token.scopes})
    db.commit()
    response = RedirectResponse("/", status_code=303)
    _set_session_cookies(response, session_token)
    return response


@router.post("/dev-login", response_model=UserOut)
def dev_login(request: Request, response: Response, db: DB) -> User:
    """Local development only: sign in as a fake allowlisted user without GitHub."""
    s = get_settings()
    if not s.dev_login_enabled or s.environment == "production":
        raise NotFound("Not found")
    allowed = sorted(s.allowed_ids)
    identity = GitHubIdentity(id=allowed[0] if allowed else 1, login="dev-owner", name="Dev Owner", avatar_url=None)
    user = auth_service.upsert_github_user(db, identity)
    token = auth_service.create_session(db, user, request.headers.get("user-agent"))
    auth_service.audit(db, "login.dev", user_id=user.id, ip=client_ip(request))
    db.commit()
    _set_session_cookies(response, token)
    return user


@router.post("/logout", status_code=204)
def logout(request: Request, db: DB) -> Response:
    token = request.cookies.get(SESSION_COOKIE, "")
    if token:
        auth_service.revoke_session(db, token)
        auth_service.audit(db, "logout", ip=client_ip(request))
        db.commit()
    response = Response(status_code=204)
    _clear_session_cookies(response)
    return response


@router.get("/me", response_model=UserOut)
def me(user: CurrentUser) -> User:
    return user


class ProfileUpdate(BaseModel):
    timezone: str


@router.patch("/me", response_model=UserOut)
def update_me(body: ProfileUpdate, user: CurrentUser, db: DB) -> User:
    from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

    try:
        ZoneInfo(body.timezone)
    except (ZoneInfoNotFoundError, ValueError) as exc:
        raise AppError("Unknown timezone", code="invalid_timezone", status_code=422) from exc
    user.timezone = body.timezone
    db.commit()
    return user
