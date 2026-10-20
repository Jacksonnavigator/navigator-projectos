from __future__ import annotations

from typing import Annotated

from fastapi import Depends, Request
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.errors import Unauthorized
from app.core.middleware import SESSION_COOKIE
from app.models import User
from app.services.auth import resolve_session

DB = Annotated[Session, Depends(get_db)]


def current_user(request: Request, db: DB) -> User:
    session = resolve_session(db, request.cookies.get(SESSION_COOKIE, ""))
    if session is None:
        raise Unauthorized("Sign in to continue.")
    return session.user


CurrentUser = Annotated[User, Depends(current_user)]
