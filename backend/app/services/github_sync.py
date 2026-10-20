"""Read-only GitHub -> ProjectOS sync.

Everything is an upsert keyed by GitHub IDs, so a sync can be interrupted (the free Render instance
may sleep) and re-run safely. Issues/PRs are fetched incrementally with `since=` and a saved cursor.
"""

from __future__ import annotations

import logging
import re
import time
import uuid
from datetime import date, datetime
from typing import Any

from sqlalchemy import select, true, update
from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.integrations.github.client import GitHubAuthError, GitHubClient, GitHubError, GitHubRateLimited, parse_dt
from app.models import (
    EvidenceRecord,
    GitHubEtag,
    GitHubProjectBoard,
    GitHubRepo,
    Milestone,
    Project,
    ProjectLink,
    Release,
    Task,
)
from app.models.base import utcnow
from app.services import jobs
from app.services.auth import any_github_token
from app.services.projects import record_activity

logger = logging.getLogger("app.github_sync")

MAX_ISSUE_PAGES_PER_RUN = 5
MAX_BOARD_PAGES_PER_RUN = 5
SYNC_ALL_KEY = "github_sync_all"


class NoGitHubConnection(AppError):
    status_code = 409
    code = "github_not_connected"


def _client(db: Session, transport: Any = None) -> GitHubClient:
    token = any_github_token(db)
    if not token:
        raise NoGitHubConnection("Sign in with GitHub to connect your account first.")
    return GitHubClient(token, transport=transport)


# Tests swap this for a mock transport.
TRANSPORT: Any = None


def _repo_url_key(url: str) -> str | None:
    m = re.search(r"github\.com/([^/\s]+)/([^/\s#?]+)", url, re.IGNORECASE)
    if not m:
        return None
    return f"{m.group(1)}/{m.group(2).removesuffix('.git')}".lower()


# ---------------------------------------------------------------- discovery


def refresh_repos(db: Session) -> dict[str, int]:
    """Fetch the repositories the user can access. New repos are not synced until enabled."""
    with _client(db, TRANSPORT) as gh:
        data = gh.paginate(
            "/user/repos",
            params={"affiliation": "owner,collaborator,organization_member", "sort": "pushed"},
            max_pages=5,
        )
    # Auto-link repos that a single registry project already references (e.g. Meza Order -> .../restaurant).
    link_index: dict[str, set[uuid.UUID]] = {}
    for project_id, url in db.execute(
        select(ProjectLink.project_id, ProjectLink.url).where(ProjectLink.kind == "github_repo")
    ).all():
        key = _repo_url_key(url)
        if key:
            link_index.setdefault(key, set()).add(project_id)
    created = linked = 0
    for r in data:
        repo = db.scalar(select(GitHubRepo).where(GitHubRepo.github_id == r["id"]))
        if repo is None:
            repo = GitHubRepo(github_id=r["id"], full_name=r["full_name"], html_url=r["html_url"])
            db.add(repo)
            created += 1
        repo.full_name = r["full_name"]
        repo.html_url = r["html_url"]
        repo.description = r.get("description")
        repo.private = bool(r.get("private"))
        repo.archived = bool(r.get("archived"))
        repo.default_branch = r.get("default_branch")
        repo.pushed_at = parse_dt(r.get("pushed_at"))
        candidates = link_index.get(r["full_name"].lower(), set())
        if repo.project_id is None and len(candidates) == 1:
            repo.project_id = next(iter(candidates))
            repo.sync_enabled = True
            linked += 1
    db.commit()
    return {"repos": len(data), "new": created, "auto_linked": linked}


BOARDS_QUERY = """
query($cursor: String) {
  viewer {
    projectsV2(first: 50, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id number title url closed
        owner { ... on User { login } ... on Organization { login } }
        fields(first: 50) { nodes { ... on ProjectV2FieldCommon { name dataType } } }
      }
    }
  }
}
"""


