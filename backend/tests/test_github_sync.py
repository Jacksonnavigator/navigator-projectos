from __future__ import annotations

import json
from datetime import date, timedelta

import httpx
import pytest
import respx
from sqlalchemy import func, select

from app.integrations.github.client import GitHubClient, GitHubError
from app.models import ActivityEvent, BackgroundJob, EvidenceRecord, GitHubRepo, Milestone, Task, User
from app.services.auth import store_github_token

API = "https://api.github.com"
FUTURE = (date.today() + timedelta(days=20)).isoformat()


@pytest.fixture
def connected(api, db):
    user = db.scalar(select(User))
    store_github_token(db, user, "gho_test", "read:user,repo,read:project")
    db.commit()
    return api


def _issue(number, node, state="open", milestone=None, pr=None, updated="2026-10-01T10:00:00Z", title=None):
    item = {
        "id": number,
        "node_id": node,
        "number": number,
        "title": title or f"Issue {number}",
        "body": "body",
        "state": state,
        "html_url": f"https://github.com/me/restaurant/issues/{number}",
        "labels": [{"name": "bug"}],
        "assignees": [{"login": "jackson"}],
        "created_at": "2026-09-01T10:00:00Z",
        "updated_at": updated,
        "closed_at": "2026-10-01T10:00:00Z" if state == "closed" else None,
        "milestone": {"number": milestone} if milestone else None,
    }
    if pr is not None:
        item["pull_request"] = {"merged_at": pr}
    return item


def _mock_repo_endpoints(issues, runs=None, etag_hits=False):
    respx.get(f"{API}/repos/me/restaurant/issues").mock(return_value=httpx.Response(200, json=issues))
    ms_route = respx.get(f"{API}/repos/me/restaurant/milestones")
    milestones = [
        {
            "number": 1,
            "title": "Launch",
            "state": "open",
            "due_on": f"{FUTURE}T07:00:00Z",
            "html_url": "https://github.com/me/restaurant/milestone/1",
        }
    ]

    def ms_side_effect(request):
        if etag_hits and request.headers.get("if-none-match") == '"ms1"':
            return httpx.Response(304)
        return httpx.Response(200, json=milestones, headers={"ETag": '"ms1"'})

    ms_route.mock(side_effect=ms_side_effect)
    respx.get(f"{API}/repos/me/restaurant/releases").mock(
        return_value=httpx.Response(
            200,
            json=[
                {
                    "id": 77,
                    "tag_name": "v1.0",
                    "name": "First",
                    "draft": False,
                    "prerelease": False,
                    "published_at": "2026-10-05T12:00:00Z",
                    "html_url": "https://github.com/me/restaurant/releases/v1.0",
                }
            ],
        )
    )
    respx.get(f"{API}/repos/me/restaurant/actions/runs").mock(
        return_value=httpx.Response(
            200,
            json={
                "workflow_runs": runs
                if runs is not None
                else [
                    {
                        "id": 9,
                        "run_attempt": 1,
                        "name": "CI",
                        "status": "completed",
                        "conclusion": "failure",
                        "head_branch": "main",
                        "head_sha": "abcdef1234",
                        "event": "push",
                        "updated_at": "2026-10-06T08:00:00Z",
                        "html_url": "https://github.com/me/restaurant/actions/runs/9",
                    },
                    {"id": 10, "run_attempt": 1, "name": "CI", "status": "in_progress", "conclusion": None},
                ]
            },
        )
    )


def _setup_repo(connected):
    project = connected.post(
        "/api/v1/projects",
        json={"name": "Meza Order", "lifecycle": "deployed", "repository_text": "https://github.com/me/restaurant"},
    ).json()
    respx.get(f"{API}/user/repos").mock(
        return_value=httpx.Response(
            200,
            json=[
                {
                    "id": 1,
                    "full_name": "me/restaurant",
                    "html_url": "https://github.com/me/restaurant",
                    "private": False,
                    "pushed_at": "2026-10-10T00:00:00Z",
                },
                {"id": 2, "full_name": "me/other", "html_url": "https://github.com/me/other", "private": True},
            ],
        )
    )
    res = connected.post("/api/v1/github/repos/refresh")
    assert res.status_code == 200, res.text
    assert res.json() == {"repos": 2, "new": 2, "auto_linked": 1}
    return project


