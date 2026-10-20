from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field, field_validator

from app.schemas.common import ORM

EvidenceKind = Literal[
    "test_run", "ci_run", "build", "deployment_check", "hardware_measurement", "calibration", "bug", "incident",
    "release", "note",
]  # fmt: skip
EvidenceResult = Literal["pass", "fail", "partial", "info"]


class EvidenceCreate(BaseModel):
    project_id: uuid.UUID
    kind: EvidenceKind
    title: str = Field(min_length=1, max_length=300)
    result: EvidenceResult
    # Manual entries are either physical measurements or reported claims; "automated" is reserved for integrations.
    origin: Literal["measured", "reported"] = "reported"
    observed_at: datetime
    measured_value: Decimal | None = Field(default=None, max_digits=18, decimal_places=6)
    reference_value: Decimal | None = Field(default=None, max_digits=18, decimal_places=6)
    unit: str | None = Field(default=None, max_length=30)
    url: str | None = Field(default=None, max_length=500)
    notes: str | None = Field(default=None, max_length=20000)
    document_id: uuid.UUID | None = None

    @field_validator("url")
    @classmethod
    def _url(cls, v: str | None) -> str | None:
        if v and not v.startswith(("http://", "https://")):
            raise ValueError("URL must start with http:// or https://")
        return v


class EvidenceOut(ORM):
    id: uuid.UUID
    project_id: uuid.UUID | None
    kind: str
    title: str
    result: str
    origin: str
    source: str
    observed_at: datetime
    measured_value: Decimal | None
    reference_value: Decimal | None
    unit: str | None
    url: str | None
    notes: str | None
    document_id: uuid.UUID | None
    created_at: datetime


DocCategory = Literal["srs", "business_plan", "diagram", "wiring", "install", "research", "decision", "report", "other"]


class DocumentCreate(BaseModel):
    project_id: uuid.UUID | None = None
    title: str = Field(min_length=1, max_length=300)
    category: DocCategory = "other"
    description: str | None = Field(default=None, max_length=5000)
    body_markdown: str | None = Field(default=None, max_length=200_000)


class DocumentUpdate(BaseModel):
    project_id: uuid.UUID | None = None
    title: str | None = Field(default=None, min_length=1, max_length=300)
    category: DocCategory | None = None
    description: str | None = Field(default=None, max_length=5000)
    body_markdown: str | None = Field(default=None, max_length=200_000)


class VersionOut(ORM):
    id: uuid.UUID
    version_no: int
    filename: str
    content_type: str
    size_bytes: int
    sha256: str
    uploaded_at: datetime


class DocumentOut(ORM):
    id: uuid.UUID
    project_id: uuid.UUID | None
    project_name: str | None = None
    title: str
    category: str
    description: str | None
    body_markdown: str | None
    created_at: datetime
    updated_at: datetime
    versions: list[VersionOut] = []


BusinessKind = Literal["cost", "revenue", "funding_need", "investment", "proposal", "opportunity"]
BusinessStatus = Literal["estimated", "committed", "actual", "open", "won", "lost"]


class BusinessCreate(BaseModel):
    project_id: uuid.UUID
    kind: BusinessKind
    title: str = Field(min_length=1, max_length=300)
    amount: Decimal | None = Field(default=None, ge=0, max_digits=16, decimal_places=2)
    currency: str = Field(default="TZS", pattern=r"^[A-Z]{3}$")
    status: BusinessStatus = "estimated"
    counterparty: str | None = Field(default=None, max_length=200)
    entry_date: date | None = None
    notes: str | None = Field(default=None, max_length=20000)


class BusinessUpdate(BaseModel):
    kind: BusinessKind | None = None
    title: str | None = Field(default=None, min_length=1, max_length=300)
    amount: Decimal | None = Field(default=None, ge=0, max_digits=16, decimal_places=2)
    currency: str | None = Field(default=None, pattern=r"^[A-Z]{3}$")
    status: BusinessStatus | None = None
    counterparty: str | None = Field(default=None, max_length=200)
    entry_date: date | None = None
    notes: str | None = Field(default=None, max_length=20000)


class BusinessOut(ORM):
    id: uuid.UUID
    project_id: uuid.UUID
    project_name: str | None = None
    kind: str
    title: str
    amount: Decimal | None
    currency: str
    status: str
    counterparty: str | None
    entry_date: date | None
    notes: str | None
    created_at: datetime
