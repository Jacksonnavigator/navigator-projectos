from __future__ import annotations

from factories import make_register, master_row
from sqlalchemy import func, select

from app.models import Milestone, Task, TaskDependency
from app.services.plan_import import bundled_plans, load_bundled

PLAN_ID = "2026-q4-devguardian-portfolio"


def _import_real_names(api):
    rows = [
        master_row(1, "DevGuardian AI"),
        master_row(7, "Smart Agriculture and Automated Irrigation"),
        master_row(17, "Meza Order"),
        master_row(21, "Jackson Wambali Developer Portfolio", status="Update requested; current status unknown"),
    ]
    content = make_register(rows=rows, priorities=[])
    sha = api.post("/api/v1/import/register/preview", files={"file": ("r.xlsx", content)}).json()["sha256"]
    api.post("/api/v1/import/register/commit", files={"file": ("r.xlsx", content)}, data={"sha256": sha})


def test_bundled_plan_is_valid():
    assert PLAN_ID in [p["id"] for p in bundled_plans()]
    plan = load_bundled(PLAN_ID)
    assert {p.match for p in plan.projects} >= {"DevGuardian AI", "Jackson Wambali Developer Portfolio"}


def test_preview_does_not_write(api, db):
    _import_real_names(api)
    res = api.post(f"/api/v1/import/plans/{PLAN_ID}?dry_run=true")
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["missing_projects"] == []
    assert body["counts"]["tasks_created"] == 14 and body["counts"]["milestones_created"] == 5
    assert db.scalar(select(func.count()).select_from(Task)) == 0


def test_apply_creates_plan_and_is_idempotent(api, db):
    _import_real_names(api)
    res = api.post(f"/api/v1/import/plans/{PLAN_ID}?dry_run=false").json()
    assert res["counts"]["tasks_created"] == 14 and res["counts"]["dependencies_added"] == 13
    projects = {p["name"]: p for p in api.get("/api/v1/projects?limit=50").json()["items"]}
    pf = projects["Jackson Wambali Developer Portfolio"]
    assert pf["lifecycle"] == "active" and pf["priority"] == "P1" and pf["target_date"] == "2026-12-18"
    assert projects["Meza Order"]["priority"] == "P2"

    # Progress made in the app survives re-applying the plan.
    suite = db.scalar(select(Task).where(Task.title == "Run the full reliability validation suite"))
    api.patch(f"/api/v1/tasks/{suite.id}", json={"status": "done"})
    again = api.post(f"/api/v1/import/plans/{PLAN_ID}?dry_run=false").json()
    assert again["counts"]["tasks_created"] == 0 and again["counts"]["tasks_updated"] == 14
    assert again["counts"]["dependencies_added"] == 0
    assert db.scalar(select(func.count()).select_from(Task)) == 14
    assert db.scalar(select(func.count()).select_from(Milestone)) == 5
    assert db.scalar(select(func.count()).select_from(TaskDependency)) == 13
    db.expire_all()
    assert db.get(Task, suite.id).status == "done"


def test_missing_projects_reported(api):
    res = api.post(f"/api/v1/import/plans/{PLAN_ID}?dry_run=true").json()
    assert "DevGuardian AI" in res["missing_projects"]
    assert res["counts"]["tasks_created"] == 0


def test_uploaded_plan_validation(api):
    _import_real_names(api)
    bad = {
        "name": "x",
        "projects": [{"match": "Meza Order", "tasks": [{"key": "a", "title": "A", "depends_on": ["nope"]}]}],
    }
    assert api.post("/api/v1/import/plan", json=bad).status_code == 422
    good = {"name": "x", "projects": [{"match": "17", "tasks": [{"key": "a", "title": "Rotate demo password"}]}]}
    res = api.post("/api/v1/import/plan?dry_run=false", json=good).json()
    assert res["counts"]["tasks_created"] == 1


def test_unknown_bundled_plan(api):
    assert api.post("/api/v1/import/plans/../etc?dry_run=true").status_code == 404
    assert api.post("/api/v1/import/plans/nope?dry_run=true").status_code == 404


def test_all_bundled_plans_parse():
    for info in bundled_plans():
        assert load_bundled(info["id"]).projects
