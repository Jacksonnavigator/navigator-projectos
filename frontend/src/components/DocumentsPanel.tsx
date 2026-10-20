import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useRef, useState } from "react";
import { api, del, get, patch, post } from "../lib/api";
import { formatBytes, formatDateTime, titleCase } from "../lib/format";
import { Markdown } from "../lib/markdown";
import type { Doc, Page } from "../lib/types";
import { ProjectSelect } from "./domain";
import { Badge, Button, ConfirmDialog, EmptyState, ErrorState, Field, InlineError, Input, LoadingBlock, Modal, Select, Textarea, Toolbar } from "./ui";

const CATEGORIES = ["srs", "business_plan", "diagram", "wiring", "install", "research", "decision", "report", "other"];
const CATEGORY_LABEL: Record<string, string> = { srs: "SRS", business_plan: "Business plan" };
const label = (c: string) => CATEGORY_LABEL[c] ?? titleCase(c);

export default function DocumentsPanel({ projectId }: { projectId?: string }) {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [creatingNote, setCreatingNote] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const list = useQuery({
    queryKey: ["documents", projectId, q, category],
    queryFn: () => get<Page<Doc>>("/documents", { project_id: projectId, q, category, limit: 200 }),
    placeholderData: keepPreviousData,
  });
  const upload = useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      if (projectId) fd.append("project_id", projectId);
      return api<Doc>("/documents/upload", { method: "POST", body: fd });
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["documents"] }),
  });

  return (
    <div>
      <Toolbar>
        <div className="w-full sm:w-64">
          <label htmlFor="doc-search" className="mb-1 block text-xs font-medium text-muted">
            Search
          </label>
          <Input id="doc-search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Title, description, notes" />
        </div>
        <div>
          <label htmlFor="doc-cat" className="mb-1 block text-xs font-medium text-muted">
            Category
          </label>
          <Select id="doc-cat" value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">All</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {label(c)}
              </option>
            ))}
          </Select>
        </div>
        <div className="ml-auto flex gap-2">
          <Button onClick={() => setCreatingNote(true)}>New note</Button>
          <Button variant="primary" onClick={() => fileInput.current?.click()} busy={upload.isPending}>
            Upload file
          </Button>
          <input
            ref={fileInput}
            type="file"
            className="sr-only"
            aria-label="Upload a file"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) upload.mutate(f);
              e.target.value = "";
            }}
          />
        </div>
      </Toolbar>
      <InlineError error={upload.error} />
      {list.isPending ? (
        <LoadingBlock rows={3} />
      ) : list.error ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : list.data.items.length === 0 ? (
        <EmptyState
          title={q || category ? "No documents match" : "No documents yet"}
          description="Upload SRS documents, wiring diagrams, business plans or PDFs (up to 15 MB), or write a Markdown note."
        />
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
          {list.data.items.map((d) => (
            <li key={d.id}>
              <button type="button" onClick={() => setOpen(d.id)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-sunken">
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{d.title}</span>
                  <span className="block truncate text-xs text-muted">
                    {[!projectId && d.project_name, d.versions[0] ? `${d.versions[0].filename} · ${formatBytes(d.versions[0].size_bytes)}` : "Note", `updated ${formatDateTime(d.updated_at)}`]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
                <Badge>{label(d.category)}</Badge>
                {d.versions.length > 1 && <Badge tone="info">v{d.versions[0]?.version_no}</Badge>}
              </button>
            </li>
          ))}
        </ul>
      )}
      <DocumentModal docId={open} onClose={() => setOpen(null)} />
      <NoteForm open={creatingNote} onClose={() => setCreatingNote(false)} projectId={projectId} onCreated={(id) => setOpen(id)} />
    </div>
  );
}

