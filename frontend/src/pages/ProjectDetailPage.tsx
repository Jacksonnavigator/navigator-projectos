import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import BusinessPanel from "../components/BusinessPanel";
import DocumentsPanel from "../components/DocumentsPanel";
import { LifecycleBadge, PriorityBadge, ProgressBar, ProjectSelect } from "../components/domain";
import EvidencePanel from "../components/EvidencePanel";
import MilestonesPanel from "../components/MilestonesPanel";
import ProjectForm from "../components/ProjectForm";
import TaskList from "../components/TaskList";
import { Badge, Button, Card, ConfirmDialog, ErrorState, InlineError, Input, LoadingBlock, Modal, cx } from "../components/ui";
import { ApiError, del, get, post } from "../lib/api";
import { formatDate, relativeTime, titleCase } from "../lib/format";
import type { Project } from "../lib/types";

const TABS = ["overview", "tasks", "milestones", "evidence", "documents", "business"] as const;
type Tab = (typeof TABS)[number];

export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [params, setParams] = useSearchParams();
  const tab = (TABS.includes(params.get("tab") as Tab) ? params.get("tab") : "overview") as Tab;
  const project = useQuery({ queryKey: ["project", id], queryFn: () => get<Project>(`/projects/${id}`) });
  const [editing, setEditing] = useState(false);

  if (project.isPending) return <LoadingBlock rows={5} />;
  if (project.error) {
    if (project.error instanceof ApiError && project.error.status === 404)
      return <ErrorState error={new Error("This project doesn't exist or was deleted.")} />;
    return <ErrorState error={project.error} onRetry={() => void project.refetch()} />;
  }
  const p = project.data;
  const total = p.open_tasks + p.done_tasks;

  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-2 text-sm text-muted">
        <Link to="/projects" className="hover:underline">
          Projects
        </Link>
        {p.parent && (
          <>
            {" / "}
            <Link to={`/projects/${p.parent.id}`} className="hover:underline">
              {p.parent.name}
            </Link>
          </>
        )}
      </nav>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight">
            {p.register_id !== null && <span className="mr-2 text-base font-normal text-faint">#{p.register_id}</span>}
            {p.name}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <LifecycleBadge value={p.lifecycle} />
            <PriorityBadge value={p.priority} label={p.priority_label} />
            {p.category && <span className="text-sm text-muted">{p.category}</span>}
            {p.tags.length > 0 && <span className="text-sm text-muted">{p.tags.map((t) => `#${t}`).join(" ")}</span>}
            {p.completed_on && <span className="text-sm text-ok">Completed {formatDate(p.completed_on)}</span>}
            {p.archived_at && <Badge tone="warn">Archived {formatDate(p.archived_at)}</Badge>}
          </div>
        </div>
        <ProjectActions project={p} onEdit={() => setEditing(true)} />
      </div>

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card>
          <p className="text-xs text-muted">Top-level tasks done</p>
          <div className="mt-1">
            <ProgressBar value={total ? p.done_tasks / total : null} label={`${p.done_tasks} of ${total} tasks done`} />
          </div>
          <p className="mt-1 text-xs text-muted">
            {p.done_tasks} of {total}
          </p>
        </Card>
        <Card>
          <p className="text-xs text-muted">Overdue</p>
          <p className={cx("mt-1 text-xl font-semibold", p.overdue_tasks > 0 && "text-bad")}>{p.overdue_tasks}</p>
        </Card>
        <Card>
          <p className="text-xs text-muted">Last verified</p>
          <p className="mt-1 text-sm font-medium">{p.last_verified_at ? relativeTime(p.last_verified_at) : "Never"}</p>
        </Card>
        <Card>
          <p className="text-xs text-muted">Dates</p>
          <p className="mt-1 text-sm">
            {p.start_date ? formatDate(p.start_date) : "No start"} → {p.target_date ? formatDate(p.target_date) : "no target"}
          </p>
        </Card>
      </div>

      <div role="tablist" aria-label="Project sections" className="mb-5 flex gap-1 overflow-x-auto border-b border-line">
        {TABS.map((t) => (
          <button
            key={t}
            role="tab"
            type="button"
            aria-selected={tab === t}
            onClick={() => setParams({ tab: t }, { replace: true })}
            className={cx(
              "-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm",
              tab === t ? "border-accent font-medium text-accent" : "border-transparent text-muted hover:text-ink",
            )}
          >
            {titleCase(t)}
          </button>
        ))}
      </div>

      <div role="tabpanel">
        {tab === "overview" && <Overview project={p} />}
        {tab === "tasks" && <TaskList projectId={p.id} />}
        {tab === "milestones" && <MilestonesPanel projectId={p.id} />}
        {tab === "evidence" && <EvidencePanel projectId={p.id} />}
        {tab === "documents" && <DocumentsPanel projectId={p.id} />}
        {tab === "business" && <BusinessPanel projectId={p.id} />}
      </div>
      <ProjectForm open={editing} onClose={() => setEditing(false)} project={p} />
    </>
  );
}