def refresh_boards(db: Session) -> dict[str, int]:
    nodes: list[dict[str, Any]] = []
    cursor = None
    with _client(db, TRANSPORT) as gh:
        for _ in range(4):
            data = gh.graphql(BOARDS_QUERY, {"cursor": cursor})
            page = data["viewer"]["projectsV2"]
            nodes.extend(page["nodes"] or [])
            if not page["pageInfo"]["hasNextPage"]:
                break
            cursor = page["pageInfo"]["endCursor"]
    for n in nodes:
        board = db.scalar(select(GitHubProjectBoard).where(GitHubProjectBoard.node_id == n["id"]))
        if board is None:
            board = GitHubProjectBoard(
                node_id=n["id"], number=n["number"], title=n["title"], url=n["url"], owner_login=""
            )
            db.add(board)
        board.number, board.title, board.url, board.closed = n["number"], n["title"], n["url"], bool(n["closed"])
        board.owner_login = (n.get("owner") or {}).get("login", "")
        fields = [f for f in (n.get("fields") or {}).get("nodes", []) if f]
        board.date_fields = [f["name"] for f in fields if f.get("dataType") == "DATE"]
        # Sensible defaults when the board has obviously named date fields.
        lowered = {name.lower(): name for name in board.date_fields}
        if board.start_field is None:
            board.start_field = next((lowered[k] for k in ("start date", "start") if k in lowered), None)
        if board.end_field is None:
            board.end_field = next(
                (lowered[k] for k in ("target date", "end date", "due date", "due", "end") if k in lowered), None
            )
    db.commit()
    return {"boards": len(nodes)}


# ------------------------------------------------------------------- repo sync


def _etag_get(db: Session, gh: GitHubClient, path: str, params: dict[str, Any]) -> Any | None:
    """GET with If-None-Match; returns None when GitHub says nothing changed (304)."""
    key = path + "?" + "&".join(f"{k}={v}" for k, v in sorted(params.items()))
    cached = db.get(GitHubEtag, key)
    resp = gh.get(path, params=params, etag=cached.etag if cached else None)
    if resp.status == 304:
        return None
    if resp.etag:
        if cached:
            cached.etag = resp.etag
        else:
            db.add(GitHubEtag(url=key, etag=resp.etag))
    return resp.data


def _upsert_issue(db: Session, repo: GitHubRepo, item: dict[str, Any]) -> tuple[Task, bool]:
    task = db.scalar(select(Task).where(Task.gh_node_id == item["node_id"]))
    created = task is None
    is_pr = "pull_request" in item
    if task is None:
        task = Task(
            source="github",
            gh_node_id=item["node_id"],
            gh_repo_id=repo.id,
            project_id=repo.project_id,
            status="in_review" if is_pr else "todo",
            priority="medium",
            title="",
        )
        db.add(task)
    pr = item.get("pull_request") or {}
    task.gh_kind = "pull_request" if is_pr else "issue"
    task.gh_number = item["number"]
    task.title = (item.get("title") or "")[:500]
    task.description = item.get("body")
    task.gh_url = item.get("html_url")
    task.gh_labels = [label["name"][:100] for label in item.get("labels", []) if isinstance(label, dict)]
    task.gh_assignees = [a["login"] for a in item.get("assignees") or []]
    task.gh_created_at = parse_dt(item.get("created_at"))
    task.gh_updated_at = parse_dt(item.get("updated_at"))
    task.gh_closed_at = parse_dt(item.get("closed_at"))
    task.gh_merged_at = parse_dt(pr.get("merged_at"))
    task.gh_milestone_number = (item.get("milestone") or {}).get("number")
    state = "merged" if task.gh_merged_at else item.get("state", "open")
    task.gh_state = state
    task.assignee = task.gh_assignees[0] if task.gh_assignees else None
    # GitHub decides "done"; local status is only kept for open items.
    if state in ("closed", "merged"):
        if task.status != "done":
            task.status = "done"
            task.completed_at = task.gh_closed_at or utcnow()
    elif task.status == "done":
        task.status, task.completed_at = "todo", None
    return task, created


