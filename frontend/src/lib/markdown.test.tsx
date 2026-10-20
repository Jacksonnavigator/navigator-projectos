import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Markdown } from "./markdown";

describe("Markdown", () => {
  it("renders basic formatting", () => {
    render(<Markdown source={"# Title\n\nSome **bold** and `code`.\n\n- one\n- two"} />);
    expect(screen.getByRole("heading", { name: "Title" })).toBeInTheDocument();
    expect(screen.getByText("bold").tagName).toBe("STRONG");
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("never renders raw HTML", () => {
    const { container } = render(<Markdown source={'<img src=x onerror="alert(1)"><script>alert(1)</script>'} />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
    expect(container.textContent).toContain("<script>");
  });

  it("only links to http(s) URLs", () => {
    render(<Markdown source={"[safe](https://example.org) and [evil](javascript:alert(1))"} />);
    expect(screen.getByRole("link", { name: "safe" })).toHaveAttribute("href", "https://example.org");
    expect(screen.getByRole("link", { name: "safe" })).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.queryByRole("link", { name: "evil" })).toBeNull();
    expect(screen.getByText(/evil/)).toBeInTheDocument();
  });
});
