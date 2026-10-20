import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type DragEvent, useState } from "react";
import { ProjectSelect, SourceBadge, TaskPriorityBadge } from "../components/domain";
import TaskModal from "../components/TaskModal";
import { Badge, ErrorState, InlineError, LoadingBlock, PageHeader, Select, Toolbar, cx } from "../components/ui";
import { get, patch } from "../lib/api";
import { formatDate, STATUS_LABEL, TASK_STATUSES } from "../lib/format";
import type { Page, Task, TaskStatus } from "../lib/types";

export default function BoardPage() {
  const qc = useQueryClient();
  const [projectId, setProjectId] = useState<string | null>(null);
  const [openTask, setOpenTask] = useState<string | null>(null);
  const [newIn, setNewIn] = useState<TaskStatus | null>(null);
  const [dragOver, setDragOver] = useState<TaskStatus | null>(null);
  const tasks = useQuery({
    queryKey: ["tasks", "board", projectId],
    queryFn: () => get<Page<Task>>("/tasks", { project_id: projectId, top_level_only: true, limit: 1000, sort: "position" }),
  });
  const move = useMutation({
    mutationFn: ({ id, status }: { id: string; status: TaskStatus }) => patch<Task>(`/tasks/${id}`, { status }),
    onMutate: async ({ id, status }) => {
      const key = ["tasks", "board", projectId];
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<Page<Task>>(key);
      if (prev) qc.setQueryData(key, { ...prev, items: prev.items.map((t) => (t.id === id ? { ...t, status } : t)) });
      return { prev, key };
    },
    onError: (_e, _v, ctx) => ctx?.prev && qc.setQueryData(ctx.key, ctx.prev),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["tasks"] });
      void qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });

  const onDrop = (status: TaskStatus) => (e: DragEvent) => {
    e.preventDefault();
    setDragOver(null);
    const id = e.dataTransfer.getData("text/task-id");
    const task = tasks.data?.items.find((t) => t.id === id);
    if (task && task.status !== status) move.mutate({ id, status });
  };

  return (
    <>
      <PageHeader
        title="Board"
        description="Drag cards between columns, or use the status menu on a card. Open GitHub issues can't be moved to Done here; close them on GitHub."
      />
      <Toolbar>
        <div className="w-64">
          <label htmlFor="board-project" className="mb-1 block text-xs font-medium text-muted">
            Project
          </label>
          <ProjectSelect id="board-project" value={projectId} onChange={setProjectId} allowEmpty emptyLabel="All projects" />
        </div>
      </Toolbar>
      <InlineError error={move.error} />
      {tasks.isPending ? (
        <LoadingBlock />
      ) : tasks.error ? (
        <ErrorState error={tasks.error} onRetry={() => void tasks.refetch()} />
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-4">
          {TASK_STATUSES.map((status) => {
            const column = tasks.data.items.filter((t) => t.status === status);
            return (
              <section
                key={status}
                aria-label={STATUS_LABEL[status]}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(status);
                }}
                onDragLeave={() => setDragOver(null)}
                onDrop={onDrop(status)}
                className={cx("flex w-72 shrink-0 flex-col rounded-lg border border-line bg-sunken", dragOver === status && "ring-2 ring-accent")}
              >
                <header className="flex items-center justify-between px-3 py-2">
                  <h2 className="text-sm font-semibold">
                    {STATUS_LABEL[status]} <span className="font-normal text-muted">{column.length}</span>
                  </h2>
                  <button type="button" onClick={() => setNewIn(status)} className="rounded px-2 text-lg leading-none text-muted hover:bg-surface hover:text-ink" aria-label={`Add task to ${STATUS_LABEL[status]}`}>
                    +
                  </button>
                </header>
                <ul className="flex min-h-24 flex-col gap-2 px-2 pb-2">
                  {column.map((t) => (
                    <li
                      key={t.id}
                      draggable
                      onDragStart={(e) => e.dataTransfer.setData("text/task-id", t.id)}
                      className="cursor-grab rounded-md border border-line bg-surface p-3 shadow-sm active:cursor-grabbing"
                    >
                      <button type="button" onClick={() => setOpenTask(t.id)} className="block w-full text-left text-sm font-medium hover:underline">
                        {t.title}
                      </button>
                      <p className="mt-1 truncate text-xs text-muted">{t.project_name}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-1">
                        <SourceBadge task={t} />
                        <TaskPriorityBadge value={t.priority} />
                        {t.blocked_by_open > 0 && <Badge tone="bad">Waiting on {t.blocked_by_open}</Badge>}
                        {t.effective_due && <Badge tone={t.overdue ? "bad" : "neutral"}>{formatDate(t.effective_due, { year: undefined })}</Badge>}
                      </div>
                      <label className="sr-only" htmlFor={`move-${t.id}`}>
                        Move {t.title}
                      </label>
                      <Select
                        id={`move-${t.id}`}
                        className="mt-2 h-8 py-1 text-xs"
                        value={t.status}
                        onChange={(e) => move.mutate({ id: t.id, status: e.target.value as TaskStatus })}
                      >
                        {TASK_STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {STATUS_LABEL[s]}
                          </option>
                        ))}
                      </Select>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
      <TaskModal taskId={openTask} open={Boolean(openTask)} onClose={() => setOpenTask(null)} />
      <TaskModal open={Boolean(newIn)} onClose={() => setNewIn(null)} defaultProjectId={projectId} defaultStatus={newIn ?? undefined} />
    </>
  );
}
