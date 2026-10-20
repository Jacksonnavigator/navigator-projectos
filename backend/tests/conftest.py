"""Test setup: a real PostgreSQL test database, migrated with Alembic, truncated between tests."""

from __future__ import annotations

import os
from collections.abc import Iterator

from cryptography.fernet import Fernet

os.environ.setdefault("DATABASE_URL", "postgresql+psycopg://nav:nav@localhost:5432/navigator_test")
os.environ["ENVIRONMENT"] = "test"
os.environ["ENCRYPTION_KEY"] = Fernet.generate_key().decode()
os.environ["SESSION_SECRET"] = "test-session-secret-0123456789"
os.environ["ALLOWED_GITHUB_USER_IDS"] = "4242"
os.environ["DEV_LOGIN_ENABLED"] = "true"
os.environ["GITHUB_CLIENT_ID"] = "test-client"
os.environ["GITHUB_CLIENT_SECRET"] = "test-secret"
os.environ["INTERNAL_SYNC_SECRET"] = "internal-sync-secret-for-tests"
os.environ["PUBLIC_BASE_URL"] = "http://testserver"
os.environ["FRONTEND_DIST_DIR"] = "/nonexistent-dist"

import pytest  # noqa: E402
from alembic import command  # noqa: E402
from alembic.config import Config  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import text  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402

from app.core.config import get_settings  # noqa: E402
from app.core.db import get_engine, get_sessionmaker  # noqa: E402

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


@pytest.fixture(scope="session", autouse=True)
def migrated_db() -> Iterator[None]:
    get_settings.cache_clear()
    cfg = Config(os.path.join(BACKEND_DIR, "alembic.ini"))
    command.downgrade(cfg, "base")
    command.upgrade(cfg, "head")
    yield


@pytest.fixture(autouse=True)
def clean_tables(migrated_db: None) -> Iterator[None]:
    yield
    engine = get_engine()
    with engine.begin() as conn:
        tables = conn.execute(
            text("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> 'alembic_version'")
        ).scalars()
        conn.execute(text("TRUNCATE " + ", ".join(f'"{t}"' for t in tables) + " CASCADE"))


@pytest.fixture
def db() -> Iterator[Session]:
    session = get_sessionmaker()()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def client() -> Iterator[TestClient]:
    from app.main import create_app

    with TestClient(create_app()) as c:
        yield c


class AuthedClient:
    """TestClient wrapper that signs in via dev-login and sends the CSRF header automatically."""

    def __init__(self, client: TestClient):
        self.c = client
        client.get("/api/v1/auth/config")
        res = client.post("/api/v1/auth/dev-login", headers={"x-csrf-token": client.cookies.get("nav_csrf")})
        assert res.status_code == 200, res.text
        self.csrf = client.cookies.get("nav_csrf")

    def _h(self, kw: dict) -> dict:  # type: ignore[type-arg]
        headers = dict(kw.pop("headers", {}) or {})
        headers.setdefault("x-csrf-token", self.csrf)
        kw["headers"] = headers
        return kw

    def get(self, url: str, **kw):  # type: ignore[no-untyped-def]
        return self.c.get(url, **kw)

    def post(self, url: str, **kw):  # type: ignore[no-untyped-def]
        return self.c.post(url, **self._h(kw))

    def patch(self, url: str, **kw):  # type: ignore[no-untyped-def]
        return self.c.patch(url, **self._h(kw))

    def put(self, url: str, **kw):  # type: ignore[no-untyped-def]
        return self.c.put(url, **self._h(kw))

    def delete(self, url: str, **kw):  # type: ignore[no-untyped-def]
        return self.c.delete(url, **self._h(kw))


@pytest.fixture
def api(client: TestClient) -> AuthedClient:
    return AuthedClient(client)
