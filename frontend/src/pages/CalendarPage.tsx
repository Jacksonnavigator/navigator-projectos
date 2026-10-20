import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import TaskModal from "../components/TaskModal";
import { Button, ErrorState, LoadingBlock, PageHeader, cx } from "../components/ui";
import { get } from "../lib/api";
import { addDays, DATE_SOURCE_LABEL, todayIso } from "../lib/format";
import type { CalendarItem } from "../lib/types";

const KIND_STYLE: Record<CalendarItem["kind"], string> = {
  task_due: "bg-sunken text-ink",
  milestone: "bg-accent-soft text-accent",
  release: "bg-info-soft text-info",
  project_target: "bg-bad-soft text-bad",
};

function monthStart(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}

export default function CalendarPage() {
  const [month, setMonth] = useState(() => monthStart(todayIso()));
  const [openTask, setOpenTask] = useState<string | null>(null);
  const first = new Date(`${month}T00:00:00Z`);
  const offset = (first.getUTCDay() + 6) % 7; // weeks start on Monday
  const gridStart = addDays(month, -offset);
  const gridEnd = addDays(gridStart, 41);
  const items = useQuery({
    queryKey: ["calendar", gridStart, gridEnd],
    queryFn: () => get<CalendarItem[]>("/calendar", { start: gridStart, end: gridEnd }),
    placeholderData: keepPreviousData,
  });
  const today = todayIso();
  const shiftMonth = (n: number) => {
    const d = new Date(`${month}T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + n);
    setMonth(d.toISOString().slice(0, 10));
  };
  const title = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric", timeZone: "UTC" }).format(first);
  const byDate = new Map<string, CalendarItem[]>();
  for (const item of items.data ?? []) byDate.set(item.date, [...(byDate.get(item.date) ?? []), item]);

  return (
    <>
      <PageHeader
        title="Calendar"
        description="Task due dates, milestones, releases and project target dates."
        actions={
          <div className="flex items-center gap-1">
            <Button onClick={() => shiftMonth(-1)} aria-label="Previous month">
              ←
            </Button>
            <Button onClick={() => setMonth(monthStart(todayIso()))}>Today</Button>
            <Button onClick={() => shiftMonth(1)} aria-label="Next month">
              →
            </Button>
          </div>
        }
      />
      <h2 className="mb-3 text-lg font-semibold">{title}</h2>
      {items.isPending ? (
        <LoadingBlock rows={6} />
      ) : items.error ? (
        <ErrorState error={items.error} onRetry={() => void items.refetch()} />
      ) : (
        <div className="overflow-x-auto">
          <div className="grid min-w-[720px] grid-cols-7 overflow-hidden rounded-lg border border-line bg-line" style={{ gap: 1 }}>
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
              <div key={d} className="bg-surface px-2 py-1 text-xs font-medium text-muted">
                {d}
              </div>
            ))}
            {Array.from({ length: 42 }, (_, i) => {
              const iso = addDays(gridStart, i);
              const inMonth = iso.slice(0, 7) === month.slice(0, 7);
              const dayItems = byDate.get(iso) ?? [];
              return (
                <div key={iso} className={cx("min-h-28 bg-surface p-1.5", !inMonth && "bg-sunken/60")}>
                  <p className={cx("mb-1 text-xs", iso === today ? "inline-grid size-6 place-items-center rounded-full bg-accent font-semibold text-accent-ink" : inMonth ? "text-ink" : "text-faint")}>
                    {Number(iso.slice(8))}
                  </p>
                  <ul className="space-y-1">
                    {dayItems.slice(0, 4).map((item) => (
                      <li key={`${item.kind}-${item.id}`}>
                        {item.kind === "task_due" ? (
                          <button
                            type="button"
                            onClick={() => setOpenTask(item.id)}
                            title={`${item.title} · ${item.project_name ?? ""} · date from ${DATE_SOURCE_LABEL[item.date_source ?? ""] ?? item.date_source}`}
                            className={cx("block w-full truncate rounded px-1 text-left text-xs", KIND_STYLE[item.kind], item.overdue && "ring-1 ring-bad", item.status === "done" && "line-through opacity-60")}
                          >
                            {item.title}
                          </button>
                        ) : item.url ? (
                          <a href={item.url} target="_blank" rel="noopener noreferrer" className={cx("block truncate rounded px-1 text-xs", KIND_STYLE[item.kind])} title={item.title}>
                            {item.kind === "release" ? "⚑ " : "◆ "}
                            {item.title}
                          </a>
                        ) : (
                          <Link to={`/projects/${item.project_id}${item.kind === "milestone" ? "?tab=milestones" : ""}`} className={cx("block truncate rounded px-1 text-xs", KIND_STYLE[item.kind])} title={item.title}>
                            {item.kind === "milestone" ? "◆ " : "⏷ "}
                            {item.title}
                          </Link>
                        )}
                      </li>
                    ))}
                    {dayItems.length > 4 && <li className="px-1 text-xs text-muted">+{dayItems.length - 4} more</li>}
                  </ul>
                </div>
              );
            })}
          </div>
        </div>
      )}
      <TaskModal taskId={openTask} open={Boolean(openTask)} onClose={() => setOpenTask(null)} />
    </>
  );
}
