from __future__ import annotations

import json

from factories import MASTER_HEADER, make_register, master_row


def _preview(api, content, name="register.xlsx"):
    return api.post(
        "/api/v1/import/register/preview",
        files={"file": (name, content, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
    )


def _commit(api, content, sha, suggestions=()):
    return api.post(
        "/api/v1/import/register/commit",
        files={"file": ("register.xlsx", content, "application/octet-stream")},
        data={"sha256": sha, "suggestions": json.dumps(list(suggestions))},
    )


def test_preview_does_not_write(api):
    content = make_register()
    res = _preview(api, content)
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["summary"] == {"create": 7, "update": 0, "unchanged": 0, "skip": 0}
    assert api.get("/api/v1/projects").json()["total"] == 0
    meza = next(r for r in body["rows"] if r["name"] == "Meza Order")
    assert meza["lifecycle"] == "deployed" and meza["priority"] == "P1"
    assert {link["kind"] for link in meza["links"]} == {"website", "github_repo"}
    bird = next(r for r in body["rows"] if r["register_id"] == 4)
    assert bird["priority"] == "P2" and bird["priority_match"] == "partial"
    assert [u["name"] for u in body["priority_unmatched"]] == ["RestaurantOS"]


def test_relation_suggestions(api):
    body = _preview(api, make_register()).json()
    descs = {s["description"] for s in body["suggestions"]}
    kinds = {(s["kind"], s.get("child_register_id"), s.get("parent_register_id")) for s in body["suggestions"]}
    assert ("parent", 31, 3) in kinds  # "component of the self-hosted AI infrastructure" / "project 3"
    assert ("parent", 33, 1) in kinds  # "Merge its backlog into DevGuardian"
    assert any("#24" in d and "#4" in d for d in descs)  # overlaps with the bird identifier


def test_commit_creates_projects_links_priorities_and_parents(api):
    content = make_register()
    preview = _preview(api, content).json()
    parents = [s for s in preview["suggestions"] if s["kind"] == "parent"]
    res = _commit(api, content, preview["sha256"], parents)
    assert res.status_code == 200, res.text
    assert res.json()["created"] == 7
    projects = {p["name"]: p for p in api.get("/api/v1/projects?limit=50").json()["items"]}
    meza = api.get(f"/api/v1/projects/{projects['Meza Order']['id']}").json()
    assert meza["priority"] == "P1" and meza["priority_label"] == "Immediate" and meza["priority_rank"] == 2
    assert meza["reported_status"] == "Deployed; QA and security follow-up needed"
    assert meza["status_confidence"] == "Prior report; unverified"
    assert any(link["url"] == "https://github.com/Jacksonnavigator/restaurant" for link in meza["links"])
    child = projects["Local AI API / Developer Infrastructure"]
    assert child["parent_id"] == projects["Self-Hosted AI Infrastructure / Local LLM Server"]["id"]
    top = api.get("/api/v1/projects?top_level_only=true").json()["total"]
    assert top == 5  # 31 and 33 are nested, so they are not double-counted


def test_reimport_updates_instead_of_duplicating(api):
    content = make_register()
    _commit(api, content, _preview(api, content).json()["sha256"])
    rows = [master_row(17, "Meza Order", "Deployed; QA done", next_action="Ship v2")]
    changed = make_register(rows=rows, priorities=[])
    preview = _preview(api, changed).json()
    assert preview["summary"]["update"] == 1
    fields = {c["field"] for c in preview["rows"][0]["changes"]}
    assert {"reported_status", "next_action"} <= fields
    result = _commit(api, changed, preview["sha256"]).json()
    assert result == {"created": 0, "updated": 1, "skipped": 0, "links_applied": 0}
    assert api.get("/api/v1/projects?limit=50").json()["total"] == 7
    unchanged = _preview(api, changed).json()
    assert unchanged["summary"]["unchanged"] == 1


def test_bad_rows_are_reported_and_skipped(api):
    rows = [master_row(1, "Alpha"), master_row(1, "Beta"), master_row(2, None), master_row("x", "Gamma")]
    body = _preview(api, make_register(rows=rows, priorities=[])).json()
    by_row = {r["row_number"]: r for r in body["rows"]}
    assert "Duplicate ID 1" in by_row[3]["problems"][0] and by_row[3]["action"] == "skip"
    assert by_row[4]["problems"] == ["Missing project name"]
    assert by_row[5]["action"] == "create" and "will be ignored" in by_row[5]["problems"][0]


def test_commit_rejects_changed_file(api):
    content = make_register()
    sha = _preview(api, content).json()["sha256"]
    other = make_register(rows=[master_row(1, "Something else")])
    res = _commit(api, other, sha)
    assert res.status_code == 422 and "changed since the preview" in res.json()["error"]["message"]


def test_rejects_non_xlsx_and_missing_columns(api):
    assert _preview(api, b"not a spreadsheet", name="register.csv").status_code == 422
    assert _preview(api, b"PK not really zip", name="r.xlsx").status_code == 422
    header = [h for h in MASTER_HEADER if h != "Project"]
    res = _preview(api, make_register(rows=[], header=header))
    assert res.status_code == 422 and "no 'Project' column" in res.json()["error"]["message"]
