import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { get } from "../lib/api";
import type { Page, Task } from "../lib/types";
import { useAllProjects } from "./domain";
import TaskModal from "./TaskModal";
import { Modal, cx } from "./ui";

export const PAGES: { to: string; label: string; keywords: string }[] = [
  { to: "/", label: "Dashboard", keywords: "home overview today" },
  { to: "/projects", label: "Projects", keywords: "registry list" },
  { to: "/timeline", label: "Timeline", keywords: "gantt schedule plan" },
  { to: "/board", label: "Board", keywords: "kanban" },
  { to: "/tasks", label: "Tasks", keywords: "todo list" },
  { to: "/calendar", label: "Calendar", keywords: "month dates" },
  { to: "/github", label: "GitHub", keywords: "repos sync boards" },
  { to: "/health", label: "Health & tests", keywords: "evidence verified measurements" },
  { to: "/documents", label: "Documents", keywords: "files notes knowledge" },
  { to: "/business", label: "Business", keywords: "money costs funding" },
  { to: "/import", label: "Import register", keywords: "excel plans upload" },
  { to: "/settings", label: "Settings", keywords: "export theme timezone" },
];

type Result =
  | { kind: "page"; id: string; label: string; to: string }
  | { kind: "project"; id: string; label: string; to: string; meta: string }
  | { kind: "task"; id: string; label: string; meta: string };

/** Ctrl/⌘+K: jump to any page, project or task. */
export default function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [active, setActive] = useState(0);
  const [taskId, setTaskId] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const projects = useAllProjects();

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 150);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => {
    if (open) {
      setQ("");
      setActive(0);
      setTimeout(() => input.current?.focus(), 0);
    }
  }, [open]);

  const tasks = useQuery({
    queryKey: ["tasks", "palette", debounced],
    queryFn: () => get<Page<Task>>("/tasks", { q: debounced, limit: 6, sort: "updated" }),
    enabled: open && debounced.length >= 2,
    placeholderData: keepPreviousData,
  });

  const results = useMemo<Result[]>(() => {
    const needle = q.trim().toLowerCase();
    const pages: Result[] = PAGES.filter((p) => !needle || `${p.label} ${p.keywords}`.toLowerCase().includes(needle))
      .slice(0, needle ? 4 : 12)
      .map((p) => ({ kind: "page", id: p.to, label: p.label, to: p.to }));
    if (!needle) return pages;
    const projs: Result[] = (projects.data?.items ?? [])
      .filter((p) => `${p.name} ${p.category ?? ""} ${p.register_id ?? ""}`.toLowerCase().includes(needle))
      .slice(0, 6)
      .map((p) => ({ kind: "project", id: p.id, label: p.name, to: `/projects/${p.id}`, meta: p.category ?? p.lifecycle }));
    const tks: Result[] =
      debounced.length >= 2
        ? (tasks.data?.items ?? []).map((t) => ({ kind: "task", id: t.id, label: t.title, meta: t.project_name ?? "" }))
        : [];
    return [...projs, ...tks, ...pages];
  }, [q, debounced, projects.data, tasks.data]);

  const choose = (r: Result | undefined) => {
    if (!r) return;
    if (r.kind === "task") {
      setTaskId(r.id);
    } else {
      navigate(r.to);
    }
    onClose();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(results.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(results[active]);
    }
  };
  const groupLabel = { page: "Go to", project: "Projects", task: "Tasks" } as const;

  return (
    <>
      <Modal open={open} onClose={onClose} title="Search ProjectOS">
        <label htmlFor="palette-input" className="sr-only">
          Search projects, tasks and pages
        </label>
        <input
          id="palette-input"
          ref={input}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setActive(0);
          }}
          onKeyDown={onKey}
          role="combobox"
          aria-expanded="true"
          aria-controls="palette-results"
          aria-activedescendant={results[active] ? `pr-${active}` : undefined}
          placeholder="Project, task or page…"
          className="w-full rounded-md border border-line bg-surface px-3 py-2.5 text-base focus:border-accent focus:outline-none"
          autoComplete="off"
        />
        <ul id="palette-results" role="listbox" aria-label="Results" className="mt-3 max-h-80 space-y-0.5 overflow-y-auto">
          {results.length === 0 && <li className="px-3 py-6 text-center text-sm text-muted">No matches. Try another word.</li>}
          {results.map((r, i) => (
            <li
              key={`${r.kind}-${r.id}`}
              id={`pr-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(r)}
              className={cx("flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm", i === active ? "bg-accent-soft text-ink" : "text-ink")}
            >
              <span className="w-16 shrink-0 text-xs text-muted">{groupLabel[r.kind]}</span>
              <span className="min-w-0 flex-1 truncate">{r.label}</span>
              {"meta" in r && r.meta && <span className="max-w-40 shrink-0 truncate text-xs text-muted">{r.meta}</span>}
            </li>
          ))}
        </ul>
        <p className="mt-3 flex gap-3 text-xs text-muted">
          <span>
            <kbd className="rounded border border-line px-1">↑</kbd> <kbd className="rounded border border-line px-1">↓</kbd> move
          </span>
          <span>
            <kbd className="rounded border border-line px-1">Enter</kbd> open
          </span>
          <span>
            <kbd className="rounded border border-line px-1">Esc</kbd> close
          </span>
        </p>
      </Modal>
      <TaskModal taskId={taskId} open={Boolean(taskId)} onClose={() => setTaskId(null)} />
    </>
  );
}
