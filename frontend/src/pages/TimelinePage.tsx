import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ProjectSelect } from "../components/domain";
import TaskModal from "../components/TaskModal";
import { Button, EmptyState, ErrorState, LoadingBlock, PageHeader, Select, Toolbar, cx } from "../components/ui";
import { get } from "../lib/api";
import { addDays, DATE_SOURCE_LABEL, daysBetween, formatDate, STATUS_LABEL, todayIso } from "../lib/format";
import type { TaskStatus, TimelineData, TimelineItem } from "../lib/types";

type Zoom = "week" | "month" | "quarter";
const ZOOMS: Record<Zoom, { days: number; px: number; label: string; lead: number }> = {
  week: { days: 42, px: 30, label: "Weeks", lead: 7 },
  month: { days: 120, px: 11, label: "Months", lead: 14 },
  quarter: { days: 365, px: 4, label: "Year", lead: 30 },
};
const ROW = 34;
const LABEL_W = 240;

const BAR_COLOR: Record<TaskStatus, string> = {
  backlog: "bg-faint/50 text-white",
  todo: "bg-muted/70 text-white dark:text-canvas",
  in_progress: "bg-accent text-accent-ink",
  blocked: "bg-bad text-white dark:text-canvas",
  in_review: "bg-info text-white dark:text-canvas",
  done: "bg-ok/70 text-white dark:text-canvas",
};

type Row =
  | { kind: "project"; id: string; name: string; target: string | null }
  | { kind: "task"; item: TimelineItem };

export default function TimelinePage() {
  const [zoom, setZoom] = useState<Zoom>("month");
  const [start, setStart] = useState(() => addDays(todayIso(), -ZOOMS.month.lead));
  const [projectId, setProjectId] = useState<string | null>(null);
  const [priority, setPriority] = useState("");
  const [includeDone, setIncludeDone] = useState(true);
  const [openTask, setOpenTask] = useState<string | null>(null);
  const cfg = ZOOMS[zoom];
  const end = addDays(start, cfg.days - 1);

  const data = useQuery({
    queryKey: ["timeline", start, end, projectId, priority, includeDone],
    queryFn: () => {
      const params = new URLSearchParams({ start, end, include_done: String(includeDone) });
      if (projectId) params.append("project_id", projectId);
      if (priority) params.set("priority", priority);
      return get<TimelineData>(`/timeline?${params.toString()}`);
    },
    placeholderData: keepPreviousData,
  });

  const changeZoom = (z: Zoom) => {
    setZoom(z);
    setStart(addDays(todayIso(), -ZOOMS[z].lead));
  };
  const shift = (dir: -1 | 1) => setStart(addDays(start, dir * Math.round(cfg.days / 2)));

  return (
    <>
      <PageHeader
        title="Timeline"
        description="Bars use your local dates first, then GitHub Projects date fields, then GitHub dates. Hover a bar to see where each date came from."
      />
      <Toolbar>
        <div role="group" aria-label="Zoom" className="flex rounded-md border border-line">
          {(Object.keys(ZOOMS) as Zoom[]).map((z) => (
            <button
              key={z}
              type="button"
              aria-pressed={zoom === z}
              onClick={() => changeZoom(z)}
              className={cx("h-10 px-3 text-sm first:rounded-l-md last:rounded-r-md", zoom === z ? "bg-accent text-accent-ink" : "hover:bg-sunken")}
            >
              {ZOOMS[z].label}
            </button>
          ))}
        </div>
        <div className="flex gap-1">
          <Button onClick={() => shift(-1)} aria-label="Earlier">
            ←
          </Button>
          <Button onClick={() => setStart(addDays(todayIso(), -cfg.lead))}>Today</Button>
          <Button onClick={() => shift(1)} aria-label="Later">
            →
          </Button>
        </div>
        <div className="w-56">
          <label htmlFor="tl-project" className="sr-only">
            Project
          </label>
          <ProjectSelect id="tl-project" value={projectId} onChange={setProjectId} allowEmpty emptyLabel="All projects" />
        </div>
        <div>
          <label htmlFor="tl-priority" className="sr-only">
            Priority
          </label>
          <Select id="tl-priority" value={priority} onChange={(e) => setPriority(e.target.value)}>
            <option value="">Any priority</option>
            {["P1", "P2", "P3", "P4"].map((p) => (
              <option key={p}>{p}</option>
            ))}
          </Select>
        </div>
        <label className="flex h-10 items-center gap-2 text-sm">
          <input type="checkbox" className="size-4" checked={includeDone} onChange={(e) => setIncludeDone(e.target.checked)} />
          Show done
        </label>
        <span className="ml-auto text-sm text-muted">
          {formatDate(start)} – {formatDate(end)}
        </span>
      </Toolbar>
      {data.isPending ? (
        <LoadingBlock rows={8} />
      ) : data.error ? (
        <ErrorState error={data.error} onRetry={() => void data.refetch()} />
      ) : (
        <Gantt data={data.data} start={start} days={cfg.days} px={cfg.px} zoom={zoom} onOpen={setOpenTask} />
      )}
      <Legend />
      <TaskModal taskId={openTask} open={Boolean(openTask)} onClose={() => setOpenTask(null)} />
    </>
  );
}

