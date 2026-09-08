// Exercise the redesigned daily workspace through the actual offline artifact.
// Optional RADAR_SCREENSHOTS directory captures the four pages in both themes.
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";

const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(15_000);
  const errors = [];
  const network = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("request", (r) => { if (!r.url().startsWith("file:")) network.push(r.url()); });
  await page.goto(`${pathToFileURL(resolve("dist/radar.html")).href}#/settings`);
  await page.getByRole("button", { name: "Load sample data", exact: true }).click();
  const seed = page.getByRole("dialog", { name: "Load sample data", exact: true });
  await seed.getByRole("button", { name: "Load sample data", exact: true }).click();
  await seed.waitFor({ state: "hidden" });

  async function go(name, heading = name) {
    await page.getByRole("link", { name, exact: true }).first().click();
    await page.getByRole("heading", { name: heading, exact: true }).waitFor();
  }
  async function settled() {
    await page.evaluate(() => new Promise((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(resolveFrame))));
  }

  await go("Tasks", "Kanban Board");
  await page.setViewportSize({ width: 1100, height: 900 });
  await page.locator(".column:last-child .card-open").first().click();
  await page.getByRole("heading", { name: "Task", exact: true }).waitFor();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("heading", { name: "Kanban Board", exact: true }).waitFor();
  await settled();
  assert.ok(await page.locator(".columns").evaluate((el) => el.scrollLeft > 0), "Opening a card must preserve horizontal board position");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: "Compact cards", exact: true }).click();
  assert.equal(await page.locator(".card-preview, .card-checklist").count(), 0);
  await page.getByRole("searchbox", { name: "Search tasks" }).fill("telework");
  await page.locator(".card-open").first().click();
  await page.getByRole("heading", { name: "Task", exact: true }).waitFor();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("heading", { name: "Kanban Board", exact: true }).waitFor();
  assert.equal(await page.getByRole("searchbox", { name: "Search tasks" }).inputValue(), "telework");
  assert.equal(await page.getByRole("button", { name: "✓ Compact cards", exact: true }).getAttribute("aria-pressed"), "true");
  await page.getByRole("group", { name: "Task view" }).getByRole("button", { name: "List", exact: true }).click();
  await page.getByRole("heading", { name: "Task List", exact: true }).waitFor();
  await go("Travel");
  await go("Tasks", "Task List");
  assert.equal(await page.getByRole("searchbox", { name: "Search tasks" }).inputValue(), "telework");
  await page.getByRole("button", { name: "Clear filters", exact: true }).click();
  await page.getByRole("group", { name: "Task view" }).getByRole("button", { name: "Board", exact: true }).click();
  await page.getByRole("button", { name: "✓ Compact cards", exact: true }).click();

  for (const [name, heading, action] of [
    ["Telework", "Telework", "+ Add Request"],
    ["Travel", "Travel", "+ Add Travel"],
    ["Leave", "Leave and Availability", "+ Add Leave"]
  ]) {
    await go(name, heading);
    const records = page.locator(`tr[id^="${name.toLowerCase()}-row-"]`);
    const before = await records.count();
    assert.ok(before > 0, `${name} sample records should be visible`);
    const search = page.getByRole("searchbox", { name: `Search ${name.toLowerCase()}` });
    await search.fill("no-such-record-workspace-test");
    await settled();
    assert.equal(await records.count(), 0, `${name} search should narrow the list`);
    await page.getByRole("button", { name: "Clear filters", exact: true }).click();
    await records.first().waitFor();
    assert.equal(await records.count(), before);
    const views = page.getByRole("group", { name: `${name} view`, exact: true });
    await views.getByRole("button", { name: "Calendar", exact: true }).click();
    await page.getByRole("region", { name: name === "Telework" ? "Situational telework calendar" : `${name} calendar`, exact: true }).waitFor();
    assert.equal(await views.getByRole("button", { name: "Calendar", exact: true }).getAttribute("aria-pressed"), "true");
    await views.getByRole("button", { name: "List", exact: true }).click();
    await page.getByRole("button", { name: action, exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.waitFor();
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden" });
  }

  // A desktop and a narrow layout must contain overflow in the board/tables.
  for (const width of [1280, 700, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const [name, title] of [["Tasks", "Kanban Board"], ["Telework", "Telework"], ["Travel", "Travel"], ["Leave", "Leave and Availability"]]) {
      await go(name, title);
      await settled();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${name} spills out of viewport at ${width}px`);
    }
  }

  if (process.env.RADAR_SCREENSHOTS) {
    mkdirSync(process.env.RADAR_SCREENSHOTS, { recursive: true });
    await page.setViewportSize({ width: 1440, height: 1000 });
    for (const theme of ["dark", "light"]) {
      await go("Settings");
      await page.locator("#set-theme").selectOption(theme);
      for (const [name, title] of [["Tasks", "Kanban Board"], ["Telework", "Telework"], ["Travel", "Travel"], ["Leave", "Leave and Availability"]]) {
        await go(name, title);
        await page.mouse.move(0, 0);
        await settled();
        await page.screenshot({ path: join(process.env.RADAR_SCREENSHOTS, `${name.toLowerCase()}-${theme}.png`) });
      }
    }
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(network, []);
  console.log("smoke-workspace: OK (board context and compact mode, availability search/reset, calendars, dialogs, 3 viewport sizes, no errors or network).");
} finally {
  await browser.close();
}
