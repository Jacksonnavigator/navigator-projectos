import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../lib/api";
import { EmptyState, ErrorState, Field, Input } from "./ui";

describe("ErrorState", () => {
  it("shows a retry button and the request reference", async () => {
    const retry = vi.fn();
    render(<ErrorState error={new ApiError(500, "internal_error", "Something went wrong on the server.", null, "req-1")} onRetry={retry} />);
    expect(screen.getByRole("alert")).toHaveTextContent("This couldn't be loaded.");
    expect(screen.getByText("Reference: req-1")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it("shows a permission-denied state without a retry button", () => {
    render(<ErrorState error={new ApiError(403, "forbidden", "Not allowed")} onRetry={() => {}} />);
    expect(screen.getByRole("alert")).toHaveTextContent("You don't have access to this.");
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });
});

describe("Field", () => {
  it("connects the label and error message to the input", () => {
    render(<Field label="Title" error="Give the task a title.">{(p) => <Input {...p} />}</Field>);
    const input = screen.getByLabelText("Title");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription("Give the task a title.");
  });
});

describe("EmptyState", () => {
  it("renders the call to action", () => {
    render(<EmptyState title="No projects yet" action={<button>Import register</button>} />);
    expect(screen.getByText("No projects yet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import register" })).toBeInTheDocument();
  });
});
