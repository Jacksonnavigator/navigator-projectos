import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { BarList, ColumnChart, ProgressRing } from "../components/charts";
import { LifecycleBadge, PriorityBadge, ProgressBar, ProjectSelect, SourceBadge } from "../components/domain";
import TaskModal from "../components/TaskModal";
import { Badge, Button, Card, EmptyState, ErrorState, InlineError, Input, LoadingBlock, cx, toast, useValidation } from "../components/ui";
import { get, patch, post } from "../lib/api";
import { useAuth } from "../lib/auth";
import { formatDate, LIFECYCLES, relativeTime, titleCase, todayIso } from "../lib/format";
import type { Dashboard, FocusCard, NextAction, Task } from "../lib/types";

const FLAG_LABEL: Record<string, string> = {
  no_recent_evidence: "No verified evidence in 30 days",
  overdue_tasks: "Overdue tasks",
  past_target_date: "Past target date",
};

const REASON_LABEL: Record<string, string> = {
  overdue: "Overdue",
  due_this_week: "Due soon",
  blocked: "Blocked",
  P1_next_action: "P1",
  P2_next_action: "P2",
};

/* ------------------------------------------------------------------ actions */

/** Return a copy of the dashboard data with one task's status changed (used for instant, optimistic ticks). */
function withTaskStatus(value: unknown, id: string, status: string): unknown {
  if (Array.isArray(value)) return value.map((v) => withTaskStatus(v, id, status));
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (obj.id === id && "gh_kind" in obj) return { ...obj, status };
    return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, withTaskStatus(v, id, status)]));
  }
  return value;
}

function useTaskActions() {
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => patch<Task>(`/tasks/${id}`, { status }),
    onMutate: async ({ id, status }) => {
      await qc.cancelQueries({ queryKey: ["dashboard"] });
      const previous = qc.getQueryData<Dashboard>(["dashboard"]);
      if (previous) qc.setQueryData(["dashboard"], withTaskStatus(previous, id, status));
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(["dashboard"], ctx.previous);
      toast("That change couldn't be saved. Try again.", { tone: "bad" });
    },
    onSettled: () => {
      for (const key of ["dashboard", "tasks", "timeline", "calendar", "projects", "project"]) void qc.invalidateQueries({ queryKey: [key] });
    },
  });
  return m;
}

/** GitHub issues/PRs are finished on GitHub, so their checkbox is read-only here. */
function canToggle(t: Task) {
  return t.source === "local" || t.gh_kind === "draft";
}

function TaskCheck({ task, onToggle, busy }: { task: Task; onToggle: () => void; busy?: boolean }) {
  const allowed = canToggle(task);
  return (
    <label className="-m-1 grid shrink-0 cursor-pointer place-items-center rounded p-1 hover:bg-sunken has-[:disabled]:cursor-not-allowed pointer-coarse:p-2.5">
      <input
        type="checkbox"
        className="size-4 cursor-pointer accent-[var(--color-accent)] disabled:cursor-not-allowed"
        checked={task.status === "done"}
        disabled={!allowed || busy}
        onChange={onToggle}
        aria-label={task.status === "done" ? `Mark “${task.title}” not done` : `Mark “${task.title}” done`}
        title={allowed ? undefined : "Close or reopen this on GitHub; the next sync updates it"}
      />
    </label>
  );
}

/* --------------------------------------------------------------------- page */

function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

function useAutoSync() {
  const qc = useQueryClient();
  const started = useRef(false);
  const { mutate } = useMutation({
    mutationFn: () => post<{ started: boolean }>("/github/sync?if_stale=true"),
    onSuccess: (res) => {
      if (res.started) setTimeout(() => void qc.invalidateQueries(), 8000);
    },
  });
  useEffect(() => {
    let already = false;
    try {
      already = sessionStorage.getItem("nav-auto-sync") === "1";
      sessionStorage.setItem("nav-auto-sync", "1");
    } catch {
      // storage blocked: try once per page load
    }
    if (!started.current && !already) {
      started.current = true;
      mutate();
    }
  }, [mutate]);
}

