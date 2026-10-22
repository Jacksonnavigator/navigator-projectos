import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useEffect, useState } from "react";
import { del, get, patch, post } from "../lib/api";
import { DATE_SOURCE_LABEL, formatDate, formatDateTime, STATUS_LABEL, TASK_PRIORITIES, TASK_STATUSES, titleCase } from "../lib/format";
import { Markdown } from "../lib/markdown";
import type { Comment, Milestone, Page, Task, TaskPriority, TaskStatus } from "../lib/types";
import { ProjectSelect, SourceBadge, StatusBadge } from "./domain";
import { Button, ConfirmDialog, Field, InlineError, Input, LoadingBlock, Modal, Select, Textarea, toast, useValidation } from "./ui";

export function useInvalidateWork() {
  const qc = useQueryClient();
  return () => {
    for (const key of ["tasks", "task", "dashboard", "timeline", "calendar", "milestones", "projects", "project"]) {
      void qc.invalidateQueries({ queryKey: [key] });
    }
  };
}

interface Draft {
  title: string;
  description: string;
  acceptance_criteria: string;
  status: TaskStatus;
  priority: TaskPriority;
  start_date: string;
  due_date: string;
  milestone_id: string;
}

function toDraft(t?: Task): Draft {
  return {
    title: t?.title ?? "",
    description: t?.description ?? "",
    acceptance_criteria: t?.acceptance_criteria ?? "",
    status: t?.status ?? "todo",
    priority: t?.priority ?? "medium",
    start_date: t?.start_date ?? "",
    due_date: t?.due_date ?? "",
    milestone_id: t?.milestone_id ?? "",
  };
}

