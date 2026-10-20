# Deploying to a Render Web Service (free) with Supabase

Everything runs as **one Render Web Service** (free instance). The same service serves the API and the website. The database and uploaded files live in **Supabase** (free). GitHub sign-in uses a **GitHub OAuth App**.

Do the steps in this order. Each step says exactly what to click and what to copy. Keep a private notes file (not in Git) for the values marked 📋.

Secrets never go into the repository. They only go into Render's **Environment** page and, optionally, GitHub repository secrets.

---

## Step 0. Before you start

You need:

* A GitHub account (the one that owns `navigator-projectos`).
* A Render account: sign up at <https://render.com> with **GitHub**, so Render can see your repositories.
* A Supabase account: sign up at <https://supabase.com> with **GitHub**.
* Python on your computer (only to generate three random secrets in Step 1). On Windows, use `py` instead of `python` if `python` isn't found.

📋 **Your GitHub user id** (only this id may sign in): open <https://api.github.com/users/Jacksonnavigator> and copy the number after `"id":`.

## Step 1. Generate three secrets

Open a terminal (PowerShell on Windows) and run each line. Copy each output into your notes.

```bash
python -c "import secrets; print(secrets.token_urlsafe(48))"
python -c "import base64, os; print(base64.urlsafe_b64encode(os.urandom(32)).decode())"
python -c "import secrets; print(secrets.token_urlsafe(48))"
```

* 📋 First output: `SESSION_SECRET` (signs your login sessions).
* 📋 Second output: `ENCRYPTION_KEY` (encrypts your GitHub token in the database; must be exactly this format).
* 📋 Third output: `INTERNAL_SYNC_SECRET` (lets the scheduled GitHub sync call your app).

## Step 2. Supabase: database and file storage

1. Supabase dashboard → **New project**.
   * Name: `navigator-projectos`.
   * **Database password:** use only letters and numbers (no `@ : / # ?`), so it works inside a URL without escaping. 📋 Save it.
   * Region: **Central EU (Frankfurt)**, the same region you'll pick on Render.
   * Click **Create new project** and wait 1–2 minutes.
2. **Database connection string:** click **Connect** (top of the project page).
   * Choose the **Session pooler** connection (port `5432`, host like `aws-0-eu-central-1.pooler.supabase.com`).
   * Not *Direct connection* (IPv6-only; Render may not reach it) and not *Transaction pooler* (port 6543; breaks prepared statements).
   * Copy the URI and replace `[YOUR-PASSWORD]` with your password. 📋 This is `DATABASE_URL`. It looks like
     `postgresql://postgres.abcdefghijkl:YourPassword123@aws-0-eu-central-1.pooler.supabase.com:5432/postgres`
3. **Storage bucket:** left menu **Storage** → **New bucket**.
   * Name: `documents`.
   * **Public bucket: OFF.**
   * Create.
4. **Project URL and secret key:**
   * 📋 **Project URL:** click **Connect** (or **Project Settings → Data API**) and copy the URL that looks like `https://abcdefghijkl.supabase.co`. This is `SUPABASE_URL`.
   * 📋 **Secret key:** **Project Settings → API Keys**. You'll see a **Publishable key** (`sb_publishable_…`) and a **Secret key** (`sb_secret_…`). Copy the **Secret key** (click the eye/copy icon; create one with **+ New secret key** if the list is empty). This is `SUPABASE_SERVICE_KEY`.
   * Don't use the publishable key: it can't reach a private bucket. The secret key gives full access to your project, so it only ever goes into Render's Environment page.
   * Older projects may show *Legacy API keys* (`anon` / `service_role`) instead; the `service_role` key also works.

## Step 3. Render: create the Web Service

1. Render dashboard → **+ New** → **Web Service**.
2. **Source code:** choose **Git Provider → GitHub**, then select `Jacksonnavigator/navigator-projectos`.
   * If it isn't listed: click **Configure account** / **Connect GitHub**, and allow Render to access the `navigator-projectos` repository.