@respx.mock
def test_refresh_repos_auto_links_by_registry_url(connected):
    project = _setup_repo(connected)
    repos = {r["full_name"]: r for r in connected.get("/api/v1/github/repos").json()}
    assert repos["me/restaurant"]["project_id"] == project["id"] and repos["me/restaurant"]["sync_enabled"]
    assert repos["me/other"]["project_id"] is None and not repos["me/other"]["sync_enabled"]


@respx.mock
def test_full_sync_imports_issues_milestones_releases_and_ci(connected, db):
    project = _setup_repo(connected)
    _mock_repo_endpoints(
        [
            _issue(1, "I_1", milestone=1),
            _issue(2, "I_2", state="closed"),
            _issue(3, "PR_3", state="closed", pr="2026-10-02T10:00:00Z"),
        ]
    )
    res = connected.post("/api/v1/github/sync")
    assert res.status_code == 202 and res.json()["started"] is True
    job = db.scalar(select(BackgroundJob))
    assert job.status == "succeeded", job.last_error
    tasks = {t["gh_number"]: t for t in connected.get(f"/api/v1/tasks?project_id={project['id']}").json()["items"]}
    assert tasks[1]["status"] == "todo" and tasks[1]["gh_labels"] == ["bug"] and tasks[1]["assignee"] == "jackson"
    assert tasks[2]["status"] == "done" and tasks[2]["gh_state"] == "closed"
    assert tasks[3]["gh_kind"] == "pull_request" and tasks[3]["gh_state"] == "merged" and tasks[3]["status"] == "done"
    assert tasks[1]["effective_due"] == FUTURE and tasks[1]["effective_due_source"] == "milestone"
    ms = db.scalar(select(Milestone))
    assert ms.source == "github" and ms.gh_due_on.isoformat() == FUTURE and str(ms.project_id) == project["id"]
    ev = db.scalar(select(EvidenceRecord))
    assert ev.result == "fail" and ev.origin == "automated" and ev.kind == "ci_run"
    assert db.scalar(select(func.count()).select_from(EvidenceRecord)) == 1  # in-progress run ignored
    kinds = set(db.scalars(select(ActivityEvent.kind)))
    assert {"github.opened", "github.closed", "github.pr_merged", "github.release", "github.ci_failed"} <= kinds
    timeline = connected.get("/api/v1/timeline").json()
    assert any(r["title"] == "First" for r in timeline["releases"])


@respx.mock
def test_resync_is_idempotent_and_tracks_reopen(connected, db):
    _setup_repo(connected)
    _mock_repo_endpoints([_issue(1, "I_1", state="closed")], etag_hits=True)
    connected.post("/api/v1/github/sync")
    activity_before = db.scalar(select(func.count()).select_from(ActivityEvent))
    _mock_repo_endpoints([_issue(1, "I_1", state="open", updated="2026-10-08T10:00:00Z")], etag_hits=True)
    connected.post("/api/v1/github/sync")
    assert db.scalar(select(func.count()).select_from(Task)) == 1
    assert db.scalar(select(func.count()).select_from(EvidenceRecord)) == 1
    task = db.scalar(select(Task))
    db.refresh(task)
    assert task.status == "todo" and task.completed_at is None  # reopened on GitHub
    assert db.scalar(select(func.count()).select_from(ActivityEvent)) == activity_before  # no duplicate events
    since = respx.calls.last.request.url  # last call was actions/runs; check the issues cursor instead
    assert since
    repo = db.scalar(select(GitHubRepo).where(GitHubRepo.full_name == "me/restaurant"))
    db.refresh(repo)
    assert repo.issues_since.isoformat().startswith("2026-10-08")


