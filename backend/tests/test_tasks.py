from __future__ import annotations

from datetime import date, timedelta

from app.models import Task
from app.models.base import utcnow


def _project(api, name="P"):
    return api.post("/api/v1/projects", json={"name": name, "lifecycle": "active"}).json()


def _task(api, project_id, **kw):
    res = api.post("/api/v1/tasks", json={"project_id": project_id, "title": kw.pop("title", "T"), **kw})
    assert res.status_code == 201, res.text
    return res.json()


def test_task_lifecycle_and_completion_timestamp(api):
    p = _project(api)
    t = _task(api, p["id"], title="Calibrate", priority="high")
    assert t["status"] == "todo" and t["completed_at"] is None
    done = api.patch(f"/api/v1/tasks/{t['id']}", json={"status": "done"}).json()
    assert done["completed_at"] is not None
    reopened = api.patch(f"/api/v1/tasks/{t['id']}", json={"status": "in_progress"}).json()
    assert reopened["completed_at"] is None
    assert api.patch(f"/api/v1/tasks/{t['id']}", json={"status": "finished"}).status_code == 422


def test_subtasks_must_share_project_and_no_parent_cycles(api):
    a, b = _project(api, "A"), _project(api, "B")
    parent = _task(api, a["id"], title="Parent")
    child = _task(api, a["id"], title="Child", parent_task_id=parent["id"])
    res = api.post("/api/v1/tasks", json={"project_id": b["id"], "title": "X", "parent_task_id": parent["id"]})
    assert res.status_code == 422
    assert api.patch(f"/api/v1/tasks/{parent['id']}", json={"parent_task_id": child["id"]}).status_code == 422
    listed = api.get(f"/api/v1/tasks?project_id={a['id']}&top_level_only=true").json()["items"]
    assert [t["title"] for t in listed] == ["Parent"] and listed[0]["subtask_count"] == 1


def test_dependencies_and_cycle_detection(api):
    p = _project(api)
    t1, t2, t3 = (_task(api, p["id"], title=f"T{i}") for i in (1, 2, 3))
    assert api.post(f"/api/v1/tasks/{t2['id']}/dependencies", json={"depends_on_id": t1["id"]}).status_code == 204
    assert api.post(f"/api/v1/tasks/{t3['id']}/dependencies", json={"depends_on_id": t2["id"]}).status_code == 204
    res = api.post(f"/api/v1/tasks/{t1['id']}/dependencies", json={"depends_on_id": t3["id"]})
    assert res.status_code == 422 and res.json()["error"]["code"] == "dependency_cycle"
    assert api.post(f"/api/v1/tasks/{t1['id']}/dependencies", json={"depends_on_id": t1["id"]}).status_code == 422
    assert api.post(f"/api/v1/tasks/{t2['id']}/dependencies", json={"depends_on_id": t1["id"]}).status_code == 409
    t2_out = api.get(f"/api/v1/tasks/{t2['id']}").json()
    assert t2_out["depends_on"] == [t1["id"]] and t2_out["blocked_by_open"] == 1
    api.patch(f"/api/v1/tasks/{t1['id']}", json={"status": "done"})
    assert api.get(f"/api/v1/tasks/{t2['id']}").json()["blocked_by_open"] == 0


def test_milestone_cannot_be_completed_with_open_tasks(api):
    p = _project(api)
    ms = api.post("/api/v1/milestones", json={"project_id": p["id"], "title": "MVP", "due_date": "2026-12-01"}).json()
    t = _task(api, p["id"], milestone_id=ms["id"])
    res = api.patch(f"/api/v1/milestones/{ms['id']}", json={"status": "done"})
    assert res.status_code == 422 and res.json()["error"]["code"] == "milestone_incomplete"
    api.patch(f"/api/v1/tasks/{t['id']}", json={"status": "done"})
    done = api.patch(f"/api/v1/milestones/{ms['id']}", json={"status": "done"}).json()
    assert done["status"] == "done" and done["task_done"] == 1


def test_milestone_from_other_project_rejected(api):
    a, b = _project(api, "A"), _project(api, "B")
    ms = api.post("/api/v1/milestones", json={"project_id": a["id"], "title": "M"}).json()
    res = api.post("/api/v1/tasks", json={"project_id": b["id"], "title": "X", "milestone_id": ms["id"]})
    assert res.status_code == 422


def test_effective_due_and_overdue_from_milestone(api):
    p = _project(api)
    past = (date.today() - timedelta(days=3)).isoformat()
    ms = api.post("/api/v1/milestones", json={"project_id": p["id"], "title": "M", "due_date": past}).json()
    t = _task(api, p["id"], milestone_id=ms["id"])
    assert t["effective_due"] == past and t["effective_due_source"] == "milestone" and t["overdue"] is True


