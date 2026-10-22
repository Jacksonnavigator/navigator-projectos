# Concepts and rules

The rules the app follows, so every number and date it shows can be traced back to stored data.

## Reported vs verified

* **Reported:** what you wrote down: a project's *Status*, *Status confidence* and *Evidence / notes* (as imported from the register), and evidence records marked “Reported”. Imported statuses are always treated as reported.
* **Verified:** evidence records that are
  * **automated**: created by an integration (currently: GitHub Actions workflow runs on synced repositories), or
  * **measured**: entered by you with an observation time, e.g. a sensor reading against a reference value.
* **Last verified** = the newest automated or measured record. An active/testing/deployed project with no verified evidence in **30 days** is flagged “No verified evidence in 30 days”.
* Manual entries can't claim to be *automated* (the API refuses it), and automated records can't be deleted from the UI.

## Stage (lifecycle)

`idea → planning → active → testing → deployed → completed`, plus `paused` and `archived`. **Completed** projects keep all their records as evidence, get a completion date automatically, appear in the dashboard's *Completed* list, and are left out of health flags and “what to work on next”. On import the stage is **inferred** from the Status text (you can change it afterwards):

| Status text contains | Stage |
| --- | --- |
| deployed | deployed |
| unknown, unclear, historical | paused |
| testing, validation, integration, troubleshooting, configuration | testing |
| requirements, planning, blueprint, concept, design, proposal | planning |
| exploration, idea, research notes | idea |
| active, development, prototype, ongoing, complete, installed, learning | active |
| (anything else) | planning |

Re-importing never overwrites a stage you changed; it only updates the register's own text fields, priorities and links.

## Progress

* **Project progress** = done **top-level** tasks ÷ all top-level tasks. Subtasks are excluded so that splitting one task into ten doesn't distort it. A project with no tasks shows **“Not measured”**, never 0 %.
* **Milestone progress** = done tasks in the milestone ÷ tasks in the milestone. A milestone can only be marked complete when **all** its tasks are done.
* A GitHub issue/PR counts as done only when it is **closed/merged on GitHub**. You can't mark an open GitHub issue done in ProjectOS, and you can't reopen a closed one here either.

## Timeline dates

Each bar's start and end come from the first available source, and the source is shown when you hover the bar:

| | 1st | 2nd | 3rd | 4th |
| --- | --- | --- | --- | --- |
| **Start** | your start date | GitHub Projects start field | GitHub issue created date | date the task was created here |
| **End** | your due date | GitHub Projects end field | milestone due date | none: an open-ended (fading) bar |

* Your local dates are never changed by a sync.
* If an end date is earlier than the inferred start (e.g. a task created after its milestone's due date), the start is moved to the end date and marked “moved to due date”.
* A milestone's date = your local override → its own due date → GitHub's `due_on`.
* **Overdue** = has an end date in the past and is not done.

## “What to work on next”

A fixed, transparent rule, not a prediction. Each task appears at most once:

1. overdue tasks (up to 5)
2. tasks due within 7 days (up to 5)
3. blocked tasks (up to 3)
4. the *next action* text of P1, then P2 projects (by rank)

## Sub-projects and related projects

* A **sub-project** (`parent`) is nested under its parent and **not counted** in the dashboard's project total (it's shown as “+N sub-projects”). Parent chains can't form cycles.
* **Related** projects are just linked both ways.
* On import, the app suggests links from your notes: explicit references (“project 3”), names and distinctive name parts (e.g. “DevGuardian”), and phrases like “part of”, “component of”, “merge its backlog into”. A phrase like those makes a **sub-project** suggestion; otherwise it's a **related** suggestion. You choose which to apply.

## GitHub sync

* **Read-only.** The client only sends `GET` requests and GraphQL queries; mutations are rejected in code.
* **What is synced** for each repository with *Sync* on: issues and pull requests (incrementally, using `since=` and a saved cursor), milestones, the latest 30 releases, the latest 20 completed Actions workflow runs (as automated evidence). For each Projects board with *Sync* on: item dates from the fields you mapped, the *Status* field, and draft items.
* **Linking:** when repositories are loaded, a repo is linked to a project automatically if exactly one project already has a link to that repo URL. Moving a repo to another project moves its synced issues, milestones and evidence too.
* **When it runs:** *Sync now*, opening the dashboard when data is older than `SYNC_STALE_MINUTES` (30), and the scheduled workflow every 4 hours. A run has a time budget (`SYNC_TIME_BUDGET_SECONDS`, 25 s). Work that doesn't fit continues next run from the saved cursor.
* **Efficiency:** milestones, releases and Actions runs use conditional requests (ETags), so unchanged data costs no rate limit. Rate-limit responses stop the run and are reported.
* **Webhooks** aren't used: a sleeping free instance takes about a minute to wake, which is longer than GitHub waits.

## Background jobs

Jobs live in the `background_jobs` table:

* **One at a time per key:** a partial unique index allows only one *queued/running* job per idempotency key (e.g. `github_sync_all`), so double-clicks and overlapping schedules don't run twice.
* **Locking:** jobs are claimed with `SELECT … FOR UPDATE SKIP LOCKED`.
* **Retries:** a failed job is retried after 1, 5 and 15 minutes, up to 3 attempts, then marked failed with its error.
* **Recovery:** a job stuck in *running* for 10 minutes (e.g. the instance slept mid-run) is re-queued, or failed if it has no attempts left.
* **Idempotent handlers:** every sync step is an upsert keyed by GitHub IDs; activity events have dedupe keys, so retries never duplicate data or notifications.

## Documents

* Files go to private storage under random keys; PostgreSQL stores only metadata (name, type, size, SHA-256, version).
* The type is detected from the file **content**, not the name. Allowed: PDF, PNG, JPEG, GIF, WebP, Word/Excel/PowerPoint, ZIP and UTF-8 text files. HTML, SVG and executables are refused. Default size limit: 15 MB.
* Downloads go through the API (session required) with `Content-Disposition: attachment`, `nosniff` and a sandboxing CSP. Only PDFs and images can be viewed inline.
* Deleting a document deletes all its stored versions.

## Money

Amounts are stored as `NUMERIC(16,2)` with an explicit 3-letter currency (default TZS). Totals are computed per currency and **never** added across currencies. Estimated, committed and actual amounts are kept apart.

## Work plans

A work plan (`backend/plans/*.json`) fills in project stages, priorities, dates, milestones, tasks and dependencies in one step. Open **Import register → Load a work plan**, press **Preview** (nothing is saved), then **Apply plan**.

* Projects are matched by register ID (e.g. `"match": "17"`) or by exact name.
* Milestones and tasks are matched by title within their project, so applying a plan again **updates** dates and criteria instead of duplicating, and never changes a task's status.
* To add a new plan, copy an existing file, change it, and push; it appears in the list after the next deploy.

## Dashboard

* **Focus projects:** one card per P1 project: progress ring (done ÷ all top-level tasks), next open milestone with a countdown, the next task (in-progress first, then earliest due), and when it was last verified.
* **This week:** Monday–Sunday with tasks and milestones due each day. Ticking a box marks a task done immediately and saves it. GitHub issues can only be finished on GitHub.
* **Tasks completed per week:** top-level tasks finished in each of the last 8 weeks.
* **Projects by stage:** click a bar to open those projects.
