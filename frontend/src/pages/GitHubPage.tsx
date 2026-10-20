import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ProjectSelect } from "../components/domain";
import { Badge, Button, Card, ConfirmDialog, EmptyState, ErrorState, InlineError, Input, LoadingBlock, PageHeader, Select } from "../components/ui";
import { del, get, patch, post } from "../lib/api";
import { formatDateTime, relativeTime } from "../lib/format";
import type { Board, GitHubStatus, Job, Repo } from "../lib/types";

export default function GitHubPage() {
  const qc = useQueryClient();
  const status = useQuery({ queryKey: ["github", "status"], queryFn: () => get<GitHubStatus>("/github/status") });
  const jobs = useQuery({
    queryKey: ["github", "jobs"],
    queryFn: () => get<Job[]>("/github/jobs"),
    refetchInterval: (q) => (q.state.data?.some((j) => j.status === "queued" || j.status === "running") ? 3000 : false),
  });
  const running = jobs.data?.some((j) => j.status === "running" || (j.status === "queued" && j.attempts === 0));
  const wasRunning = useWasRunning(Boolean(running));
  useEffect(() => {
    if (wasRunning && !running) void qc.invalidateQueries();
  }, [wasRunning, running, qc]);

  const sync = useMutation({
    mutationFn: () => post("/github/sync"),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["github"] }),
  });
  const [disconnecting, setDisconnecting] = useState(false);
  const disconnect = useMutation({
    mutationFn: () => del("/github/connection"),
    onSuccess: () => {
      setDisconnecting(false);
      void qc.invalidateQueries({ queryKey: ["github"] });
    },
  });

  if (status.isPending) return <LoadingBlock rows={4} />;
  if (status.error) return <ErrorState error={status.error} onRetry={() => void status.refetch()} />;
  const s = status.data;

  return (
    <>
      <PageHeader
        title="GitHub"
        description="Read-only: ProjectOS reads repositories, issues, pull requests, milestones, releases, Actions results and Projects boards. It never writes to GitHub."
        actions={
          s.connected ? (
            <>
              <Button variant="primary" onClick={() => sync.mutate()} busy={sync.isPending || Boolean(running)} disabled={s.repos_synced + s.boards_synced === 0}>
                {running ? "Syncing…" : "Sync now"}
              </Button>
              <Button variant="ghost" onClick={() => setDisconnecting(true)}>
                Disconnect
              </Button>
            </>
          ) : (
            <a href="/api/v1/auth/github/login" className="inline-flex h-10 items-center rounded-md bg-accent px-4 text-sm font-medium text-accent-ink hover:bg-accent-strong">
              Connect GitHub
            </a>
          )
        }
      />
      <InlineError error={sync.error} />
      {!s.connected ? (
        <EmptyState title="GitHub is not connected" description="Sign in with GitHub again to give ProjectOS read access to your repositories and Projects boards." />
      ) : (
        <div className="space-y-6">
          <div className="grid gap-3 sm:grid-cols-4">
            <Card>
              <p className="text-xs text-muted">Account</p>
              <p className="mt-1 font-medium">@{s.login}</p>
              <p className="mt-1 break-words text-xs text-muted">Scopes: {s.scopes || "—"}</p>
            </Card>
            <Card>
              <p className="text-xs text-muted">Repositories synced</p>
              <p className="mt-1 text-xl font-semibold">
                {s.repos_synced} <span className="text-sm font-normal text-muted">of {s.repos_total}</span>
              </p>
            </Card>
            <Card>
              <p className="text-xs text-muted">Projects boards synced</p>
              <p className="mt-1 text-xl font-semibold">
                {s.boards_synced} <span className="text-sm font-normal text-muted">of {s.boards_total}</span>
              </p>
            </Card>
            <Card>
              <p className="text-xs text-muted">Last sync</p>
              <p className="mt-1 font-medium">{relativeTime(s.last_synced_at)}</p>
              <p className="mt-1 text-xs text-muted">Auto-sync when older than {s.stale_minutes} min, plus the scheduled workflow.</p>
            </Card>
          </div>
          <ReposCard />
          <BoardsCard />
          <Card title="Recent sync runs">
            {jobs.data?.length ? (
              <ul className="divide-y divide-line text-sm">
                {jobs.data.map((j) => (
                  <li key={j.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span>
                      {formatDateTime(j.created_at)} · attempt {j.attempts}
                      {j.last_error && <span className="block text-xs text-bad">{j.last_error}</span>}
                      {j.result && <SyncSummary result={j.result} />}
                    </span>
                    <Badge tone={j.status === "succeeded" ? "ok" : j.status === "failed" ? "bad" : "warn"}>{j.status}</Badge>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">No sync has run yet.</p>
            )}
          </Card>
        </div>
      )}
      <ConfirmDialog
        open={disconnecting}
        title="Disconnect GitHub?"
        message="ProjectOS will revoke its access on GitHub and delete the stored token. Data already synced stays. You'll need to sign in with GitHub again to sync."
        confirmLabel="Disconnect"
        busy={disconnect.isPending}
        onConfirm={() => disconnect.mutate()}
        onCancel={() => setDisconnecting(false)}
      />
    </>
  );
}

function useWasRunning(running: boolean) {
  const [was, setWas] = useState(false);
  const [prev, setPrev] = useState(running);
  if (prev !== running) {
    setPrev(running);
    setWas(prev);
  }
  return was;
}

function SyncSummary({ result }: { result: Record<string, unknown> }) {
  const repos = (result.repos as { repo: string; issues_and_prs?: number; error?: string }[]) ?? [];
  const boards = (result.boards as { board: string; matched?: number; drafts?: number; error?: string }[]) ?? [];
  return (
    <span className="block text-xs text-muted">
      {repos.map((r) => `${r.repo}: ${r.error ? `error (${r.error})` : `${r.issues_and_prs ?? 0} issues/PRs updated`}`).join(" · ")}
      {boards.length > 0 && " · "}
      {boards.map((b) => `${b.board}: ${b.error ? "error" : `${b.matched ?? 0} items, ${b.drafts ?? 0} drafts`}`).join(" · ")}
      {result.incomplete ? " · continues next run" : ""}
    </span>
  );
}

function ReposCard() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState("");
  const repos = useQuery({ queryKey: ["github", "repos"], queryFn: () => get<Repo[]>("/github/repos") });
  const refresh = useMutation({
    mutationFn: () => post<{ repos: number; new: number; auto_linked: number }>("/github/repos/refresh"),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["github"] }),
  });
  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) => patch(`/github/repos/${id}`, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["github"] });
      void qc.invalidateQueries({ queryKey: ["projects"] });
    },
  });
  const shown = repos.data?.filter((r) => r.full_name.toLowerCase().includes(filter.toLowerCase())) ?? [];
  return (
    <Card
      title="Repositories"
      actions={
        <Button size="sm" onClick={() => refresh.mutate()} busy={refresh.isPending}>
          {repos.data?.length ? "Reload list from GitHub" : "Load my repositories"}
        </Button>
      }
    >
      {refresh.data && (
        <p className="mb-3 text-sm text-ok" role="status">
          Found {refresh.data.repos} repositories ({refresh.data.new} new). {refresh.data.auto_linked} linked automatically because a project already references them.
        </p>
      )}
      <InlineError error={refresh.error ?? update.error} />
      {repos.isPending ? (
        <LoadingBlock rows={3} />
      ) : !repos.data?.length ? (
        <p className="text-sm text-muted">Load your repositories, then link each one to a project and turn on sync.</p>
      ) : (
        <>
          <label htmlFor="repo-filter" className="sr-only">
            Filter repositories
          </label>
          <Input id="repo-filter" type="search" placeholder="Filter repositories" value={filter} onChange={(e) => setFilter(e.target.value)} className="mb-3 max-w-xs" />
          <ul className="divide-y divide-line">
            {shown.map((r) => (
              <li key={r.id} className="flex flex-col gap-2 py-3 md:flex-row md:items-center">
                <div className="min-w-0 flex-1">
                  <a href={r.html_url} target="_blank" rel="noopener noreferrer" className="font-medium hover:underline">
                    {r.full_name}
                  </a>{" "}
                  {r.private && <Badge>Private</Badge>} {r.archived && <Badge tone="warn">Archived</Badge>}
                  <p className="text-xs text-muted">
                    {r.sync_enabled ? `Synced ${relativeTime(r.last_synced_at)}` : "Not synced"}
                    {r.pushed_at && ` · last push ${relativeTime(r.pushed_at)}`}
                  </p>
                  {r.last_sync_error && <p className="text-xs text-bad">Last sync error: {r.last_sync_error}</p>}
                </div>
                <div className="flex items-center gap-3">
                  <label htmlFor={`repo-proj-${r.id}`} className="sr-only">
                    Project for {r.full_name}
                  </label>
                  <ProjectSelect
                    id={`repo-proj-${r.id}`}
                    className="w-56"
                    value={r.project_id}
                    onChange={(id) => update.mutate({ id: r.id, body: { project_id: id } })}
                    allowEmpty
                    emptyLabel="Unassigned"
                  />
                  <label className="flex items-center gap-2 text-sm whitespace-nowrap">
                    <input type="checkbox" className="size-4" checked={r.sync_enabled} onChange={(e) => update.mutate({ id: r.id, body: { sync_enabled: e.target.checked } })} />
                    Sync
                  </label>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}

function BoardsCard() {
  const qc = useQueryClient();
  const boards = useQuery({ queryKey: ["github", "boards"], queryFn: () => get<Board[]>("/github/boards") });
  const refresh = useMutation({
    mutationFn: () => post<{ boards: number }>("/github/boards/refresh"),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["github"] }),
  });
  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) => patch(`/github/boards/${id}`, body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["github"] }),
  });
  return (
    <Card
      title="GitHub Projects boards"
      actions={
        <Button size="sm" onClick={() => refresh.mutate()} busy={refresh.isPending}>
          {boards.data?.length ? "Reload boards" : "Load my boards"}
        </Button>
      }
    >
      <p className="mb-3 text-sm text-muted">
        Choose which date fields mean “start” and “end”. Board dates are used on the timeline when a task has no date set in ProjectOS. Items
        from repositories that aren't synced are skipped.
      </p>
      <InlineError error={refresh.error ?? update.error} />
      {boards.isPending ? (
        <LoadingBlock rows={2} />
      ) : !boards.data?.length ? (
        <p className="text-sm text-muted">No boards loaded.</p>
      ) : (
        <ul className="divide-y divide-line">
          {boards.data.map((b) => (
            <li key={b.id} className="grid gap-3 py-3 lg:grid-cols-[1fr_auto]">
              <div className="min-w-0">
                <a href={b.url} target="_blank" rel="noopener noreferrer" className="font-medium hover:underline">
                  {b.title}
                </a>{" "}
                <span className="text-xs text-muted">
                  @{b.owner_login} #{b.number}
                </span>{" "}
                {b.closed && <Badge>Closed</Badge>}
                <p className="text-xs text-muted">{b.sync_enabled ? `Synced ${relativeTime(b.last_synced_at)}` : "Not synced"}</p>
                {b.last_sync_error && <p className="text-xs text-bad">Last sync error: {b.last_sync_error}</p>}
                {b.date_fields.length === 0 && <p className="text-xs text-warn">This board has no date fields; add “Start date” / “Target date” fields on GitHub to see it on the timeline.</p>}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <label className="sr-only" htmlFor={`b-start-${b.id}`}>
                  Start field
                </label>
                <Select id={`b-start-${b.id}`} className="w-40" value={b.start_field ?? ""} onChange={(e) => update.mutate({ id: b.id, body: { start_field: e.target.value || null } })}>
                  <option value="">Start: none</option>
                  {b.date_fields.map((f) => (
                    <option key={f} value={f}>
                      Start: {f}
                    </option>
                  ))}
                </Select>
                <label className="sr-only" htmlFor={`b-end-${b.id}`}>
                  End field
                </label>
                <Select id={`b-end-${b.id}`} className="w-40" value={b.end_field ?? ""} onChange={(e) => update.mutate({ id: b.id, body: { end_field: e.target.value || null } })}>
                  <option value="">End: none</option>
                  {b.date_fields.map((f) => (
                    <option key={f} value={f}>
                      End: {f}
                    </option>
                  ))}
                </Select>
                <label className="sr-only" htmlFor={`b-proj-${b.id}`}>
                  Project for draft items
                </label>
                <ProjectSelect id={`b-proj-${b.id}`} className="w-48" value={b.project_id} onChange={(id) => update.mutate({ id: b.id, body: { project_id: id } })} allowEmpty emptyLabel="Drafts: unassigned" />
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" className="size-4" checked={b.sync_enabled} onChange={(e) => update.mutate({ id: b.id, body: { sync_enabled: e.target.checked } })} />
                  Sync
                </label>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
