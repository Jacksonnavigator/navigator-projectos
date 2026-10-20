export interface User {
  id: string;
  github_id: number | null;
  login: string;
  name: string | null;
  avatar_url: string | null;
  timezone: string;
  last_login_at: string | null;
}

export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export type Lifecycle = "idea" | "planning" | "active" | "testing" | "deployed" | "paused" | "archived";
export type Priority = "P1" | "P2" | "P3" | "P4";
export type TaskStatus = "backlog" | "todo" | "in_progress" | "blocked" | "in_review" | "done";
export type TaskPriority = "low" | "medium" | "high" | "urgent";

export interface ProjectRef {
  id: string;
  name: string;
}

export interface Link {
  id: string;
  kind: string;
  url: string;
  label: string | null;
}

export interface ProjectSummary {
  id: string;
  register_id: number | null;
  name: string;
  category: string | null;
  project_type: string | null;
  lifecycle: Lifecycle;
  reported_status: string | null;
  status_confidence: string | null;
  priority: Priority | null;
  priority_rank: number | null;
  priority_label: string | null;
  next_action: string | null;
  start_date: string | null;
  target_date: string | null;
  parent_id: string | null;
  tags: string[];
  archived_at: string | null;
  updated_at: string;
  open_tasks: number;
  done_tasks: number;
  overdue_tasks: number;
  repo_count: number;
  last_verified_at: string | null;
}

export interface Project extends ProjectSummary {
  purpose: string | null;
  tech_stack: string | null;
  repository_text: string | null;
  remaining_work: string | null;
  business_potential: string | null;
  evidence_notes: string | null;
  priority_reason: string | null;
  created_at: string;
  links: Link[];
  parent: ProjectRef | null;
  children: ProjectRef[];
  related: ProjectRef[];
}

export interface Task {
  id: string;
  project_id: string | null;
  project_name: string | null;
  milestone_id: string | null;
  parent_task_id: string | null;
  title: string;
  description: string | null;
  acceptance_criteria: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  assignee: string | null;
  start_date: string | null;
  due_date: string | null;
  position: number;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  source: "local" | "github";
  gh_kind: "issue" | "pull_request" | "draft" | null;
  gh_number: number | null;
  gh_state: string | null;
  gh_url: string | null;
  gh_labels: string[];
  gh_assignees: string[];
  gh_created_at: string | null;
  gh_closed_at: string | null;
  gh_merged_at: string | null;
  gh_board_start: string | null;
  gh_board_end: string | null;
  gh_board_status: string | null;
  repo_full_name: string | null;
  depends_on: string[];
  blocked_by_open: number;
  subtask_count: number;
  subtasks_done: number;
  effective_due: string | null;
  effective_due_source: string | null;
  overdue: boolean;
}

export interface Milestone {
  id: string;
  project_id: string | null;
  project_name: string | null;
  title: string;
  description: string | null;
  completion_criteria: string | null;
  due_date: string | null;
  local_due_date: string | null;
  gh_due_on: string | null;
  effective_due: string | null;
  status: "open" | "done";
  completed_at: string | null;
  source: "local" | "github";
  gh_url: string | null;
  task_total: number;
  task_done: number;
}

export interface Comment {
  id: string;
  task_id: string;
  body: string;
  created_at: string;
}

export interface TimelineItem {
  id: string;
  type: "task";
  project_id: string;
  milestone_id: string | null;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  source: string;
  gh_kind: string | null;
  gh_number: number | null;
  url: string | null;
  overdue: boolean;
  start: string;
  start_source: string;
  end: string | null;
  end_source: string | null;
}

export interface TimelineProject {
  id: string;
  name: string;
  lifecycle: Lifecycle;
  priority: Priority | null;
  start_date: string | null;
  target_date: string | null;
  parent_id: string | null;
}

export interface TimelineData {
  window_start: string;
  window_end: string;
  today: string;
  projects: TimelineProject[];
  items: TimelineItem[];
  milestones: {
    id: string;
    project_id: string;
    title: string;
    date: string;
    date_source: string;
    status: string;
    url: string | null;
    overdue: boolean;
  }[];
  releases: { id: string; project_id: string; title: string; date: string; url: string }[];
  dependencies: { from: string; to: string }[];
}

export interface CalendarItem {
  date: string;
  kind: "task_due" | "milestone" | "release" | "project_target";
  title: string;
  id: string;
  project_id: string | null;
  project_name: string | null;
  status: string | null;
  date_source: string | null;
  url: string | null;
  overdue: boolean;
}

export interface HealthRow {
  id: string;
  name: string;
  lifecycle: Lifecycle;
  priority: Priority | null;
  reported_status: string | null;
  open_tasks: number;
  done_tasks: number;
  overdue_tasks: number;
  progress: number | null;
  last_verified_at: string | null;
  flags: string[];
  next_action: string | null;
}

