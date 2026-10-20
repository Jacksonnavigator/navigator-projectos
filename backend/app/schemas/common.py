from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict


class ORM(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class Page[T](BaseModel):
    items: list[T]
    total: int
    limit: int
    offset: int


class UserOut(ORM):
    id: uuid.UUID
    github_id: int | None
    login: str
    name: str | None
    avatar_url: str | None
    timezone: str
    last_login_at: datetime | None
