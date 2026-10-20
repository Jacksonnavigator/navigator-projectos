import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { del, get, post } from "../lib/api";
import { formatDateTime, titleCase } from "../lib/format";
import type { Evidence, Page } from "../lib/types";
import { ProjectSelect } from "./domain";
import { Badge, Button, EmptyState, ErrorState, Field, InlineError, Input, LoadingBlock, Modal, Select, Textarea } from "./ui";

const KINDS = ["test_run", "build", "deployment_check", "hardware_measurement", "calibration", "bug", "incident", "release", "note"];
const RESULT_TONE = { pass: "ok", fail: "bad", partial: "warn", info: "neutral" } as const;
const ORIGIN_LABEL = { automated: "Automated", measured: "Measured", reported: "Reported" } as const;

export default function EvidencePanel({ projectId }: { projectId?: string }) {
  const [origin, setOrigin] = useState("");
  const [adding, setAdding] = useState(false);
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: ["evidence", projectId, origin],
    queryFn: () => get<Page<Evidence>>("/evidence", { project_id: projectId, origin, limit: 200 }),
  });
  const remove = useMutation({
    mutationFn: (id: string) => del(`/evidence/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["evidence"] }),
  });

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <label htmlFor="ev-origin" className="mb-1 block text-xs font-medium text-muted">
            Show
          </label>
          <Select id="ev-origin" value={origin} onChange={(e) => setOrigin(e.target.value)}>
            <option value="">All evidence</option>
            <option value="automated">Automated (CI, integrations)</option>
            <option value="measured">Measured by you</option>
            <option value="reported">Reported claims</option>
          </Select>
        </div>
        <Button variant="primary" onClick={() => setAdding(true)}>
          Record evidence
        </Button>
      </div>
      {list.isPending ? (
        <LoadingBlock rows={3} />
      ) : list.error ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : list.data.items.length === 0 ? (
        <EmptyState
          title="No evidence recorded"
          description="Record test results, hardware measurements or deployment checks. CI results from synced GitHub repos appear here automatically."
        />
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
          {list.data.items.map((e) => (
            <li key={e.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">
                  {e.url ? (
                    <a href={e.url} target="_blank" rel="noopener noreferrer" className="hover:underline">
                      {e.title}
                    </a>
                  ) : (
                    e.title
                  )}
                </p>
                <p className="text-xs text-muted">
                  {titleCase(e.kind)} · {formatDateTime(e.observed_at)} · source: {e.source}
                </p>
                {e.measured_value !== null && (
                  <p className="mt-1 text-sm tabular-nums">
                    Measured {Number(e.measured_value)} {e.unit}
                    {e.reference_value !== null && (
                      <>
                        {" "}
                        vs reference {Number(e.reference_value)} {e.unit} (difference{" "}
                        {(Number(e.measured_value) - Number(e.reference_value)).toFixed(3)} {e.unit})
                      </>
                    )}
                  </p>
                )}
                {e.notes && <p className="mt-1 whitespace-pre-line text-sm text-muted">{e.notes}</p>}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Badge tone={e.origin === "reported" ? "neutral" : "info"}>{ORIGIN_LABEL[e.origin]}</Badge>
                <Badge tone={RESULT_TONE[e.result]}>{titleCase(e.result)}</Badge>
                {e.source === "manual" && (
                  <Button size="sm" variant="ghost" onClick={() => remove.mutate(e.id)} aria-label={`Delete ${e.title}`}>
                    Delete
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      <EvidenceForm open={adding} onClose={() => setAdding(false)} projectId={projectId} />
    </div>
  );
}

function nowLocal(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

function EvidenceForm({ open, onClose, projectId }: { open: boolean; onClose: () => void; projectId?: string }) {
  const qc = useQueryClient();
  const [form, setForm] = useState<Record<string, string>>({});
  const [lastOpen, setLastOpen] = useState(false);
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) setForm({ project_id: projectId ?? "", kind: "test_run", result: "pass", origin: "measured", observed_at: nowLocal() });
  }
  const set = (k: string) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const save = useMutation({
    mutationFn: () =>
      post("/evidence", {
        project_id: form.project_id,
        kind: form.kind,
        title: form.title?.trim(),
        result: form.result,
        origin: form.origin,
        observed_at: new Date(form.observed_at!).toISOString(),
        measured_value: form.measured_value || null,
        reference_value: form.reference_value || null,
        unit: form.unit || null,
        url: form.url || null,
        notes: form.notes || null,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["evidence"] });
      void qc.invalidateQueries({ queryKey: ["health-overview"] });
      void qc.invalidateQueries({ queryKey: ["dashboard"] });
      onClose();
    },
  });
  const valid = form.project_id && form.title?.trim() && form.observed_at;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (valid) save.mutate();
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Record evidence"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="ev-form" busy={save.isPending} disabled={!valid}>
            Save record
          </Button>
        </>
      }
    >
      <form id="ev-form" onSubmit={submit} className="space-y-4">
        {!projectId && (
          <Field label="Project">
            {(p) => <ProjectSelect {...p} value={form.project_id} onChange={(id) => setForm((f) => ({ ...f, project_id: id ?? "" }))} emptyLabel="Choose a project" />}
          </Field>
        )}
        <Field label="What was checked">{(p) => <Input {...p} value={form.title ?? ""} onChange={set("title")} placeholder="e.g. Depth sensor at 1.00 m" />}</Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Kind">
            {(p) => (
              <Select {...p} value={form.kind} onChange={set("kind")}>
                {KINDS.map((k) => (
                  <option key={k} value={k}>
                    {titleCase(k)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Result">
            {(p) => (
              <Select {...p} value={form.result} onChange={set("result")}>
                <option value="pass">Pass</option>
                <option value="fail">Fail</option>
                <option value="partial">Partial</option>
                <option value="info">Info only</option>
              </Select>
            )}
          </Field>
          <Field label="How do you know?" hint="Only measured (and automated) records count as verification.">
            {(p) => (
              <Select {...p} value={form.origin} onChange={set("origin")}>
                <option value="measured">I measured / ran it myself</option>
                <option value="reported">Reported (not verified)</option>
              </Select>
            )}
          </Field>
          <Field label="When">{(p) => <Input {...p} type="datetime-local" value={form.observed_at ?? ""} onChange={set("observed_at")} />}</Field>
          <Field label="Measured value">{(p) => <Input {...p} inputMode="decimal" value={form.measured_value ?? ""} onChange={set("measured_value")} />}</Field>
          <Field label="Reference value">{(p) => <Input {...p} inputMode="decimal" value={form.reference_value ?? ""} onChange={set("reference_value")} />}</Field>
          <Field label="Unit">{(p) => <Input {...p} value={form.unit ?? ""} onChange={set("unit")} placeholder="m, V, %, mA…" />}</Field>
          <Field label="Link (optional)">{(p) => <Input {...p} type="url" value={form.url ?? ""} onChange={set("url")} placeholder="https://…" />}</Field>
        </div>
        <Field label="Notes">{(p) => <Textarea {...p} value={form.notes ?? ""} onChange={set("notes")} />}</Field>
        <InlineError error={save.error} />
      </form>
    </Modal>
  );
}
