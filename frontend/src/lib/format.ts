import type { Lifecycle, TaskPriority, TaskStatus } from "./types";

export const LIFECYCLES: Lifecycle[] = ["idea", "planning", "active", "testing", "deployed", "paused", "archived"];
export const TASK_STATUSES: TaskStatus[] = ["backlog", "todo", "in_progress", "blocked", "in_review", "done"];
export const TASK_PRIORITIES: TaskPriority[] = ["low", "medium", "high", "urgent"];

export const STATUS_LABEL: Record<TaskStatus, string> = {
  backlog: "Backlog",
  todo: "To do",
  in_progress: "In progress",
  blocked: "Blocked",
  in_review: "In review",
  done: "Done",
};

export const LIFECYCLE_TONE: Record<Lifecycle, "neutral" | "accent" | "ok" | "warn" | "bad" | "info"> = {
  idea: "neutral",
  planning: "info",
  active: "accent",
  testing: "warn",
  deployed: "ok",
  paused: "neutral",
  archived: "neutral",
};

export const DATE_SOURCE_LABEL: Record<string, string> = {
  local: "set in ProjectOS",
  github_project: "GitHub Projects date field",
  github_created: "GitHub issue created date",
  github_created_clamped: "GitHub created date (moved to due date)",
  created: "date the task was created here",
  created_clamped: "created date (moved to due date)",
  milestone: "milestone due date",
  github_milestone: "GitHub milestone due date",
  github_release: "GitHub release date",
};

export function titleCase(value: string): string {
  return value.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

let userTimeZone: string | undefined;
export function setUserTimeZone(tz: string | undefined) {
  userTimeZone = tz;
}

/** Date-only values (YYYY-MM-DD) are shown as calendar dates without timezone shifting. */
export function formatDate(value: string | null | undefined, opts: Intl.DateTimeFormatOptions = {}): string {
  if (!value) return "—";
  const d = value.length === 10 ? new Date(`${value}T00:00:00Z`) : new Date(value);
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: value.length === 10 ? "UTC" : userTimeZone,
    ...opts,
  }).format(d);
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: userTimeZone,
  }).format(new Date(value));
}

export function relativeTime(value: string | null | undefined): string {
  if (!value) return "never";
  const diff = Date.now() - new Date(value).getTime();
  const minutes = Math.round(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}

export function formatMoney(amount: string | null, currency: string): string {
  if (amount === null) return "—";
  const n = Number(amount);
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 2 }).format(n);
  } catch {
    return `${n.toLocaleString()} ${currency}`;
  }
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return isoDate(d);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime()) / 86400000);
}

export function todayIso(): string {
  const now = new Date();
  return new Intl.DateTimeFormat("en-CA", { timeZone: userTimeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
