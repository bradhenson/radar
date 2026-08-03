// Drives the one-way rich-text migration against the built file:// artifact:
// a database holding pre-Tiptap text must refuse to convert without a saved
// backup, must preserve formatting and checklist state when it does convert,
// must report what it did, and must not ask again. Run `npm run build` first.

import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";

const artifact = resolve("dist/radar.html");
if (!existsSync(artifact)) {
  console.error("smoke-migration: dist/radar.html not found. Run npm run build first.");
  process.exit(1);
}

/** Legacy records written straight into storage, as a pre-migration database would hold them. */
const LEGACY = {
  quickNotes: {
    id: "legacy-note",
    body: "## Standup\n\n- [x] Shipped the thing\n- [ ] Still open\n\nSome **bold** text.",
    purpose: "scratch",
    isPinned: false,
    isArchived: false
  },
  tasks: {
    id: "legacy-task",
    title: "Legacy task",
    description: "- first\n- second",
    status: "open",
    priority: "normal",
    performanceInputCreated: false,
    tags: [],
    boardOrder: 1000,
    isArchived: false
  }
};

const profileDir = mkdtempSync(join(tmpdir(), "radar-migration-smoke-"));
const downloadDir = mkdtempSync(join(tmpdir(), "radar-migration-dl-"));
let context;
try {
  context = await chromium.launchPersistentContext(profileDir, {
    channel: "msedge",
    headless: true,
    acceptDownloads: true
  });
  const page = await context.newPage();
  page.setDefaultTimeout(20_000);

  const errors = [];
  const requests = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => { if (!r.url().startsWith("file://")) requests.push(r.url()); });

  const url = pathToFileURL(artifact).href;
  await page.goto(`${url}#/notes`);
  await page.getByRole("heading", { name: "Notes" }).waitFor();

  // Seed legacy records directly, so this exercises the real migration path
  // rather than anything the app just wrote in the current format.
  await page.evaluate(async (legacy) => {
    const open = indexedDB.open("supervisor-assistant");
    const db = await new Promise((res, rej) => {
      open.onsuccess = () => res(open.result);
      open.onerror = () => rej(open.error);
    });
    const now = new Date().toISOString();
    const tx = db.transaction(["quickNotes", "tasks"], "readwrite");
    tx.objectStore("quickNotes").put({ ...legacy.quickNotes, createdAt: now, updatedAt: now });
    tx.objectStore("tasks").put({ ...legacy.tasks, createdAt: now, updatedAt: now });
    await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
  }, LEGACY);

  await page.reload();

  // 1. The gate appears and states what it will do.
  const gate = page.getByRole("dialog", { name: "Update how notes are stored" });
  await gate.waitFor();
  const gateText = await gate.innerText();
  for (const needle of ["2 fields", "2 records", "checklist"]) {
    if (!gateText.includes(needle)) throw new Error(`Migration prompt is missing "${needle}":\n${gateText}`);
  }
  console.log("  ok  prompt states the scope before changing anything");

  // 2. Nothing has been converted yet.
  const beforeType = await page.evaluate(async () => {
    const open = indexedDB.open("supervisor-assistant");
    const db = await new Promise((res) => { open.onsuccess = () => res(open.result); });
    const tx = db.transaction("quickNotes", "readonly");
    const rec = await new Promise((res) => {
      const r = tx.objectStore("quickNotes").get("legacy-note");
      r.onsuccess = () => res(r.result);
    });
    return typeof rec.body;
  });
  if (beforeType !== "string") throw new Error("Records were converted before the backup was saved.");
  console.log("  ok  nothing converted while the prompt is open");

  // 3. Converting saves a backup first, in the same click.
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    gate.getByRole("button", { name: "Save a backup and update" }).click()
  ]);
  const backupPath = join(downloadDir, download.suggestedFilename());
  await download.saveAs(backupPath);
  if (!download.suggestedFilename().includes("before_rich_text_update")) {
    throw new Error(`Backup is not named as a pre-migration backup: ${download.suggestedFilename()}`);
  }
  const backup = JSON.parse(readFileSync(backupPath, "utf8"));
  const backedUpNote = backup.data.quickNotes.find((n) => n.id === "legacy-note");
  if (typeof backedUpNote?.body !== "string") {
    throw new Error("The backup does not contain the original pre-migration text.");
  }
  console.log(`  ok  pre-migration backup saved (${download.suggestedFilename()}) holding the original text`);

  // 4. The result is reported.
  const summary = page.getByRole("dialog", { name: "Notes updated" });
  await summary.waitFor();
  const summaryText = await summary.innerText();
  for (const needle of ["2 rich-text fields", "2 records", "2 checklist items"]) {
    if (!summaryText.includes(needle)) throw new Error(`Summary is missing "${needle}":\n${summaryText}`);
  }
  console.log("  ok  summary reports fields, records, and checklist items converted");
  await summary.getByRole("button", { name: "Done" }).click();

  // 5. Stored records are documents now, and the text survived.
  const after = await page.evaluate(async () => {
    const open = indexedDB.open("supervisor-assistant");
    const db = await new Promise((res) => { open.onsuccess = () => res(open.result); });
    const read = async (store, id) => {
      const tx = db.transaction(store, "readonly");
      return new Promise((res) => {
        const r = tx.objectStore(store).get(id);
        r.onsuccess = () => res(r.result);
      });
    };
    const note = await read("quickNotes", "legacy-note");
    const task = await read("tasks", "legacy-task");
    return {
      noteIsDoc: typeof note.body === "object" && note.body?.schemaVersion === 1,
      taskIsDoc: typeof task.description === "object" && task.description?.schemaVersion === 1
    };
  });
  if (!after.noteIsDoc || !after.taskIsDoc) throw new Error(`Records were not converted: ${JSON.stringify(after)}`);
  console.log("  ok  stored records are versioned documents");

  const rendered = page.locator(".rich-text", { hasText: "Shipped the thing" }).first();
  await rendered.waitFor();
  const noteText = await rendered.innerText();
  if (!noteText.includes("Standup")) throw new Error("Heading did not survive the migration.");
  if (!noteText.includes("✓ Shipped the thing")) throw new Error("Completed checklist state was lost.");
  if (!noteText.includes("○ Still open")) throw new Error("Open checklist state was lost.");
  if ((await rendered.locator("h4").count()) !== 1) throw new Error("Heading did not convert to a real heading.");
  if ((await rendered.locator("strong").count()) !== 1) throw new Error("Bold did not survive the migration.");
  console.log("  ok  headings, bold, and checklist state preserved");

  // 6. It does not ask again.
  await page.reload();
  await page.getByRole("heading", { name: "Notes" }).waitFor();
  await page.waitForTimeout(600);
  if (await page.getByRole("dialog", { name: "Update how notes are stored" }).isVisible().catch(() => false)) {
    throw new Error("The migration prompt returned after the migration completed.");
  }
  console.log("  ok  migration is not offered again");

  if (errors.length) throw new Error(`Console/page errors: ${errors.join(" | ")}`);
  if (requests.length) throw new Error(`Network requests attempted: ${requests.join(", ")}`);

  console.log("\nsmoke-migration: OK (backup enforced, content preserved, reported, idempotent).");
} finally {
  await context?.close();
  rmSync(profileDir, { recursive: true, force: true });
  rmSync(downloadDir, { recursive: true, force: true });
}