function ProjectActions({ project: p, onEdit }: { project: Project; onEdit: () => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [typed, setTyped] = useState("");
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["project", p.id] });
    void qc.invalidateQueries({ queryKey: ["projects"] });
    void qc.invalidateQueries({ queryKey: ["dashboard"] });
  };
  const archive = useMutation({ mutationFn: () => post(`/projects/${p.id}/${p.archived_at ? "restore" : "archive"}`), onSuccess: refresh });
  const duplicate = useMutation({
    mutationFn: () => post<Project>(`/projects/${p.id}/duplicate`),
    onSuccess: (copy) => {
      refresh();
      navigate(`/projects/${copy.id}`);
    },
  });
  const remove = useMutation({
    mutationFn: () => del(`/projects/${p.id}`),
    onSuccess: () => {
      void qc.invalidateQueries();
      navigate("/projects");
    },
  });
  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="primary" onClick={onEdit}>
        Edit
      </Button>
      <Button onClick={() => duplicate.mutate()} busy={duplicate.isPending} title="Copy this project with its local tasks and milestones (use it as a template)">
        Duplicate
      </Button>
      <Button onClick={() => archive.mutate()} busy={archive.isPending}>
        {p.archived_at ? "Restore" : "Archive"}
      </Button>
      <Button variant="ghost" className="text-bad" onClick={() => setConfirmDelete(true)}>
        Delete
      </Button>
      <InlineError error={archive.error ?? duplicate.error} />
      <ConfirmDialog
        open={confirmDelete}
        title={`Delete ${p.name}?`}
        message={
          <div className="space-y-3">
            <p>
              This permanently deletes the project with its tasks, milestones, evidence, documents and business entries. Linked GitHub
              repositories stay but become unassigned. Archive instead if you might need it again.
            </p>
            <label htmlFor="confirm-name" className="block font-medium">
              Type the project name to confirm
            </label>
            <Input id="confirm-name" value={typed} onChange={(e) => setTyped(e.target.value)} />
          </div>
        }
        confirmLabel="Delete project"
        busy={remove.isPending}
        onConfirm={() => typed === p.name && remove.mutate()}
        onCancel={() => {
          setConfirmDelete(false);
          setTyped("");
        }}
      />
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  if (children === null || children === undefined || children === "") return null;
  return (
    <div className="grid gap-1 py-2 sm:grid-cols-[12rem_1fr]">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="whitespace-pre-line text-sm">{children}</dd>
    </div>
  );
}

