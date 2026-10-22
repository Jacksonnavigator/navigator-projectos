import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { del, get, post } from "../lib/api";
import { formatDate, formatMoney, titleCase } from "../lib/format";
import type { BusinessEntry, BusinessSummaryRow } from "../lib/types";
import { ProjectSelect } from "./domain";
import { Badge, Button, Card, ConfirmDialog, EmptyState, ErrorState, Field, InlineError, Input, LoadingBlock, Modal, Select, Textarea, toast, useValidation } from "./ui";

const KINDS = ["cost", "revenue", "funding_need", "investment", "proposal", "opportunity"];
const STATUSES = ["estimated", "committed", "actual", "open", "won", "lost"];

export default function BusinessPanel({ projectId }: { projectId?: string }) {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState<BusinessEntry | null>(null);
  const entries = useQuery({ queryKey: ["business", projectId], queryFn: () => get<BusinessEntry[]>("/business", { project_id: projectId }) });
  const summary = useQuery({
    queryKey: ["business", "summary", projectId],
    queryFn: () => get<BusinessSummaryRow[]>("/business/summary", { project_id: projectId }),
  });
  const remove = useMutation({
    mutationFn: (id: string) => del(`/business/${id}`),
    onSuccess: () => {
      setDeleting(null);
      void qc.invalidateQueries({ queryKey: ["business"] });
    },
  });

  // Group summary by project and currency; amounts in different currencies are never added together.
  const groups = new Map<string, BusinessSummaryRow[]>();
  for (const row of summary.data ?? []) {
    const key = `${row.project_name ?? "?"}|${row.currency}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <Button variant="primary" onClick={() => setAdding(true)}>
          Add entry
        </Button>
      </div>
      {groups.size > 0 && (
        <div className="grid gap-4 md:grid-cols-2">
          {[...groups.entries()].map(([key, rows]) => {
            const [name, currency] = key.split("|");
            return (
              <Card key={key} title={`${projectId ? "" : `${name} · `}${currency}`}>
                <dl className="space-y-1 text-sm">
                  {rows.map((r) => (
                    <div key={`${r.kind}-${r.status}`} className="flex justify-between gap-3">
                      <dt className="text-muted">
                        {titleCase(r.kind)} <span className="text-xs">({r.status}, {r.count})</span>
                      </dt>
                      <dd className="tabular-nums">{formatMoney(r.total, r.currency)}</dd>
                    </div>
                  ))}
                </dl>
              </Card>
            );
          })}
        </div>
      )}
      <p className="text-xs text-muted">
        Business figures are tracked separately from software progress. Estimated amounts are planning numbers, not results.
      </p>
      {entries.isPending ? (
        <LoadingBlock rows={3} />
      ) : entries.error ? (
        <ErrorState error={entries.error} onRetry={() => void entries.refetch()} />
      ) : entries.data.length === 0 ? (
        <EmptyState title="No business entries" description="Track costs, revenue, funding needs, investors, proposals and opportunities." />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-muted">
                <th className="px-4 py-2 font-medium">Entry</th>
                {!projectId && <th className="px-2 py-2 font-medium">Project</th>}
                <th className="px-2 py-2 font-medium">Kind</th>
                <th className="px-2 py-2 font-medium">Status</th>
                <th className="px-2 py-2 text-right font-medium">Amount</th>
                <th className="px-2 py-2 font-medium">Date</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {entries.data.map((e) => (
                <tr key={e.id} className="border-b border-line last:border-0">
                  <td className="px-4 py-2">
                    <span className="font-medium">{e.title}</span>
                    {e.counterparty && <span className="block text-xs text-muted">{e.counterparty}</span>}
                  </td>
                  {!projectId && <td className="px-2 py-2 text-muted">{e.project_name}</td>}
                  <td className="px-2 py-2">{titleCase(e.kind)}</td>
                  <td className="px-2 py-2">
                    <Badge tone={e.status === "actual" || e.status === "won" ? "ok" : e.status === "lost" ? "bad" : "neutral"}>{titleCase(e.status)}</Badge>
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">{formatMoney(e.amount, e.currency)}</td>
                  <td className="px-2 py-2 text-muted">{formatDate(e.entry_date)}</td>
                  <td className="px-4 py-2 text-right">
                    <Button size="sm" variant="ghost" onClick={() => setDeleting(e)} aria-label={`Delete ${e.title}`}>
                      Delete
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <BusinessForm open={adding} onClose={() => setAdding(false)} projectId={projectId} />
      <ConfirmDialog
        open={Boolean(deleting)}
        title="Delete entry?"
        message={<>“{deleting?.title}” will be deleted.</>}
        confirmLabel="Delete entry"
        busy={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}

function BusinessForm({ open, onClose, projectId }: { open: boolean; onClose: () => void; projectId?: string }) {
  const qc = useQueryClient();
  const [f, setF] = useState<Record<string, string>>({});
  const [lastOpen, setLastOpen] = useState(false);
  const v = useValidation({
    project: f.project_id ? undefined : "Choose the project this belongs to.",
    title: f.title?.trim() ? undefined : "Give the entry a short title.",
    amount: !f.amount || /^\d+(\.\d{1,2})?$/.test(f.amount) ? undefined : "Use a positive number with up to 2 decimals.",
    currency: /^[A-Z]{3}$/.test(f.currency ?? "") ? undefined : "Use a 3-letter code such as TZS or USD.",
  });
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) {
      setF({ project_id: projectId ?? "", kind: "cost", status: "estimated", currency: "TZS" });
      v.reset();
    }
  }
  const set = (k: string) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const save = useMutation({
    mutationFn: () =>
      post("/business", {
        project_id: f.project_id,
        kind: f.kind,
        title: f.title?.trim(),
        amount: f.amount || null,
        currency: f.currency,
        status: f.status,
        counterparty: f.counterparty || null,
        entry_date: f.entry_date || null,
        notes: f.notes || null,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["business"] });
      toast("Business entry saved");
      onClose();
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (v.check()) save.mutate();
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add business entry"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="biz-form" busy={save.isPending}>
            Save entry
          </Button>
        </>
      }
    >
      <form id="biz-form" onSubmit={submit} className="space-y-4">
        {!projectId && (
          <Field label="Project" error={v.error("project")}>
            {(p) => <ProjectSelect {...p} value={f.project_id} onChange={(id) => setF((x) => ({ ...x, project_id: id ?? "" }))} onBlur={() => v.blur("project")} emptyLabel="Choose a project" />}
          </Field>
        )}
        <Field label="Title" error={v.error("title")}>{(p) => <Input {...p} value={f.title ?? ""} onChange={set("title")} onBlur={() => v.blur("title")} placeholder="e.g. 5 electric motorbikes" />}</Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Kind">
            {(p) => (
              <Select {...p} value={f.kind} onChange={set("kind")}>
                {KINDS.map((k) => (
                  <option key={k} value={k}>
                    {titleCase(k)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Status">
            {(p) => (
              <Select {...p} value={f.status} onChange={set("status")}>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {titleCase(s)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Amount" error={v.error("amount")}>
            {(p) => <Input {...p} inputMode="decimal" value={f.amount ?? ""} onChange={set("amount")} onBlur={() => v.blur("amount")} />}
          </Field>
          <Field label="Currency" hint="3-letter code, e.g. TZS, USD" error={v.error("currency")}>
            {(p) => <Input {...p} value={f.currency ?? ""} onChange={(e) => setF((x) => ({ ...x, currency: e.target.value.toUpperCase().slice(0, 3) }))} onBlur={() => v.blur("currency")} />}
          </Field>
          <Field label="Counterparty">{(p) => <Input {...p} value={f.counterparty ?? ""} onChange={set("counterparty")} placeholder="Client, investor, supplier" />}</Field>
          <Field label="Date">{(p) => <Input {...p} type="date" value={f.entry_date ?? ""} onChange={set("entry_date")} />}</Field>
        </div>
        <Field label="Notes">{(p) => <Textarea {...p} value={f.notes ?? ""} onChange={set("notes")} />}</Field>
        <InlineError error={save.error} />
      </form>
    </Modal>
  );
}
