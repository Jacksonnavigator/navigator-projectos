import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, api, buildUrl } from "./api";

afterEach(() => vi.restoreAllMocks());

describe("buildUrl", () => {
  it("prefixes the API version and drops empty query values", () => {
    expect(buildUrl("/projects", { q: "bird", status: "", limit: 20, x: undefined })).toBe(
      "/api/v1/projects?q=bird&limit=20",
    );
  });
});

describe("api", () => {
  it("sends the CSRF cookie as a header on writes", async () => {
    document.cookie = "nav_csrf=abc123";
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    await api("/things", { method: "POST", body: { a: 1 } });
    const init = fetchMock.mock.calls[0]![1]!;
    expect((init.headers as Record<string, string>)["X-CSRF-Token"]).toBe("abc123");
  });

  it("turns error bodies into ApiError", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: { code: "not_found", message: "Project not found", request_id: "r1" } }), {
        status: 404,
      }),
    );
    const err = await api("/projects/x").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe("not_found");
    expect((err as ApiError).requestId).toBe("r1");
  });
});
