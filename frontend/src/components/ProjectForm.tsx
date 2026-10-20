import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { patch, post } from "../lib/api";
import { LIFECYCLES, titleCase } from "../lib/format";
import type { Lifecycle, Priority, Project } from "../lib/types";
import { ProjectSelect } from "./domain";
import { Button, Field, InlineError, Input, Modal, Select, Textarea } from "./ui";

const TEXT_FIELDS: [keyof Project, string, string?][] = [
  ["purpose", "Purpose / scope"],
  ["tech_stack", "Tech stack"],
  ["repository_text", "Repository / URL / local path", "URLs and paths here become links automatically when the project is created."],
  ["remaining_work", "Known remaining work"],
  ["next_action", "Next action"],
  ["business_potential", "Business potential"],
  ["reported_status", "Reported status", "What you would say the status is. Verified evidence is tracked separately."],
  ["status_confidence", "Status confidence"],
  ["evidence_notes", "Evidence / notes"],
];

type Form = Record<string, string>;

function toForm(p?: Project): Form {
  const f: Form = {
    name: p?.name ?? "",
    category: p?.category ?? "",
    project_type: p?.project_type ?? "",
    lifecycle: p?.lifecycle ?? "planning",
    priority: p?.priority ?? "",
    start_date: p?.start_date ?? "",
    target_date: p?.target_date ?? "",
    parent_id: p?.parent_id ?? "",
    tags: p?.tags.join(", ") ?? "",
  };
  for (const [key] of TEXT_FIELDS) f[key] = (p?.[key] as string | null) ?? "";
  return f;
}

export default function ProjectForm({ open, onClose, project }: { open: boolean; onClose: () => void; project?: Project }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [form, setForm] = useState<Form>(toForm(project));
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => {
    if (open) {
      setForm(toForm(project));
      setErrors({});
    }
  }, [open, project]);

  const save = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = {
        name: form.name!.trim(),
        category: form.category || null,
        project_type: form.project_type || null,
        lifecycle: form.lifecycle as Lifecycle,
        priority: (form.priority || null) as Priority | null,
        start_date: form.start_date || null,
        target_date: form.target_date || null,
        parent_id: form.parent_id || null,
        tags: (form.tags ?? "").split(",").map((t) => t.trim()).filter(Boolean),
      };
      for (const [key] of TEXT_FIELDS) body[key] = form[key] || null;
      return project ? patch<Project>(`/projects/${project.id}`, body) : post<Project>("/projects", body);
    },
    onSuccess: (saved) => {
      void qc.invalidateQueries({ queryKey: ["projects"] });
      void qc.invalidateQueries({ queryKey: ["project", saved.id] });
      void qc.invalidateQueries({ queryKey: ["dashboard"] });
      onClose();
      if (!project) navigate(`/projects/${saved.id}`);
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const next: Record<string, string> = {};
    if (!form.name?.trim()) next.name = "Give the project a name.";
    if (form.start_date && form.target_date && form.target_date < form.start_date) next.target_date = "Target date is before the start date.";
    setErrors(next);
    if (Object.keys(next).length === 0) save.mutate();
  };
  const set = (key: string) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }));

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={project ? `Edit ${project.name}` : "New project"}
      wide
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="project-form" busy={save.isPending}>
            {project ? "Save changes" : "Create project"}
          </Button>
        </>
      }
    >
      <form id="project-form" onSubmit={submit} className="space-y-4" noValidate>
        <Field label="Name" error={errors.name}>
          {(p) => <Input {...p} value={form.name} onChange={set("name")} maxLength={200} autoFocus />}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Category">{(p) => <Input {...p} value={form.category} onChange={set("category")} placeholder="e.g. IoT / Water" />}</Field>
          <Field label="Type">{(p) => <Input {...p} value={form.project_type} onChange={set("project_type")} placeholder="e.g. Product" />}</Field>
          <Field label="Stage">
            {(p) => (
              <Select {...p} value={form.lifecycle} onChange={set("lifecycle")}>
                {LIFECYCLES.map((l) => (
                  <option key={l} value={l}>
                    {titleCase(l)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Priority">
            {(p) => (
              <Select {...p} value={form.priority} onChange={set("priority")}>
                <option value="">None</option>
                <option value="P1">P1 — Immediate</option>
                <option value="P2">P2 — Next</option>
                <option value="P3">P3 — Later</option>
                <option value="P4">P4 — Someday</option>
              </Select>
            )}
          </Field>
          <Field label="Start date">{(p) => <Input {...p} type="date" value={form.start_date} onChange={set("start_date")} />}</Field>
          <Field label="Target date" error={errors.target_date}>
            {(p) => <Input {...p} type="date" value={form.target_date} onChange={set("target_date")} />}
          </Field>
          <Field label="Part of (parent project)" hint="Sub-projects aren't counted twice on the dashboard.">
            {(p) => (
              <ProjectSelect
                {...p}
                value={form.parent_id || null}
                onChange={(id) => setForm((f) => ({ ...f, parent_id: id ?? "" }))}
                allowEmpty
                emptyLabel="None (top-level project)"
              />
            )}
          </Field>
          <Field label="Tags" hint="Comma separated">{(p) => <Input {...p} value={form.tags} onChange={set("tags")} />}</Field>
        </div>
        {TEXT_FIELDS.map(([key, label, hint]) => (
          <Field key={key} label={label} hint={hint}>
            {(p) => <Textarea {...p} value={form[key]} onChange={set(key)} rows={2} />}
          </Field>
        ))}
        <InlineError error={save.error} />
      </form>
    </Modal>
  );
}