3. Fill in the form exactly:

   | Field | Value |
   | --- | --- |
   | Name | `navigator-projectos` |
   | Project | (optional) leave empty |
   | Language | **Python 3** |
   | Branch | the branch that has the code (`claude/trusting-wright-j0u3so`, or `main` if you renamed it) |
   | Region | **Frankfurt (EU Central)** |
   | Root Directory | leave **empty** |
   | Build Command | `cd frontend && npm ci && npm run build && cd ../backend && pip install -r requirements.txt` |
   | Start Command | `cd backend && alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port $PORT --proxy-headers --forwarded-allow-ips='*'` |
   | Instance Type | **Free** |

4. **Environment Variables** (same page, *Environment Variables* section → *Add Environment Variable* for each):

   | Key | Value |
   | --- | --- |
   | `PYTHON_VERSION` | `3.13.5` |
   | `NODE_VERSION` | `22` |
   | `ENVIRONMENT` | `production` |
   | `PUBLIC_BASE_URL` | `https://navigator-projectos.onrender.com` (check it in Step 4 and fix it if Render gives a different URL) |
   | `DATABASE_URL` | 📋 from Step 2.2 |
   | `SESSION_SECRET` | 📋 from Step 1 |
   | `ENCRYPTION_KEY` | 📋 from Step 1 |
   | `INTERNAL_SYNC_SECRET` | 📋 from Step 1 |
   | `ALLOWED_GITHUB_USER_IDS` | 📋 your GitHub id from Step 0 |
   | `STORAGE_BACKEND` | `supabase` |
   | `SUPABASE_URL` | 📋 from Step 2.4 |
   | `SUPABASE_SERVICE_KEY` | 📋 from Step 2.4 |
   | `SUPABASE_BUCKET` | `documents` |

   You'll add `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` in Step 5, because the GitHub app needs the Render URL first.

5. Open **Advanced**:
   * **Health Check Path:** `/api/v1/health/live`
   * **Auto-Deploy:** *On Commit* (default).
6. Click **Deploy Web Service**. The first build takes about 3–6 minutes. Watch the **Logs** tab.

**Success looks like** these lines in the log: `Running upgrade -> 0001, initial schema`, then `Uvicorn running on http://0.0.0.0:10000`. Render then shows **Live**.

**If it fails**, the log tells you why:
* `Invalid production configuration: …` lists exactly which variable is missing or wrong.
* `password authentication failed` or `could not translate host name`: re-check `DATABASE_URL` (Session pooler, password filled in).
* `npm: command not found` or a Node error: check `NODE_VERSION` is `22`.

## Step 4. Check the URL

At the top of the service page Render shows the URL, e.g. `https://navigator-projectos.onrender.com`. If the name was taken, Render adds letters (e.g. `navigator-projectos-ab12.onrender.com`).

* 📋 Save the exact URL.
* If it differs from `PUBLIC_BASE_URL`, go to **Environment**, fix `PUBLIC_BASE_URL` (no trailing `/`), and choose **Save, rebuild, and deploy**.
* Open `<your URL>/api/v1/health/ready` in the browser. You should see `{"status":"ok","database":"ok","migration":"0001"}`.
* Open `<your URL>`. The login page should load and say GitHub sign-in isn't configured yet. That's expected.

## Step 5. GitHub OAuth App (sign-in and read access)

1. GitHub → your avatar → **Settings** → **Developer settings** (bottom left) → **OAuth Apps** → **New OAuth App**.
2. Fill in:
   * **Application name:** `Navigator ProjectOS`
   * **Homepage URL:** your Render URL, e.g. `https://navigator-projectos.onrender.com`
   * **Authorization callback URL:** your Render URL + `/api/v1/auth/github/callback`, e.g. `https://navigator-projectos.onrender.com/api/v1/auth/github/callback`
   * Leave *Enable Device Flow* unchecked.
3. **Register application.**
4. 📋 Copy the **Client ID**.
5. Click **Generate a new client secret**. 📋 Copy it immediately (GitHub shows it only once).
6. Back in Render → your service → **Environment** → add:

   | Key | Value |
   | --- | --- |
   | `GITHUB_CLIENT_ID` | 📋 Client ID |
   | `GITHUB_CLIENT_SECRET` | 📋 Client secret |

   Then **Save, rebuild, and deploy** and wait until it's **Live** again.