def test_github_items_are_read_only_for_github_fields(api, db):
    p = _project(api)
    task = Task(
        project_id=p["id"],
        title="Issue",
        source="github",
        gh_kind="issue",
        gh_state="open",
        gh_node_id="I_1",
        gh_number=1,
        status="todo",
    )
    db.add(task)
    db.commit()
    tid = str(task.id)
    res = api.patch(f"/api/v1/tasks/{tid}", json={"title": "Renamed"})
    assert res.status_code == 422 and res.json()["error"]["code"] == "github_owned"
    assert api.patch(f"/api/v1/tasks/{tid}", json={"status": "done"}).status_code == 422
    ok = api.patch(f"/api/v1/tasks/{tid}", json={"status": "in_progress", "due_date": "2026-11-30"})
    assert ok.status_code == 200 and ok.json()["due_date"] == "2026-11-30"
    assert api.delete(f"/api/v1/tasks/{tid}").status_code == 422


def test_comments(api):
    p = _project(api)
    t = _task(api, p["id"])
    c = api.post(f"/api/v1/tasks/{t['id']}/comments", json={"body": "Measured 4.2V"}).json()
    assert [x["body"] for x in api.get(f"/api/v1/tasks/{t['id']}/comments").json()] == ["Measured 4.2V"]
    assert api.delete(f"/api/v1/tasks/{t['id']}/comments/{c['id']}").status_code == 204


def test_timeline_date_sources(api, db):
    p = _project(api)
    local = _task(api, p["id"], title="Local", start_date="2026-10-01", due_date="2026-10-10")
    gh = Task(
        project_id=p["id"],
        title="GH",
        source="github",
        gh_kind="issue",
        gh_state="open",
        gh_node_id="I_2",
        gh_created_at=utcnow() - timedelta(days=2),
        gh_board_end=date.today() + timedelta(days=5),
        status="todo",
    )
    db.add(gh)
    db.commit()
    open_ended = _task(api, p["id"], title="Open")
    body = api.get("/api/v1/timeline?start=2026-09-01&end=2027-01-31").json()
    items = {i["title"]: i for i in body["items"]}
    assert items["Local"]["start_source"] == "local" and items["Local"]["end_source"] == "local"
    assert items["GH"]["start_source"] == "github_created" and items["GH"]["end_source"] == "github_project"
    assert items["Open"]["end"] is None and items["Open"]["start_source"] == "created"
    assert local["id"] and open_ended["id"]
    assert api.get("/api/v1/timeline?start=2026-01-01&end=2025-01-01").status_code == 422


def test_dashboard_counts_and_next_actions(api):
    p = api.post(
        "/api/v1/projects",
        json={"name": "Meza", "lifecycle": "deployed", "priority": "P1", "next_action": "Fix security findings"},
    ).json()
    api.post("/api/v1/projects", json={"name": "Child", "parent_id": p["id"]})
    yesterday = (date.today() - timedelta(days=1)).isoformat()
    _task(api, p["id"], title="Late", due_date=yesterday)
    _task(api, p["id"], title="Doing", status="in_progress")
    body = api.get("/api/v1/dashboard").json()
    assert body["counts"]["projects"] == 1 and body["counts"]["sub_projects"] == 1
    assert body["counts"]["overdue"] == 1 and body["counts"]["in_progress"] == 1
    reasons = [n["reason"] for n in body["next_actions"]]
    assert reasons[0] == "overdue" and "P1_next_action" in reasons
    health = body["health"][0]
    assert health["progress"] == 0.0 and "no_recent_evidence" in health["flags"] and "overdue_tasks" in health["flags"]


def test_dashboard_progress_not_measured_without_tasks(api):
    api.post("/api/v1/projects", json={"name": "Empty", "lifecycle": "idea"})
    assert api.get("/api/v1/dashboard").json()["health"][0]["progress"] is None


def test_calendar(api):
    p = _project(api)
    soon = (date.today() + timedelta(days=3)).isoformat()
    _task(api, p["id"], title="Due soon", due_date=soon)
    api.post("/api/v1/milestones", json={"project_id": p["id"], "title": "Demo", "due_date": soon})
    kinds = {i["kind"] for i in api.get("/api/v1/calendar").json()}
    assert kinds == {"task_due", "milestone"}


def test_next_actions_list_each_task_once(api):
    p = _project(api)
    soon = (date.today() + timedelta(days=2)).isoformat()
    _task(api, p["id"], title="Blocked and due", status="blocked", due_date=soon)
    actions = api.get("/api/v1/dashboard").json()["next_actions"]
    titles = [a["task"]["title"] for a in actions if "task" in a]
    assert titles == ["Blocked and due"]
