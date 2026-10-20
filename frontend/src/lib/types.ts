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
