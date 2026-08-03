// Verifies the rich-text migration at its real surface: every editor in the app
// exposes the same six-tool schema, no editor can produce a checkbox, and note
// text saved before the migration still renders with its completion state.
// Run `npm run build` first.

import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";

const artifact = resolve("dist/radar.html");
if (!existsSync(artifact)) {
  console.error("smoke-richtext: dist/radar.html not found. Run npm run build first.");
  process.exit(1);
}

const EXPECTED_TOOLS = ["Bold", "Italic", "Underline", "Heading", "Bulleted list", "Numbered list"];

const profileDir = mkdtempSync(join(tmpdir(), "radar-richtext-smoke-"));
let context;
try {
  context = await chromium.launchPersistentContext(profileDir, { channel: "msedge", headless: true });
  const page = await context.newPage();
  page.setDefaultTimeout(20_000);

  const errors = [];
  const requests = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => { if (!r.url().startsWith("file://")) requests.push(r.url()); });

  const url = pathToFileURL(artifact).href;
  await page.goto(`${url}#/settings`);
  await page.getByRole("heading", { name: "Settings" }).waitFor();
  await page.getByRole("button", { name: "Load sample data" }).click();
  await page.getByRole("dialog", { name: "Load sample data" }).getByRole("button", { name: "Load sample data" }).click();
  await page.getByText("Sample data loaded").waitFor();

  /** Assert one editor's toolbar is exactly the agreed schema. */
  async function checkEditor(label, editorId) {
    const editor = page.locator(`#${editorId}`);
    await editor.waitFor();

    const toolbar = page.locator(".rich-editor", { has: page.locator(`#${editorId}`) }).getByRole("toolbar");
    const names = await toolbar.getByRole("button").evaluateAll((els) =>
      els.map((el) => el.getAttribute("aria-label"))
    );

    if (names.length !== EXPECTED_TOOLS.length || names.some((n, i) => n !== EXPECTED_TOOLS[i])) {
      throw new Error(`${label} (#${editorId}) toolbar is [${names.join(", ")}], expected [${EXPECTED_TOOLS.join(", ")}]`);
    }
    if (names.some((n) => /check|task ?list|todo/i.test(n ?? ""))) {
      throw new Error(`${label} (#${editorId}) still offers a checkbox tool.`);
    }
    // The schema itself must refuse a checkbox, not merely hide the button.
    await editor.click();
    await page.keyboard.type("[] typed checkbox prefix");
    if ((await editor.locator("input[type=checkbox], ul[data-type=taskList], li[data-checked]").count()) > 0) {
      throw new Error(`${label} (#${editorId}) produced a task list from a typed "[] " prefix.`);
    }
    await page.keyboard.press("Control+a");
    await page.keyboard.press("Backspace");
    console.log(`  ok  ${label} (#${editorId})`);
  }

  console.log("Editors:");
  await page.goto(`${url}#/notes`);
  await page.getByRole("heading", { name: "Notes" }).waitFor();
  await checkEditor("Notes composer", "notes-composer");

  // The J shortcut only fires when focus is outside a text surface.
  await page.goto(`${url}#/board`);
  await page.getByRole("heading", { name: "Board" }).first().waitFor();
  await page.keyboard.press("j");
  await checkEditor("Quick note dialog", "qn-body");
  await page.keyboard.press("Escape");

  await page.goto(`${url}#/meetings`);
  await page.getByRole("button", { name: "New meeting note" }).first().click();
  await checkEditor("Meeting discussion notes", "mn-notes");
  await checkEditor("Meeting action items", "mn-actions");

  await page.goto(`${url}#/performance`);
  await page.getByRole("button", { name: "New performance input" }).first().click();
  await checkEditor("Performance context", "pi-context");
  await checkEditor("Performance action", "pi-action");
  await checkEditor("Performance result", "pi-result-impact");

  // A legacy checklist must still show which items were done.
  await page.goto(`${url}#/notes`);
  await page.getByRole("heading", { name: "Notes" }).waitFor();
  const legacy = await page.evaluate(async () => {
    const open = indexedDB.open("supervisor-assistant");
    const db = await new Promise((res, rej) => {
      open.onsuccess = () => res(open.result);
      open.onerror = () => rej(open.error);
    });
    const tx = db.transaction("quickNotes", "readwrite");
    tx.objectStore("quickNotes").put({
      id: "legacy-checklist-probe",
      body: "- [x] Shipped the thing\n- [ ] Still open",
      purpose: "scratch",
      isPinned: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      isArchived: false
    });
    await new Promise((res) => (tx.oncomplete = res));
    return true;
  });
  if (!legacy) throw new Error("Could not seed a legacy checklist note.");

  // reload(), not goto(): the URL is unchanged, so goto would stay same-document
  // and the store would never re-read what was just written.
  await page.reload();
  // Seeding legacy text makes the migration offer appear. Defer it here on
  // purpose: unconverted records must already render correctly, which is what
  // makes deferring safe in the first place.
  const gate = page.getByRole("dialog", { name: "Update how notes are stored" });
  await gate.waitFor();
  await gate.getByRole("button", { name: "Not now" }).click();
  console.log("Deferred migration:\n  ok  offer can be declined and legacy records still render");

  const rendered = page.locator(".rich-text", { hasText: "Shipped the thing" }).first();
  await rendered.waitFor();
  const text = await rendered.innerText();
  if (!text.includes("✓ Shipped the thing")) throw new Error(`Completed legacy item lost its state: ${text}`);
  if (!text.includes("○ Still open")) throw new Error(`Open legacy item lost its state: ${text}`);
  if ((await rendered.locator("input[type=checkbox]").count()) > 0) {
    throw new Error("A legacy checklist still renders an interactive checkbox.");
  }
  console.log("Legacy checklist:\n  ok  renders as ✓ / ○ bullets, no checkbox");

  if (errors.length) throw new Error(`Console/page errors: ${errors.join(" | ")}`);
  if (requests.length) throw new Error(`Network requests attempted: ${requests.join(", ")}`);

  console.log("\nsmoke-richtext: OK (7 editors, uniform 6-tool schema, no checkbox anywhere, legacy state preserved).");
} finally {
  await context?.close();
  rmSync(profileDir, { recursive: true, force: true });
}