@respx.mock
def test_local_fields_survive_sync(connected, db):
    _setup_repo(connected)
    _mock_repo_endpoints([_issue(1, "I_1")])
    connected.post("/api/v1/github/sync")
    task_id = str(db.scalar(select(Task.id)))
    connected.patch(
        f"/api/v1/tasks/{task_id}",
        json={"due_date": "2026-12-24", "status": "in_progress", "acceptance_criteria": "Works on iPhone"},
    )
    _mock_repo_endpoints([_issue(1, "I_1", title="Renamed on GitHub", updated="2026-10-09T00:00:00Z")])
    connected.post("/api/v1/github/sync")
    t = connected.get(f"/api/v1/tasks/{task_id}").json()
    assert t["title"] == "Renamed on GitHub"
    assert (
        t["due_date"] == "2026-12-24" and t["status"] == "in_progress" and t["acceptance_criteria"] == "Works on iPhone"
    )


@respx.mock
def test_repo_api_error_is_recorded_not_fatal(connected, db):
    _setup_repo(connected)
    respx.get(f"{API}/repos/me/restaurant/issues").mock(
        return_value=httpx.Response(500, json={"message": "Server Error"})
    )
    connected.post("/api/v1/github/sync")
    job = db.scalar(select(BackgroundJob))
    assert job.status == "succeeded"
    repo = connected.get("/api/v1/github/repos").json()[0]
    assert "500" in repo["last_sync_error"]


@respx.mock
def test_revoked_token_fails_job_with_retry(connected, db):
    _setup_repo(connected)
    respx.get(f"{API}/repos/me/restaurant/issues").mock(return_value=httpx.Response(401, json={}))
    connected.post("/api/v1/github/sync")
    job = db.scalar(select(BackgroundJob))
    assert job.status == "queued" and job.attempts == 1 and "GitHubAuthError" in job.last_error


BOARDS = {
    "data": {
        "viewer": {
            "projectsV2": {
                "pageInfo": {"hasNextPage": False, "endCursor": None},
                "nodes": [
                    {
                        "id": "PVT_1",
                        "number": 3,
                        "title": "Roadmap",
                        "url": "https://github.com/users/me/projects/3",
                        "closed": False,
                        "owner": {"login": "me"},
                        "fields": {
                            "nodes": [
                                {"name": "Start date", "dataType": "DATE"},
                                {"name": "Target date", "dataType": "DATE"},
                                {"name": "Status", "dataType": "SINGLE_SELECT"},
                                {},
                            ]
                        },
                    },
                ],
            }
        }
    }
}


def _board_items(start, end):
    return {
        "data": {
            "node": {
                "items": {
                    "pageInfo": {"hasNextPage": False, "endCursor": None},
                    "nodes": [
                        {
                            "id": "PVTI_1",
                            "type": "ISSUE",
                            "isArchived": False,
                            "content": {"id": "I_1"},
                            "fieldValues": {
                                "nodes": [
                                    {"date": start, "field": {"name": "Start date"}},
                                    {"date": end, "field": {"name": "Target date"}},
                                    {"name": "In progress", "field": {"name": "Status"}},
                                    {},
                                ]
                            },
                        },
                        {
                            "id": "PVTI_2",
                            "type": "DRAFT_ISSUE",
                            "isArchived": False,
                            "content": {
                                "id": "DI_1",
                                "title": "Buy RS485 module",
                                "body": None,
                                "createdAt": "2026-10-01T00:00:00Z",
                            },
                            "fieldValues": {"nodes": [{"date": end, "field": {"name": "Target date"}}]},
                        },
                        {
                            "id": "PVTI_3",
                            "type": "ISSUE",
                            "isArchived": False,
                            "content": {"id": "I_unsynced"},
                            "fieldValues": {"nodes": []},
                        },
                    ],
                }
            }
        }
    }


