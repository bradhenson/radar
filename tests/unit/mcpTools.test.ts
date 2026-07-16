// MCP server tools, exercised against a real temporary SQLite database.
// Fictional sample people only (working rule 8). No network, no MCP client:
// the tools are called directly, which is where the domain behavior lives.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RadarDb } from "../../mcp/src/db";
import {
  addEmployeeNote,
  createTask,
  getEmployee,
  listEmployees,
  recordCheckIn,
  searchTasks,
  updateTask
} from "../../mcp/src/tools";
import { COLLECTION_NAMES } from "../../src/data/DataStore";
import { DEFAULT_BOARD_COLUMN_SEEDS } from "../../src/domain/models";

let dir: string;
let dbPath: string;
let db: RadarDb;

const NOW = "2026-07-01T12:00:00.000Z";

/** Builds a RADAR-shaped database the same way desktop/store.go would. */
function seedDatabase(path: string): void {
  const raw = new DatabaseSync(path);
  raw.exec("CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  for (const name of COLLECTION_NAMES) {
    raw.exec(`CREATE TABLE IF NOT EXISTS "${name}" (id TEXT PRIMARY KEY NOT NULL, data TEXT NOT NULL)`);
  }
  raw.exec("INSERT INTO app_meta(key, value) VALUES('schema_version', '1')");
  raw.prepare("INSERT INTO app_meta(key, value) VALUES('meta', ?)").run(
    JSON.stringify({ databaseId: "test-db", changesSinceBackup: 0 })
  );

  const insert = (collection: string, record: { id: string } & Record<string, unknown>) =>
    raw.prepare(`INSERT INTO "${collection}"(id, data) VALUES(?, ?)`).run(record.id, JSON.stringify(record));

  for (const seed of DEFAULT_BOARD_COLUMN_SEEDS) {
    insert("boardColumns", { ...seed, createdAt: NOW, updatedAt: NOW });
  }
  insert("employees", {
    id: "emp-1",
    displayName: "Dana Whitfield",
    preferredName: "Dana",
    positionTitle: "IT Specialist",
    team: "Delta",
    activeStatus: "active",
    tags: [],
    createdAt: NOW,
    updatedAt: NOW,
    isArchived: false
  });
  insert("employees", {
    id: "emp-2",
    displayName: "Marisol Reyes",
    activeStatus: "active",
    tags: [],
    createdAt: NOW,
    updatedAt: NOW,
    isArchived: false
  });
  insert("tasks", {
    id: "task-1",
    title: "Migration cutover checklist",
    status: "open",
    boardColumnId: "inbox",
    priority: "normal",
    employeeId: "emp-1",
    performanceInputCreated: false,
    tags: [],
    boardOrder: 100,
    createdAt: NOW,
    updatedAt: NOW,
    isArchived: false
  });
  raw.close();
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "radar-mcp-"));
  dbPath = join(dir, "radar.db");
  seedDatabase(dbPath);
  db = new RadarDb(dbPath);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

/** Reads a raw app_meta value the way desktop/dbwatch.go does. */
function metaValue(key: string): string | undefined {
  const raw = new DatabaseSync(dbPath);
  const row = raw.prepare("SELECT value FROM app_meta WHERE key = ?").get(key) as { value?: string } | undefined;
  raw.close();
  return row?.value;
}

describe("RadarDb", () => {
  it("refuses a database that is not RADAR's", () => {
    const strangerPath = join(dir, "stranger.db");
    const stranger = new DatabaseSync(strangerPath);
    stranger.exec("CREATE TABLE something (id TEXT)");
    stranger.close();
    expect(() => new RadarDb(strangerPath)).toThrow(/not a RADAR database/);
  });

  it("records an activity entry and bumps the backup counter on write", () => {
    createTask(db, { title: "Audit evidence prep" });
    const entries = db.readAll("activityEntries");
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ entityType: "tasks", actionType: "created" });
    expect(entries[0]!.summary).toContain("Audit evidence prep");
    expect(db.getMeta().changesSinceBackup).toBe(1);
  });

  it("stamps the external-write signal desktop/dbwatch.go polls", () => {
    expect(metaValue("external_write_at")).toBeUndefined();
    createTask(db, { title: "First" });
    const first = metaValue("external_write_at");
    expect(first).toBeDefined();
    createTask(db, { title: "Second" });
    // Two writes in the same millisecond must still differ, or a running
    // desktop window would miss the second change.
    expect(metaValue("external_write_at")).not.toBe(first);
  });
});

