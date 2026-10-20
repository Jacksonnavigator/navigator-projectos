import { useQuery } from "@tanstack/react-query";
import type { SelectHTMLAttributes } from "react";
import { get } from "../lib/api";
import { LIFECYCLE_TONE, STATUS_LABEL, titleCase } from "../lib/format";
import type { Lifecycle, Page, Priority, ProjectSummary, Task, TaskPriority, TaskStatus } from "../lib/types";
import { Badge, Select } from "./ui";

export function useAllProjects(includeArchived = false) {
  return useQuery({
    queryKey: ["projects", "all", includeArchived],
    queryFn: () =>
      get<Page<ProjectSummary>>("/projects", { limit: 500, sort: "name", include_archived: includeArchived }),
    staleTime: 60_000,
  });
}

export function ProjectSelect({
  value,
  onChange,
  allowEmpty,
  emptyLabel = "No project",
  ...rest
}: {
  value: string | null | undefined;
  onChange: (id: string | null) => void;
  allowEmpty?: boolean;
  emptyLabel?: string;
} & Omit<SelectHTMLAttributes<HTMLSelectElement>, "value" | "onChange">) {
  const projects = useAllProjects();
  return (
    <Select value={value ?? ""} onChange={(e) => onChange(e.target.value || null)} {...rest}>
      {(allowEmpty || !value) && <option value="">{projects.isPending ? "Loading…" : emptyLabel}</option>}
      {projects.data?.items.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
    </Select>
  );
}

export function LifecycleBadge({ value }: { value: Lifecycle }) {
  return <Badge tone={LIFECYCLE_TONE[value]}>{titleCase(value)}</Badge>;
}

export function PriorityBadge({ value, label }: { value: Priority | null; label?: string | null }) {
  if (!value) return null;
  const tone = value === "P1" ? "bad" : value === "P2" ? "accent" : "neutral";
  return (
    <Badge tone={tone} title={label ?? undefined}>
      {value}
      {label ? ` · ${label}` : ""}
    </Badge>
  );
}

const STATUS_TONE: Record<TaskStatus, "neutral" | "accent" | "ok" | "warn" | "bad" | "info"> = {
  backlog: "neutral",
  todo: "neutral",
  in_progress: "accent",
  blocked: "bad",
  in_review: "info",
  done: "ok",
};

export function StatusBadge({ value }: { value: TaskStatus }) {
  return <Badge tone={STATUS_TONE[value]}>{STATUS_LABEL[value]}</Badge>;
}

export function TaskPriorityBadge({ value }: { value: TaskPriority }) {
  if (value === "medium") return null;
  return <Badge tone={value === "urgent" ? "bad" : value === "high" ? "warn" : "neutral"}>{titleCase(value)}</Badge>;
}

export function SourceBadge({ task }: { task: Pick<Task, "source" | "gh_kind" | "gh_number" | "gh_url" | "repo_full_name"> }) {
  if (task.source !== "github") return null;
  const label =
    task.gh_kind === "pull_request" ? `PR #${task.gh_number}` : task.gh_kind === "draft" ? "Draft" : `#${task.gh_number}`;
  const content = (
    <Badge tone="info" title={task.repo_full_name ?? "GitHub"}>
      GitHub {label}
    </Badge>
  );
  return task.gh_url ? (
    <a href={task.gh_url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>
      {content}
    </a>
  ) : (
    content
  );
}

export function ProgressBar({ value, label }: { value: number | null; label: string }) {
  if (value === null) return <span className="text-xs text-muted">Not measured</span>;
  const pct = Math.round(value * 100);
  return (
    <div className="flex items-center gap-2" title={label}>
      <div
        className="h-1.5 w-20 overflow-hidden rounded-full bg-sunken"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
      >
        <div className="h-full bg-accent" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs tabular-nums text-muted">{pct}%</span>
    </div>
  );
}
