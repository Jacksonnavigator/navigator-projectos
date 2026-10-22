import { expect, type Page, test } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

async function signIn(page: Page) {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);
  await page.getByRole("button", { name: "Development sign-in" }).click();
  await expect(page.getByRole("heading", { name: /Good (morning|afternoon|evening)/ })).toBeVisible();
}

test.describe.configure({ mode: "serial" });

test("unauthenticated users only see the login page and get 401 from the API", async ({ page, request }) => {
  await page.goto("/projects");
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole("link", { name: "Sign in with GitHub" })).toBeVisible();
  const res = await request.get("/api/v1/projects");
  expect(res.status()).toBe(401);
});

test("import the register, then browse projects", async ({ page }) => {
  await signIn(page);
  await page.getByRole("link", { name: "Import register" }).first().click();
  await page.getByLabel("Register file").setInputFiles(path.join(here, "register-sample.xlsx"));
  await expect(page.getByText("7 new")).toBeVisible();
  await expect(page.getByText(/part of #3 Self-Hosted AI Infrastructure/)).toBeVisible();
  await page.getByRole("button", { name: /Import 7 projects/ }).click();
  await expect(page.getByText("Import complete")).toBeVisible();
  await expect(page.getByText(/7 created/)).toBeVisible();

  await page.getByRole("link", { name: "View projects" }).click();
  await expect(page.getByText("7 projects")).toBeVisible();
  await page.getByLabel("Search").fill("meza");
  await expect(page.getByRole("link", { name: /Meza Order/ })).toBeVisible();
  await page.getByRole("link", { name: /Meza Order/ }).click();
  await expect(page.getByRole("heading", { name: /Meza Order/ })).toBeVisible();
  await expect(page.getByText("Deployed; QA and security follow-up needed")).toBeVisible();
  await expect(page.getByRole("link", { name: "https://github.com/Jacksonnavigator/restaurant" })).toBeVisible();
});

test("task, milestone, dependency and timeline workflow", async ({ page }) => {
  await signIn(page);
  await page.goto("/projects");
  await page.getByRole("link", { name: /DevGuardian AI/ }).first().click();
  await page.getByRole("tab", { name: "Milestones" }).click();
  await page.getByRole("button", { name: "New milestone" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Title").fill("Reliability release");
  const due = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10);
  await dialog.getByLabel("Due date").fill(due);
  await dialog.getByRole("button", { name: "Create milestone" }).click();
  await expect(page.getByText("Reliability release")).toBeVisible();

  await page.getByRole("tab", { name: "Tasks" }).click();
  for (const title of ["Run validation suite", "Fix highest-severity failures"]) {
    await page.getByRole("button", { name: "New task" }).click();
    const d = page.getByRole("dialog");
    await d.getByLabel("Title").fill(title);
    await d.getByLabel("Milestone").selectOption({ index: 1 });
    await d.getByRole("button", { name: "Create task" }).click();
    await expect(page.getByRole("button", { name: new RegExp(title) })).toBeVisible();
  }
  // Second task depends on the first.
  await page.getByRole("button", { name: /Fix highest-severity failures/ }).click();
  const taskDialog = page.getByRole("dialog");
  await taskDialog.getByLabel("Add dependency").selectOption({ label: "Run validation suite" });
  await taskDialog.getByRole("button", { name: "Add", exact: true }).first().click();
  await expect(taskDialog.getByText("(1 not done)")).toBeVisible();
  await taskDialog.getByRole("button", { name: "Close" }).click();

  // Milestone can't be completed while tasks are open.
  await page.getByRole("tab", { name: "Milestones" }).click();
  await page.getByRole("button", { name: "Mark complete" }).click();
  await expect(page.getByText(/2 of 2 tasks in this milestone are not done yet/)).toBeVisible();

  // Timeline shows the bars (end date from the milestone) and the milestone diamond.
  await page.getByRole("link", { name: "Timeline", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Timeline" })).toBeVisible();
  const bar = page.getByRole("button", { name: /Run validation suite\. Status: To do\. Start .*End .* from milestone due date/ });
  await expect(bar).toBeVisible();
  await expect(page.getByText("Milestone Reliability release")).toBeAttached();

  // Board: move the first task to In progress with the keyboard-accessible menu.
  await page.getByRole("link", { name: "Board", exact: true }).click();
  await page.getByLabel("Move Run validation suite").selectOption("in_progress");
  await expect(page.getByRole("region", { name: "In progress" }).getByRole("button", { name: "Run validation suite", exact: true })).toBeVisible();

  await page.getByRole("link", { name: "Dashboard", exact: true }).click();
  await expect(page.getByText("In progress").first()).toBeVisible();
});

test("record evidence and upload a private document", async ({ page }) => {
  await signIn(page);
  await page.goto("/health");
  await page.getByRole("button", { name: "Record evidence" }).click();
  const d = page.getByRole("dialog");
  await d.getByLabel("Project").selectOption({ label: "Meza Order" });
  await d.getByLabel("What was checked").fill("Live QR ordering flow");
  await d.getByRole("button", { name: "Save record" }).click();
  await expect(page.getByRole("table").getByText("Live QR ordering flow")).toBeVisible(); // shown as the latest verified result
  await expect(page.getByRole("listitem").getByText("Live QR ordering flow")).toBeVisible();

  await page.goto("/documents");
  await page.getByLabel("Upload a file").setInputFiles({ name: "wiring.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n%e2e\n") });
  await expect(page.getByText("wiring.pdf").first()).toBeVisible();
  await page.getByRole("button", { name: /wiring\.pdf/ }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("dialog").getByRole("link", { name: "Download" }).click();
  expect((await download).suggestedFilename()).toBe("wiring.pdf");

  await page.getByRole("dialog").getByRole("button", { name: "Close" }).click();
  await page.getByLabel("Upload a file").setInputFiles({ name: "evil.html", mimeType: "text/html", buffer: Buffer.from("<script>alert(1)</script>") });
  await expect(page.getByText(/Unsupported file type/)).toBeVisible();
});
