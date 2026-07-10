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

  await page.goto(pathToFileURL(artifact).href);
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

  const nonFileRequests = requests.filter((url) => !url.startsWith("file:"));
  if (errors.length) throw new Error(`Console/page errors: ${errors.join(" | ")}`);
  if (nonFileRequests.length) throw new Error(`Unexpected non-file requests: ${nonFileRequests.join(", ")}`);

  console.log(`smoke-file: OK (${navCount} nav links, task creation persisted across reload, no network requests).`);
} finally {
  await context?.close();
  rmSync(profileDir, { recursive: true, force: true });
}