def _sync_issues(db: Session, gh: GitHubClient, repo: GitHubRepo, deadline: float) -> dict[str, Any]:
    params: dict[str, Any] = {"state": "all", "sort": "updated", "direction": "asc", "per_page": 100}
    if repo.issues_since:
        params["since"] = repo.issues_since.isoformat().replace("+00:00", "Z")
    url: str | None = f"/repos/{repo.full_name}/issues"
    pages = upserted = 0
    newest: datetime | None = repo.issues_since
    complete = True
    while url:
        if pages >= MAX_ISSUE_PAGES_PER_RUN or time.monotonic() > deadline:
            complete = False
            break
        resp = gh.get(url, params=params if pages == 0 else None)
        for item in resp.data or []:
            task, created = _upsert_issue(db, repo, item)
            upserted += 1
            updated = parse_dt(item.get("updated_at"))
            if updated and (newest is None or updated > newest):
                newest = updated
            kind = "PR" if task.gh_kind == "pull_request" else "Issue"
            if task.gh_state == "merged":
                record_activity(
                    db,
                    "github.pr_merged",
                    f"PR #{task.gh_number} merged in {repo.full_name}: {task.title}",
                    project_id=repo.project_id,
                    url=task.gh_url,
                    occurred_at=task.gh_merged_at,
                    dedupe_key=f"merged:{task.gh_node_id}",
                )
            elif task.gh_state == "closed":
                record_activity(
                    db,
                    "github.closed",
                    f"{kind} #{task.gh_number} closed in {repo.full_name}: {task.title}",
                    project_id=repo.project_id,
                    url=task.gh_url,
                    occurred_at=task.gh_closed_at,
                    dedupe_key=f"closed:{task.gh_node_id}:{task.gh_closed_at}",
                )
            elif created:
                record_activity(
                    db,
                    "github.opened",
                    f"{kind} #{task.gh_number} opened in {repo.full_name}: {task.title}",
                    project_id=repo.project_id,
                    url=task.gh_url,
                    occurred_at=task.gh_created_at,
                    dedupe_key=f"opened:{task.gh_node_id}",
                )
        db.flush()
        url = resp.next_url
        pages += 1
    # Save the cursor even on partial runs; the next run continues from here (items are upserts).
    repo.issues_since = newest
    return {"issues_and_prs": upserted, "complete": complete}


def _sync_milestones(db: Session, gh: GitHubClient, repo: GitHubRepo) -> int:
    data = _etag_get(db, gh, f"/repos/{repo.full_name}/milestones", {"state": "all", "per_page": 100})
    if data is not None:
        for m in data:
            ms = db.scalar(select(Milestone).where(Milestone.gh_repo_id == repo.id, Milestone.gh_number == m["number"]))
            if ms is None:
                ms = Milestone(source="github", gh_repo_id=repo.id, gh_number=m["number"], title="")
                db.add(ms)
            ms.project_id = repo.project_id
            ms.title = (m.get("title") or "")[:300]
            ms.description = m.get("description")
            ms.gh_url = m.get("html_url")
            due = parse_dt(m.get("due_on"))
            ms.gh_due_on = due.date() if due else None
            closed = m.get("state") == "closed"
            ms.status = "done" if closed else "open"
            ms.completed_at = parse_dt(m.get("closed_at")) if closed else None
        db.flush()
    # (Re)attach tasks to their milestones by number.
    ms_by_number = {
        n: mid
        for n, mid in db.execute(select(Milestone.gh_number, Milestone.id).where(Milestone.gh_repo_id == repo.id)).all()
    }
    for task in db.scalars(select(Task).where(Task.gh_repo_id == repo.id)):
        task.milestone_id = ms_by_number.get(task.gh_milestone_number) if task.gh_milestone_number else None
    return len(data or [])


def _sync_releases(db: Session, gh: GitHubClient, repo: GitHubRepo) -> int:
    data = _etag_get(db, gh, f"/repos/{repo.full_name}/releases", {"per_page": 30})
    if data is None:
        return 0
    for r in data:
        rel = db.scalar(select(Release).where(Release.gh_repo_id == repo.id, Release.gh_release_id == r["id"]))
        if rel is None:
            rel = Release(gh_repo_id=repo.id, gh_release_id=r["id"], tag=r["tag_name"], url=r["html_url"])
            db.add(rel)
        rel.tag, rel.name, rel.url = r["tag_name"], r.get("name"), r["html_url"]
        rel.draft, rel.prerelease = bool(r.get("draft")), bool(r.get("prerelease"))
        rel.published_at = parse_dt(r.get("published_at"))
        if rel.published_at and not rel.draft:
            record_activity(
                db,
                "github.release",
                f"Release {rel.name or rel.tag} published in {repo.full_name}",
                project_id=repo.project_id,
                url=rel.url,
                occurred_at=rel.published_at,
                dedupe_key=f"release:{r['id']}",
            )
    return len(data)


RUN_RESULTS = {"success": "pass", "failure": "fail", "timed_out": "fail", "startup_failure": "fail"}


