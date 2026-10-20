"""Private file storage behind a small interface.

* LocalStorage   — development/tests only (Render's disk is wiped on every restart).
* SupabaseStorage — production: a PRIVATE Supabase Storage bucket, accessed only from the server
  with the service key. The browser never receives the key or a public URL; downloads stream
  through the API after the session is checked.

Keys are random (uuid4 hex), never derived from user-supplied filenames, so there is no path traversal.
"""

from __future__ import annotations

import re
import uuid
from pathlib import Path
from typing import Protocol

import httpx

from app.core.config import get_settings


class StorageError(RuntimeError):
    pass


class Storage(Protocol):
    def put(self, key: str, data: bytes, content_type: str) -> None: ...
    def get(self, key: str) -> bytes: ...
    def delete(self, key: str) -> None: ...


_KEY_RE = re.compile(r"^[0-9a-f]{32}$")


def new_key() -> str:
    return uuid.uuid4().hex


def _check_key(key: str) -> str:
    if not _KEY_RE.match(key):
        raise StorageError("Invalid storage key")
    return key


class LocalStorage:
    def __init__(self, root: str):
        self.root = Path(root).resolve()
        self.root.mkdir(parents=True, exist_ok=True)

    def _path(self, key: str) -> Path:
        return self.root / _check_key(key)

    def put(self, key: str, data: bytes, content_type: str) -> None:
        self._path(key).write_bytes(data)

    def get(self, key: str) -> bytes:
        path = self._path(key)
        if not path.is_file():
            raise StorageError("File not found in storage")
        return path.read_bytes()

    def delete(self, key: str) -> None:
        self._path(key).unlink(missing_ok=True)


class SupabaseStorage:
    def __init__(self, url: str, service_key: str, bucket: str, transport: httpx.BaseTransport | None = None):
        if not url or not service_key:
            raise StorageError("SUPABASE_URL and SUPABASE_SERVICE_KEY must be set for Supabase storage")
        self.base = url.rstrip("/") + "/storage/v1"
        self.bucket = bucket
        # New-style secret keys (sb_secret_...) are not JWTs and must only be sent in the apikey header.
        # Legacy service_role keys are JWTs and are also sent as a Bearer token.
        headers = {"apikey": service_key}
        if not service_key.startswith("sb_"):
            headers["Authorization"] = f"Bearer {service_key}"
        self._http = httpx.Client(timeout=60.0, headers=headers, transport=transport)

    def put(self, key: str, data: bytes, content_type: str) -> None:
        resp = self._http.post(
            f"{self.base}/object/{self.bucket}/{_check_key(key)}",
            content=data,
            headers={"Content-Type": content_type, "x-upsert": "false"},
        )
        if resp.status_code >= 300:
            raise StorageError(f"Upload to storage failed ({resp.status_code})")

    def get(self, key: str) -> bytes:
        resp = self._http.get(f"{self.base}/object/{self.bucket}/{_check_key(key)}")
        if resp.status_code != 200:
            raise StorageError(f"Download from storage failed ({resp.status_code})")
        return resp.content

    def delete(self, key: str) -> None:
        resp = self._http.request("DELETE", f"{self.base}/object/{self.bucket}", json={"prefixes": [_check_key(key)]})
        if resp.status_code >= 300:
            raise StorageError(f"Delete from storage failed ({resp.status_code})")  # noqa: S608


_storage: Storage | None = None


def get_storage() -> Storage:
    global _storage
    if _storage is None:
        s = get_settings()
        if s.storage_backend == "supabase":
            _storage = SupabaseStorage(s.supabase_url, s.supabase_service_key, s.supabase_bucket)
        else:
            _storage = LocalStorage(s.local_storage_dir)
    return _storage


def set_storage(storage: Storage | None) -> None:
    """Used by tests."""
    global _storage
    _storage = storage
