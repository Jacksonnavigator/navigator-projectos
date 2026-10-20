# Navigator ProjectOS

A personal **project command center**: one browser app and one source of truth for software, AI, IoT, research, business and content projects. It imports your Excel project register, connects to GitHub (read-only), and shows everything on a dashboard, a Gantt-style timeline, a Kanban board, lists and a calendar.

Built for a single owner, hosted on **Render's free plan** with a **Supabase** PostgreSQL database.

## What it does

| Module | What you get |
| --- | --- |
| Command Dashboard | Counts, “what to work on next” (with the rule shown), overdue and upcoming work, project health, recent activity |
| Project Registry | Every project with the register's fields, sub-projects and related projects, links, archive/restore, duplicate-as-template |
| Excel import | Preview before saving, Priority Plan joined in, suggested parent/related links, re-import updates instead of duplicating |
| Tasks & milestones | Subtasks, dependencies (cycle-checked), comments, acceptance criteria, milestones that can't be completed while tasks are open |
| Timeline | Gantt bars with dependency arrows, milestones, releases, project target dates; **every date shows its source** |
| Board / list / calendar | Drag-and-drop Kanban (with a keyboard alternative), filterable list, month calendar |
| GitHub (read-only) | Sign in with GitHub, link repos to projects, sync issues/PRs, milestones, releases, Actions results and **GitHub Projects boards with your date fields** |
| Health & tests | *Reported* status kept separate from *verified* evidence (CI results, your measurements), stale-evidence flags |
| Documents | Private file storage (Supabase bucket), versions, Markdown notes, search |
| Business | Costs, revenue, funding needs, investors, opportunities; totals per currency |
| Settings | Time zone, theme, JSON/Excel export, delete-everything |

AI assistant and AI workforce (modules 8–9) are **not built yet**; there is a provider-agnostic interface in `backend/app/ai/` for later.

## Architecture

```
Browser ──HTTPS──▶ Render free web service (one process)
                    ├─ FastAPI  /api/v1  (auth, projects, tasks, sync, ...)
                    └─ serves the built React app (same origin → first-party cookies)
                          │
                          ├──▶ Supabase PostgreSQL   (all records)
                          ├──▶ Supabase Storage      (private "documents" bucket)
                          └──▶ GitHub API            (read-only)

GitHub Actions (in this repo)
  ├─ ci.yml               lint, type-check, tests on every push
  ├─ scheduled-sync.yml   wakes the app every 4 h and triggers a GitHub sync
  └─ backup.yml           weekly encrypted pg_dump kept as a private artifact
```

* **Backend:** Python 3.13, FastAPI, SQLAlchemy 2, Alembic, PostgreSQL, pytest.
* **Frontend:** React 19, TypeScript, Vite, Tailwind CSS 4, TanStack Query, Vitest, Playwright.
* **No Docker, no Redis, no worker process.** Background work uses a PostgreSQL job table (see [docs/CONCEPTS.md](docs/CONCEPTS.md)).

## Run it locally

Requirements: Python 3.12+, Node 22, PostgreSQL 15+.

```bash
# 1. Database
createuser -P nav            # password: nav (local only)
createdb -O nav navigator

# 2. Backend
cd backend
python -m venv .venv && . .venv/bin/activate
pip install -r requirements-dev.txt
cp .env.example .env         # then fill in SESSION_SECRET and ENCRYPTION_KEY (commands are in the file)
alembic upgrade head
uvicorn app.main:app --reload --port 8000

# 3. Frontend (another terminal)
cd frontend
npm install
npm run dev                  # http://localhost:5173, proxies /api to :8000
```

With `DEV_LOGIN_ENABLED=true` the login page shows **Development sign-in**, so you can use the app without setting up GitHub. It is refused in production.

## Tests and checks

```bash
cd backend && . .venv/bin/activate
ruff check . && ruff format --check . && mypy app
DATABASE_URL=postgresql+psycopg://nav:nav@localhost:5432/navigator_test python -m pytest -q

cd frontend
npm run lint && npm run typecheck && npm test && npm run build
PLAYWRIGHT_CHROMIUM_PATH=/path/to/chromium npm run e2e   # needs a navigator_e2e database
```

## Deploy

Follow **[docs/DEPLOY_RENDER.md](docs/DEPLOY_RENDER.md)**. It takes about 30–45 minutes: create a Supabase project, a Render **Web Service** (free), then a GitHub OAuth App.

## Documentation

* [docs/DEPLOY_RENDER.md](docs/DEPLOY_RENDER.md): step-by-step deployment
* [docs/CONCEPTS.md](docs/CONCEPTS.md): date rules, progress definitions, evidence, sync and jobs
* [docs/OPERATIONS.md](docs/OPERATIONS.md): backups and restore, upgrades, rollback, troubleshooting, security
* [docs/PHASE_REPORT.md](docs/PHASE_REPORT.md): what was built in each phase and how it was verified

## Status

Phases 1–6 are implemented and tested locally (see the phase report). Not yet verified: a real deployment on Render/Supabase and a real GitHub account connection. Those need your accounts and credentials.