function NoteForm({ open, onClose, projectId, onCreated }: { open: boolean; onClose: () => void; projectId?: string; onCreated: (id: string) => void }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("research");
  const [body, setBody] = useState("");
  const [project, setProject] = useState<string | null>(projectId ?? null);
  const save = useMutation({
    mutationFn: () => post<Doc>("/documents", { title: title.trim(), category, body_markdown: body, project_id: project }),
    onSuccess: (doc) => {
      void qc.invalidateQueries({ queryKey: ["documents"] });
      setTitle("");
      setBody("");
      onClose();
      onCreated(doc.id);
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (title.trim()) save.mutate();
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New note"
      wide
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="note-form" busy={save.isPending} disabled={!title.trim()}>
            Create note
          </Button>
        </>
      }
    >
      <form id="note-form" onSubmit={submit} className="space-y-4">
        <Field label="Title">{(p) => <Input {...p} value={title} onChange={(e) => setTitle(e.target.value)} />}</Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Category">
            {(p) => (
              <Select {...p} value={category} onChange={(e) => setCategory(e.target.value)}>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {label(c)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {!projectId && <Field label="Project">{(p) => <ProjectSelect {...p} value={project} onChange={setProject} allowEmpty emptyLabel="General (no project)" />}</Field>}
        </div>
        <Field label="Content" hint="Markdown: # headings, **bold**, - lists, `code`, [links](https://…)">
          {(p) => <Textarea {...p} value={body} onChange={(e) => setBody(e.target.value)} rows={10} />}
        </Field>
        <InlineError error={save.error} />
      </form>
    </Modal>
  );
}

function DocumentModal({ docId, onClose }: { docId: string | null; onClose: () => void }) {
  const qc = useQueryClient();
  const doc = useQuery({ queryKey: ["document", docId], queryFn: () => get<Doc>(`/documents/${docId}`), enabled: Boolean(docId) });
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState("");
  const [confirm, setConfirm] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["documents"] });
    void qc.invalidateQueries({ queryKey: ["document", docId] });
  };
  const saveBody = useMutation({
    mutationFn: () => patch(`/documents/${docId}`, { body_markdown: body }),
    onSuccess: () => {
      setEditing(false);
      refresh();
    },
  });
  const upload = useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      return api(`/documents/${docId}/versions`, { method: "POST", body: fd });
    },
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: () => del(`/documents/${docId}`),
    onSuccess: () => {
      setConfirm(false);
      refresh();
      onClose();
    },
  });
  const d = doc.data;
  return (
    <>
      <Modal
        open={Boolean(docId)}
        onClose={() => {
          setEditing(false);
          onClose();
        }}
        title={d?.title ?? "Document"}
        wide
        footer={
          <>
            <Button variant="ghost" className="mr-auto text-bad" onClick={() => setConfirm(true)}>
              Delete document
            </Button>
            <Button onClick={() => fileInput.current?.click()} busy={upload.isPending}>
              Upload new version
            </Button>
            <input ref={fileInput} type="file" className="sr-only" aria-label="Upload new version" onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) upload.mutate(f);
              e.target.value = "";
            }} />
          </>
        }
      >
        {doc.isPending ? (
          <LoadingBlock rows={3} />
        ) : doc.error ? (
          <ErrorState error={doc.error} />
        ) : d ? (
          <div className="space-y-5">
            <p className="text-xs text-muted">
              {label(d.category)}
              {d.project_name && ` · ${d.project_name}`} · updated {formatDateTime(d.updated_at)}
            </p>
            <InlineError error={upload.error} />
            {d.versions.length > 0 && (
              <section>
                <h3 className="mb-2 text-sm font-semibold">Files</h3>
                <ul className="divide-y divide-line rounded-md border border-line">
                  {d.versions.map((v) => (
                    <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                      <span className="min-w-0">
                        <span className="font-medium">v{v.version_no}</span> {v.filename}
                        <span className="block text-xs text-muted">
                          {formatBytes(v.size_bytes)} · {formatDateTime(v.uploaded_at)} · SHA-256 {v.sha256.slice(0, 12)}…
                        </span>
                      </span>
                      <span className="flex gap-2">
                        {["application/pdf", "image/png", "image/jpeg", "image/gif", "image/webp"].includes(v.content_type) && (
                          <a className="text-sm text-accent underline" href={`/api/v1/documents/${d.id}/versions/${v.id}/download?inline=true`} target="_blank" rel="noopener noreferrer">
                            View
                          </a>
                        )}
                        <a className="text-sm text-accent underline" href={`/api/v1/documents/${d.id}/versions/${v.id}/download`}>
                          Download
                        </a>
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <section>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-semibold">Notes</h3>
                {!editing && (
                  <Button size="sm" onClick={() => { setBody(d.body_markdown ?? ""); setEditing(true); }}>
                    Edit notes
                  </Button>
                )}
              </div>
              {editing ? (
                <div className="space-y-2">
                  <label htmlFor="doc-body" className="sr-only">
                    Notes
                  </label>
                  <Textarea id="doc-body" value={body} onChange={(e) => setBody(e.target.value)} rows={12} />
                  <div className="flex gap-2">
                    <Button variant="primary" onClick={() => saveBody.mutate()} busy={saveBody.isPending}>
                      Save notes
                    </Button>
                    <Button onClick={() => setEditing(false)}>Cancel</Button>
                  </div>
                  <InlineError error={saveBody.error} />
                </div>
              ) : d.body_markdown ? (
                <Markdown source={d.body_markdown} />
              ) : (
                <p className="text-sm text-muted">No notes.</p>
              )}
            </section>
          </div>
        ) : null}
      </Modal>
      <ConfirmDialog
        open={confirm}
        title="Delete document?"
        message={<>“{d?.title}” and all {d?.versions.length ?? 0} stored file versions will be permanently deleted.</>}
        confirmLabel="Delete document"
        busy={remove.isPending}
        onConfirm={() => remove.mutate()}
        onCancel={() => setConfirm(false)}
      />
    </>
  );
}
