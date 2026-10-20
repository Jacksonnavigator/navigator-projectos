from __future__ import annotations


def _create(api, **kw):
    body = {"name": "Water Monitor", "lifecycle": "active", **kw}
    res = api.post("/api/v1/projects", json=body)
    assert res.status_code == 201, res.text
    return res.json()


def test_crud_and_links(api):
    p = _create(
        api, repository_text="Code at https://github.com/me/water and C:/work/water", tags=["IoT", "iot", " water "]
    )
    assert {link["kind"] for link in p["links"]} == {"github_repo", "local_path"}
    assert p["tags"] == ["iot", "water"]
    res = api.patch(f"/api/v1/projects/{p['id']}", json={"next_action": "Calibrate sensor", "priority": "P1"})
    assert res.json()["next_action"] == "Calibrate sensor" and res.json()["priority"] == "P1"
    link = api.post(f"/api/v1/projects/{p['id']}/links", json={"url": "https://example.org/docs"}).json()
    assert link["kind"] == "website"
    assert api.post(f"/api/v1/projects/{p['id']}/links", json={"url": "https://example.org/docs"}).status_code == 409
    assert api.post(f"/api/v1/projects/{p['id']}/links", json={"url": "javascript:alert(1)"}).status_code == 422
    assert api.delete(f"/api/v1/projects/{p['id']}/links/{link['id']}").status_code == 204


def test_duplicate_names_rejected_case_insensitively(api):
    _create(api)
    res = api.post("/api/v1/projects", json={"name": "water monitor"})
    assert res.status_code == 409


def test_date_validation(api):
    res = api.post("/api/v1/projects", json={"name": "X", "start_date": "2026-05-01", "target_date": "2026-04-01"})
    assert res.status_code == 422


def test_parent_cycle_prevented(api):
    a = _create(api, name="A")
    b = _create(api, name="B", parent_id=a["id"])
    res = api.patch(f"/api/v1/projects/{a['id']}", json={"parent_id": b["id"]})
    assert res.status_code == 422
    assert api.patch(f"/api/v1/projects/{a['id']}", json={"parent_id": a["id"]}).status_code == 422
    detail = api.get(f"/api/v1/projects/{a['id']}").json()
    assert [c["name"] for c in detail["children"]] == ["B"]


def test_list_filters_search_and_top_level(api):
    a = _create(api, name="Bird Classifier", category="AI / Conservation", priority="P2")
    _create(api, name="Bird Device", category="Edge AI", parent_id=a["id"])
    _create(api, name="Meza Order", category="Restaurant", priority="P1")
    names = [p["name"] for p in api.get("/api/v1/projects?q=bird").json()["items"]]
    assert set(names) == {"Bird Classifier", "Bird Device"}
    top = api.get("/api/v1/projects?top_level_only=true").json()
    assert top["total"] == 2
    assert api.get("/api/v1/projects").json()["items"][0]["name"] == "Meza Order"  # sorted by priority
    assert api.get("/api/v1/projects?priority=P2").json()["total"] == 1


def test_archive_restore_and_duplicate(api):
    p = _create(api)
    api.post("/api/v1/tasks", json={"project_id": p["id"], "title": "Wire sensor"})
    archived = api.post(f"/api/v1/projects/{p['id']}/archive").json()
    assert archived["archived_at"] and archived["lifecycle"] == "archived"
    assert api.get("/api/v1/projects").json()["total"] == 0
    assert api.get("/api/v1/projects?include_archived=true").json()["total"] == 1
    restored = api.post(f"/api/v1/projects/{p['id']}/restore").json()
    assert restored["archived_at"] is None
    dup = api.post(f"/api/v1/projects/{p['id']}/duplicate").json()
    assert dup["name"] == "Water Monitor (copy)"
    tasks = api.get(f"/api/v1/tasks?project_id={dup['id']}").json()["items"]
    assert [t["title"] for t in tasks] == ["Wire sensor"] and tasks[0]["status"] == "todo"


def test_related_projects(api):
    a, b = _create(api, name="A"), _create(api, name="B")
    assert api.post(f"/api/v1/projects/{a['id']}/related", json={"project_id": b["id"]}).status_code == 204
    assert (
        api.post(f"/api/v1/projects/{a['id']}/related", json={"project_id": b["id"]}).status_code == 204
    )  # idempotent
    assert [r["name"] for r in api.get(f"/api/v1/projects/{b['id']}").json()["related"]] == ["A"]
    assert api.delete(f"/api/v1/projects/{b['id']}/related/{a['id']}").status_code == 204


def test_delete_project_is_audited(api, db):
    from sqlalchemy import select

    from app.models import AuditEvent

    p = _create(api)
    assert api.delete(f"/api/v1/projects/{p['id']}").status_code == 204
    assert api.get(f"/api/v1/projects/{p['id']}").status_code == 404
    assert db.scalar(select(AuditEvent).where(AuditEvent.action == "project.deleted")).target == "Water Monitor"


def test_projects_require_auth(client):
    assert client.get("/api/v1/projects").status_code == 401
