// Boots the packaged desktop executable against a portable SQLite database that
// still holds pre-Tiptap text, and checks two things the browser smokes cannot:
// the app starts normally against a legacy database, and it does not convert
// anything before the user accepts the backup. Wails' production WebView2
// loader exposes no CDP seam, so the conversion click itself is covered by
// smoke:migration in the browser; what is proved here is the SQLite side.
//
// Run `npm run build:desktop` first.

import { execFileSync, spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const builtExe = resolve("desktop/build/bin/RADAR.exe");
if (!existsSync(builtExe)) {
  console.error("smoke-desktop-legacy: desktop/build/bin/RADAR.exe not found. Run npm run build:desktop first.");
  process.exit(1);
}

const LEGACY_BODY = "## Standup\n\n- [x] Shipped the thing\n- [ ] Still open\n\nSome **bold** text.";

const workDir = mkdtempSync(join(tmpdir(), "radar-desktop-legacy-"));
const exe = join(workDir, "RADAR.exe");
const db = join(workDir, "radar.db");
copyFileSync(builtExe, exe);
writeFileSync(db, ""); // Presence beside the executable selects portable mode.

function launch() {
  const child = spawn(exe, [], {
    detached: true,
    stdio: "ignore",
    env: { ...process.env, LOCALAPPDATA: workDir }
  });
  child.unref();
  return child.pid;
}

function killTree(pid) {
  try {
    execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
  } catch {
    // Already exited.
  }
}

function inspect() {
  const raw = execFileSync("go", ["run", "./cmd/smoke-inspect", db], {
    cwd: resolve("desktop"),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"]
  });
  return JSON.parse(raw);
}

async function waitForBootstrap() {
  const deadline = Date.now() + 20_000;
  for (;;) {
    try {
      const state = inspect();
      if (state.databaseId && state.boardColumns > 0) return state;
    } catch {
      // Still opening, or the frontend has not initialized yet.
    }
    if (Date.now() > deadline) throw new Error("desktop app did not initialize its SQLite store within 20 seconds");
    await new Promise((r) => setTimeout(r, 400));
  }
}

function readNote() {
  const handle = new DatabaseSync(db, { readOnly: true });
  try {
    const row = handle.prepare("select data from quickNotes where id = 'legacy-note'").get();
    return row ? JSON.parse(row.data) : undefined;
  } finally {
    handle.close();
  }
}

let pid;
try {
  // First boot creates the schema the legacy row needs a table for.
  pid = launch();
  await waitForBootstrap();
  killTree(pid);
  pid = undefined;
  await new Promise((r) => setTimeout(r, 750));

  const now = new Date().toISOString();
  const handle = new DatabaseSync(db);
  handle
    .prepare("insert or replace into quickNotes (id, data) values (?, ?)")
    .run(
      "legacy-note",
      JSON.stringify({
        id: "legacy-note",
        body: LEGACY_BODY,
        purpose: "scratch",
        isPinned: false,
        isArchived: false,
        createdAt: now,
        updatedAt: now
      })
    );
  handle.close();
  console.log("  ok  seeded a pre-Tiptap note into portable SQLite");

  pid = launch();
  const state = await waitForBootstrap();
  if (!state.databaseId) throw new Error("app did not bootstrap against a legacy database");
  console.log("  ok  app boots normally against a database holding legacy text");

  // Give the frontend room to have done something wrong before checking.
  await new Promise((r) => setTimeout(r, 2500));
  const note = readNote();
  if (!note) throw new Error("the legacy note disappeared from SQLite");
  if (typeof note.body !== "string" || note.body !== LEGACY_BODY) {
    throw new Error(
      `legacy text was altered without the user accepting a backup: ${JSON.stringify(note.body).slice(0, 200)}`
    );
  }
  console.log("  ok  nothing converted, and the original text is byte-for-byte intact");

  console.log("\nsmoke-desktop-legacy: OK (SQLite boots on legacy data; conversion stays gated behind the backup).");
} finally {
  if (pid) killTree(pid);
  await new Promise((r) => setTimeout(r, 500));
  rmSync(workDir, { recursive: true, force: true });
}
