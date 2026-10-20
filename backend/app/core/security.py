"""Token generation, hashing and encryption helpers."""

from __future__ import annotations

import hashlib
import hmac
import secrets

from cryptography.fernet import Fernet, InvalidToken

from app.core.config import get_settings


def new_token(nbytes: int = 32) -> str:
    return secrets.token_urlsafe(nbytes)


def hash_token(token: str) -> str:
    """Hash a session token for storage. Keyed with the session secret so a DB leak alone is not enough."""
    key = get_settings().session_secret.encode()
    return hmac.new(key, token.encode(), hashlib.sha256).hexdigest()


def constant_time_equals(a: str, b: str) -> bool:
    return hmac.compare_digest(a.encode(), b.encode())


class EncryptionUnavailable(RuntimeError):
    pass


def _fernet() -> Fernet:
    key = get_settings().encryption_key
    if not key:
        raise EncryptionUnavailable("ENCRYPTION_KEY is not configured")
    return Fernet(key.encode())


def encrypt_secret(value: str) -> str:
    return _fernet().encrypt(value.encode()).decode()


def decrypt_secret(value: str) -> str:
    try:
        return _fernet().decrypt(value.encode()).decode()
    except InvalidToken as exc:  # wrong key or tampered value
        raise EncryptionUnavailable("Stored secret could not be decrypted with the current ENCRYPTION_KEY") from exc
