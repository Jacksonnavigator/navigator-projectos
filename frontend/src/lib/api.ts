/** Typed fetch wrapper: same-origin cookies, CSRF header, consistent errors, and Render cold-start retries. */

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
    public requestId?: string,
  ) {
    super(message);
  }
}

type WakeListener = (waking: boolean) => void;
const wakeListeners = new Set<WakeListener>();
export function onWakeChange(listener: WakeListener): () => void {
  wakeListeners.add(listener);
  return () => wakeListeners.delete(listener);
}
function setWaking(waking: boolean) {
  wakeListeners.forEach((l) => l(waking));
}

function csrfToken(): string {
  const match = document.cookie.match(/(?:^|;\s*)nav_csrf=([^;]+)/);
  return match?.[1] ? decodeURIComponent(match[1]) : "";
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// A sleeping free Render service takes ~1 minute to start; retry gateway errors for up to ~90s.
const WAKE_STATUSES = new Set([502, 503, 504]);
const WAKE_DELAYS_MS = [2000, 3000, 5000, 8000, 10000, 15000, 15000, 15000, 15000];

export interface RequestOptions {
  method?: string;
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  signal?: AbortSignal;
}

export function buildUrl(path: string, query?: RequestOptions["query"]): string {
  const url = new URL(`/api/v1${path}`, window.location.origin);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  }
  return url.pathname + url.search;
}

export async function api<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const method = opts.method ?? "GET";
  const headers: Record<string, string> = { Accept: "application/json" };
  let body: BodyInit | undefined;
  if (opts.body instanceof FormData) {
    body = opts.body;
  } else if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.body);
  }
  if (method !== "GET") headers["X-CSRF-Token"] = csrfToken();

  const url = buildUrl(path, opts.query);
  let attempt = 0;
  for (;;) {
    let res: Response | undefined;
    try {
      res = await fetch(url, { method, headers, body, credentials: "same-origin", signal: opts.signal });
    } catch (err) {
      if ((err as Error).name === "AbortError") throw err;
    }
    // Only idempotent reads are retried automatically while the server wakes up.
    const retryable = method === "GET" && (!res || WAKE_STATUSES.has(res.status));
    if (retryable && attempt < WAKE_DELAYS_MS.length) {
      setWaking(true);
      await sleep(WAKE_DELAYS_MS[attempt]!);
      attempt += 1;
      continue;
    }
    setWaking(false);
    if (!res) throw new ApiError(0, "network_error", "Could not reach the server. Check your connection and retry.");
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    const data = text ? safeJson(text) : undefined;
    if (!res.ok) {
      const err = (data as { error?: { code?: string; message?: string; details?: unknown; request_id?: string } })
        ?.error;
      throw new ApiError(
        res.status,
        err?.code ?? "http_error",
        err?.message ?? `Request failed (${res.status})`,
        err?.details,
        err?.request_id,
      );
    }
    return data as T;
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export const get = <T>(path: string, query?: RequestOptions["query"]) => api<T>(path, { query });
export const post = <T>(path: string, body?: unknown) => api<T>(path, { method: "POST", body });
export const patch = <T>(path: string, body?: unknown) => api<T>(path, { method: "PATCH", body });
export const put = <T>(path: string, body?: unknown) => api<T>(path, { method: "PUT", body });
export const del = <T>(path: string) => api<T>(path, { method: "DELETE" });
