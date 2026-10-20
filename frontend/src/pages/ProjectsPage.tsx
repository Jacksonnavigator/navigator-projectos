import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { LifecycleBadge, PriorityBadge } from "../components/domain";
import ProjectForm from "../components/ProjectForm";
import { Badge, Button, EmptyState, ErrorState, Input, LoadingBlock, PageHeader, Select, Toolbar } from "../components/ui";
import { get } from "../lib/api";
import { formatDate, LIFECYCLES, relativeTime, titleCase } from "../lib/format";
import type { Page, ProjectSummary } from "../lib/types";

export default function ProjectsPage() {
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get("q") ?? "");
  const [creating, setCreating] = useState(params.get("new") === "1");
  const q = params.get("q") ?? "";
  const lifecycle = params.get("lifecycle") ?? "";
  const priority = params.get("priority") ?? "";
  const category = params.get("category") ?? "";
  const sort = params.get("sort") ?? "priority";
  const archived = params.get("archived") === "1";

  useEffect(() => {
    const t = setTimeout(() => update("q", search), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  function update(key: string, value: string) {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value) next.set(key, value);
        else next.delete(key);
        next.delete("new");
        return next;
      },
      { replace: true },
    );
  }

  const categories = useQuery({ queryKey: ["projects", "categories"], queryFn: () => get<string[]>("/projects/categories") });
  const list = useQuery({
    queryKey: ["projects", { q, lifecycle, priority, category, sort, archived }],
    queryFn: () =>
      get<Page<ProjectSummary>>("/projects", { q, lifecycle, priority, category, sort, include_archived: archived, limit: 500 }),
    placeholderData: keepPreviousData,
  });

  // Group sub-projects under their parent when the parent is in the result.
  const items = list.data?.items ?? [];
  const ids = new Set(items.map((p) => p.id));
  const children = new Map<string, ProjectSummary[]>();
  for (const p of items) if (p.parent_id && ids.has(p.parent_id)) children.set(p.parent_id, [...(children.get(p.parent_id) ?? []), p]);
  const roots = items.filter((p) => !(p.parent_id && ids.has(p.parent_id)));
  const filtered = Boolean(q || lifecycle || priority || category);

  return (
    <>
      <PageHeader
        title="Projects"
        description="Every project in one registry. Reported status is what you've written down; verified progress comes from evidence."
        actions={
          <Button variant="primary" onClick={() => setCreating(true)}>
            New project
          </Button>
        }
      />
      <Toolbar>
        <div className="w-full sm:w-64">
          <label htmlFor="project-search" className="mb-1 block text-xs font-medium text-muted">
            Search
          </label>
          <Input id="project-search" type="search" placeholder="Name, purpose, tech…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div>
          <label htmlFor="f-stage" className="mb-1 block text-xs font-medium text-muted">
            Stage
          </label>
          <Select id="f-stage" value={lifecycle} onChange={(e) => update("lifecycle", e.target.value)}>
            <option value="">All stages</option>
            {LIFECYCLES.map((l) => (
              <option key={l} value={l}>
                {titleCase(l)}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <label htmlFor="f-priority" className="mb-1 block text-xs font-medium text-muted">
            Priority
          </label>
          <Select id="f-priority" value={priority} onChange={(e) => update("priority", e.target.value)}>
            <option value="">Any</option>
            {["P1", "P2", "P3", "P4"].map((p) => (
              <option key={p}>{p}</option>
            ))}
          </Select>
        </div>
        <div className="max-w-56">
          <label htmlFor="f-category" className="mb-1 block text-xs font-medium text-muted">
            Category
          </label>
          <Select id="f-category" value={category} onChange={(e) => update("category", e.target.value)}>
            <option value="">All categories</option>
            {categories.data?.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <label htmlFor="f-sort" className="mb-1 block text-xs font-medium text-muted">
            Sort
          </label>
          <Select id="f-sort" value={sort} onChange={(e) => update("sort", e.target.value)}>
            <option value="priority">Priority</option>
            <option value="name">Name</option>
            <option value="updated">Recently updated</option>
            <option value="target">Target date</option>
            <option value="register">Register ID</option>
          </Select>
        </div>
        <label className="flex h-10 items-center gap-2 text-sm">
          <input type="checkbox" checked={archived} onChange={(e) => update("archived", e.target.checked ? "1" : "")} className="size-4" />
          Show archived
        </label>
      </Toolbar>

      {list.isPending ? (
        <LoadingBlock />
      ) : list.error ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : items.length === 0 ? (
        filtered ? (
          <EmptyState title="No projects match these filters" action={<Button onClick={() => { setSearch(""); setParams({}); }}>Clear filters</Button>} />
        ) : (
          <EmptyState
            title="No projects yet"
            description="Import your Excel register to bring in all your projects at once."
            action={
              <Link to="/import" className="inline-flex h-10 items-center rounded-md bg-accent px-4 text-sm font-medium text-accent-ink">
                Import register
              </Link>
            }
          />
        )
      ) : (
        <>
          <p className="mb-2 text-xs text-muted" aria-live="polite">
            {list.data.total} project{list.data.total === 1 ? "" : "s"}
          </p>
          <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
            {roots.map((p) => (
              <ProjectRow key={p.id} project={p} childProjects={children.get(p.id) ?? []} />
            ))}
          </ul>
        </>
      )}
      <ProjectForm open={creating} onClose={() => setCreating(false)} />
    </>
  );
}

function ProjectRow({ project: p, childProjects, nested }: { project: ProjectSummary; childProjects: ProjectSummary[]; nested?: boolean }) {
  return (
    <li>
      <Link to={`/projects/${p.id}`} className={`flex flex-col gap-2 px-4 py-3 hover:bg-sunken sm:flex-row sm:items-center ${nested ? "pl-10" : ""}`}>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {nested && <span className="text-faint" aria-hidden="true">↳</span>}
            {p.register_id !== null && <span className="text-xs tabular-nums text-faint">#{p.register_id}</span>}
            <span className="font-medium">{p.name}</span>
            <PriorityBadge value={p.priority} label={p.priority_label} />
            {p.archived_at && <Badge>Archived</Badge>}
          </div>
          <p className="mt-0.5 truncate text-xs text-muted">
            {[p.category, p.reported_status].filter(Boolean).join(" · ") || "No category"}
          </p>
          {p.next_action && <p className="mt-1 line-clamp-1 text-sm text-ink/80">Next: {p.next_action}</p>}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-3 text-xs text-muted sm:justify-end">
          <LifecycleBadge value={p.lifecycle} />
          <span title="Open / done top-level tasks">
            {p.open_tasks} open · {p.done_tasks} done
          </span>
          {p.overdue_tasks > 0 && <Badge tone="bad">{p.overdue_tasks} overdue</Badge>}
          {p.repo_count > 0 && <Badge tone="info">{p.repo_count} repo{p.repo_count > 1 ? "s" : ""}</Badge>}
          {p.target_date && <span>Target {formatDate(p.target_date)}</span>}
          <span title="Last automated or measured evidence">Verified: {p.last_verified_at ? relativeTime(p.last_verified_at) : "never"}</span>
        </div>
      </Link>
      {childProjects.length > 0 && (
        <ul className="divide-y divide-line border-t border-line">
          {childProjects.map((c) => (
            <ProjectRow key={c.id} project={c} childProjects={[]} nested />
          ))}
        </ul>
      )}
    </li>
  );
}
