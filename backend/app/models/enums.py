"""Allowed values for status-like columns. Stored as text with CHECK constraints."""

LIFECYCLES = ("idea", "planning", "active", "testing", "deployed", "paused", "archived")
PRIORITIES = ("P1", "P2", "P3", "P4")
TASK_STATUSES = ("backlog", "todo", "in_progress", "blocked", "in_review", "done")
TASK_PRIORITIES = ("low", "medium", "high", "urgent")
SOURCES = ("local", "github")
GITHUB_KINDS = ("issue", "pull_request", "draft")
MILESTONE_STATUSES = ("open", "done")
LINK_KINDS = ("github_repo", "huggingface", "website", "firebase", "docs", "local_path", "other")
EVIDENCE_KINDS = (
    "test_run",
    "ci_run",
    "build",
    "deployment_check",
    "hardware_measurement",
    "calibration",
    "bug",
    "incident",
    "release",
    "note",
)
EVIDENCE_RESULTS = ("pass", "fail", "partial", "info")
# How the record came to exist. Only "automated" and "measured" count as verification.
EVIDENCE_ORIGINS = ("automated", "measured", "reported")
BUSINESS_KINDS = ("cost", "revenue", "funding_need", "investment", "proposal", "opportunity")
BUSINESS_STATUSES = ("estimated", "committed", "actual", "open", "won", "lost")
JOB_STATUSES = ("queued", "running", "succeeded", "failed")
DOC_CATEGORIES = (
    "srs",
    "business_plan",
    "diagram",
    "wiring",
    "install",
    "research",
    "decision",
    "report",
    "other",
)
