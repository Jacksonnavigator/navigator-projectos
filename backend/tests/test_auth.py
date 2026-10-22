from __future__ import annotations

import httpx
import respx
from sqlalchemy import select

from app.models import AuditEvent, GitHubConnection, User


def test_health_live_and_ready(client):
    assert client.get("/api/v1/health/live").json() == {"status": "ok"}
    ready = client.get("/api/v1/health/ready")
    assert ready.status_code == 200
    assert ready.json()["migration"] == "0001"


def test_security_headers_and_request_id(client):
    res = client.get("/api/v1/health/live", headers={"x-request-id": "abc123"})
    assert res.headers["x-request-id"] == "abc123"
    assert "frame-ancestors 'none'" in res.headers["content-security-policy"]
    assert res.headers["x-content-type-options"] == "nosniff"


def test_protected_routes_require_session(client):
    res = client.get("/api/v1/auth/me")
    assert res.status_code == 401
    body = res.json()["error"]
    assert body["code"] == "unauthorized"
    assert body["request_id"]


def test_unknown_api_route_is_json_404(client):
    res = client.get("/api/v1/does-not-exist")
    assert res.status_code == 404
    assert res.json()["error"]["code"] == "not_found"


def test_csrf_required_for_unsafe_requests(client):
    client.get("/api/v1/auth/config")
    res = client.post("/api/v1/auth/dev-login")
    assert res.status_code == 403
    assert res.json()["error"]["code"] == "csrf_failed"
    res = client.post("/api/v1/auth/dev-login", headers={"x-csrf-token": "wrong"})
    assert res.status_code == 403


def test_dev_login_me_and_logout(api, db):
    me = api.get("/api/v1/auth/me")
    assert me.status_code == 200
    assert me.json()["login"] == "dev-owner"
    assert api.post("/api/v1/auth/logout").status_code == 204
    assert api.get("/api/v1/auth/me").status_code == 401
    actions = db.scalars(select(AuditEvent.action)).all()
    assert "login.dev" in actions and "logout" in actions


def test_update_timezone_validates(api):
    assert api.patch("/api/v1/auth/me", json={"timezone": "Mars/Base"}).status_code == 422
    res = api.patch("/api/v1/auth/me", json={"timezone": "Africa/Dar_es_Salaam"})
    assert res.json()["timezone"] == "Africa/Dar_es_Salaam"


def _start_login(client):
    res = client.get("/api/v1/auth/github/login", follow_redirects=False)
    assert res.status_code == 303
    assert res.headers["location"].startswith("https://github.com/login/oauth/authorize?")
    return client.cookies.get("nav_oauth_state")


@respx.mock
def test_github_callback_allowlisted_user_gets_session(client, db):
    state = _start_login(client)
    respx.post("https://github.com/login/oauth/access_token").mock(
        return_value=httpx.Response(200, json={"access_token": "gho_secret", "scope": "read:user,repo"})
    )
    respx.get("https://api.github.com/user").mock(
        return_value=httpx.Response(200, json={"id": 4242, "login": "jackson", "name": "Jackson", "avatar_url": None})
    )
    res = client.get(f"/api/v1/auth/github/callback?code=abc&state={state}", follow_redirects=False)
    assert res.status_code == 303 and res.headers["location"] == "/"
    assert client.get("/api/v1/auth/me").json()["login"] == "jackson"
    conn = db.scalar(select(GitHubConnection))
    assert conn is not None and "gho_secret" not in conn.access_token_enc  # encrypted at rest


@respx.mock
def test_github_callback_rejects_other_users(client, db):
    state = _start_login(client)
    respx.post("https://github.com/login/oauth/access_token").mock(
        return_value=httpx.Response(200, json={"access_token": "gho_x", "scope": ""})
    )
    respx.get("https://api.github.com/user").mock(
        return_value=httpx.Response(200, json={"id": 999, "login": "stranger"})
    )
    res = client.get(f"/api/v1/auth/github/callback?code=abc&state={state}", follow_redirects=False)
    assert res.status_code == 303
    assert "error=not_allowed" in res.headers["location"] and "github_id=999" in res.headers["location"]
    assert client.get("/api/v1/auth/me").status_code == 401
    assert db.scalar(select(User)) is None
    assert db.scalar(select(GitHubConnection)) is None


def test_github_callback_rejects_bad_state(client):
    _start_login(client)
    res = client.get("/api/v1/auth/github/callback?code=abc&state=forged", follow_redirects=False)
    assert "error=invalid_state" in res.headers["location"]


def test_login_rate_limited(client):
    statuses = [client.get("/api/v1/auth/github/login", follow_redirects=False).status_code for _ in range(35)]
    assert 429 in statuses


def test_production_settings_reject_unsafe_config():
    import pytest
    from pydantic import ValidationError

    from app.core.config import Settings

    with pytest.raises(ValidationError) as exc:
        Settings(environment="production", dev_login_enabled=True, public_base_url="http://x", encryption_key="")
    message = str(exc.value)
    assert "DEV_LOGIN_ENABLED" in message and "ENCRYPTION_KEY" in message and "https" in message


def test_database_url_must_be_postgres():
    import pytest
    from pydantic import ValidationError

    from app.core.config import Settings

    with pytest.raises(ValidationError, match="not the https:// project URL"):
        Settings(database_url="https://abc.supabase.co")
    assert Settings(database_url=" postgresql://u:p@h:5432/db ").sqlalchemy_url.startswith("postgresql+psycopg://")