def _sync_workflow_runs(db: Session, gh: GitHubClient, repo: GitHubRepo) -> int:
    try:
        data = _etag_get(db, gh, f"/repos/{repo.full_name}/actions/runs", {"per_page": 20})
    except GitHubError as exc:
        if exc.status in (403, 404):  # Actions disabled or no access: not an error for the sync
            return 0
        raise
    if data is None:
        return 0
    count = 0
    for run in data.get("workflow_runs", []):
        if run.get("status") != "completed":
            continue
        ref = f"{run['id']}:{run.get('run_attempt', 1)}"
        result = RUN_RESULTS.get(run.get("conclusion") or "", "info")
        ev = db.scalar(
            select(EvidenceRecord).where(EvidenceRecord.source == "github_actions", EvidenceRecord.source_ref == ref)
        )
        if ev is None:
            ev = EvidenceRecord(
                source="github_actions",
                source_ref=ref,
                kind="ci_run",
                origin="automated",
                title="",
                result=result,
                observed_at=utcnow(),
            )
            db.add(ev)
            count += 1
            if result == "fail":
                record_activity(
                    db,
                    "github.ci_failed",
                    f"CI '{run.get('name')}' failed on {run.get('head_branch')} in {repo.full_name}",
                    project_id=repo.project_id,
                    url=run.get("html_url"),
                    occurred_at=parse_dt(run.get("updated_at")),
                    dedupe_key=f"ci:{ref}",
                )
        ev.project_id, ev.gh_repo_id = repo.project_id, repo.id
        ev.title = f"{run.get('name') or 'Workflow'} on {run.get('head_branch') or '?'} ({repo.full_name})"[:300]
        ev.result = result
        ev.observed_at = parse_dt(run.get("updated_at")) or utcnow()
        ev.url = run.get("html_url")
        ev.notes = (
            f"conclusion: {run.get('conclusion')}; event: {run.get('event')}; commit {str(run.get('head_sha'))[:7]}"
        )
    return count


def sync_repo(db: Session, repo: GitHubRepo, gh: GitHubClient, deadline: float) -> dict[str, Any]:
    summary: dict[str, Any] = {"repo": repo.full_name}
    try:
        summary.update(_sync_issues(db, gh, repo, deadline))
        summary["milestones"] = _sync_milestones(db, gh, repo)
        summary["releases"] = _sync_releases(db, gh, repo)
        summary["ci_runs"] = _sync_workflow_runs(db, gh, repo)
        repo.last_synced_at = utcnow()
        repo.last_sync_error = None
        db.commit()
    except (GitHubAuthError, GitHubRateLimited):
        db.rollback()
        raise
    except GitHubError as exc:
        db.rollback()
        repo = db.get(GitHubRepo, repo.id)  # type: ignore[assignment]
        repo.last_sync_error = str(exc)[:1000]
        db.commit()
        summary["error"] = str(exc)
    return summary


# ------------------------------------------------------------------ board sync

BOARD_ITEMS_QUERY = """
query($id: ID!, $cursor: String) {
  node(id: $id) {
    ... on ProjectV2 {
      items(first: 100, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id type isArchived
          content {
            ... on Issue { id }
            ... on PullRequest { id }
            ... on DraftIssue { id title body createdAt }
          }
          fieldValues(first: 30) {
            nodes {
              ... on ProjectV2ItemFieldDateValue { date field { ... on ProjectV2FieldCommon { name } } }
              ... on ProjectV2ItemFieldSingleSelectValue { name field { ... on ProjectV2FieldCommon { name } } }
            }
          }
        }
      }
    }
  }
}
"""


def _field_values(item: dict[str, Any]) -> dict[str, Any]:
    values: dict[str, Any] = {}
    for fv in (item.get("fieldValues") or {}).get("nodes", []):
        if not fv or not fv.get("field"):
            continue
        name = fv["field"].get("name")
        if "date" in fv and fv["date"]:
            values[name] = date.fromisoformat(fv["date"])
        elif "name" in fv:
            values[name] = fv["name"]
    return values