/** Create a task (no taskId) or view/edit an existing one. */
export default function TaskModal({
  taskId,
  open,
  onClose,
  defaultProjectId,
  defaultParentId,
  defaultStatus,
}: {
  taskId?: string | null;
  open: boolean;
  onClose: () => void;
  defaultProjectId?: string | null;
  defaultParentId?: string | null;
  defaultStatus?: TaskStatus;
}) {
  const invalidate = useInvalidateWork();
  const isNew = !taskId;
  const task = useQuery({ queryKey: ["task", taskId], queryFn: () => get<Task>(`/tasks/${taskId}`), enabled: open && !isNew });
  const [projectId, setProjectId] = useState<string | null>(defaultProjectId ?? null);
  const [draft, setDraft] = useState<Draft>(toDraft());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const v = useValidation({
    title: draft.title.trim() ? undefined : "Give the task a title.",
    project: !isNew || projectId ? undefined : "Choose the project this task belongs to.",
    due: draft.start_date && draft.due_date && draft.due_date < draft.start_date ? "Due date is before the start date." : undefined,
  });
  const resetValidation = v.reset;

  useEffect(() => {
    if (!open) return;
    if (isNew) {
      setDraft({ ...toDraft(), status: defaultStatus ?? "todo" });
      setProjectId(defaultProjectId ?? null);
    } else if (task.data) {
      setDraft(toDraft(task.data));
      setProjectId(task.data.project_id);
    }
    resetValidation();
  }, [open, isNew, task.data, defaultProjectId, defaultStatus, resetValidation]);

  const milestones = useQuery({
    queryKey: ["milestones", projectId],
    queryFn: () => get<Milestone[]>("/milestones", { project_id: projectId }),
    enabled: open && Boolean(projectId),
  });

  const save = useMutation({
    mutationFn: () => {
      const body = {
        title: draft.title.trim(),
        description: draft.description || null,
        acceptance_criteria: draft.acceptance_criteria || null,
        status: draft.status,
        priority: draft.priority,
        start_date: draft.start_date || null,
        due_date: draft.due_date || null,
        milestone_id: draft.milestone_id || null,
      };
      if (isNew) return post<Task>("/tasks", { ...body, project_id: projectId, parent_task_id: defaultParentId ?? null });
      const gh = task.data?.source === "github";
      const { title: _t, description: _d, ...local } = body;
      void _t;
      void _d;
      return patch<Task>(`/tasks/${taskId}`, gh ? local : body);
    },
    onSuccess: () => {
      invalidate();
      toast(isNew ? "Task created" : "Task saved");
      onClose();
    },
  });
  const remove = useMutation({
    mutationFn: () => del(`/tasks/${taskId}`),
    onSuccess: () => {
      invalidate();
      setConfirmDelete(false);
      toast("Task deleted", { tone: "neutral" });
      onClose();
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (v.check()) save.mutate();
  };

  const gh = task.data?.source === "github";
  const ghLocked = gh && task.data?.gh_kind !== "draft";
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title={isNew ? "New task" : "Task"}
        panel
        footer={
          <>
            {!isNew && task.data?.source === "local" && (
              <Button variant="ghost" className="mr-auto text-bad" onClick={() => setConfirmDelete(true)}>
                Delete task
              </Button>
            )}
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" type="submit" form="task-form" busy={save.isPending}>
              {isNew ? "Create task" : "Save changes"}
            </Button>
          </>
        }
      >
        {!isNew && task.isPending ? (
          <LoadingBlock rows={3} />
        ) : (
          <form id="task-form" onSubmit={submit} className="space-y-4" noValidate>
            {task.data && (
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                <StatusBadge value={task.data.status} />
                <SourceBadge task={task.data} />
                {task.data.project_name && <span>in {task.data.project_name}</span>}
                {task.data.effective_due && (
                  <span title={DATE_SOURCE_LABEL[task.data.effective_due_source ?? ""]}>
                    Due {formatDate(task.data.effective_due)} ({DATE_SOURCE_LABEL[task.data.effective_due_source ?? ""] ?? "unknown source"})
                  </span>
                )}
                {task.data.gh_board_status && <span>Board status: {task.data.gh_board_status}</span>}
              </div>
            )}
            {ghLocked && (
              <p className="rounded-md bg-info-soft px-3 py-2 text-sm text-info">
                Title, description and open/closed state come from GitHub and are read-only here. Your planning fields
                (dates, priority, acceptance criteria, in-progress status) are stored in ProjectOS and never sent to GitHub.
              </p>
            )}
            {isNew && (
              <Field label="Project" error={v.error("project")}>
                {(p) => <ProjectSelect {...p} value={projectId} onChange={setProjectId} onBlur={() => v.blur("project")} emptyLabel="Choose a project" />}
              </Field>
            )}
            <Field label="Title" error={v.error("title")}>
              {(p) => <Input {...p} value={draft.title} onChange={(e) => set("title", e.target.value)} onBlur={() => v.blur("title")} disabled={ghLocked} maxLength={500} />}
            </Field>
            {ghLocked && task.data?.description ? (
              <div>
                <p className="mb-1 text-sm font-medium">Description (from GitHub)</p>
                <div className="max-h-48 overflow-y-auto rounded-md border border-line p-3">
                  <Markdown source={task.data.description} />
                </div>
              </div>
            ) : (
              !ghLocked && (
                <Field label="Description" hint="Markdown supported">
                  {(p) => <Textarea {...p} value={draft.description} onChange={(e) => set("description", e.target.value)} rows={4} />}
                </Field>
              )
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Status">
                {(p) => (
                  <Select {...p} value={draft.status} onChange={(e) => set("status", e.target.value as TaskStatus)}>
                    {TASK_STATUSES.map((s) => (
                      <option key={s} value={s} disabled={ghLocked && (s === "done") !== (task.data?.status === "done")}>
                        {STATUS_LABEL[s]}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label="Priority">
                {(p) => (
                  <Select {...p} value={draft.priority} onChange={(e) => set("priority", e.target.value as TaskPriority)}>
                    {TASK_PRIORITIES.map((s) => (
                      <option key={s} value={s}>
                        {titleCase(s)}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label="Start date">
                {(p) => <Input {...p} type="date" value={draft.start_date} onChange={(e) => set("start_date", e.target.value)} />}
              </Field>
              <Field label="Due date" error={v.error("due")}>
                {(p) => <Input {...p} type="date" value={draft.due_date} onChange={(e) => set("due_date", e.target.value)} onBlur={() => v.blur("due")} />}
              </Field>
              <Field label="Milestone">
                {(p) => (
                  <Select {...p} value={draft.milestone_id} onChange={(e) => set("milestone_id", e.target.value)} disabled={!projectId}>
                    <option value="">None</option>
                    {milestones.data?.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.title}
                        {m.effective_due ? ` (${formatDate(m.effective_due)})` : ""}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </div>
            <Field label="Acceptance criteria" hint="What must be true for this to count as done?">
              {(p) => (
                <Textarea {...p} value={draft.acceptance_criteria} onChange={(e) => set("acceptance_criteria", e.target.value)} rows={3} />
              )}
            </Field>
            <InlineError error={save.error} />
          </form>
        )}
        {task.data && <TaskExtras task={task.data} />}
      </Modal>
      <ConfirmDialog
        open={confirmDelete}
        title="Delete task?"
        message={<>“{task.data?.title}” and its subtasks and comments will be deleted. This can’t be undone.</>}
        confirmLabel="Delete task"
        busy={remove.isPending}
        onConfirm={() => remove.mutate()}
        onCancel={() => setConfirmDelete(false)}
      />
    </>
  );
}

function TaskExtras({ task }: { task: Task }) {
  const invalidate = useInvalidateWork();
  const qc = useQueryClient();
  const siblings = useQuery({
    queryKey: ["tasks", "project-for-deps", task.project_id],
    queryFn: () => get<Page<Task>>("/tasks", { project_id: task.project_id, limit: 500 }),
    enabled: Boolean(task.project_id),
  });
  const subtasks = useQuery({
    queryKey: ["tasks", "subtasks", task.id],
    queryFn: () => get<Page<Task>>("/tasks", { parent_task_id: task.id, limit: 200, include_unassigned: true }),
  });
  const comments = useQuery({ queryKey: ["comments", task.id], queryFn: () => get<Comment[]>(`/tasks/${task.id}/comments`) });
  const [dep, setDep] = useState("");
  const [subtitle, setSubtitle] = useState("");
  const [comment, setComment] = useState("");

  const addDep = useMutation({
    mutationFn: () => post(`/tasks/${task.id}/dependencies`, { depends_on_id: dep }),
    onSuccess: () => {
      setDep("");
      invalidate();
    },
  });
  const removeDep = useMutation({
    mutationFn: (id: string) => del(`/tasks/${task.id}/dependencies/${id}`),
    onSuccess: invalidate,
  });
  const addSub = useMutation({
    mutationFn: () => post("/tasks", { project_id: task.project_id, title: subtitle.trim(), parent_task_id: task.id }),
    onSuccess: () => {
      setSubtitle("");
      invalidate();
    },
  });
  const toggleSub = useMutation({
    mutationFn: (t: Task) => patch(`/tasks/${t.id}`, { status: t.status === "done" ? "todo" : "done" }),
    onSuccess: invalidate,
  });
  const addComment = useMutation({
    mutationFn: () => post(`/tasks/${task.id}/comments`, { body: comment.trim() }),
    onSuccess: () => {
      setComment("");
      void qc.invalidateQueries({ queryKey: ["comments", task.id] });
    },
  });

  const byId = new Map(siblings.data?.items.map((t) => [t.id, t]));
  const candidates = siblings.data?.items.filter((t) => t.id !== task.id && !task.depends_on.includes(t.id)) ?? [];

  return (
    <div className="mt-6 space-y-6 border-t border-line pt-4">
      <section aria-labelledby="deps-h">
        <h3 id="deps-h" className="mb-2 text-sm font-semibold">
          Depends on {task.blocked_by_open > 0 && <span className="font-normal text-bad">({task.blocked_by_open} not done)</span>}
        </h3>
        {task.depends_on.length === 0 && <p className="text-sm text-muted">No dependencies.</p>}
        <ul className="space-y-1">
          {task.depends_on.map((id) => {
            const t = byId.get(id);
            return (
              <li key={id} className="flex items-center justify-between gap-2 text-sm">
                <span className="flex items-center gap-2">
                  {t && <StatusBadge value={t.status} />}
                  {t?.title ?? "Task in another project"}
                </span>
                <Button size="sm" variant="ghost" onClick={() => removeDep.mutate(id)} aria-label={`Remove dependency on ${t?.title ?? "task"}`}>
                  Remove
                </Button>
              </li>
            );
          })}
        </ul>
        {task.project_id && (
          <div className="mt-2 flex gap-2">
            <label className="sr-only" htmlFor="dep-select">
              Add dependency
            </label>
            <Select id="dep-select" value={dep} onChange={(e) => setDep(e.target.value)}>
              <option value="">Add a task this depends on…</option>
              {candidates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
            </Select>
            <Button size="md" onClick={() => addDep.mutate()} disabled={!dep} busy={addDep.isPending}>
              Add
            </Button>
          </div>
        )}
        <InlineError error={addDep.error ?? removeDep.error} />
      </section>

      {task.source === "local" && (
        <section aria-labelledby="subs-h">
          <h3 id="subs-h" className="mb-2 text-sm font-semibold">
            Subtasks {task.subtask_count > 0 && <span className="font-normal text-muted">({task.subtasks_done}/{task.subtask_count} done)</span>}
          </h3>
          <ul className="space-y-1">
            {subtasks.data?.items.map((s) => (
              <li key={s.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  id={`sub-${s.id}`}
                  checked={s.status === "done"}
                  onChange={() => toggleSub.mutate(s)}
                  className="size-4 accent-[var(--color-accent)]"
                />
                <label htmlFor={`sub-${s.id}`} className={s.status === "done" ? "text-muted line-through" : ""}>
                  {s.title}
                </label>
              </li>
            ))}
          </ul>
          <form
            className="mt-2 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (subtitle.trim()) addSub.mutate();
            }}
          >
            <label className="sr-only" htmlFor="subtask-input">
              New subtask
            </label>
            <Input id="subtask-input" placeholder="Add a subtask" value={subtitle} onChange={(e) => setSubtitle(e.target.value)} />
            <Button type="submit" disabled={!subtitle.trim()} busy={addSub.isPending}>
              Add
            </Button>
          </form>
          <InlineError error={addSub.error ?? toggleSub.error} />
        </section>
      )}

      <section aria-labelledby="comments-h">
        <h3 id="comments-h" className="mb-2 text-sm font-semibold">
          Notes & comments
        </h3>
        <ul className="space-y-3">
          {comments.data?.map((c) => (
            <li key={c.id} className="rounded-md bg-sunken p-3">
              <p className="mb-1 text-xs text-muted">{formatDateTime(c.created_at)}</p>
              <Markdown source={c.body} />
            </li>
          ))}
        </ul>
        <form
          className="mt-2 space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (comment.trim()) addComment.mutate();
          }}
        >
          <label className="sr-only" htmlFor="comment-input">
            New comment
          </label>
          <Textarea id="comment-input" placeholder="Write a note (Markdown)" value={comment} onChange={(e) => setComment(e.target.value)} />
          <Button type="submit" disabled={!comment.trim()} busy={addComment.isPending}>
            Add note
          </Button>
          <InlineError error={addComment.error} />
        </form>
      </section>
    </div>
  );
}
