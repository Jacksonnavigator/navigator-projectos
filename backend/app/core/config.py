"""Validated application settings, read from environment variables (or a local .env file)."""

from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    environment: Literal["development", "test", "production"] = "development"
    app_name: str = "Navigator ProjectOS"
    # Public base URL of the deployed app, e.g. https://navigator-projectos.onrender.com
    public_base_url: str = "http://localhost:8000"

    database_url: str = "postgresql+psycopg://nav:nav@localhost:5432/navigator"

    # Secrets. In production these MUST be set explicitly (see validate_production).
    session_secret: str = Field(default="dev-only-session-secret-change-me", min_length=16)
    # Fernet key used to encrypt GitHub tokens at rest. Generate with:
    #   python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
    encryption_key: str = ""
    # Shared secret for the scheduled sync workflow (Authorization: Bearer <secret>).
    internal_sync_secret: str = ""

    session_ttl_hours: int = 24 * 14
    # Render terminates TLS in front of the app and sets X-Forwarded-For.
    trust_proxy_headers: bool = True

    # GitHub OAuth App (see docs/DEPLOY_RENDER.md)
    github_client_id: str = ""
    github_client_secret: str = ""
    github_oauth_scopes: str = "read:user repo read:project"
    # Comma-separated numeric GitHub user IDs allowed to sign in.
    allowed_github_user_ids: str = ""
    github_api_url: str = "https://api.github.com"
    github_web_url: str = "https://github.com"

    # Local development login that bypasses GitHub. Never allowed in production.
    dev_login_enabled: bool = False

    # Sync behaviour
    sync_stale_minutes: int = 30
    sync_time_budget_seconds: int = 25

    # Document storage
    storage_backend: Literal["local", "supabase"] = "local"
    local_storage_dir: str = "./.storage"
    supabase_url: str = ""
    supabase_service_key: str = ""
    supabase_bucket: str = "documents"
    max_upload_mb: int = 15

    # Directory with the built frontend (served by FastAPI in production).
    frontend_dist_dir: str = "../frontend/dist"

    @field_validator("database_url")
    @classmethod
    def _database_url_is_postgres(cls, value: str) -> str:
        value = value.strip()
        if not value.startswith(("postgres://", "postgresql://", "postgresql+psycopg://")):
            raise ValueError(
                "DATABASE_URL must be a PostgreSQL connection string starting with postgresql:// "
                "(Supabase: Connect -> Session pooler), not the https:// project URL"
            )
        return value

    @field_validator("allowed_github_user_ids")
    @classmethod
    def _ids_are_numeric(cls, value: str) -> str:
        for part in [p.strip() for p in value.split(",") if p.strip()]:
            if not part.isdigit():
                raise ValueError("ALLOWED_GITHUB_USER_IDS must be comma-separated numeric GitHub user IDs")
        return value

    @model_validator(mode="after")
    def validate_production(self) -> Settings:
        if self.environment == "production":
            problems = []
            if self.dev_login_enabled:
                problems.append("DEV_LOGIN_ENABLED must be false in production")
            if self.session_secret.startswith("dev-only"):
                problems.append("SESSION_SECRET must be set")
            if not self.encryption_key:
                problems.append("ENCRYPTION_KEY must be set")
            if not self.allowed_github_user_ids.strip():
                problems.append("ALLOWED_GITHUB_USER_IDS must list at least one GitHub user ID")
            if not self.public_base_url.startswith("https://"):
                problems.append("PUBLIC_BASE_URL must be https in production")
            if self.storage_backend == "local":
                problems.append("STORAGE_BACKEND must be 'supabase' in production (Render disk is ephemeral)")
            if problems:
                raise ValueError("Invalid production configuration: " + "; ".join(problems))
        return self

    @property
    def allowed_ids(self) -> set[int]:
        return {int(p.strip()) for p in self.allowed_github_user_ids.split(",") if p.strip()}

    @property
    def secure_cookies(self) -> bool:
        return self.public_base_url.startswith("https://")

    @property
    def sqlalchemy_url(self) -> str:
        # Render/Supabase hand out postgres:// or postgresql:// URLs; use the psycopg 3 driver.
        url = self.database_url
        if url.startswith("postgres://"):
            url = "postgresql://" + url[len("postgres://") :]
        if url.startswith("postgresql://"):
            url = "postgresql+psycopg://" + url[len("postgresql://") :]
        return url


@lru_cache
def get_settings() -> Settings:
    return Settings()
