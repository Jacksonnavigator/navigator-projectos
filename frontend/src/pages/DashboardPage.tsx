import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { LifecycleBadge, PriorityBadge, ProgressBar, SourceBadge, StatusBadge } from "../components/domain";
import TaskModal from "../components/TaskModal";
import { Badge, Button, Card, EmptyState, ErrorState, LoadingBlock, PageHeader } from "../components/ui";
import { get, post } from "../lib/api";
import { DATE_SOURCE_LABEL, formatDate, relativeTime } from "../lib/format";
import type { Dashboard, NextAction, Task } from "../lib/types";

const FLAG_LABEL: Record<string, string> = {
  no_recent_evidence: "No verified evidence in 30 days",
  overdue_tasks: "Overdue tasks",
  past_target_date: "Past target date",
};

const REASON_LABEL: Record<string, string> = {
  overdue: "Overdue",
  due_this_week: "Due this week",
  blocked: "Blocked",
  P1_next_action: "P1 next action",
  P2_next_action: "P2 next action",
};

function Stat({ label, value, tone, to }: { label: string; value: number; tone?: "bad" | "accent"; to?: string }) {
  const body = (
    <div className="rounded-lg border border-line bg-surface px-4 py-3">
      <p className="text-xs text-muted">{label}</p>
      <p
        className={`mt-1 text-2xl font-semibold tabular-nums ${tone === "bad" && value > 0 ? "text-bad" : tone === "accent" ? "text-accent" : ""}`}
      >
        {value}
      </p>
    </div>
  );
  return to ? (
    <Link to={to} className="block rounded-lg hover:ring-2 hover:ring-accent/40">
      {body}
    </Link>
  ) : (
    body
  );
}

function TaskLine({ task, onOpen }: { task: Task; onOpen: (id: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(task.id)}
      className="flex w-full items-start justify-between gap-3 rounded-md px-2 py-2 text-left hover:bg-sunken"
    >
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium">{task.title}</span>
        <span className="block truncate text-xs text-muted">{task.project_name}</span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1">
        <span className="flex gap-1">
          <SourceBadge task={task} />
          <StatusBadge value={task.status} />
        </span>
        {task.effective_due && (
          <span
            className={`text-xs ${task.overdue ? "text-bad" : "text-muted"}`}
            title={DATE_SOURCE_LABEL[task.effective_due_source ?? ""]}
          >
            Due {formatDate(task.effective_due)}
          </span>
        )}
      </span>
    </button>
  );
}

function NextActionItem({ item, onOpen }: { item: NextAction; onOpen: (id: string) => void }) {
  const tone =
    item.reason === "overdue" || item.reason === "blocked" ? "bad" : item.reason === "due_this_week" ? "warn" : "accent";
  return (
    <li className="flex items-start gap-3 py-2">
      <Badge tone={tone}>{REASON_LABEL[item.reason] ?? item.reason}</Badge>
      {"task" in item ? (
        <button type="button" className="min-w-0 text-left text-sm hover:underline" onClick={() => onOpen(item.task.id)}>
          {item.task.title} <span className="text-muted">· {item.task.project_name}</span>
        </button>
      ) : (
        <p className="min-w-0 text-sm">
          <Link to={`/projects/${item.project.id}`} className="font-medium hover:underline">
            {item.project.name}
          </Link>
          : {item.text}
        </p>
      )}
    </li>
  );
}

/** Sync GitHub once per browser session when data is stale (the free server has no scheduler of its own). */
function useAutoSync() {
  const qc = useQueryClient();
  const started = useRef(false);
  const sync = useMutation({
    mutationFn: () => post<{ started: boolean }>("/github/sync?if_stale=true"),
    onSuccess: (res) => {
      if (res.started) setTimeout(() => void qc.invalidateQueries(), 8000);
    },
  });
  const { mutate } = sync;
  useEffect(() => {
    let already = false;
    try {
      already = sessionStorage.getItem("nav-auto-sync") === "1";
      sessionStorage.setItem("nav-auto-sync", "1");
    } catch {
      // storage blocked: just try once per page load
    }
    if (!started.current && !already) {
      started.current = true;
      mutate();
    }
  }, [mutate]);
}

