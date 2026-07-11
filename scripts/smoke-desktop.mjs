// Release launch smoke for the desktop distribution. It runs the packaged
// executable beside an empty portable-mode radar.db, waits until the Svelte
// app has crossed the Wails bridge and bootstrapped store meta/default board
// columns, then hard-kills and relaunches to prove the same SQLite lineage is
// retained. UI workflows are verified separately because Wails' WebView2
// loader does not expose a CDP attachment seam in production builds.

import { execFileSync, spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

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
  console.log("smoke-desktop: OK (Wails bridge initialized portable SQLite and retained it across relaunch).\n");
} finally {
  if (pid) killTree(pid);
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
  rmSync(workDir, { recursive: true, force: true });
}
