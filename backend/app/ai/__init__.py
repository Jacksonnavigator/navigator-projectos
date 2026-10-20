"""Provider-agnostic interface for the future AI Project Assistant (Phase 7 — not enabled).

Rules the implementation must keep:
  * The assistant reads only records the signed-in owner can access, through the same services the API uses.
  * Every answer cites the records it used (``Citation``); no citation means no claim.
  * It proposes changes (``ProposedChange``) for the owner to approve; it never writes on its own.
  * No user data leaves the server unless an external provider is explicitly configured.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol


@dataclass
class Citation:
    kind: str  # "project" | "task" | "evidence" | "document"
    id: str
    title: str


@dataclass
class ProposedChange:
    action: str  # e.g. "create_task"
    payload: dict[str, object]
    reason: str


@dataclass
class AssistantAnswer:
    text: str
    citations: list[Citation] = field(default_factory=list)
    proposals: list[ProposedChange] = field(default_factory=list)


class AssistantProvider(Protocol):
    def answer(self, question: str, context: list[Citation], context_text: str) -> AssistantAnswer: ...


class DisabledProvider:
    """Default: AI is off. The core app never depends on an AI provider."""

    def answer(self, question: str, context: list[Citation], context_text: str) -> AssistantAnswer:
        return AssistantAnswer(text="The AI assistant is not enabled.")