function Gantt({ data, start, days, px, zoom, onOpen }: { data: TimelineData; start: string; days: number; px: number; zoom: Zoom; onOpen: (id: string) => void }) {
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    for (const p of data.projects) {
      out.push({ kind: "project", id: p.id, name: p.name, target: p.target_date });
      const items = data.items.filter((i) => i.project_id === p.id).sort((a, b) => a.start.localeCompare(b.start));
      for (const item of items) out.push({ kind: "task", item });
    }
    return out;
  }, [data]);

  if (rows.length === 0) {
    return (
      <EmptyState
        title="Nothing on the timeline in this period"
        description="Add start or due dates to tasks, set milestone dates, or sync a GitHub repository. Try a wider zoom or move the window."
      />
    );
  }

  const width = days * px;
  const x = (iso: string) => Math.max(0, Math.min(width, daysBetween(start, iso) * px));
  const rowIndex = new Map<string, number>();
  rows.forEach((r, i) => r.kind === "task" && rowIndex.set(r.item.id, i));
  const projectRow = new Map<string, number>();
  rows.forEach((r, i) => r.kind === "project" && projectRow.set(r.id, i));
  const ticks = buildTicks(start, days, zoom);
  const todayX = x(data.today);
  const height = rows.length * ROW;
  const itemById = new Map(data.items.map((i) => [i.id, i]));

  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-surface">
      <div style={{ width: LABEL_W + width }} className="relative">
        {/* header */}
        <div className="sticky top-0 z-20 flex border-b border-line bg-surface text-xs text-muted" style={{ height: 32 }}>
          <div className="sticky left-0 z-10 shrink-0 border-r border-line bg-surface px-3 py-2 font-medium" style={{ width: LABEL_W }}>
            Project / task
          </div>
          <div className="relative" style={{ width }}>
            {ticks.map((t) => (
              <div key={t.date} className="absolute top-0 h-full border-l border-line pl-1 pt-2 whitespace-nowrap" style={{ left: x(t.date) }}>
                {t.label}
              </div>
            ))}
          </div>
        </div>
        {/* body */}
        <div className="relative" style={{ height }}>
          {/* grid + today */}
          <div className="pointer-events-none absolute top-0 bottom-0" style={{ left: LABEL_W, width }}>
            {ticks.map((t) => (
              <div key={t.date} className="absolute top-0 bottom-0 border-l border-line/60" style={{ left: x(t.date) }} />
            ))}
            {data.today >= start && daysBetween(start, data.today) < days && (
              <div className="absolute top-0 bottom-0 w-0.5 bg-accent" style={{ left: todayX }} title="Today" />
            )}
          </div>
          {/* dependency arrows */}
          <svg className="pointer-events-none absolute top-0 z-10" style={{ left: LABEL_W, width, height }} aria-hidden="true">
            <defs>
              <marker id="arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                <path d="M0,0 L6,3 L0,6 z" fill="var(--color-muted)" />
              </marker>
            </defs>
            {data.dependencies.map((d) => {
              const from = itemById.get(d.from);
              const to = itemById.get(d.to);
              const r1 = rowIndex.get(d.from);
              const r2 = rowIndex.get(d.to);
              if (!from || !to || r1 === undefined || r2 === undefined) return null;
              const x1 = from.end ? x(addDays(from.end, 1)) : x(from.start) + 12;
              const y1 = r1 * ROW + ROW / 2;
              const x2 = x(to.start);
              const y2 = r2 * ROW + ROW / 2;
              const mid = Math.max(x1 + 8, Math.min(x2 - 8, (x1 + x2) / 2));
              return <path key={`${d.from}-${d.to}`} d={`M${x1},${y1} H${mid} V${y2} H${x2}`} fill="none" stroke="var(--color-muted)" strokeWidth="1.2" markerEnd="url(#arrow)" />;
            })}
          </svg>
          {rows.map((row, i) =>
            row.kind === "project" ? (
              <div key={row.id} className="absolute flex w-full border-b border-line bg-sunken/60" style={{ top: i * ROW, height: ROW }}>
                <div className="sticky left-0 z-10 flex shrink-0 items-center border-r border-line bg-sunken px-3" style={{ width: LABEL_W }}>
                  <Link to={`/projects/${row.id}`} className="truncate text-sm font-semibold hover:underline">
                    {row.name}
                  </Link>
                </div>
                <div className="relative" style={{ width }}>
                  {row.target && row.target >= start && daysBetween(start, row.target) < days && (
                    <div className="absolute top-1 bottom-1 border-l-2 border-dashed border-bad" style={{ left: x(row.target) }} title={`Project target date ${formatDate(row.target)}`} />
                  )}
                  {data.milestones
                    .filter((m) => m.project_id === row.id)
                    .map((m) => (
                      <a
                        key={m.id}
                        href={m.url ?? `/projects/${row.id}?tab=milestones`}
                        target={m.url ? "_blank" : undefined}
                        rel="noopener noreferrer"
                        className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2"
                        style={{ left: x(m.date) }}
                        title={`Milestone: ${m.title} — ${formatDate(m.date)} (${DATE_SOURCE_LABEL[m.date_source] ?? m.date_source})${m.status === "done" ? " · done" : ""}`}
                      >
                        <span className={cx("block size-3 rotate-45 border-2", m.status === "done" ? "border-ok bg-ok" : m.overdue ? "border-bad bg-bad-soft" : "border-accent bg-accent-soft")} />
                        <span className="sr-only">Milestone {m.title}</span>
                      </a>
                    ))}
                  {data.releases
                    .filter((r) => r.project_id === row.id)
                    .map((r) => (
                      <a key={r.id} href={r.url} target="_blank" rel="noopener noreferrer" className="absolute top-0 text-xs" style={{ left: x(r.date) }} title={`Release ${r.title} — ${formatDate(r.date)}`}>
                        <span aria-hidden="true">⚑</span>
                        <span className="sr-only">Release {r.title}</span>
                      </a>
                    ))}
                </div>
              </div>
            ) : (
              <TaskRow key={row.item.id} item={row.item} top={i * ROW} width={width} x={x} start={start} days={days} onOpen={onOpen} />
            ),
          )}
        </div>
      </div>
    </div>
  );
}

