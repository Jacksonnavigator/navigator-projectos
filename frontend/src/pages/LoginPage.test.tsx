import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import LoginPage from "./LoginPage";

function renderAt(url: string) {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify({ github_configured: true, dev_login_enabled: false }), { status: 200 }),
  );
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[url]}>
        <LoginPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => vi.restoreAllMocks());

describe("LoginPage", () => {
  it("explains how to allow a rejected GitHub account", async () => {
    renderAt("/login?error=not_allowed&github_id=12345&login=someone");
    expect(await screen.findByRole("link", { name: "Sign in with GitHub" })).toHaveAttribute("href", "/api/v1/auth/github/login");
    expect(screen.getByRole("alert")).toHaveTextContent("That GitHub account is not allowed");
    expect(screen.getByRole("alert")).toHaveTextContent("12345");
    expect(screen.queryByRole("button", { name: "Sign in for development" })).toBeNull();
  });
});
