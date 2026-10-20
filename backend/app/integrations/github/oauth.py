"""GitHub OAuth web flow (sign-in and token for read-only API access)."""

from __future__ import annotations

from dataclasses import dataclass
from urllib.parse import urlencode

import httpx

from app.core.config import get_settings
from app.integrations.github.client import GitHubError


@dataclass
class OAuthToken:
    access_token: str
    scopes: str


@dataclass
class GitHubIdentity:
    id: int
    login: str
    name: str | None
    avatar_url: str | None


def redirect_uri() -> str:
    return get_settings().public_base_url.rstrip("/") + "/api/v1/auth/github/callback"


def authorize_url(state: str) -> str:
    s = get_settings()
    query = urlencode(
        {
            "client_id": s.github_client_id,
            "redirect_uri": redirect_uri(),
            "scope": s.github_oauth_scopes,
            "state": state,
            "allow_signup": "false",
        }
    )
    return f"{s.github_web_url.rstrip('/')}/login/oauth/authorize?{query}"


def exchange_code(code: str, *, transport: httpx.BaseTransport | None = None) -> OAuthToken:
    s = get_settings()
    with httpx.Client(timeout=15.0, transport=transport) as http:
        resp = http.post(
            f"{s.github_web_url.rstrip('/')}/login/oauth/access_token",
            data={
                "client_id": s.github_client_id,
                "client_secret": s.github_client_secret,
                "code": code,
                "redirect_uri": redirect_uri(),
            },
            headers={"Accept": "application/json"},
        )
    if resp.status_code != 200:
        raise GitHubError(f"GitHub token exchange failed ({resp.status_code})", resp.status_code)
    body = resp.json()
    if "access_token" not in body:
        # e.g. {"error": "bad_verification_code"} — never include the code itself in messages.
        raise GitHubError(f"GitHub token exchange failed: {body.get('error', 'unknown_error')}")
    return OAuthToken(access_token=body["access_token"], scopes=body.get("scope", ""))


def fetch_identity(token: str, *, transport: httpx.BaseTransport | None = None) -> GitHubIdentity:
    from app.integrations.github.client import GitHubClient

    with GitHubClient(token, transport=transport) as gh:
        data = gh.get("/user").data
    return GitHubIdentity(
        id=int(data["id"]), login=data["login"], name=data.get("name"), avatar_url=data.get("avatar_url")
    )


def revoke_grant(token: str, *, transport: httpx.BaseTransport | None = None) -> bool:
    """Revoke the OAuth grant on GitHub. Returns False if GitHub could not be reached."""
    s = get_settings()
    try:
        with httpx.Client(timeout=15.0, transport=transport) as http:
            resp = http.request(
                "DELETE",
                f"{s.github_api_url.rstrip('/')}/applications/{s.github_client_id}/grant",
                auth=(s.github_client_id, s.github_client_secret),
                json={"access_token": token},
                headers={"Accept": "application/vnd.github+json"},
            )
        return resp.status_code in (204, 404, 422)
    except httpx.HTTPError:
        return False
