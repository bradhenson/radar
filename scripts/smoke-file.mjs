// Browser-level release smoke test for the self-contained file:// artifact.
// Uses the system Edge that RADAR targets operationally; Playwright is already
// a pinned development dependency, so no browser download or runtime service
// is required. Run `npm run build` first.

import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";

const artifact = resolve("dist/radar.html");
if (!existsSync(artifact)) {
  console.error("smoke-file: dist/radar.html not found. Run npm run build first.");
  process.exit(1);
}

const profileDir = mkdtempSync(join(tmpdir(), "radar-file-smoke-"));
let context;
try {
  // A fresh profile keeps this probe isolated from a developer's RADAR data
  // and proves first-run IndexedDB initialization as well as reload behavior.
  context = await chromium.launchPersistentContext(profileDir, { channel: "msedge", headless: true });
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);

  const errors = [];
  const requests = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => requests.push(request.url()));

  await page.goto(`${pathToFileURL(artifact).href}#/settings`);
  await page.getByRole("heading", { name: "Settings" }).waitFor();

  // A fresh database must start dark before any user preference is saved.
  if ((await page.locator("html").getAttribute("data-theme")) !== "dark") {
    throw new Error("Fresh browser database did not start in dark mode.");
  }
  if ((await page.locator("#set-theme").inputValue()) !== "dark") {
    throw new Error("Settings did not report Dark as the fresh default.");
  }

  // Seed through the real Settings workflow before exercising the board.
  await page.getByRole("button", { name: "Load sample data" }).click();
  await page.getByRole("dialog", { name: "Load sample data" }).getByRole("button", { name: "Load sample data" }).click();
  await page.getByRole("link", { name: /board/i }).first().click();
  await page.getByRole("heading", { name: "Kanban Board" }).waitFor();

  const navCount = await page.locator("nav a").count();
  if (navCount !== 14) throw new Error(`Expected 14 navigation destinations, found ${navCount}.`);

  const title = `File smoke task ${Date.now()}`;
  await page.getByRole("button", { name: /new task/i }).click();
  await page.locator("#td-title").fill(title);
  await page.getByRole("button", { name: "Create task" }).click();
  await page.getByText(title, { exact: true }).waitFor();

  // A reload must retain the same writer identity and persist the new task.
  await page.reload();
  await page.getByRole("heading", { name: "Kanban Board" }).waitFor();
  await page.getByText(title, { exact: true }).waitFor();

  // Performance inputs use the same full-page editing surface as tasks and
  // meeting notes. Exercise create, persistence, and edit on that real page.
  await page.getByRole("link", { name: "Performance", exact: true }).first().click();
  await page.getByRole("heading", { name: "Performance", exact: true }).waitFor();
  await page.getByRole("button", { name: "New Performance Input" }).click();
  await page.locator('.form-page[aria-label="Performance Input"]').waitFor();
  if (await page.getByRole("dialog", { name: "Performance Input" }).count()) {
    throw new Error("Performance input opened as a modal instead of a full page.");
  }

  const performanceAction = `Improved offline workflow ${Date.now()}`;
  await page.locator("#pi-emp").selectOption({ index: 1 });
  await page.locator("#pi-action").fill(performanceAction);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("heading", { name: "Performance", exact: true }).waitFor();
  await page.getByRole("searchbox", { name: "Search performance" }).fill(performanceAction);
  await page.getByText(performanceAction, { exact: true }).first().waitFor();
  await page.getByRole("button", { name: "Edit input" }).click();
  await page.locator('.form-page[aria-label="Edit Performance Input"]').waitFor();
  await page.getByRole("button", { name: "Close" }).click();

  // Compact data-entry forms have returned to the centered modal component;
  // Quick Add is a representative global entry point.
  await page.getByRole("link", { name: "Today", exact: true }).first().click();
  await page.getByRole("button", { name: "Quick Add", exact: true }).click();
  await page.getByRole("dialog", { name: "Quick add task" }).waitFor();
  if (await page.locator(".pane").count()) {
    throw new Error("A right-edge slide-over pane is still present.");
  }
  await page.getByRole("dialog", { name: "Quick add task" }).getByRole("button", { name: "Close" }).click();

  const nonFileRequests = requests.filter((url) => !url.startsWith("file:"));
  if (errors.length) throw new Error(`Console/page errors: ${errors.join(" | ")}`);
  if (nonFileRequests.length) throw new Error(`Unexpected non-file requests: ${nonFileRequests.join(", ")}`);

  console.log(`smoke-file: OK (${navCount} nav links, task and performance input flows passed, centered modal passed, no network requests).`);
} finally {
  await context?.close();
  rmSync(profileDir, { recursive: true, force: true });
}