Why these permissions? The app asks GitHub for `read:user repo read:project`. `read:project` is needed to read your personal **Projects** boards; `repo` is the only way GitHub allows reading **private** repositories. The app itself only reads: its GitHub client sends only read requests and refuses any write. If all your repositories are public, add `GITHUB_OAUTH_SCOPES` = `read:user public_repo read:project` for narrower access.

## Step 6. First sign-in and setup

1. Open your Render URL → **Sign in with GitHub** → **Authorize**. You land on the dashboard.
   * “That GitHub account is not allowed”: the page shows your id. Put exactly that number in `ALLOWED_GITHUB_USER_IDS` and redeploy.
   * “The sign-in link expired”: `PUBLIC_BASE_URL` and the GitHub callback URL must match your Render URL exactly.
2. **Import register** → choose your `.xlsx` → review the preview and the suggested sub-project links → **Import**.
3. **GitHub** → **Load my repositories**. Repos your projects already mention (e.g. Meza Order → `restaurant`) are linked automatically. For the others, pick the project and tick **Sync**.
4. **GitHub** → **Load my boards** → for each Projects board pick the *Start* and *End* date fields and tick **Sync**.
5. Press **Sync now**, wait a few seconds, then open **Timeline**.

From now on the free instance sleeps after 15 minutes without visits; the next visit takes about a minute and the app shows “Waking up the server…”.

## Step 7 (recommended). Automatic sync every 4 hours

The free Web Service has no scheduler of its own, so a GitHub Actions workflow in the repo calls it.

1. **First check that GitHub Actions can run for your account.** The CI runs on this repo so far stopped after ~3 seconds without logs, which usually means GitHub isn't allowing Actions to start (billing, spending limit or Actions disabled). Check:
   * Repo → **Actions** tab: open a failed run and read the message at the top.
   * GitHub → **Settings → Billing and plans**: no payment problem; for private repos the free plan includes 2,000 Actions minutes per month.
   * Repo → **Settings → Actions → General**: *Allow all actions* is selected.
2. Repo → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**, twice:
   * `APP_URL` = your Render URL
   * `INTERNAL_SYNC_SECRET` = the same value you put on Render
3. Repo → **Actions** → **Scheduled GitHub sync** → **Run workflow** to test it. The log should end with `jobs run: 1`.

This also keeps the free Supabase database from pausing for inactivity.

## Step 8 (recommended). Weekly encrypted database backups

1. Install [age](https://github.com/FiloSottile/age/releases) and run `age-keygen -o projectos-backup-key.txt`.
   * Keep that file safe and **never** upload it. Without it, backups can't be decrypted.
   * 📋 Copy the printed public key (starts with `age1…`).
2. Add two more repository secrets:
   * `BACKUP_AGE_RECIPIENT` = the `age1…` public key
   * `BACKUP_DATABASE_URL` = your `DATABASE_URL`
3. **Actions** → **Database backup** → **Run workflow** once to test. The run should produce an artifact `projectos-backup-<date>`.

Also use **Settings → Download everything (JSON)** in the app now and then. Restore steps are in [OPERATIONS.md](OPERATIONS.md#restore-a-backup).

## Checklist

- [ ] Step 0: GitHub id copied
- [ ] Step 1: three secrets generated
- [ ] Step 2: Supabase project, Session pooler URL, private `documents` bucket, Project URL and secret key (`sb_secret_…`)
- [ ] Step 3: Render Web Service created and **Live**
- [ ] Step 4: URL checked, `/api/v1/health/ready` says `ok`
- [ ] Step 5: GitHub OAuth App created, client id and secret added on Render
- [ ] Step 6: signed in, register imported, repos and boards linked, first sync done
- [ ] Step 7: Actions working, scheduled sync secrets added
- [ ] Step 8: backup key created, backup secrets added, first backup run
