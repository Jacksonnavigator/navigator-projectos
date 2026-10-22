import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { api, get } from "../lib/api";
import { formatDate } from "../lib/format";
import { Badge, Button, Card, InlineError } from "./ui";

interface PlanInfo {
  id: string;
  name: string;
  description: string | null;
}

interface PlanResult {
  plan: string;
  dry_run: boolean;
  projects: {
    project: string;
    changes: string[];
    milestones: { title: string; action: string }[];
    tasks: { title: string; action: string; due: string | null }[];
  }[];
  missing_projects: string[];
  counts: Record<string, number>;
  warnings: string[];
}

/** Preview and apply a work plan (milestones, tasks, dependencies) shipped in backend/plans/. */
export default function PlanLoader() {
  const qc = useQueryClient();
  const plans = useQuery({ queryKey: ["plans"], queryFn: () => get<PlanInfo[]>("/import/plans") });
  const [selected, setSelected] = useState<string | null>(null);
  const run = useMutation({
    mutationFn: ({ id, dryRun }: { id: string; dryRun: boolean }) =>
      api<PlanResult>(`/import/plans/${encodeURIComponent(id)}?dry_run=${dryRun}`, { method: "POST" }),
    onSuccess: (res) => {
      if (!res.dry_run) void qc.invalidateQueries();
    },
  });
  const result = run.data;

  if (!plans.data?.length) return null;
  return (
    <Card title="Load a work plan" className="mb-6">
      <p className="mb-3 text-sm text-muted">
        A plan fills in project stages, priorities, dates, milestones, tasks and dependencies in one go. Preview first; applying it again
        later updates dates but never changes a task's status.
      </p>
      <ul className="space-y-2">
        {plans.data.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-line p-3">
            <span className="min-w-0">
              <span className="block font-medium">{p.name}</span>
              {p.description && <span className="block text-xs text-muted">{p.description}</span>}
            </span>
            <span className="flex gap-2">
              <Button
                onClick={() => {
                  setSelected(p.id);
                  run.mutate({ id: p.id, dryRun: true });
                }}
                busy={run.isPending && selected === p.id && run.variables?.dryRun}
              >
                Preview
              </Button>
              <Button
                variant="primary"
                disabled={!(result?.dry_run && selected === p.id)}
                onClick={() => run.mutate({ id: p.id, dryRun: false })}
                busy={run.isPending && selected === p.id && !run.variables?.dryRun}
              >
                Apply plan
              </Button>
            </span>
          </li>
        ))}
      </ul>
      <InlineError error={run.error} />
      {result && (
        <div className="mt-4 space-y-3 text-sm" role="status">
          <p className={result.dry_run ? "font-medium" : "font-medium text-ok"}>
            {result.dry_run ? "Preview (nothing saved yet):" : "Plan applied:"} {result.counts.tasks_created} tasks created,{" "}
            {result.counts.tasks_updated} updated, {result.counts.milestones_created} milestones created, {result.counts.dependencies_added}{" "}
            dependencies added, {result.counts.projects_updated} projects updated.
          </p>
          {result.missing_projects.length > 0 && (
            <p className="text-bad">
              Not found (import your register first, or check the names): {result.missing_projects.join(", ")}
            </p>
          )}
          {result.warnings.map((w) => (
            <p key={w} className="text-warn">
              {w}
            </p>
          ))}
          {result.projects.map((p) => (
            <div key={p.project} className="rounded-md bg-sunken p-3">
              <p className="font-medium">
                {p.project} {p.changes.length > 0 && <span className="text-xs font-normal text-muted">(sets {p.changes.join(", ")})</span>}
              </p>
              {p.tasks.length > 0 && (
                <ul className="mt-1 space-y-0.5">
                  {p.tasks.map((t) => (
                    <li key={t.title} className="flex justify-between gap-2">
                      <span>
                        <Badge tone={t.action === "create" ? "ok" : "info"}>{t.action}</Badge> {t.title}
                      </span>
                      <span className="shrink-0 text-xs text-muted">{t.due ? formatDate(t.due) : ""}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
          {!result.dry_run && (
            <Link to="/timeline" className="inline-block font-medium text-accent underline">
              Open the timeline
            </Link>
          )}
        </div>
      )}
    </Card>
  );
}
