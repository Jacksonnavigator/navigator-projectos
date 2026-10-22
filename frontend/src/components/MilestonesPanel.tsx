import { useMutation, useQuery } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { del, get, patch, post } from "../lib/api";
import { formatDate } from "../lib/format";
import type { Milestone } from "../lib/types";
import { ProgressBar } from "./domain";
import { useInvalidateWork } from "./TaskModal";
import { Badge, Button, ConfirmDialog, EmptyState, ErrorState, Field, InlineError, Input, LoadingBlock, Modal, Textarea, toast, useValidation } from "./ui";

export default function MilestonesPanel({ projectId }: { projectId: string }) {
  const invalidate = useInvalidateWork();
  const list = useQuery({ queryKey: ["milestones", projectId], queryFn: () => get<Milestone[]>("/milestones", { project_id: projectId }) });
  const [editing, setEditing] = useState<Milestone | "new" | null>(null);
  const [deleting, setDeleting] = useState<Milestone | null>(null);
  const [error, setError] = useState<unknown>(null);

  const toggle = useMutation({
    mutationFn: (m: Milestone) => patch(`/milestones/${m.id}`, { status: m.status === "done" ? "open" : "done" }),
    onSuccess: () => {
      setError(null);
      invalidate();
    },
    onError: setError,
  });
  const remove = useMutation({
    mutationFn: (m: Milestone) => del(`/milestones/${m.id}`),
    onSuccess: () => {
      setDeleting(null);
      invalidate();
    },
  });

  if (list.isPending) return <LoadingBlock rows={2} />;
  if (list.error) return <ErrorState error={list.error} onRetry={() => void list.refetch()} />;

  return (
    <div>
      <div className="mb-3 flex justify-end">
        <Button variant="primary" onClick={() => setEditing("new")}>
          New milestone
        </Button>
      </div>
      <InlineError error={error} />
      {list.data.length === 0 ? (
        <EmptyState title="No milestones" description="Milestones group tasks and show as diamonds on the timeline." />
      ) : (
        <ul className="space-y-3">
          {list.data.map((m) => (
            <li key={m.id} className="rounded-lg border border-line bg-surface p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium">
                    {m.title} {m.source === "github" && <Badge tone="info">GitHub</Badge>}{" "}
                    {m.status === "done" ? <Badge tone="ok">Done</Badge> : null}
                  </p>
                  <p className="text-xs text-muted">
                    {m.effective_due ? `Due ${formatDate(m.effective_due)}` : "No due date"}
                    {m.local_due_date && m.gh_due_on && " (local date overrides GitHub)"}
                  </p>
                  {m.completion_criteria && <p className="mt-2 text-sm">Done when: {m.completion_criteria}</p>}
                </div>
                <div className="flex items-center gap-3">
                  <ProgressBar value={m.task_total ? m.task_done / m.task_total : null} label={`${m.task_done} of ${m.task_total} tasks done`} />
                  {m.source === "local" && (
                    <Button size="sm" onClick={() => toggle.mutate(m)} busy={toggle.isPending && toggle.variables?.id === m.id}>
                      {m.status === "done" ? "Reopen" : "Mark complete"}
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => setEditing(m)}>
                    Edit
                  </Button>
                  {m.source === "local" && (
                    <Button size="sm" variant="ghost" onClick={() => setDeleting(m)} aria-label={`Delete ${m.title}`}>
                      Delete
                    </Button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      <MilestoneForm projectId={projectId} milestone={editing === "new" ? undefined : editing ?? undefined} open={editing !== null} onClose={() => setEditing(null)} />
      <ConfirmDialog
        open={Boolean(deleting)}
        title="Delete milestone?"
        message={<>“{deleting?.title}” will be deleted. Its tasks stay, without a milestone.</>}
        confirmLabel="Delete milestone"
        busy={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting)}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}

function MilestoneForm({ projectId, milestone, open, onClose }: { projectId: string; milestone?: Milestone; open: boolean; onClose: () => void }) {
  const invalidate = useInvalidateWork();
  const gh = milestone?.source === "github";
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [criteria, setCriteria] = useState("");
  const [lastKey, setLastKey] = useState<string | null>(null);
  const key = `${open}-${milestone?.id ?? "new"}`;
  if (key !== lastKey) {
    setLastKey(key);
    setTitle(milestone?.title ?? "");
    setDue((gh ? milestone?.local_due_date : milestone?.due_date) ?? "");
    setCriteria(milestone?.completion_criteria ?? "");
  }
  const save = useMutation({
    mutationFn: () => {
      if (!milestone) return post("/milestones", { project_id: projectId, title: title.trim(), due_date: due || null, completion_criteria: criteria || null });
      return patch(
        `/milestones/${milestone.id}`,
        gh ? { local_due_date: due || null, completion_criteria: criteria || null } : { title: title.trim(), due_date: due || null, completion_criteria: criteria || null },
      );
    },
    onSuccess: () => {
      invalidate();
      toast(milestone ? "Milestone updated" : "Milestone created");
      onClose();
    },
  });
  const v = useValidation({ title: title.trim() ? undefined : "Give the milestone a title." });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (v.check()) save.mutate();
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={milestone ? "Edit milestone" : "New milestone"}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="ms-form" busy={save.isPending}>
            {milestone ? "Save" : "Create milestone"}
          </Button>
        </>
      }
    >
      <form id="ms-form" onSubmit={submit} className="space-y-4">
        <Field label="Title" error={v.error("title")}>
          {(p) => <Input {...p} value={title} onChange={(e) => setTitle(e.target.value)} onBlur={() => v.blur("title")} disabled={gh} />}
        </Field>
        <Field label={gh ? "Local due date (overrides GitHub's)" : "Due date"}>
          {(p) => <Input {...p} type="date" value={due} onChange={(e) => setDue(e.target.value)} />}
        </Field>
        <Field label="Completion criteria" hint="It can only be marked complete when all its tasks are done.">
          {(p) => <Textarea {...p} value={criteria} onChange={(e) => setCriteria(e.target.value)} />}
        </Field>
        <InlineError error={save.error} />
      </form>
    </Modal>
  );
}