export type NextAction =
  | { reason: string; task: Task }
  | { reason: string; project: ProjectRef; text: string };

export interface Dashboard {
  counts: {
    projects: number;
    sub_projects: number;
    by_lifecycle: Partial<Record<Lifecycle, number>>;
    open_tasks: number;
    in_progress: number;
    blocked: number;
    overdue: number;
  };
  overdue: Task[];
  due_soon: Task[];
  in_progress: Task[];
  upcoming: {
    kind: string;
    id: string;
    title: string;
    date: string;
    project_name: string;
    project_id: string;
    overdue: boolean;
  }[];
  health: HealthRow[];
  activity: {
    id: string;
    kind: string;
    message: string;
    url: string | null;
    occurred_at: string;
    project_id: string | null;
  }[];
  next_actions: NextAction[];
  sync: { repos_synced: number; boards_synced: number; last_synced_at: string | null; errors: number };
  generated_at: string;
}

export interface Repo {
  id: string;
  github_id: number;
  full_name: string;
  html_url: string;
  description: string | null;
  private: boolean;
  archived: boolean;
  pushed_at: string | null;
  project_id: string | null;
  project_name: string | null;
  sync_enabled: boolean;
  last_synced_at: string | null;
  last_sync_error: string | null;
}

export interface Board {
  id: string;
  number: number;
  title: string;
  url: string;
  owner_login: string;
  closed: boolean;
  project_id: string | null;
  project_name: string | null;
  sync_enabled: boolean;
  date_fields: string[];
  start_field: string | null;
  end_field: string | null;
  last_synced_at: string | null;
  last_sync_error: string | null;
}

export interface Job {
  id: string;
  kind: string;
  status: "queued" | "running" | "succeeded" | "failed";
  attempts: number;
  created_at: string;
  finished_at: string | null;
  last_error: string | null;
  result: Record<string, unknown> | null;
}

export interface GitHubStatus {
  connected: boolean;
  scopes: string | null;
  login: string;
  repos_total: number;
  repos_synced: number;
  boards_total: number;
  boards_synced: number;
  last_synced_at: string | null;
  last_job: Job | null;
  stale_minutes: number;
}

export interface Evidence {
  id: string;
  project_id: string | null;
  kind: string;
  title: string;
  result: "pass" | "fail" | "partial" | "info";
  origin: "automated" | "measured" | "reported";
  source: string;
  observed_at: string;
  measured_value: string | null;
  reference_value: string | null;
  unit: string | null;
  url: string | null;
  notes: string | null;
  document_id: string | null;
  created_at: string;
}

export interface HealthOverviewRow {
  project_id: string;
  name: string;
  lifecycle: Lifecycle;
  reported_status: string | null;
  status_confidence: string | null;
  evidence_notes: string | null;
  verified_count: number;
  reported_count: number;
  last_verified_at: string | null;
  last_result: string | null;
  last_title: string | null;
  stale: boolean;
}

export interface DocVersion {
  id: string;
  version_no: number;
  filename: string;
  content_type: string;
  size_bytes: number;
  sha256: string;
  uploaded_at: string;
}

export interface Doc {
  id: string;
  project_id: string | null;
  project_name: string | null;
  title: string;
  category: string;
  description: string | null;
  body_markdown: string | null;
  created_at: string;
  updated_at: string;
  versions: DocVersion[];
}

export interface BusinessEntry {
  id: string;
  project_id: string;
  project_name: string | null;
  kind: string;
  title: string;
  amount: string | null;
  currency: string;
  status: string;
  counterparty: string | null;
  entry_date: string | null;
  notes: string | null;
  created_at: string;
}

export interface BusinessSummaryRow {
  project_id: string;
  project_name: string | null;
  currency: string;
  kind: string;
  status: string;
  total: string;
  count: number;
}

export interface ImportRow {
  row_number: number;
  register_id: number | null;
  name: string | null;
  action: "create" | "update" | "unchanged" | "skip";
  lifecycle: Lifecycle | null;
  priority: Priority | null;
  priority_match: string | null;
  links: { kind: string; url: string }[];
  changes: { field: string; old: unknown; new: unknown }[];
  problems: string[];
}

export interface ImportSuggestion {
  kind: "parent" | "related";
  description: string;
  [key: string]: unknown;
}

export interface ImportPreview {
  sha256: string;
  summary: { create: number; update: number; unchanged: number; skip: number };
  rows: ImportRow[];
  priority_unmatched: { name: string; reason: string }[];
  suggestions: ImportSuggestion[];
  warnings: string[];
}
