import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { get } from "../lib/api";
import { DATE_SOURCE_LABEL, formatDate, STATUS_LABEL, TASK_STATUSES } from "../lib/format";
import type { Page, Task, TaskStatus } from "../lib/types";
import { ProjectSelect, SourceBadge, StatusBadge, TaskPriorityBadge } from "./domain";
import TaskModal from "./TaskModal";
import { Badge, Button, EmptyState, ErrorState, Input, LoadingBlock, Select, Toolbar } from "./ui";

export interface TaskFilters {
  project_id?: string;
  status?: string;
  q?: string;
  source?: string;
  label?: string;
  sort?: string;
}

/** Filterable task list used on the Tasks page and inside a project. */
export default function TaskList({
  projectId,
  initial = {},
  onFiltersChange,
}: {
  projectId?: string;
  initial?: TaskFilters;
  onFiltersChange?: (f: TaskFilters) => void;
}) {
  const [filters, setFilters] = useState<TaskFilters>({ sort: "due", ...initial, project_id: projectId ?? initial.project_id });
  const [openTask, setOpenTask] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [showDone, setShowDone] = useState(Boolean(initial.status));

  const statuses = filters.status ? [filters.status] : showDone ? undefined : TASK_STATUSES.filter((s) => s !== "done");
  const tasks = useQuery({
    queryKey: ["tasks", "list", filters, showDone],
    queryFn: () => {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries({ ...filters, status: undefined })) if (v) params.set(k, v);
      for (const s of statuses ?? []) params.append("status", s);
      params.set("top_level_only", "true");
      params.set("limit", "500");
      return get<Page<Task>>(`/tasks?${params.toString()}`);
    },
    placeholderData: keepPreviousData,
  });

  const set = (key: keyof TaskFilters, value: string) => {
    const next = { ...filters, [key]: value || undefined };
    setFilters(next);
    onFiltersChange?.(next);
  };
  const labels = [...new Set(tasks.data?.items.flatMap((t) => t.gh_labels) ?? [])].sort();

  return (
    <>
      <Toolbar>
        <div className="w-full sm:w-56">
          <label htmlFor="t-search" className="mb-1 block text-xs font-medium text-muted">
            Search tasks
          </label>
          <Input id="t-search" type="search" value={filters.q ?? ""} onChange={(e) => set("q", e.target.value)} placeholder="Title or description" />
        </div>
        {!projectId && (
          <div className="w-full sm:w-56">
            <label htmlFor="t-project" className="mb-1 block text-xs font-medium text-muted">
              Project
            </label>
            <ProjectSelect id="t-project" value={filters.project_id} onChange={(id) => set("project_id", id ?? "")} allowEmpty emptyLabel="All projects" />
          </div>
        )}
        <div>
          <label htmlFor="t-status" className="mb-1 block text-xs font-medium text-muted">
            Status
          </label>
          <Select id="t-status" value={filters.status ?? ""} onChange={(e) => set("status", e.target.value)}>
            <option value="">{showDone ? "All" : "All open"}</option>
            {TASK_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s as TaskStatus]}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <label htmlFor="t-source" className="mb-1 block text-xs font-medium text-muted">
            Source
          </label>
          <Select id="t-source" value={filters.source ?? ""} onChange={(e) => set("source", e.target.value)}>
            <option value="">All</option>
            <option value="local">ProjectOS</option>
            <option value="github">GitHub</option>
          </Select>
        </div>
        {labels.length > 0 && (
          <div>
            <label htmlFor="t-label" className="mb-1 block text-xs font-medium text-muted">
              Label
            </label>
            <Select id="t-label" value={filters.label ?? ""} onChange={(e) => set("label", e.target.value)}>
              <option value="">Any</option>
              {labels.map((l) => (
                <option key={l}>{l}</option>
              ))}
            </Select>
          </div>
        )}
        <div>
          <label htmlFor="t-sort" className="mb-1 block text-xs font-medium text-muted">
            Sort
          </label>
          <Select id="t-sort" value={filters.sort ?? "due"} onChange={(e) => set("sort", e.target.value)}>
            <option value="due">Due date</option>
            <option value="priority">Priority</option>
            <option value="updated">Recently updated</option>
            <option value="position">Manual order</option>
          </Select>
        </div>
        <label className="flex h-10 items-center gap-2 text-sm">
          <input type="checkbox" className="size-4" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} />
          Include done
        </label>
        <Button variant="primary" className="ml-auto" onClick={() => setCreating(true)}>
          New task
        </Button>
      </Toolbar>

      {tasks.isPending ? (
        <LoadingBlock />
      ) : tasks.error ? (
        <ErrorState error={tasks.error} onRetry={() => void tasks.refetch()} />
      ) : tasks.data.items.length === 0 ? (
        <EmptyState
          title={filters.q || filters.status || filters.label ? "No tasks match" : "No open tasks"}
          description="Create a task, or connect a GitHub repository to bring in its issues."
          action={<Button onClick={() => setCreating(true)}>New task</Button>}
        />
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
          {tasks.data.items.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                onClick={() => setOpenTask(t.id)}
                className="flex w-full flex-col gap-1 px-4 py-3 text-left hover:bg-sunken sm:flex-row sm:items-center sm:gap-4"
              >
                <span className="min-w-0 flex-1">
                  <span className={`block font-medium ${t.status === "done" ? "text-muted line-through" : ""}`}>{t.title}</span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted">
                    {!projectId && t.project_name && <span>{t.project_name}</span>}
                    {t.subtask_count > 0 && <span>{t.subtasks_done}/{t.subtask_count} subtasks</span>}
                    {t.blocked_by_open > 0 && <Badge tone="bad">Waiting on {t.blocked_by_open}</Badge>}
                    {t.gh_labels.map((l) => (
                      <Badge key={l}>{l}</Badge>
                    ))}
                  </span>
                </span>
                <span className="flex shrink-0 flex-wrap items-center gap-2">
                  <SourceBadge task={t} />
                  <TaskPriorityBadge value={t.priority} />
                  <StatusBadge value={t.status} />
                  {t.effective_due && (
                    <span className={`text-xs ${t.overdue ? "font-medium text-bad" : "text-muted"}`} title={`Due date source: ${DATE_SOURCE_LABEL[t.effective_due_source ?? ""]}`}>
                      {t.overdue ? "Overdue · " : ""}
                      {formatDate(t.effective_due)}
                    </span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <TaskModal taskId={openTask} open={Boolean(openTask)} onClose={() => setOpenTask(null)} />
      <TaskModal open={creating} onClose={() => setCreating(false)} defaultProjectId={filters.project_id ?? projectId} />
    </>
  );
}
