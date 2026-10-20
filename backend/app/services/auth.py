from __future__ import annotations

from datetime import timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.errors import Forbidden
from app.core.security import decrypt_secret, encrypt_secret, hash_token, new_token
from app.integrations.github.oauth import GitHubIdentity
from app.models import AuditEvent, GitHubConnection, User, UserSession
from app.models.base import utcnow

# Refresh last_seen_at at most this often, to avoid a DB write on every request.
_TOUCH_INTERVAL = timedelta(minutes=5)


def audit(
    db: Session,
    action: str,
    *,
    user_id: Any = None,
    target: str | None = None,
    ip: str | None = None,
    details: dict[str, Any] | None = None,
) -> None:
    db.add(AuditEvent(action=action, user_id=user_id, target=target, ip=ip, details=details))


def ensure_allowed(identity: GitHubIdentity) -> None:
    allowed = get_settings().allowed_ids
    if identity.id not in allowed:
        raise Forbidden(
            f"GitHub account '{identity.login}' (id {identity.id}) is not allowed to use this app. "
            "Add this id to ALLOWED_GITHUB_USER_IDS if it is yours.",
            code="github_user_not_allowed",
            details={"github_id": identity.id, "login": identity.login},
        )


def upsert_github_user(db: Session, identity: GitHubIdentity) -> User:
    user = db.scalar(select(User).where(User.github_id == identity.id))
    if user is None:
        user = User(github_id=identity.id, login=identity.login)
        db.add(user)
    user.login = identity.login
    user.name = identity.name
    user.avatar_url = identity.avatar_url
    user.last_login_at = utcnow()
    db.flush()
    return user


def store_github_token(db: Session, user: User, access_token: str, scopes: str) -> None:
    conn = db.scalar(select(GitHubConnection).where(GitHubConnection.user_id == user.id))
    if conn is None:
        conn = GitHubConnection(user_id=user.id, access_token_enc="", scopes="")
        db.add(conn)
    conn.access_token_enc = encrypt_secret(access_token)
    conn.scopes = scopes


def get_github_token(db: Session, user_id: Any) -> str | None:
    conn = db.scalar(select(GitHubConnection).where(GitHubConnection.user_id == user_id))
    return decrypt_secret(conn.access_token_enc) if conn else None


def any_github_token(db: Session) -> str | None:
    """Token used by scheduled sync (single-owner app: the most recently updated connection)."""
    conn = db.scalar(select(GitHubConnection).order_by(GitHubConnection.updated_at.desc()).limit(1))
    return decrypt_secret(conn.access_token_enc) if conn else None


def create_session(db: Session, user: User, user_agent: str | None) -> str:
    token = new_token()
    db.add(
        UserSession(
            user_id=user.id,
            token_hash=hash_token(token),
            expires_at=utcnow() + timedelta(hours=get_settings().session_ttl_hours),
            user_agent=(user_agent or "")[:300] or None,
        )
    )
    return token


def resolve_session(db: Session, token: str) -> UserSession | None:
    if not token:
        return None
    session = db.scalar(select(UserSession).where(UserSession.token_hash == hash_token(token)))
    now = utcnow()
    if session is None or session.revoked_at is not None or session.expires_at <= now:
        return None
    if now - session.last_seen_at > _TOUCH_INTERVAL:
        session.last_seen_at = now
        db.commit()
    return session


def revoke_session(db: Session, token: str) -> None:
    session = db.scalar(select(UserSession).where(UserSession.token_hash == hash_token(token)))
    if session and session.revoked_at is None:
        session.revoked_at = utcnow()
