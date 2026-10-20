"""Minimal read-only GitHub API client.

The client deliberately exposes only GET requests and GraphQL *queries*. Even though the OAuth
token may carry broader scopes, this application never writes to GitHub (v1 is read-only).
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

import httpx

from app.core.config import get_settings

API_VERSION = "2022-11-28"
_LINK_NEXT = re.compile(r'<([^>]+)>;\s*rel="next"')
_MUTATION = re.compile(r"^\s*mutation\b", re.IGNORECASE | re.MULTILINE)


class GitHubError(RuntimeError):
    def __init__(self, message: str, status: int | None = None):
        super().__init__(message)
        self.status = status


class GitHubAuthError(GitHubError):
    """Token missing, expired or revoked."""


class GitHubRateLimited(GitHubError):
    def __init__(self, reset_at: datetime | None):
        super().__init__("GitHub API rate limit reached", 429)
        self.reset_at = reset_at


@dataclass
class Response:
    status: int
    data: Any
    etag: str | None
    next_url: str | None


class GitHubClient:
    def __init__(self, token: str, *, transport: httpx.BaseTransport | None = None, timeout: float = 15.0):
        settings = get_settings()
        self.api_url = settings.github_api_url.rstrip("/")
        self._http = httpx.Client(
            base_url=self.api_url,
            headers={
                "Authorization": f"Bearer {token}",
                "Accept": "application/vnd.github+json",
                "X-GitHub-Api-Version": API_VERSION,
                "User-Agent": "navigator-projectos",
            },
            timeout=timeout,
            transport=transport,
        )

    def close(self) -> None:
        self._http.close()

    def __enter__(self) -> GitHubClient:
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()

    def _check(self, resp: httpx.Response) -> None:
        if resp.status_code == 401:
            raise GitHubAuthError("GitHub rejected the token. Sign in with GitHub again.", 401)
        if resp.status_code in (403, 429) and (
            resp.headers.get("x-ratelimit-remaining") == "0" or resp.status_code == 429
        ):
            reset = resp.headers.get("x-ratelimit-reset")
            reset_at = datetime.fromtimestamp(int(reset), UTC) if reset and reset.isdigit() else None
            raise GitHubRateLimited(reset_at)
        if resp.status_code >= 400 and resp.status_code != 304:
            message = ""
            try:
                message = resp.json().get("message", "")
            except ValueError:
                pass
            raise GitHubError(f"GitHub API error {resp.status_code}: {message}".strip(), resp.status_code)

    def get(self, path_or_url: str, *, params: dict[str, Any] | None = None, etag: str | None = None) -> Response:
        headers = {"If-None-Match": etag} if etag else {}
        resp = self._http.get(path_or_url, params=params, headers=headers)
        self._check(resp)
        match = _LINK_NEXT.search(resp.headers.get("link", ""))
        data = None if resp.status_code == 304 else resp.json()
        return Response(resp.status_code, data, resp.headers.get("etag"), match.group(1) if match else None)

    def paginate(self, path: str, *, params: dict[str, Any] | None = None, max_pages: int = 10) -> list[Any]:
        items: list[Any] = []
        url: str | None = path
        query = dict(params or {})
        query.setdefault("per_page", 100)
        pages = 0
        while url and pages < max_pages:
            resp = self.get(url, params=query if pages == 0 else None)
            items.extend(resp.data or [])
            url = resp.next_url
            pages += 1
        return items

    def graphql(self, query: str, variables: dict[str, Any] | None = None) -> dict[str, Any]:
        if _MUTATION.search(query):
            raise GitHubError("Mutations are not allowed: this integration is read-only")
        resp = self._http.post("/graphql", json={"query": query, "variables": variables or {}})
        self._check(resp)
        body = resp.json()
        if body.get("errors"):
            messages = "; ".join(e.get("message", "unknown error") for e in body["errors"])
            raise GitHubError(f"GitHub GraphQL error: {messages}")
        return body.get("data") or {}


def parse_dt(value: str | None) -> datetime | None:
    if not value:
        return None
    return datetime.fromisoformat(value.replace("Z", "+00:00"))
