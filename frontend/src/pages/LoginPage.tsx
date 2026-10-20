import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { Button, InlineError, Spinner } from "../components/ui";
import { get, post } from "../lib/api";

const ERRORS: Record<string, string> = {
  not_allowed: "That GitHub account is not allowed to use this app.",
  invalid_state: "The sign-in link expired or was tampered with. Try again.",
  github_denied: "GitHub sign-in was cancelled.",
  github_error: "GitHub could not complete the sign-in. Try again in a moment.",
  github_not_configured: "GitHub sign-in is not configured on the server yet (GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET).",
};

export default function LoginPage() {
  const [params] = useSearchParams();
  const qc = useQueryClient();
  const config = useQuery({
    queryKey: ["auth-config"],
    queryFn: () => get<{ github_configured: boolean; dev_login_enabled: boolean }>("/auth/config"),
  });
  const devLogin = useMutation({
    mutationFn: () => post("/auth/dev-login"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["me"] }),
  });
  const error = params.get("error");
  const githubId = params.get("github_id");

  return (
    <div className="grid min-h-full place-items-center px-4 py-12">
      <div className="w-full max-w-sm rounded-xl border border-line bg-surface p-8">
        <div className="mb-6 flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-lg bg-accent text-accent-ink" aria-hidden="true">
            <svg viewBox="0 0 32 32" className="size-5"><path d="M16 4l8 23-8-6-8 6z" fill="currentColor" /></svg>
          </span>
          <div>
            <h1 className="text-lg font-semibold">Navigator ProjectOS</h1>
            <p className="text-sm text-muted">Your project command center</p>
          </div>
        </div>
        {error && (
          <div role="alert" className="mb-4 rounded-md bg-bad-soft px-3 py-2 text-sm text-bad">
            <p>{ERRORS[error] ?? "Sign-in failed."}</p>
            {error === "not_allowed" && githubId && (
              <p className="mt-1 text-ink">
                If this is your account, add <code className="font-mono">{githubId}</code> to{" "}
                <code className="font-mono">ALLOWED_GITHUB_USER_IDS</code> on the server.
              </p>
            )}
          </div>
        )}
        {config.isPending ? (
          <Spinner label="Checking server…" />
        ) : (
          <div className="space-y-3">
            <a
              href="/api/v1/auth/github/login"
              className="flex h-10 w-full items-center justify-center gap-2 rounded-md bg-ink text-sm font-medium text-canvas hover:opacity-90"
            >
              Sign in with GitHub
            </a>
            {config.data?.dev_login_enabled && (
              <Button className="w-full" onClick={() => devLogin.mutate()} busy={devLogin.isPending}>
                Development sign-in
              </Button>
            )}
            <InlineError error={devLogin.error ?? config.error} />
          </div>
        )}
        <p className="mt-6 text-xs text-muted">
          Only the owner&apos;s GitHub account can sign in. Access to GitHub is read-only.
        </p>
      </div>
    </div>
  );
}
