// Release launch smoke for the desktop distribution. It runs the packaged
// executable beside an empty portable-mode radar.db, waits until the Svelte
// app has crossed the Wails bridge and bootstrapped store meta/default board
// columns, then hard-kills and relaunches to prove the same SQLite lineage is
// retained. A record is then written into the database between launches to
// prove the automatic backup: an empty database must not be backed up, and
// one with records must get a valid backup file beside it on the next launch.
// UI workflows are verified separately because Wails' WebView2 loader does
// not expose a CDP attachment seam in production builds.

import { execFileSync, spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const builtExe = resolve("desktop/build/bin/RADAR.exe");
if (!existsSync(builtExe)) {
  console.error("smoke-desktop: desktop/build/bin/RADAR.exe not found. Run npm run build:desktop first.");
  process.exit(1);
}

const workDir = mkdtempSync(join(tmpdir(), "radar-desktop-smoke-"));
const exe = join(workDir, "RADAR.exe");
const db = join(workDir, "radar.db");
copyFileSync(builtExe, exe);
writeFileSync(db, ""); // Presence beside the executable selects portable mode.

function launch() {
  // Isolate both the portable database and the remembered database-path
  // preference. A developer's real selection must never redirect this test
  // away from its temporary radar.db.
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
      // Database is still opening or the frontend has not initialized yet.
    }
    if (Date.now() > deadline) throw new Error("desktop app did not initialize its SQLite store within 20 seconds");
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 400));
  }
}

const backupFolder = join(workDir, "backups");
const AUTO_BACKUP_NAME = /^RADAR_AutoBackup_[A-Za-z0-9]{1,16}_\d{4}-\d{2}-\d{2}\.json$/;

function autoBackups() {
  return existsSync(backupFolder) ? readdirSync(backupFolder).filter((name) => AUTO_BACKUP_NAME.test(name)) : [];
}

/** Adds one task directly to the database, as a stand-in for a day's work. */
function seedTask() {
  const now = new Date().toISOString();
  const task = {
    id: "smoke-task",
    title: "Smoke test task",
    status: "open",
    boardColumnId: "inbox",
    priority: "normal",
    performanceInputCreated: false,
    tags: [],
    boardOrder: 1000,
    createdAt: now,
    updatedAt: now,
    isArchived: false
  };
  const handle = new DatabaseSync(db);
  try {
    handle.prepare("insert or replace into tasks (id, data) values (?, ?)").run(task.id, JSON.stringify(task));
  } finally {
    handle.close();
  }
}

async function waitForAutoBackup() {
  const deadline = Date.now() + 20_000;
  for (;;) {
    const names = autoBackups();
    if (names.length > 0) {
      try {
        // The rename into place is atomic, so a listed file is a complete one.
        return { name: names[0], backup: JSON.parse(readFileSync(join(backupFolder, names[0]), "utf8")) };
      } catch {
        // Still being written on a slow disk; try again.
      }
    }
    if (Date.now() > deadline) throw new Error("desktop app did not write an automatic backup within 20 seconds");
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 400));
  }
}

let pid;
try {
  pid = launch();
  const first = await waitForBootstrap();
  killTree(pid);
  pid = undefined;
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 750));

  pid = launch();
  const second = await waitForBootstrap();
  if (second.databaseId !== first.databaseId) {
    throw new Error("database lineage changed across desktop relaunch");
  }
  // Give a startup backup time to appear if one were (wrongly) going to.
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 2_500));
  if (autoBackups().length > 0) {
    throw new Error("an empty database must not be backed up automatically");
  }
  killTree(pid);
  pid = undefined;
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 750));

  seedTask();
  pid = launch();
  await waitForBootstrap();
  const { name, backup } = await waitForAutoBackup();
  if (backup.format !== "SupervisorAssistantBackup" || !Array.isArray(backup.data?.tasks)) {
    throw new Error(`automatic backup ${name} is not a RADAR backup package`);
  }
  if (!backup.data.tasks.some((task) => task.id === "smoke-task")) {
    throw new Error(`automatic backup ${name} does not contain the record written before launch`);
  }
  if (autoBackups().length !== 1) {
    throw new Error(`expected exactly one automatic backup, found ${autoBackups().join(", ")}`);
  }
  console.log(
    "smoke-desktop: OK (Wails bridge initialized portable SQLite, retained it across relaunch, and wrote an automatic backup once it held a record).\n"
  );
} finally {
  if (pid) killTree(pid);
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
  rmSync(workDir, { recursive: true, force: true });
}