describe("read tools", () => {
  it("lists and searches employees", () => {
    expect(listEmployees(db, {}).map((e) => e.name)).toEqual(["Dana Whitfield", "Marisol Reyes"]);
    expect(listEmployees(db, { search: "delta" })).toHaveLength(1);
  });

  it("resolves a person by fragment and returns their open work", () => {
    const view = getEmployee(db, { employee: "dana" });
    expect(view.name).toBe("Dana Whitfield");
    expect(view.title).toBe("IT Specialist");
    expect(view.openTasks).toHaveLength(1);
    expect(view.openTasks[0]).toMatchObject({ title: "Migration cutover checklist", column: "Inbox" });
  });

  it("refuses an ambiguous name rather than guessing", () => {
    addEmployeeNote(db, { employee: "emp-2", note: "placeholder" });
    // Both people match "a"; picking one silently would write to the wrong record.
    expect(() => getEmployee(db, { employee: "a" })).toThrow(/matches 2 people/);
  });

  it("reports an unknown person clearly", () => {
    expect(() => getEmployee(db, { employee: "nobody" })).toThrow(/No employee matches/);
  });

  it("filters tasks by assignee and text", () => {
    expect(searchTasks(db, { employee: "Dana" })).toHaveLength(1);
    expect(searchTasks(db, { text: "cutover" })).toHaveLength(1);
    expect(searchTasks(db, { text: "nothing here" })).toHaveLength(0);
  });
});

describe("create_task", () => {
  it("defaults to Inbox at normal priority with only a title", () => {
    const created = createTask(db, { title: "Follow up on voucher" });
    expect(created).toMatchObject({ column: "Inbox", priority: "normal", status: "Open" });
    const stored = db.readAll("tasks").find((t) => t.title === "Follow up on voucher")!;
    expect(stored.isArchived).toBe(false);
    expect(stored.performanceInputCreated).toBe(false);
    expect(stored.tags).toEqual([]);
  });

  it("appends after existing cards in the same column", () => {
    const created = createTask(db, { title: "Second inbox card" });
    const stored = db.readAll("tasks").find((t) => t.title === created.title)!;
    expect(stored.boardOrder).toBeGreaterThan(100);
  });

  it("assigns by name fragment and sets waiting metadata from the column", () => {
    const created = createTask(db, { title: "Vendor ticket", employee: "dana", column: "Waiting" });
    expect(created.assignee).toBe("Dana Whitfield");
    const stored = db.readAll("tasks").find((t) => t.id === created.id)!;
    expect(stored.status).toBe("waiting");
    expect(stored.waitingSince).toBeTruthy();
  });

  it("rejects an empty title", () => {
    expect(() => createTask(db, { title: "   " })).toThrow(/title is required/);
  });
});

describe("update_task", () => {
  it("keeps status in sync when the column moves", () => {
    updateTask(db, { taskId: "task-1", column: "Complete" });
    const stored = db.readOne("tasks", "task-1")!;
    expect(stored.status).toBe("complete");
    expect(stored.completedDate).toBeTruthy();
    expect(stored.boardColumnId).toBe("complete");
  });

  it("moves the card when the status changes", () => {
    updateTask(db, { taskId: "task-1", status: "waiting" });
    const stored = db.readOne("tasks", "task-1")!;
    expect(stored.boardColumnId).toBe("waiting");
    expect(stored.waitingSince).toBeTruthy();
  });

  it("clears the completion date and waiting clock when reopened", () => {
    updateTask(db, { taskId: "task-1", status: "complete" });
    updateTask(db, { taskId: "task-1", status: "open" });
    const stored = db.readOne("tasks", "task-1")!;
    expect(stored.completedDate).toBeUndefined();
    expect(stored.waitingSince).toBeUndefined();
  });

  it("changes only what it is given", () => {
    updateTask(db, { taskId: "task-1", priority: "high" });
    const stored = db.readOne("tasks", "task-1")!;
    expect(stored.priority).toBe("high");
    expect(stored.title).toBe("Migration cutover checklist");
    expect(stored.employeeId).toBe("emp-1");
  });

  it("clears a due date with null but leaves it alone when omitted", () => {
    updateTask(db, { taskId: "task-1", dueDate: "2026-07-20" });
    expect(db.readOne("tasks", "task-1")!.dueDate).toBe("2026-07-20");
    updateTask(db, { taskId: "task-1", priority: "low" });
    expect(db.readOne("tasks", "task-1")!.dueDate).toBe("2026-07-20");
    updateTask(db, { taskId: "task-1", dueDate: null });
    expect(db.readOne("tasks", "task-1")!.dueDate).toBeUndefined();
  });

  it("reports an unknown task id", () => {
    expect(() => updateTask(db, { taskId: "missing", priority: "high" })).toThrow(/No task with id/);
  });
});

describe("note and check-in tools", () => {
  it("adds a note against the resolved person", () => {
    const added = addEmployeeNote(db, { employee: "dana", note: "Prefers written summaries" });
    expect(added.employee).toBe("Dana Whitfield");
    const notes = db.readAll("employeeNotes");
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ employeeId: "emp-1", isArchived: false });
  });

  it("records a check-in and updates the employee's last check-in date", () => {
    const result = recordCheckIn(db, { employee: "Dana Whitfield", summary: "Discussed cutover" });
    expect(result.type).toBe("Informal check-in");
    expect(db.readAll("employeeInteractions")).toHaveLength(1);
    expect(db.readOne("employees", "emp-1")!.lastCheckInDate).toBe(result.date);
  });
});