@respx.mock
def test_projects_v2_board_dates_flow_into_timeline(connected, db):
    project = _setup_repo(connected)
    _mock_repo_endpoints([_issue(1, "I_1", milestone=1)])
    graphql = respx.post(f"{API}/graphql")
    graphql.mock(return_value=httpx.Response(200, json=BOARDS))
    boards = connected.post("/api/v1/github/boards/refresh")
    assert boards.json() == {"boards": 1}
    board = connected.get("/api/v1/github/boards").json()[0]
    assert board["start_field"] == "Start date" and board["end_field"] == "Target date"  # auto-detected
    assert connected.patch(f"/api/v1/github/boards/{board['id']}", json={"end_field": "Status"}).status_code == 422
    connected.patch(f"/api/v1/github/boards/{board['id']}", json={"sync_enabled": True, "project_id": project["id"]})

    start = date.today().isoformat()
    end = (date.today() + timedelta(days=10)).isoformat()
    graphql.mock(return_value=httpx.Response(200, json=_board_items(start, end)))
    connected.post("/api/v1/github/sync")
    job = db.scalar(select(BackgroundJob))
    assert job.status == "succeeded", job.last_error
    result = job.result["boards"][0]
    assert result["matched"] == 1 and result["drafts"] == 1 and result["not_synced_repo_items"] == 1
    body = json.loads(graphql.calls.last.request.content)
    assert body["query"].lstrip().startswith("query")
    items = {i["title"]: i for i in connected.get("/api/v1/timeline").json()["items"]}
    issue = items["Issue 1"]
    assert issue["start_source"] == "github_project" and issue["end_source"] == "github_project"
    assert issue["end"] == end  # board date wins over the milestone date
    draft = items["Buy RS485 module"]
    assert draft["source"] == "github" and draft["end"] == end
    t = connected.get(f"/api/v1/tasks/{issue['id']}").json()
    assert t["gh_board_status"] == "In progress"


@respx.mock
def test_sync_if_stale_skips_fresh_data(connected):
    _setup_repo(connected)
    _mock_repo_endpoints([])
    assert connected.post("/api/v1/github/sync").json()["started"] is True
    again = connected.post("/api/v1/github/sync?if_stale=true").json()
    assert again["started"] is False and again["reason"] == "fresh"


def test_sync_requires_connection(api):
    res = api.post("/api/v1/github/sync")
    assert res.status_code == 422 and res.json()["error"]["code"] == "github_not_connected"


@respx.mock
def test_internal_sync_endpoint_auth(connected, client, db):
    _setup_repo(connected)
    _mock_repo_endpoints([_issue(1, "I_1")])
    assert client.post("/api/v1/internal/sync").status_code == 401
    assert client.post("/api/v1/internal/sync", headers={"Authorization": "Bearer wrong"}).status_code == 401
    res = client.post("/api/v1/internal/sync", headers={"Authorization": "Bearer internal-sync-secret-for-tests"})
    assert res.status_code == 200 and res.json()["ran"] == 1
    assert db.scalar(select(func.count()).select_from(Task)) == 1


@respx.mock
def test_moving_repo_moves_its_items(connected, db):
    _setup_repo(connected)
    _mock_repo_endpoints([_issue(1, "I_1", milestone=1)])
    connected.post("/api/v1/github/sync")
    other = connected.post("/api/v1/projects", json={"name": "Other"}).json()
    repo = next(r for r in connected.get("/api/v1/github/repos").json() if r["full_name"] == "me/restaurant")
    connected.patch(f"/api/v1/github/repos/{repo['id']}", json={"project_id": other["id"]})
    assert connected.get(f"/api/v1/tasks?project_id={other['id']}").json()["total"] == 1
    assert [m["project_id"] for m in connected.get("/api/v1/milestones").json()] == [other["id"]]


@respx.mock
def test_disconnect_revokes_and_deletes_token(connected, db):
    route = respx.delete(f"{API}/applications/test-client/grant").mock(return_value=httpx.Response(204))
    assert connected.delete("/api/v1/github/connection").status_code == 204
    assert route.called
    assert connected.get("/api/v1/github/status").json()["connected"] is False


def test_client_refuses_mutations():
    with GitHubClient("t") as gh, pytest.raises(GitHubError, match="read-only"):
        gh.graphql("mutation { deleteProjectV2Item(input: {}) { deletedItemId } }")