export default function DashboardPage() {
  const dash = useQuery({ queryKey: ["dashboard"], queryFn: () => get<Dashboard>("/dashboard") });
  const [openTask, setOpenTask] = useState<string | null>(null);
  useAutoSync();

  if (dash.isPending) return <LoadingBlock rows={6} />;
  if (dash.error) return <ErrorState error={dash.error} onRetry={() => void dash.refetch()} />;
  const d = dash.data;

  if (d.counts.projects === 0) {
    return (
      <>
        <PageHeader title="Dashboard" />
        <EmptyState
          title="No projects yet"
          description="Import your Excel project register, or create your first project by hand."
          action={
            <div className="flex gap-2">
              <Link
                to="/import"
                className="inline-flex h-10 items-center rounded-md bg-accent px-4 text-sm font-medium text-accent-ink hover:bg-accent-strong"
              >
                Import register
              </Link>
              <Link
                to="/projects?new=1"
                className="inline-flex h-10 items-center rounded-md border border-line px-4 text-sm font-medium hover:bg-sunken"
              >
                New project
              </Link>
            </div>
          }
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Dashboard"
        description={`${d.counts.projects} projects${d.counts.sub_projects ? ` (+${d.counts.sub_projects} sub-projects)` : ""}. GitHub last synced ${relativeTime(d.sync.last_synced_at)}.`}
        actions={
          <Button size="sm" onClick={() => void dash.refetch()} busy={dash.isFetching}>
            Refresh
          </Button>
        }
      />
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat
          label="Active projects"
          value={(d.counts.by_lifecycle.active ?? 0) + (d.counts.by_lifecycle.testing ?? 0)}
          tone="accent"
          to="/projects?lifecycle=active"
        />
        <Stat label="Deployed" value={d.counts.by_lifecycle.deployed ?? 0} to="/projects?lifecycle=deployed" />
        <Stat label="Open tasks" value={d.counts.open_tasks} to="/tasks" />
        <Stat label="In progress" value={d.counts.in_progress} to="/board" />
        <Stat label="Blocked" value={d.counts.blocked} tone="bad" to="/tasks?status=blocked" />
        <Stat label="Overdue" value={d.counts.overdue} tone="bad" to="/tasks?sort=due" />
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="min-w-0 space-y-6 xl:col-span-2">
          <Card
            title="What to work on next"
            actions={<span className="hidden text-xs text-muted sm:inline">Overdue → this week → blocked → P1/P2 next actions</span>}
          >
            {d.next_actions.length === 0 ? (
              <p className="text-sm text-muted">
                Nothing urgent. Add next actions or due dates to your projects to see suggestions here.
              </p>
            ) : (
              <ul className="divide-y divide-line">
                {d.next_actions.map((item, i) => (
                  <NextActionItem key={i} item={item} onOpen={setOpenTask} />
                ))}
              </ul>
            )}
          </Card>

          <Card title="Project health">
            <div className="-mx-4 overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-xs text-muted">
                    <th className="px-4 py-2 font-medium">Project</th>
                    <th className="px-2 py-2 font-medium">Stage</th>
                    <th className="px-2 py-2 font-medium">Tasks done</th>
                    <th className="px-2 py-2 font-medium">Last verified</th>
                    <th className="px-4 py-2 font-medium">Attention</th>
                  </tr>
                </thead>
                <tbody>
                  {d.health.map((h) => (
                    <tr key={h.id} className="border-b border-line last:border-0">
                      <td className="px-4 py-2">
                        <Link to={`/projects/${h.id}`} className="font-medium hover:underline">
                          {h.name}
                        </Link>
                        <div className="mt-0.5">
                          <PriorityBadge value={h.priority} />
                        </div>
                      </td>
                      <td className="px-2 py-2">
                        <LifecycleBadge value={h.lifecycle} />
                      </td>
                      <td className="px-2 py-2">
                        <ProgressBar
                          value={h.progress}
                          label={`${h.done_tasks} of ${h.open_tasks + h.done_tasks} top-level tasks done`}
                        />
                      </td>
                      <td className="px-2 py-2 text-xs text-muted">
                        {h.last_verified_at ? relativeTime(h.last_verified_at) : "Never"}
                      </td>
                      <td className="px-4 py-2">
                        <div className="flex flex-wrap gap-1">
                          {h.flags.map((f) => (
                            <Badge key={f} tone={f === "no_recent_evidence" ? "warn" : "bad"}>
                              {FLAG_LABEL[f] ?? f}
                            </Badge>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-xs text-muted">
              “Tasks done” counts top-level tasks only; projects without tasks show “Not measured”. “Last verified” uses
              automated or measured evidence, not reported status.
            </p>
          </Card>
        </div>

        <div className="min-w-0 space-y-6">
          <Card title={`Overdue (${d.overdue.length})`}>
            {d.overdue.length === 0 ? (
              <p className="text-sm text-muted">Nothing overdue.</p>
            ) : (
              d.overdue.map((t) => <TaskLine key={t.id} task={t} onOpen={setOpenTask} />)
            )}
          </Card>
          <Card title="Coming up (14 days)">
            {d.due_soon.length === 0 && d.upcoming.length === 0 ? (
              <p className="text-sm text-muted">No deadlines in the next two weeks.</p>
            ) : (
              <>
                {d.upcoming.map((u) => (
                  <Link
                    key={u.id}
                    to={`/projects/${u.project_id}`}
                    className="flex justify-between gap-2 rounded-md px-2 py-2 text-sm hover:bg-sunken"
                  >
                    <span className="min-w-0 truncate">
                      <Badge tone="info">{u.kind === "milestone" ? "Milestone" : "Target"}</Badge> {u.title}
                    </span>
                    <span className={`shrink-0 text-xs ${u.overdue ? "text-bad" : "text-muted"}`}>
                      {formatDate(u.date)}
                    </span>
                  </Link>
                ))}
                {d.due_soon.map((t) => (
                  <TaskLine key={t.id} task={t} onOpen={setOpenTask} />
                ))}
              </>
            )}
          </Card>
          <Card title="Recent activity">
            {d.activity.length === 0 ? (
              <p className="text-sm text-muted">No activity yet.</p>
            ) : (
              <ul className="space-y-2">
                {d.activity.map((a) => (
                  <li key={a.id} className="text-sm">
                    {a.url ? (
                      <a href={a.url} target="_blank" rel="noopener noreferrer" className="hover:underline">
                        {a.message}
                      </a>
                    ) : (
                      a.message
                    )}
                    <span className="block text-xs text-muted">{relativeTime(a.occurred_at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
      <TaskModal taskId={openTask} open={Boolean(openTask)} onClose={() => setOpenTask(null)} />
    </>
  );
}