function Overview({ project: p }: { project: Project }) {
  const qc = useQueryClient();
  const [addingLink, setAddingLink] = useState(false);
  const [url, setUrl] = useState("");
  const [related, setRelated] = useState<string | null>(null);
  const refresh = () => void qc.invalidateQueries({ queryKey: ["project", p.id] });
  const addLink = useMutation({
    mutationFn: () => post(`/projects/${p.id}/links`, { url: url.trim() }),
    onSuccess: () => {
      setUrl("");
      setAddingLink(false);
      refresh();
    },
  });
  const removeLink = useMutation({ mutationFn: (linkId: string) => del(`/projects/${p.id}/links/${linkId}`), onSuccess: refresh });
  const addRelated = useMutation({
    mutationFn: () => post(`/projects/${p.id}/related`, { project_id: related }),
    onSuccess: () => {
      setRelated(null);
      refresh();
    },
  });
  const removeRelated = useMutation({ mutationFn: (other: string) => del(`/projects/${p.id}/related/${other}`), onSuccess: refresh });

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Card title="Register" className="lg:col-span-2">
        <dl className="divide-y divide-line">
          <Row label="Purpose / scope">{p.purpose}</Row>
          <Row label="Next action">{p.next_action}</Row>
          <Row label="Known remaining work">{p.remaining_work}</Row>
          <Row label="Reported status">
            {p.reported_status}
            {p.status_confidence && <span className="mt-1 block text-xs text-muted">Confidence: {p.status_confidence}</span>}
          </Row>
          <Row label="Evidence / notes">{p.evidence_notes}</Row>
          <Row label="Tech stack">{p.tech_stack}</Row>
          <Row label="Type">{p.project_type}</Row>
          <Row label="Business potential">{p.business_potential}</Row>
          <Row label="Priority reason">{p.priority_reason}</Row>
          <Row label="Repository (as written)">{p.repository_text}</Row>
        </dl>
        <p className="mt-3 text-xs text-muted">
          These fields are what you reported. Use the Evidence tab to record what has been verified.
        </p>
      </Card>
      <div className="space-y-6">
        <Card title="Links" actions={<Button size="sm" onClick={() => setAddingLink(true)}>Add link</Button>}>
          {p.links.length === 0 ? (
            <p className="text-sm text-muted">No links.</p>
          ) : (
            <ul className="space-y-2">
              {p.links.map((l) => (
                <li key={l.id} className="flex items-start justify-between gap-2 text-sm">
                  <span className="min-w-0">
                    <Badge tone={l.kind === "github_repo" ? "info" : "neutral"}>{titleCase(l.kind)}</Badge>{" "}
                    {l.url.startsWith("http") ? (
                      <a href={l.url} target="_blank" rel="noopener noreferrer" className="break-all text-accent underline">
                        {l.label ?? l.url}
                      </a>
                    ) : (
                      <code className="break-all text-xs">{l.url}</code>
                    )}
                  </span>
                  <button type="button" className="text-xs text-muted hover:text-bad" onClick={() => removeLink.mutate(l.id)} aria-label={`Remove link ${l.url}`}>
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
          {p.links.some((l) => l.kind === "github_repo") && p.repo_count === 0 && (
            <p className="mt-3 text-xs text-muted">
              This project references a GitHub repo. Open <Link to="/github" className="underline">GitHub</Link> and load your
              repositories; matching repos are linked automatically.
            </p>
          )}
        </Card>
        <Card title="Related projects">
          {p.children.length > 0 && (
            <div className="mb-3">
              <p className="mb-1 text-xs font-medium text-muted">Sub-projects</p>
              <ul className="space-y-1 text-sm">
                {p.children.map((c) => (
                  <li key={c.id}>
                    <Link to={`/projects/${c.id}`} className="hover:underline">
                      {c.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <ul className="space-y-1 text-sm">
            {p.related.map((r) => (
              <li key={r.id} className="flex justify-between gap-2">
                <Link to={`/projects/${r.id}`} className="hover:underline">
                  {r.name}
                </Link>
                <button type="button" className="text-xs text-muted hover:text-bad" onClick={() => removeRelated.mutate(r.id)} aria-label={`Unlink ${r.name}`}>
                  Unlink
                </button>
              </li>
            ))}
          </ul>
          {p.related.length === 0 && p.children.length === 0 && <p className="text-sm text-muted">None.</p>}
          <div className="mt-3 flex gap-2">
            <label htmlFor="rel-select" className="sr-only">
              Link a related project
            </label>
            <ProjectSelect id="rel-select" value={related} onChange={setRelated} allowEmpty emptyLabel="Link a related project…" />
            <Button onClick={() => addRelated.mutate()} disabled={!related || related === p.id} busy={addRelated.isPending}>
              Link
            </Button>
          </div>
          <InlineError error={addRelated.error} />
        </Card>
      </div>
      <Modal
        open={addingLink}
        onClose={() => setAddingLink(false)}
        title="Add link"
        footer={
          <>
            <Button onClick={() => setAddingLink(false)}>Cancel</Button>
            <Button variant="primary" onClick={() => addLink.mutate()} disabled={!url.trim()} busy={addLink.isPending}>
              Add link
            </Button>
          </>
        }
      >
        <label htmlFor="link-url" className="mb-1 block text-sm font-medium">
          URL or local path
        </label>
        <Input id="link-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://github.com/you/repo" />
        <p className="mt-1 text-xs text-muted">GitHub, Hugging Face and website links are recognised automatically.</p>
        <InlineError error={addLink.error} />
      </Modal>
    </div>
  );
}
