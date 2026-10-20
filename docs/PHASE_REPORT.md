# Phase report

Built on 2026-10-20 in a Linux cloud container (Python 3.13, Node 22, PostgreSQL 16). Everything below was **run** in that container unless it says otherwise. Nothing has been deployed to Render or Supabase yet, and no real GitHub account has been connected; those need the owner's credentials (see [DEPLOY_RENDER.md](DEPLOY_RENDER.md)).

## Final verification (all phases)

| Check | Command | Result |
| --- | --- | --- |
| Backend lint/format | `ruff check . && ruff format --check .` | passed |
| Backend types | `mypy app` | no issues in 45 files |
| Backend tests | `python -m pytest -q` (real PostgreSQL) | **64 passed** |
| Migrations match models | `alembic check` | no differences |
| Migration up/down | `alembic upgrade head`, `downgrade base`, `upgrade head` | passed |
| Frontend lint/types | `npm run lint && npm run typecheck` | passed |
| Frontend unit tests | `npm test` | **11 passed** |
| Production build | `npm run build` | passed (JS ≈ 127 kB gzipped) |
| Browser end-to-end | `npm run e2e` (Chromium, real API and database) | **4 passed** |
| Dependency audit | `pip-audit -r requirements.txt`, `npm audit --omit=dev` | no known vulnerabilities |
| Backup/restore | `pg_dump` → `age` encrypt → decrypt → `pg_restore` into an empty DB | row counts and migration revision matched |
| Real register | preview of the owner's 33-row register (not committed) | 33 projects, all 10 Priority Plan rows matched, 6 relation suggestions |
| Visual check | screenshots of dashboard, timeline (light/dark), project, board, health, mobile 390 px | no horizontal overflow on mobile |

---

## Phase 1: Foundation

**Implemented:** repository structure; FastAPI app with validated settings (production refuses unsafe config), JSON logs, request IDs, a consistent error format, security headers, CSRF double-submit, rate limiting; the full relational schema (Alembic `0001`); GitHub OAuth sign-in restricted to allowlisted user ids, sessions stored as HMAC hashes, GitHub token encrypted with Fernet; dev-only sign-in; React/Vite/Tailwind shell with sidebar, light/dark theme and cold-start banner, served by FastAPI from the same origin; `render.yaml`; CI.

**Key files:** `backend/app/core/*`, `backend/app/models/*`, `backend/migrations/versions/0001_initial_schema.py`, `backend/app/api/v1/auth.py`, `frontend/src/lib/api.ts`, `frontend/src/components/{Layout,ui}.tsx`, `render.yaml`, `.github/workflows/ci.yml`.

**Tests:** `tests/test_auth.py`: health/ready, headers, 401s, JSON 404s, CSRF, dev login/logout with audit, GitHub callback (allowed user gets a session and an encrypted token; others are rejected and nothing is stored), forged state, rate limit, production config validation.

**Security notes:** only GET/redirects are unauthenticated; the OAuth `state` is checked in constant time; query strings are not logged.

## Phase 2: Project registry and Excel import

**Implemented:** project CRUD, search/filters/sort, archive/restore, duplicate (with local tasks and milestones, usable as templates), links (auto-detected kinds; `javascript:` and other schemes rejected), parent/sub-projects with cycle prevention, related projects. Register import with preview (no writes), SHA-256-checked commit, Priority Plan join (exact, then unambiguous partial name), relation suggestions, row problems (duplicates, missing names, bad IDs), re-import updating instead of duplicating; Excel export in the same format.

**Tests:** `tests/test_projects.py`, `tests/test_register_import.py` (synthetic registers shaped like the real one), plus a round-trip test (export → import shows all rows unchanged).

**Limitations:** the stage (lifecycle) is inferred from free text (rules in [CONCEPTS.md](CONCEPTS.md)); check it after the first import.

## Phase 3: Tasks, milestones, timeline, dashboard

**Implemented:** tasks, subtasks, dependencies with cycle detection, comments, acceptance criteria; milestones that can't be completed while tasks are open; timeline with per-date sources, dependency arrows, milestones, releases and project targets; month calendar; Kanban with drag-and-drop and a keyboard-friendly status menu; filterable task list; command dashboard with documented progress definitions and a transparent next-action rule.

**Tests:** `tests/test_tasks.py` (13 tests), e2e “task, milestone, dependency and timeline workflow”.

## Phase 4: GitHub integration

**Implemented:** repo discovery with automatic linking from registry URLs; incremental issue/PR sync with a saved cursor; milestones, releases and Actions runs (ETag-conditional); Projects v2 boards with user-mapped start/end fields and draft items; moving a repo moves its items; disconnect revokes the grant. PostgreSQL job queue (dedupe, SKIP LOCKED, retries, stale-lock recovery). Sync triggers: *Sync now*, stale-on-open, and the scheduled workflow through a secret-protected endpoint.

**Tests:** `tests/test_github_sync.py` (13 tests against a mocked GitHub API): full import, idempotent re-sync with reopen, local fields surviving sync, per-repo errors, revoked token → retry, board dates winning over milestone dates, `if_stale`, internal endpoint auth, repo move, disconnect, mutation guard.

**Not verified:** calls against the real GitHub API (no credentials in this environment). The request shapes follow GitHub's documented REST and GraphQL APIs, but the first real sync is the real test. Check the GitHub page's sync history after connecting.

**Decision (differs from the original prompt):** a **GitHub OAuth App** instead of a GitHub App. In GitHub's permission list, the *Projects* permission for GitHub Apps is organization-level only; reading personal Projects (v2) boards needs the `read:project` OAuth scope. The trade-off is that `repo` is broader than needed, so read-only behaviour is enforced in code.

## Phase 5: Health, testing and documents

**Implemented:** evidence records (automated / measured / reported) with measurements and reference values, health overview (reported vs verified, 30-day staleness), documents with content-sniffed uploads, versions, private storage (local for dev, Supabase in production), safe downloads, Markdown notes and search.

**Tests:** `tests/test_ops.py` (evidence rules, uploads, rejected HTML/SVG/mislabelled files, size limit, Office/text detection, search, deletion removes stored files), e2e “record evidence and upload a private document”.

**Not verified:** the Supabase Storage backend against a real bucket (tests use local storage; the Supabase client follows its documented storage REST API).

## Phase 6: Business tracking, export, operations

**Implemented:** business entries with per-currency summaries; JSON export without secrets; Excel register export; delete-everything with a typed confirmation; weekly encrypted backup workflow; scheduled sync workflow; operations guide.

**Tests:** business validation and per-currency totals, export has no secrets, register round-trip, delete-everything.

## Known limitations

* Single owner by design: no teams, roles or billing.
* No email notifications (Render's free plan blocks SMTP); reminders appear on the dashboard instead.
* GitHub write-back (closing issues, editing board dates) is intentionally not implemented.
* Rate limiting is per process (fine for one free instance).
* The AI assistant (Phase 7) has only an interface (`backend/app/ai/`), no implementation.

## Next recommended phase

1. **Deploy** following [DEPLOY_RENDER.md](DEPLOY_RENDER.md), import the register, connect GitHub and run the first real sync.
2. Use it for a week; then decide on **GitHub write-back** (opt-in, per-action confirmation) if you want to close issues or change board dates from the timeline.
3. **Phase 7, AI assistant:** read-only Q&A over your records with citations, starting with a hosted model (Render can't reach your private `wise-lab` server without a secure tunnel).