export default function DashboardPage() {
  const { user } = useAuth();
  const dash = useQuery({ queryKey: ["dashboard"], queryFn: () => get<Dashboard>("/dashboard") });
  const [openTask, setOpenTask] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const actions = useTaskActions();
  useAutoSync();

  if (dash.isPending) return <LoadingBlock rows={6} />;
  if (dash.error) return <ErrorState error={dash.error} onRetry={() => void dash.refetch()} />;
  const d = dash.data;
  const toggle = (t: Task) => {
    const previous = t.status;
    const next = previous === "done" ? "todo" : "done";
    actions.mutate(
      { id: t.id, status: next },
      {
        onSuccess: () =>
          toast(next === "done" ? `Done: “${t.title}”` : `Reopened “${t.title}”`, {
            action: { label: "Undo", onClick: () => actions.mutate({ id: t.id, status: previous }) },
          }),
      },
    );
  };
  const start = (t: Task) => actions.mutate({ id: t.id, status: "in_progress" }, { onSuccess: () => toast(`Started “${t.title}”`) });

  if (d.counts.projects === 0 && d.completed_projects.length === 0) {
    return (
      <>
        <Hero name={user?.name ?? user?.login ?? ""} />
        <EmptyState
          title="No projects yet"
          description="Import your Excel project register, or create your first project by hand."
          action={
            <div className="flex gap-2">
              <Link to="/import" className="inline-flex h-10 items-center rounded-md bg-accent px-4 text-sm font-medium text-accent-ink hover:bg-accent-strong">
                Import register
              </Link>
              <Link to="/projects?new=1" className="inline-flex h-10 items-center rounded-md border border-line px-4 text-sm font-medium hover:bg-sunken">
                New project
              </Link>
            </div>
          }
        />
      </>
    );
  }

  const doneThisWeek = d.throughput[d.throughput.length - 1]?.done ?? 0;
  const active = (d.counts.by_lifecycle.active ?? 0) + (d.counts.by_lifecycle.testing ?? 0);

  return (
    <div className="space-y-6">
      <Hero
        name={user?.name?.split(" ")[0] ?? user?.login ?? ""}
        sub={`GitHub synced ${relativeTime(d.sync.last_synced_at)}`}
        actions={
          <>
            <Button size="sm" variant="ghost" onClick={() => void dash.refetch()} busy={dash.isFetching} aria-label="Refresh dashboard">
              ↻ Refresh
            </Button>
            <Button size="sm" variant="primary" onClick={() => setAdding((v) => !v)} aria-expanded={adding}>
              + Quick task
            </Button>
          </>
        }
      />
      {adding && <QuickAdd onDone={() => setAdding(false)} />}
      <InlineError error={actions.error} />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 2xl:grid-cols-6">
        <Stat icon="◎" label="Active projects" value={active} to="/projects?lifecycle=active" tone="accent" />
        <Stat icon="✓" label="Completed" value={d.completed_projects.length} to="/projects?lifecycle=completed" tone="ok" />
        <Stat icon="☰" label="Open tasks" value={d.counts.open_tasks} to="/tasks" />
        <Stat icon="▶" label="In progress" value={d.counts.in_progress} to="/board" />
        <Stat icon="⚑" label="Overdue" value={d.counts.overdue} to="/tasks?sort=due" tone={d.counts.overdue ? "bad" : undefined} />
        <Stat icon="★" label="Done this week" value={doneThisWeek} to="/tasks?status=done" tone="ok" />
      </div>

      {d.focus.length > 0 && (
        <section aria-labelledby="focus-h">
          <h2 id="focus-h" className="mb-3 text-sm font-semibold tracking-wide text-muted uppercase">
            Focus projects
          </h2>
          <div className="grid gap-4 lg:grid-cols-2">
            {d.focus.map((f) => (
              <FocusProject key={f.id} card={f} onOpen={setOpenTask} onToggle={toggle} onStart={start} busy={actions.isPending} />
            ))}
          </div>
        </section>
      )}

      <WeekStrip days={d.week} onOpen={setOpenTask} onToggle={toggle} busy={actions.isPending} />

      <div className="grid gap-6 xl:grid-cols-3">
        <Card title="What to work on next" className="xl:col-span-2" actions={<span className="hidden text-xs text-muted sm:inline">Overdue → due in 7 days → blocked → P1/P2</span>}>
          {d.next_actions.length === 0 ? (
            <p className="text-sm text-muted">Nothing urgent. Add due dates or next actions to see suggestions here.</p>
          ) : (
            <ul className="divide-y divide-line">
              {d.next_actions.map((item, i) => (
                <NextActionRow key={i} item={item} onOpen={setOpenTask} onToggle={toggle} onStart={start} busy={actions.isPending} />
              ))}
            </ul>
          )}
        </Card>
        <div className="min-w-0 space-y-6">
          <Card title="Tasks completed per week">
            <ColumnChart
              label="Top-level tasks completed per week, last 8 weeks"
              data={d.throughput.map((w) => ({
                key: w.week_start,
                label: formatDate(w.week_start, { year: undefined, month: "numeric", day: "numeric" }),
                value: w.done,
                tooltip: `Week of ${formatDate(w.week_start)}: ${w.done} task${w.done === 1 ? "" : "s"} done`,
              }))}
            />
          </Card>
          <StageChart counts={d.counts.by_lifecycle} />
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <Card title="Project health" className="xl:col-span-2">
          <HealthTable health={d.health} />
        </Card>
        <div className="min-w-0 space-y-6">
          {d.completed_projects.length > 0 && (
            <Card title={`Completed (${d.completed_projects.length})`}>
              <ul className="space-y-2">
                {d.completed_projects.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-2 text-sm">
                    <Link to={`/projects/${p.id}`} className="flex min-w-0 items-center gap-2 hover:underline">
                      <span className="text-ok" aria-hidden="true">✓</span>
                      <span className="truncate">{p.name}</span>
                    </Link>
                    <span className="shrink-0 text-xs text-muted">{p.completed_on ? formatDate(p.completed_on) : ""}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          <Card title="Recent activity">
            {d.activity.length === 0 ? (
              <p className="text-sm text-muted">No activity yet.</p>
            ) : (
              <ol className="relative space-y-3 border-l border-line pl-4">
                {d.activity.slice(0, 10).map((a) => (
                  <li key={a.id} className="text-sm">
                    <span className="absolute -left-[5px] mt-1.5 size-2.5 rounded-full border-2 border-surface bg-accent" aria-hidden="true" />
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
              </ol>
            )}
          </Card>
        </div>
      </div>
      <TaskModal taskId={openTask} open={Boolean(openTask)} onClose={() => setOpenTask(null)} />
    </div>
  );
}

/* --------------------------------------------------------------- sections */

function Hero({ name, sub, actions }: { name: string; sub?: string; actions?: ReactNode }) {
  const today = new Intl.DateTimeFormat(undefined, { weekday: "long", day: "numeric", month: "long" }).format(new Date());
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 rounded-xl border border-line bg-gradient-to-br from-accent-soft via-surface to-surface px-5 py-5">
      <div>
        <p className="text-sm text-muted">{today}</p>
        <h1 className="mt-0.5 text-2xl font-semibold tracking-tight">
          {greeting()}
          {name ? `, ${name}` : ""}
        </h1>
        {sub && <p className="mt-1 text-sm text-muted">{sub}</p>}
      </div>
      {actions && <div className="flex gap-2">{actions}</div>}
    </div>
  );
}

function Stat({ icon, label, value, to, tone }: { icon: string; label: string; value: number; to: string; tone?: "accent" | "ok" | "bad" }) {
  const toneClass = tone === "accent" ? "text-accent bg-accent-soft" : tone === "ok" ? "text-ok bg-ok-soft" : tone === "bad" ? "text-bad bg-bad-soft" : "text-muted bg-sunken";
  return (
    <Link to={to} className="group flex items-center gap-3 rounded-lg border border-line bg-surface px-4 py-3 hover:shadow-md">
      <span className={cx("grid size-9 shrink-0 place-items-center rounded-md text-base", toneClass)} aria-hidden="true">
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-2xl leading-tight font-semibold tabular-nums">{value}</span>
        <span className="block text-xs leading-tight text-muted group-hover:text-ink">{label}</span>
      </span>
    </Link>
  );
}

function FocusProject({ card: f, onOpen, onToggle, onStart, busy }: {
  card: FocusCard;
  onOpen: (id: string) => void;
  onToggle: (t: Task) => void;
  onStart: (t: Task) => void;
  busy: boolean;
}) {
  const ms = f.next_milestone;
  const t = f.next_task;
  return (
    <article className="flex min-w-0 flex-col gap-4 rounded-xl border border-line bg-surface p-5 hover:shadow-md">
      <header className="flex items-start gap-4">
        <ProgressRing value={f.progress} label={`${f.name} tasks done`} />
        <div className="min-w-0 flex-1">
          <Link to={`/projects/${f.id}`} className="block truncate text-lg font-semibold hover:underline">
            {f.name}
          </Link>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
            <LifecycleBadge value={f.lifecycle} />
            <span>
              {f.done_tasks}/{f.open_tasks + f.done_tasks} tasks done
            </span>
            {f.days_to_target !== null && (
              <span className={f.days_to_target < 0 ? "text-bad" : ""}>
                {f.days_to_target < 0 ? `${-f.days_to_target} days past target` : `${f.days_to_target} days to target`}
              </span>
            )}
          </div>
        </div>
      </header>
      {ms && (
        <div className="flex items-center gap-3 rounded-lg bg-sunken px-3 py-2">
          <span className="block size-3 rotate-45 border-2 border-accent bg-accent-soft" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate text-sm">
            <span className="text-muted">Next milestone: </span>
            <span className="font-medium">{ms.title}</span>
          </span>
          <Badge tone={ms.days_left < 0 ? "bad" : ms.days_left <= 7 ? "warn" : "neutral"}>
            {ms.days_left < 0 ? `${-ms.days_left}d late` : ms.days_left === 0 ? "today" : `in ${ms.days_left}d`}
          </Badge>
        </div>
      )}
      {t ? (
        <div className="flex items-center gap-3">
          <TaskCheck task={t} onToggle={() => onToggle(t)} busy={busy} />
          <button type="button" onClick={() => onOpen(t.id)} className="min-w-0 flex-1 text-left">
            <span className="block truncate text-sm font-medium hover:underline">{t.title}</span>
            <span className={cx("block truncate text-xs", t.overdue ? "text-bad" : "text-muted")}>
              {t.status === "in_progress" ? "In progress" : "Up next"}
              {t.effective_due ? ` · due ${formatDate(t.effective_due, { year: undefined })}` : ""}
              {t.blocked_by_open > 0 ? ` · waiting on ${t.blocked_by_open}` : ""}
            </span>
          </button>
          {t.status !== "in_progress" && t.status !== "done" && (
            <Button size="sm" onClick={() => onStart(t)} disabled={busy}>
              Start
            </Button>
          )}
        </div>
      ) : (
        <p className="text-sm text-muted">No open tasks. Add one from the project page.</p>
      )}
      <footer className="flex items-center justify-between border-t border-line pt-3 text-xs text-muted">
        <span>Verified: {f.last_verified_at ? relativeTime(f.last_verified_at) : "never"}</span>
        <Link to={`/projects/${f.id}?tab=tasks`} className="font-medium text-accent hover:underline">
          All tasks →
        </Link>
      </footer>
    </article>
  );
}

function WeekStrip({ days, onOpen, onToggle, busy }: {
  days: Dashboard["week"];
  onOpen: (id: string) => void;
  onToggle: (t: Task) => void;
  busy: boolean;
}) {
  const today = todayIso();
  return (
    <section aria-labelledby="week-h">
      <h2 id="week-h" className="mb-3 text-sm font-semibold tracking-wide text-muted uppercase">
        This week
      </h2>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-7">
        {days.map((day) => {
          const date = new Date(`${day.date}T00:00:00Z`);
          const isToday = day.date === today || day.is_today;
          const past = day.date < today;
          return (
            <div
              key={day.date}
              className={cx(
                "flex min-h-28 flex-col rounded-lg border p-2",
                isToday ? "border-accent bg-accent-soft/60 ring-1 ring-accent" : "border-line bg-surface",
                past && !isToday && "opacity-70",
              )}
            >
              <p className={cx("mb-2 flex items-baseline gap-1 text-xs", isToday ? "font-semibold text-accent" : "text-muted")}>
                {new Intl.DateTimeFormat(undefined, { weekday: "short", timeZone: "UTC" }).format(date)}
                <span className="text-sm tabular-nums">{date.getUTCDate()}</span>
                {isToday && <span className="ml-auto text-xs">Today</span>}
              </p>
              <ul className="space-y-1.5">
                {day.items.length === 0 && <li className="text-xs text-faint">—</li>}
                {day.items.map((item) =>
                  item.kind === "task" ? (
                    <li key={item.task.id} className="flex items-start gap-1.5">
                      <TaskCheck task={item.task} onToggle={() => onToggle(item.task)} busy={busy} />
                      <button
                        type="button"
                        onClick={() => onOpen(item.task.id)}
                        className={cx("min-w-0 text-left text-xs leading-4 hover:underline", item.task.status === "done" && "text-muted line-through")}
                        title={`${item.task.title} · ${item.task.project_name ?? ""}`}
                      >
                        {item.task.title}
                      </button>
                    </li>
                  ) : (
                    <li key={item.id}>
                      <Link to={`/projects/${item.project_id}?tab=milestones`} className="flex items-start gap-1.5 text-xs leading-4 font-medium text-accent hover:underline" title={item.project_name}>
                        <span className="mt-0.5 block size-2.5 shrink-0 rotate-45 border-2 border-accent" aria-hidden="true" />
                        {item.title}
                      </Link>
                    </li>
                  ),
                )}
              </ul>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function NextActionRow({ item, onOpen, onToggle, onStart, busy }: {
  item: NextAction;
  onOpen: (id: string) => void;
  onToggle: (t: Task) => void;
  onStart: (t: Task) => void;
  busy: boolean;
}) {
  const tone = item.reason === "overdue" || item.reason === "blocked" ? "bad" : item.reason === "due_this_week" ? "warn" : "accent";
  if ("task" in item) {
    const t = item.task;
    return (
      <li className="flex items-center gap-3 py-2.5">
        <TaskCheck task={t} onToggle={() => onToggle(t)} busy={busy} />
        <button type="button" className="min-w-0 flex-1 text-left" onClick={() => onOpen(t.id)}>
          <span className="block truncate text-sm font-medium hover:underline">{t.title}</span>
          <span className="block truncate text-xs text-muted">
            {t.project_name}
            {t.effective_due ? ` · due ${formatDate(t.effective_due, { year: undefined })}` : ""}
          </span>
        </button>
        <SourceBadge task={t} />
        <Badge tone={tone}>{REASON_LABEL[item.reason] ?? item.reason}</Badge>
        {t.status !== "in_progress" && (
          <Button size="sm" variant="ghost" onClick={() => onStart(t)} disabled={busy} aria-label={`Start ${t.title}`}>
            Start
          </Button>
        )}
      </li>
    );
  }
  return (
    <li className="flex items-start gap-3 py-2.5">
      <span className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <p className="min-w-0 flex-1 text-sm">
        <Link to={`/projects/${item.project.id}`} className="font-medium hover:underline">
          {item.project.name}
        </Link>
        <span className="text-muted"> — {item.text}</span>
      </p>
      <Badge tone={tone}>{REASON_LABEL[item.reason] ?? item.reason}</Badge>
    </li>
  );
}

function StageChart({ counts }: { counts: Dashboard["counts"]["by_lifecycle"] }) {
  const navigate = useNavigate();
  const data = LIFECYCLES.filter((l) => l !== "archived").map((l) => ({ key: l, label: titleCase(l), value: counts[l] ?? 0 }));
  return (
    <Card title="Projects by stage">
      <BarList data={data} onSelect={(key) => navigate(`/projects?lifecycle=${key}`)} />
    </Card>
  );
}

function HealthTable({ health }: { health: Dashboard["health"] }) {
  const [showAll, setShowAll] = useState(false);
  const rows = showAll ? health : health.filter((h) => h.priority === "P1" || h.priority === "P2" || h.flags.length > 0).slice(0, 10);
  return (
    <>
      <div className="-mx-4 overflow-x-auto">
        <table className="w-full min-w-[620px] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs text-muted">
              <th className="px-4 py-2 font-medium">Project</th>
              <th className="px-2 py-2 font-medium">Stage</th>
              <th className="px-2 py-2 font-medium">Tasks done</th>
              <th className="px-2 py-2 font-medium">Verified</th>
              <th className="px-4 py-2 font-medium">Attention</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((h) => (
              <tr key={h.id} className="border-b border-line last:border-0 hover:bg-sunken/60">
                <td className="px-4 py-2">
                  <Link to={`/projects/${h.id}`} className="font-medium hover:underline">
                    {h.name}
                  </Link>{" "}
                  <PriorityBadge value={h.priority} />
                </td>
                <td className="px-2 py-2">
                  <LifecycleBadge value={h.lifecycle} />
                </td>
                <td className="px-2 py-2">
                  <ProgressBar value={h.progress} label={`${h.done_tasks} of ${h.open_tasks + h.done_tasks} top-level tasks done`} />
                </td>
                <td className="px-2 py-2 text-xs text-muted">{h.last_verified_at ? relativeTime(h.last_verified_at) : "Never"}</td>
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
      {health.length > rows.length || showAll ? (
        <Button size="sm" variant="ghost" className="mt-2" onClick={() => setShowAll((v) => !v)}>
          {showAll ? "Show priority projects only" : `Show all ${health.length} projects`}
        </Button>
      ) : null}
    </>
  );
}

function QuickAdd({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [projectId, setProjectId] = useState<string | null>(null);
  const [due, setDue] = useState("");
  const add = useMutation({
    mutationFn: () => post("/tasks", { project_id: projectId, title: title.trim(), due_date: due || null }),
    onSuccess: () => {
      for (const key of ["dashboard", "tasks", "timeline", "calendar"]) void qc.invalidateQueries({ queryKey: [key] });
      toast(`Task “${title.trim()}” added`);
      setTitle("");
      setDue("");
      onDone();
    },
  });
  const v = useValidation({
    title: title.trim() ? undefined : "Say what needs doing.",
    project: projectId ? undefined : "Choose a project.",
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (v.check()) add.mutate();
  };
  return (
    <form onSubmit={submit} noValidate className="flex flex-wrap items-start gap-3 rounded-lg border border-line bg-surface p-4">
      <div className="min-w-56 flex-1">
        <label htmlFor="qa-title" className="mb-1 block text-xs font-medium text-muted">
          Task
        </label>
        <Input
          id="qa-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => v.blur("title")}
          placeholder="e.g. Order RS485 module"
          aria-invalid={v.error("title") ? true : undefined}
          aria-describedby={v.error("title") ? "qa-title-error" : undefined}
          autoFocus
        />
        {v.error("title") && (
          <p id="qa-title-error" className="mt-1 text-xs text-bad">
            {v.error("title")}
          </p>
        )}
      </div>
      <div className="w-60">
        <label htmlFor="qa-project" className="mb-1 block text-xs font-medium text-muted">
          Project
        </label>
        <ProjectSelect
          id="qa-project"
          value={projectId}
          onChange={setProjectId}
          onBlur={() => v.blur("project")}
          emptyLabel="Choose a project"
          aria-invalid={v.error("project") ? true : undefined}
          aria-describedby={v.error("project") ? "qa-project-error" : undefined}
        />
        {v.error("project") && (
          <p id="qa-project-error" className="mt-1 text-xs text-bad">
            {v.error("project")}
          </p>
        )}
      </div>
      <div>
        <label htmlFor="qa-due" className="mb-1 block text-xs font-medium text-muted">
          Due
        </label>
        <Input id="qa-due" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
      </div>
      <Button type="submit" variant="primary" busy={add.isPending}>
        Add task
      </Button>
      <Button onClick={onDone}>Cancel</Button>
      <div className="w-full">
        <InlineError error={add.error} />
      </div>
    </form>
  );
}