function TaskRow({ item, top, width, x, start, days, onOpen }: {
  item: TimelineItem;
  top: number;
  width: number;
  x: (iso: string) => number;
  start: string;
  days: number;
  onOpen: (id: string) => void;
}) {
  const windowEnd = addDays(start, days);
  const left = x(item.start);
  const right = item.end ? x(addDays(item.end, 1)) : x(windowEnd);
  const barWidth = Math.max(6, right - left);
  const clippedLeft = item.start < start;
  const clippedRight = item.end ? item.end >= windowEnd : true;
  const tooltip = [
    item.title,
    `Status: ${STATUS_LABEL[item.status]}`,
    `Start ${formatDate(item.start)} — from ${DATE_SOURCE_LABEL[item.start_source] ?? item.start_source}`,
    item.end ? `End ${formatDate(item.end)} — from ${DATE_SOURCE_LABEL[item.end_source ?? ""] ?? item.end_source}` : "No end date (open-ended)",
    item.overdue ? "OVERDUE" : "",
  ]
    .filter(Boolean)
    .join("\n");
  return (
    <div className="absolute flex w-full border-b border-line/60" style={{ top, height: ROW }}>
      <div className="sticky left-0 z-10 flex shrink-0 items-center gap-2 border-r border-line bg-surface px-3 pl-6" style={{ width: LABEL_W }}>
        <button type="button" onClick={() => onOpen(item.id)} className={cx("truncate text-left text-sm hover:underline", item.status === "done" && "text-muted line-through")} title={item.title}>
          {item.gh_number ? <span className="text-faint">#{item.gh_number} </span> : null}
          {item.title}
        </button>
      </div>
      <div className="relative" style={{ width }}>
        <button
          type="button"
          onClick={() => onOpen(item.id)}
          title={tooltip}
          aria-label={tooltip.replace(/\n/g, ". ")}
          className={cx(
            "absolute top-1/2 h-5 -translate-y-1/2 overflow-hidden rounded px-1.5 text-left text-[11px] font-medium leading-5",
            BAR_COLOR[item.status],
            item.overdue && "ring-2 ring-bad",
            !item.end && "border-r-2 border-dashed border-white/70 [mask-image:linear-gradient(to_right,black_70%,transparent)]",
            clippedLeft && "rounded-l-none",
            clippedRight && item.end && "rounded-r-none",
          )}
          style={{ left, width: barWidth }}
        >
          <span className="truncate">{barWidth > 60 ? item.title : ""}</span>
        </button>
      </div>
    </div>
  );
}

function buildTicks(start: string, days: number, zoom: Zoom): { date: string; label: string }[] {
  const ticks: { date: string; label: string }[] = [];
  // Label the partial period at the left edge too, so the first column is never unnamed.
  const first = new Date(`${start}T00:00:00Z`);
  if (zoom !== "week" && first.getUTCDate() > 1 && first.getUTCDate() < 20) {
    ticks.push({ date: start, label: new Intl.DateTimeFormat(undefined, { month: "short", timeZone: "UTC" }).format(first) });
  }
  for (let i = 0; i < days; i += 1) {
    const iso = addDays(start, i);
    const d = new Date(`${iso}T00:00:00Z`);
    if (zoom === "week" && d.getUTCDay() === 1) {
      ticks.push({ date: iso, label: new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", timeZone: "UTC" }).format(d) });
    } else if (zoom !== "week" && d.getUTCDate() === 1) {
      ticks.push({
        date: iso,
        label: new Intl.DateTimeFormat(undefined, { month: "short", year: zoom === "quarter" || d.getUTCMonth() === 0 ? "2-digit" : undefined, timeZone: "UTC" }).format(d),
      });
    }
  }
  return ticks;
}

function Legend() {
  return (
    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted">
      {(Object.keys(BAR_COLOR) as TaskStatus[]).map((s) => (
        <span key={s} className="flex items-center gap-1">
          <span className={cx("inline-block h-3 w-5 rounded", BAR_COLOR[s])} /> {STATUS_LABEL[s]}
        </span>
      ))}
      <span className="flex items-center gap-1">
        <span className="inline-block size-2.5 rotate-45 border-2 border-accent bg-accent-soft" /> Milestone
      </span>
      <span>⚑ Release</span>
      <span className="flex items-center gap-1">
        <span className="inline-block h-3 border-l-2 border-dashed border-bad" /> Project target
      </span>
      <span className="flex items-center gap-1">
        <span className="inline-block h-3 w-0.5 bg-accent" /> Today
      </span>
      <span>Fading bar = no end date</span>
    </div>
  );
}
