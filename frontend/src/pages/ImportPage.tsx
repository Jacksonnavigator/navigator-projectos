import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { Badge, Button, Card, InlineError, PageHeader } from "../components/ui";
import { api } from "../lib/api";
import { titleCase } from "../lib/format";
import type { ImportPreview, ImportSuggestion } from "../lib/types";

const ACTION_TONE = { create: "ok", update: "info", unchanged: "neutral", skip: "bad" } as const;

export default function ImportPage() {
  const qc = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [chosen, setChosen] = useState<Set<number>>(new Set());
  const [onlyChanges, setOnlyChanges] = useState(false);

  const preview = useMutation({
    mutationFn: (f: File) => {
      const fd = new FormData();
      fd.append("file", f);
      return api<ImportPreview>("/import/register/preview", { method: "POST", body: fd });
    },
    onSuccess: (data) => setChosen(new Set(data.suggestions.map((_, i) => i))),
  });
  const commit = useMutation({
    mutationFn: () => {
      const fd = new FormData();
      fd.append("file", file!);
      fd.append("sha256", preview.data!.sha256);
      const picked: ImportSuggestion[] = preview.data!.suggestions.filter((_, i) => chosen.has(i));
      fd.append("suggestions", JSON.stringify(picked));
      return api<{ created: number; updated: number; skipped: number; links_applied: number }>("/import/register/commit", { method: "POST", body: fd });
    },
    onSuccess: () => void qc.invalidateQueries(),
  });

  const pick = (f: File | null) => {
    setFile(f);
    commit.reset();
    preview.reset();
    if (f) preview.mutate(f);
  };
  const data = preview.data;
  const rows = data?.rows.filter((r) => !onlyChanges || r.action !== "unchanged") ?? [];

  return (
    <>
      <PageHeader
        title="Import project register"
        description="Upload your Excel register (.xlsx with a “Master Register” sheet and optional “Priority Plan” sheet). You'll see exactly what changes before anything is saved. Re-importing updates matching projects instead of duplicating them."
      />
      <Card className="mb-6">
        <label htmlFor="register-file" className="mb-2 block text-sm font-medium">
          Register file
        </label>
        <input
          id="register-file"
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          onChange={(e) => pick(e.target.files?.[0] ?? null)}
          className="block w-full text-sm file:mr-3 file:h-10 file:rounded-md file:border-0 file:bg-accent file:px-4 file:font-medium file:text-accent-ink"
        />
        <p className="mt-2 text-xs text-muted">
          Expected columns: ID, Project, Category, Type, Status, Status confidence, Purpose / scope, Known tech stack, Repository / URL, Known
          remaining work, Business potential, Suggested next action, Evidence / notes. Don't put passwords or keys in the register.
        </p>
        {preview.isPending && <p className="mt-3 text-sm text-muted" role="status">Reading the workbook…</p>}
        <InlineError error={preview.error} />
      </Card>

      {commit.data && (
        <div role="status" className="mb-6 rounded-lg border border-ok/30 bg-ok-soft p-4 text-sm">
          <p className="font-medium text-ok">Import complete</p>
          <p className="mt-1">
            {commit.data.created} created, {commit.data.updated} updated, {commit.data.skipped} skipped, {commit.data.links_applied} project links applied.
          </p>
          <Link to="/projects" className="mt-2 inline-block font-medium text-accent underline">
            View projects
          </Link>
        </div>
      )}

      {data && !commit.data && (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-3">
            <Badge tone="ok">{data.summary.create} new</Badge>
            <Badge tone="info">{data.summary.update} to update</Badge>
            <Badge>{data.summary.unchanged} unchanged</Badge>
            {data.summary.skip > 0 && <Badge tone="bad">{data.summary.skip} skipped (problems)</Badge>}
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="size-4" checked={onlyChanges} onChange={(e) => setOnlyChanges(e.target.checked)} />
              Hide unchanged
            </label>
            <Button variant="primary" className="ml-auto" onClick={() => commit.mutate()} busy={commit.isPending} disabled={data.summary.create + data.summary.update === 0 && chosen.size === 0}>
              Import {data.summary.create + data.summary.update} projects
            </Button>
          </div>
          <InlineError error={commit.error} />
          {data.warnings.map((w) => (
            <p key={w} className="text-sm text-warn">
              {w}
            </p>
          ))}

          {data.suggestions.length > 0 && (
            <Card title="Suggested links between projects">
              <p className="mb-3 text-sm text-muted">
                Found in your notes (e.g. “part of DevGuardian”, “duplicate counting with project 3”). Sub-projects are nested under their parent and
                not counted twice. Untick any that are wrong.
              </p>
              <ul className="space-y-2">
                {data.suggestions.map((s, i) => (
                  <li key={i}>
                    <label className="flex items-start gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="mt-0.5 size-4"
                        checked={chosen.has(i)}
                        onChange={(e) =>
                          setChosen((prev) => {
                            const next = new Set(prev);
                            if (e.target.checked) next.add(i);
                            else next.delete(i);
                            return next;
                          })
                        }
                      />
                      <span>
                        <Badge tone={s.kind === "parent" ? "accent" : "neutral"}>{s.kind === "parent" ? "Sub-project" : "Related"}</Badge> {s.description}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {data.priority_unmatched.length > 0 && (
            <Card title="Priority Plan rows not matched">
              <ul className="list-disc pl-5 text-sm">
                {data.priority_unmatched.map((u) => (
                  <li key={u.name}>
                    {u.name}: {u.reason}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <div className="overflow-x-auto rounded-lg border border-line bg-surface">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-muted">
                  <th className="px-3 py-2 font-medium">Row</th>
                  <th className="px-3 py-2 font-medium">Project</th>
                  <th className="px-3 py-2 font-medium">Action</th>
                  <th className="px-3 py-2 font-medium">Stage (inferred)</th>
                  <th className="px-3 py-2 font-medium">Priority</th>
                  <th className="px-3 py-2 font-medium">Details</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.row_number} className="border-b border-line align-top last:border-0">
                    <td className="px-3 py-2 tabular-nums text-muted">{r.row_number}</td>
                    <td className="px-3 py-2">
                      {r.register_id !== null && <span className="text-faint">#{r.register_id} </span>}
                      {r.name ?? <em className="text-muted">no name</em>}
                    </td>
                    <td className="px-3 py-2">
                      <Badge tone={ACTION_TONE[r.action]}>{titleCase(r.action)}</Badge>
                    </td>
                    <td className="px-3 py-2">{r.lifecycle ? titleCase(r.lifecycle) : "—"}</td>
                    <td className="px-3 py-2">
                      {r.priority ?? "—"}
                      {r.priority_match === "partial" && <span className="block text-xs text-muted">matched by partial name</span>}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {r.problems.map((p) => (
                        <p key={p} className="text-bad">
                          {p}
                        </p>
                      ))}
                      {r.changes.length > 0 && <p className="text-muted">Changes: {r.changes.map((c) => titleCase(c.field)).join(", ")}</p>}
                      {r.links.length > 0 && <p className="text-muted">Links: {r.links.map((l) => titleCase(l.kind)).join(", ")}</p>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted">
            The stage is a best guess from the Status text and can be changed per project afterwards. Status, status confidence and evidence notes
            are stored exactly as written and are treated as reported, not verified.
          </p>
        </div>
      )}
    </>
  );
}