def sync_board(db: Session, board: GitHubProjectBoard, gh: GitHubClient, deadline: float) -> dict[str, Any]:
    cursor = None
    matched = drafts = skipped = 0
    seen_tasks: set[uuid.UUID] = set()
    complete = True
    try:
        for _ in range(MAX_BOARD_PAGES_PER_RUN):
            if time.monotonic() > deadline:
                complete = False
                break
            data = gh.graphql(BOARD_ITEMS_QUERY, {"id": board.node_id, "cursor": cursor})
            page = (data.get("node") or {}).get("items") or {"nodes": [], "pageInfo": {"hasNextPage": False}}
            for item in page["nodes"] or []:
                if not item or item.get("isArchived"):
                    continue
                content = item.get("content") or {}
                values = _field_values(item)
                if item.get("type") == "DRAFT_ISSUE":
                    task = db.scalar(select(Task).where(Task.gh_node_id == item["id"]))
                    if task is None:
                        task = Task(
                            id=uuid.uuid4(),
                            source="github",
                            gh_kind="draft",
                            gh_node_id=item["id"],
                            title="",
                            status="todo",
                            priority="medium",
                            project_id=board.project_id,
                        )
                        db.add(task)
                    task.title = (content.get("title") or "Untitled draft")[:500]
                    task.description = content.get("body")
                    task.gh_created_at = parse_dt(content.get("createdAt"))
                    task.gh_url = board.url
                    task.project_id = board.project_id
                    drafts += 1
                else:
                    task = db.scalar(select(Task).where(Task.gh_node_id == content.get("id"))) if content else None
                    if task is None:
                        skipped += 1  # item from a repository that is not synced
                        continue
                    matched += 1
                task.gh_board_id = board.id
                task.gh_board_start = values.get(board.start_field) if board.start_field else None
                task.gh_board_end = values.get(board.end_field) if board.end_field else None
                status = values.get("Status")
                task.gh_board_status = status[:100] if isinstance(status, str) else None
                seen_tasks.add(task.id)
            db.flush()
            if not page["pageInfo"]["hasNextPage"]:
                break
            cursor = page["pageInfo"]["endCursor"]
        else:
            complete = False
        if complete:
            # Items removed from the board lose their board dates.
            db.execute(
                update(Task)
                .where(Task.gh_board_id == board.id, Task.id.not_in(seen_tasks) if seen_tasks else true())
                .values(gh_board_id=None, gh_board_start=None, gh_board_end=None, gh_board_status=None)
            )
        board.last_synced_at = utcnow()
        board.last_sync_error = None
        db.commit()
    except (GitHubAuthError, GitHubRateLimited):
        db.rollback()
        raise
    except GitHubError as exc:
        db.rollback()
        board = db.get(GitHubProjectBoard, board.id)  # type: ignore[assignment]
        board.last_sync_error = str(exc)[:1000]
        db.commit()
        return {"board": board.title, "error": str(exc)}
    return {
        "board": board.title,
        "matched": matched,
        "drafts": drafts,
        "not_synced_repo_items": skipped,
        "complete": complete,
    }


# ------------------------------------------------------------------- entry points


@jobs.handler("github_sync_all")
def sync_all(db: Session, payload: dict[str, Any], deadline: float) -> dict[str, Any]:
    results: dict[str, Any] = {"repos": [], "boards": []}
    with _client(db, TRANSPORT) as gh:
        repos = list(
            db.scalars(
                select(GitHubRepo)
                .where(GitHubRepo.sync_enabled.is_(True))
                .order_by(GitHubRepo.last_synced_at.asc().nulls_first())
            )
        )
        for repo in repos:
            if time.monotonic() > deadline:
                results["incomplete"] = True
                break
            results["repos"].append(sync_repo(db, repo, gh, deadline))
        boards = list(
            db.scalars(
                select(GitHubProjectBoard)
                .where(GitHubProjectBoard.sync_enabled.is_(True))
                .order_by(GitHubProjectBoard.last_synced_at.asc().nulls_first())
            )
        )
        for board in boards:
            if time.monotonic() > deadline:
                results["incomplete"] = True
                break
            results["boards"].append(sync_board(db, board, gh, deadline))
    return results


def set_repo_project(db: Session, repo: GitHubRepo, project_id: uuid.UUID | None) -> None:
    """Move a repo (and everything synced from it) to another project."""
    if project_id is not None and db.get(Project, project_id) is None:
        raise AppError("Project not found", code="not_found", status_code=404)
    repo.project_id = project_id
    db.execute(update(Task).where(Task.gh_repo_id == repo.id).values(project_id=project_id))
    db.execute(update(Milestone).where(Milestone.gh_repo_id == repo.id).values(project_id=project_id))
    db.execute(update(EvidenceRecord).where(EvidenceRecord.gh_repo_id == repo.id).values(project_id=project_id))
    # Tasks moved between projects can't keep local milestones of the old project.
    db.execute(
        update(Task)
        .where(
            Task.gh_repo_id == repo.id, Task.milestone_id.in_(select(Milestone.id).where(Milestone.source == "local"))
        )
        .values(milestone_id=None)
    )


def set_board_project(db: Session, board: GitHubProjectBoard, project_id: uuid.UUID | None) -> None:
    if project_id is not None and db.get(Project, project_id) is None:
        raise AppError("Project not found", code="not_found", status_code=404)
    board.project_id = project_id
    db.execute(update(Task).where(Task.gh_board_id == board.id, Task.gh_kind == "draft").values(project_id=project_id))
