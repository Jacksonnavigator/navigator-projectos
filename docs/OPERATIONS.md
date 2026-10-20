# Operations

## Backups

You have three layers:

1. **Weekly encrypted dump:** `.github/workflows/backup.yml` (set up in [DEPLOY_RENDER.md](DEPLOY_RENDER.md#6-weekly-encrypted-backups-recommended)). Artifacts are kept for 90 days.
2. **Your own exports:** *Settings → Download everything (JSON)* and *Download project register (Excel)*. The Excel file uses the import format, so it can be imported again.
3. **Document files** live in the Supabase `documents` bucket; download important ones yourself. Supabase's free plan has no bucket backups.

### Restore a backup

Tested locally on 2026-10-20: encrypt with age, decrypt, `pg_restore` into an empty database; row counts and the migration version matched the original.

```bash
# 1. Download the artifact from GitHub (Actions → Database backup → run → Artifacts) and unzip it.
# 2. Create an EMPTY target database (a new Supabase project, or a local one):
createdb -O nav navigator_restore
# 3. Decrypt and restore:
age -d -i projectos-backup-key.txt projectos-YYYYMMDDTHHMMZ.dump.age \
  | pg_restore --no-owner --no-privileges -d "postgresql://USER:PASS@HOST:5432/navigator_restore"
# 4. Check it:
DATABASE_URL=postgresql://USER:PASS@HOST:5432/navigator_restore alembic current   # should print the head revision
```

Then point Render's `DATABASE_URL` at the restored database and redeploy. Restore into an *empty* database. Restoring over existing tables fails on conflicts by design.

## Upgrading

**Dependencies** are pinned (`backend/requirements*.txt`, `frontend/package-lock.json`).

1. Create a branch.
2. Backend: `pip install -U <package>` in the venv, run the full test suite, then update the pin in `requirements.txt`.
3. Frontend: `npm install <package>@<version>`, then `npm run lint && npm run typecheck && npm test && npm run build`.
4. `npm audit --omit=dev` and `pip install pip-audit && pip-audit -r backend/requirements.txt` for known vulnerabilities.
5. Push; CI must be green before merging. Render deploys the default branch automatically.

**Database changes:** edit the models, then `alembic revision --autogenerate -m "describe change"`, **read the generated file**, and test `alembic upgrade head` and `alembic downgrade -1` locally. CI runs `alembic check` to catch models that don't match migrations. Migrations run automatically when the Render service starts.

## Rolling back

* **Code:** Render dashboard → service → *Events* → *Rollback* to a previous deploy (the free plan keeps the last two). Or revert the commit and push.
* **Database:** prefer rolling *forward* with a new migration. If you must downgrade, take a backup first, then run `alembic downgrade <revision>` from your machine against the production `DATABASE_URL`. Downgrades can drop data in new columns.

## Health checks

* `GET /api/v1/health/live`: the process is up (Render's health check).
* `GET /api/v1/health/ready`: database reachable; returns the migration revision. `503` means the database is unreachable (e.g. a paused Supabase project).
* Logs are JSON lines in the Render dashboard. Every response has an `X-Request-ID`; error messages in the UI show it as “Reference”, so you can search the logs for it.

## Troubleshooting

| Symptom | Likely cause / fix |
| --- | --- |
| First page load takes ~1 minute | Normal on the free plan after 15 idle minutes. |
| Login page: “not allowed” with an id | Add that id to `ALLOWED_GITHUB_USER_IDS` on Render and redeploy. |
| Login page: “expired or was tampered with” | The OAuth `state` cookie is missing: check `PUBLIC_BASE_URL` exactly matches the URL you use and the GitHub callback URL. |
| Login page: “not configured” | `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` aren't set. |
| Service won't start, log says “Invalid production configuration” | The message lists what's missing (e.g. `ENCRYPTION_KEY`, https `PUBLIC_BASE_URL`, Supabase storage). |
| `/health/ready` returns 503 | Supabase is paused or the URL/password is wrong. Restore the project in Supabase, check `DATABASE_URL` (use the session pooler). |
| GitHub page: “GitHub rejected the token” | The token was revoked or expired. Sign out and sign in with GitHub again. |
| Repo shows “Last sync error” | Open the GitHub page. The error is GitHub's message (e.g. no access, repository renamed). Other repos still sync. |
| Board items missing from the timeline | The item's repository isn't synced, or the board's start/end fields aren't mapped. |
| Upload refused | Only the listed file types are accepted, detected by content (an `.html` renamed to `.pdf` is refused). |
| “Storage is unavailable” on upload | `SUPABASE_URL`/`SUPABASE_SERVICE_KEY` wrong, or the `documents` bucket doesn't exist. |
| Scheduled sync workflow prints `github_not_connected` | Sign in to the app with GitHub at least once so a token is stored. |

## Security checklist

* [x] Only allowlisted GitHub user ids can sign in; every other API route requires a session.
* [x] Sessions: random 256-bit tokens, stored only as HMAC hashes, HttpOnly + Secure + SameSite=Lax cookies, 14-day expiry, revocable by signing out.
* [x] CSRF: double-submit token required on every state-changing request.
* [x] Rate limits on sign-in, import and the internal sync endpoint.
* [x] GitHub token encrypted at rest (Fernet); never logged; “Disconnect” revokes the grant on GitHub and deletes it.
* [x] GitHub access is read-only in code; mutations are rejected.
* [x] Security headers: CSP (no inline scripts), frame-ancestors none, nosniff, HSTS, strict referrer policy.
* [x] Uploads: content-type sniffing, size limit, random keys, private bucket, attachment downloads with a sandbox CSP.
* [x] Markdown rendered without HTML; only http(s) links.
* [x] Parameterized SQL everywhere (SQLAlchemy); request validation with Pydantic.
* [x] Production refuses to start with dev login on, default secrets, http URLs or local file storage.
* [x] Logs exclude query strings (OAuth codes) and redact token-like fields.
* [x] Exports never include tokens or session data.
* [ ] Supabase: rotate the database password and secret key (`sb_secret_…`) if they ever leak; never paste them into the register.
* [ ] Review `npm audit` / `pip-audit` output when upgrading.
