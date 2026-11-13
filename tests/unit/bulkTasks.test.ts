// Bulk task changes: the pure rule, and the app store applying it atomically.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppStore } from "../../src/stores/app.svelte";
import { InMemoryDataStore } from "../../src/data/InMemoryDataStore";
import { emptyCollections, type DatabaseSnapshot, type MutationOp } from "../../src/data/DataStore";
import { DEFAULT_SETTINGS, type BoardColumnDefinition, type Employee, type Task } from "../../src/domain/models";
import { orderForAppend } from "../../src/domain/rules/boardOrder";
import { applyBulkTaskChange, bulkChangeAction, bulkChangePhrase, type BulkTaskContext } from "../../src/domain/rules/bulkTasks";

const NOW = "2026-07-20T12:00:00.000Z";
const TODAY = "2026-07-20";
const STAMP = { createdAt: "2026-07-01T00:00:00.000Z", updatedAt: "2026-07-01T00:00:00.000Z" };

const column = (id: string, label: string, sortOrder: number, mapsToStatus?: "open" | "waiting"): BoardColumnDefinition =>
  ({ id, label, sortOrder, mapsToStatus, isArchived: false, ...STAMP }) as BoardColumnDefinition;
const COLUMNS = [column("inbox", "Inbox", 0, "open"), column("waiting", "Waiting", 1, "waiting"), column("parked", "Parked", 2)];

const task = (id: string, overrides: Partial<Task> = {}): Task => ({
  id,
  title: `Task ${id}`,
  status: "open",
  boardColumnId: "inbox",
  priority: "normal",
  performanceInputCreated: false,
  tags: [],
  boardOrder: 1000,
  isArchived: false,
  ...STAMP,
  ...overrides
});

function ruleContext(orders: Record<string, number[]> = {}): BulkTaskContext {
  return {
    today: TODAY,
    now: NOW,
    columns: COLUMNS,
    columnIdOf: (t) => t.boardColumnId ?? "inbox",
    orderForAppend,
    ordersByColumn: new Map(Object.entries(orders))
  };
}

describe("applyBulkTaskChange", () => {
  it("moves a card to the end of the lane and follows the lane's status rule", () => {
    const moved = applyBulkTaskChange(task("a"), { kind: "column", columnId: "waiting" }, ruleContext({ waiting: [1000, 2000] }));
    expect(moved).toMatchObject({ boardColumnId: "waiting", status: "waiting", waitingSince: NOW, boardOrder: 3000, updatedAt: NOW });
  });

  it("keeps several moved cards in order by appending each after the last", () => {
    const ctx = ruleContext({ waiting: [1000] });
    const first = applyBulkTaskChange(task("a"), { kind: "column", columnId: "waiting" }, ctx)!;
    const second = applyBulkTaskChange(task("b"), { kind: "column", columnId: "waiting" }, ctx)!;
    expect([first.boardOrder, second.boardOrder]).toEqual([2000, 3000]);
  });

  it("leaves status alone when the lane has no status mapping, and reopens when moving out of Waiting", () => {
    const parked = applyBulkTaskChange(task("a", { status: "waiting", boardColumnId: "waiting", waitingSince: NOW }), { kind: "column", columnId: "parked" }, ruleContext());
    expect(parked).toMatchObject({ boardColumnId: "parked", status: "waiting" });
    const reopened = applyBulkTaskChange(task("a", { status: "waiting", boardColumnId: "waiting", waitingSince: NOW }), { kind: "column", columnId: "inbox" }, ruleContext());
    expect(reopened).toMatchObject({ status: "open", waitingSince: undefined });
  });

  it("returns nothing when the change would not alter the task", () => {
    const ctx = ruleContext();
    expect(applyBulkTaskChange(task("a"), { kind: "column", columnId: "inbox" }, ctx)).toBeUndefined();
    expect(applyBulkTaskChange(task("a"), { kind: "column", columnId: "no-such-lane" }, ctx)).toBeUndefined();
    expect(applyBulkTaskChange(task("a"), { kind: "priority", priority: "normal" }, ctx)).toBeUndefined();
    expect(applyBulkTaskChange(task("a", { employeeId: "e1" }), { kind: "assign", employeeId: "e1" }, ctx)).toBeUndefined();
    expect(applyBulkTaskChange(task("a"), { kind: "assign", employeeId: undefined }, ctx)).toBeUndefined();
    expect(applyBulkTaskChange(task("a", { dueDate: "2026-08-01" }), { kind: "due", dueDate: "2026-08-01" }, ctx)).toBeUndefined();
    expect(applyBulkTaskChange(task("a"), { kind: "due", dueDate: undefined }, ctx)).toBeUndefined();
  });

  it("assigns, unassigns, sets priority, and sets or clears the due date", () => {
    const ctx = ruleContext();
    expect(applyBulkTaskChange(task("a"), { kind: "assign", employeeId: "e1" }, ctx)).toMatchObject({ employeeId: "e1", updatedAt: NOW });
    expect(applyBulkTaskChange(task("a", { employeeId: "e1" }), { kind: "assign", employeeId: undefined }, ctx)!.employeeId).toBeUndefined();
    expect(applyBulkTaskChange(task("a"), { kind: "priority", priority: "critical" }, ctx)!.priority).toBe("critical");
    expect(applyBulkTaskChange(task("a"), { kind: "due", dueDate: "2026-08-01" }, ctx)!.dueDate).toBe("2026-08-01");
    expect(applyBulkTaskChange(task("a", { dueDate: "2026-08-01" }), { kind: "due", dueDate: undefined }, ctx)!.dueDate).toBeUndefined();
  });

  it("marks done the way the Done button does: complete, dated today, archived", () => {
    const done = applyBulkTaskChange(task("a", { status: "waiting", waitingSince: NOW }), { kind: "done" }, ruleContext());
    expect(done).toMatchObject({ status: "complete", completedDate: TODAY, isArchived: true, waitingSince: undefined });
  });

  it("does not mutate the task it is given", () => {
    const original = task("a");
    const copy = structuredClone(original);
    applyBulkTaskChange(original, { kind: "done" }, ruleContext());
    expect(original).toEqual(copy);
  });
});

describe("bulk change wording", () => {
  const names = { column: (id: string) => id.toUpperCase(), employee: () => "Avery Brooks", priority: (p: string) => p, date: (d: string) => d };

  it("describes each change", () => {
    expect(bulkChangePhrase({ kind: "column", columnId: "waiting" }, names)).toBe("moved to WAITING");
    expect(bulkChangePhrase({ kind: "assign", employeeId: "e1" }, names)).toBe("assigned to Avery Brooks");
    expect(bulkChangePhrase({ kind: "assign", employeeId: undefined }, names)).toBe("unassigned");
    expect(bulkChangePhrase({ kind: "priority", priority: "high" }, names)).toBe("set to high priority");
    expect(bulkChangePhrase({ kind: "due", dueDate: "2026-08-01" }, names)).toBe("due date set to 2026-08-01");
    expect(bulkChangePhrase({ kind: "due", dueDate: undefined }, names)).toBe("due date cleared");
    expect(bulkChangePhrase({ kind: "done" }, names)).toBe("marked done and archived");
  });

  it("logs the same action type the single-task action would", () => {
    const a = task("a");
    expect(bulkChangeAction({ kind: "done" }, a, { ...a, status: "complete" })).toBe("completed");
    expect(bulkChangeAction({ kind: "column", columnId: "waiting" }, a, { ...a, status: "waiting" })).toBe("status_changed");
    expect(bulkChangeAction({ kind: "priority", priority: "high" }, a, { ...a, priority: "high" })).toBe("updated");
  });
});

// ---------------------------------------------------------------------------
// Store

class FailingMutateStore extends InMemoryDataStore {
  failNext = false;
  mutateCalls = 0;
  override async mutate(ops: MutationOp[]): Promise<void> {
    this.mutateCalls += 1;
    if (this.failNext) {
      this.failNext = false;
      throw new Error("disk full");
    }
    await super.mutate(ops);
  }
}

async function boot() {
  const collections = emptyCollections();
  collections.boardColumns = COLUMNS;
  collections.employees = [{ id: "e1", displayName: "Avery Brooks", activeStatus: "active", tags: [], isArchived: false, ...STAMP } as Employee];
  collections.tasks = [
    task("a", { boardOrder: 1000 }),
    task("b", { boardOrder: 2000 }),
    task("c", { boardOrder: 3000, priority: "high" }),
    task("w", { boardColumnId: "waiting", status: "waiting", boardOrder: 1000 }),
    task("old", { isArchived: true, status: "complete" })
  ];
  const snapshot: DatabaseSnapshot = { collections, settings: { ...DEFAULT_SETTINGS }, meta: { databaseId: "db", changesSinceBackup: 0 } };
  const store = new FailingMutateStore();
  await store.initialize();
  await store.replaceAll(snapshot);
  const app = new AppStore();
  await app.initializeFrom(store);
  app.today = TODAY;
  store.mutateCalls = 0;
  return { app, store };
}

const byId = (app: AppStore, id: string) => app.tasks.find((t) => t.id === id)!;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("bulkUpdateTasks", () => {
  it("changes every selected task in one write, with one activity entry each and one counter bump", async () => {
    const { app, store } = await boot();
    const entriesBefore = app.activityEntries.length;

    expect(await app.bulkUpdateTasks(["a", "b", "c"], { kind: "priority", priority: "high" })).toBe(2);

    expect(store.mutateCalls).toBe(1);
    expect(["a", "b", "c"].map((id) => byId(app, id).priority)).toEqual(["high", "high", "high"]);
    // "c" was already high, so it is neither rewritten nor logged.
    expect(byId(app, "c").updatedAt).toBe(STAMP.updatedAt);
    expect(app.activityEntries.length).toBe(entriesBefore + 2);
    expect(app.activityEntries.at(-1)!.summary).toBe('"Task b" set to High priority');
    expect(app.meta.changesSinceBackup).toBe(1);
    const persisted = await store.exportSnapshot();
    expect(persisted.collections.tasks.filter((t) => t.priority === "high").map((t) => t.id).sort()).toEqual(["a", "b", "c"]);
  });

  it("moves cards to the end of a lane in their existing order and applies the lane's status", async () => {
    const { app } = await boot();
    await app.bulkUpdateTasks(["c", "a"], { kind: "column", columnId: "waiting" });
    const waiting = app.tasks.filter((t) => t.boardColumnId === "waiting" && !t.isArchived).sort((x, y) => x.boardOrder - y.boardOrder);
    expect(waiting.map((t) => t.id)).toEqual(["w", "a", "c"]);
    expect(byId(app, "a")).toMatchObject({ status: "waiting" });
    expect(byId(app, "a").waitingSince).toBeTruthy();
  });

  it("Done archives the tasks, and Undo brings every one back exactly as it was", async () => {
    const { app } = await boot();
    const before = structuredClone([byId(app, "a"), byId(app, "w")].map((t) => ({ ...t })));

    expect(await app.bulkUpdateTasks(["a", "w"], { kind: "done" })).toBe(2);
    expect(byId(app, "a")).toMatchObject({ status: "complete", isArchived: true, completedDate: TODAY });
    expect(byId(app, "w")).toMatchObject({ status: "complete", isArchived: true, waitingSince: undefined });
    const toast = app.toasts.at(-1)!;
    expect(toast.message).toBe("2 tasks marked done and archived");

    await toast.undo!();
    for (const original of before) {
      const restored = byId(app, original.id);
      expect({ ...restored, updatedAt: original.updatedAt }).toEqual(original);
    }
    expect(app.activityEntries.filter((e) => e.actionType === "reopened")).toHaveLength(2);
  });

  it("ignores archived tasks and ids that do not exist, and does nothing when nothing would change", async () => {
    const { app, store } = await boot();
    expect(await app.bulkUpdateTasks(["old", "missing"], { kind: "priority", priority: "low" })).toBe(0);
    expect(await app.bulkUpdateTasks(["a"], { kind: "priority", priority: "normal" })).toBe(0);
    expect(await app.bulkUpdateTasks([], { kind: "done" })).toBe(0);
    expect(store.mutateCalls).toBe(0);
    expect(app.toasts).toHaveLength(0);
    expect(byId(app, "old").priority).toBe("normal");
  });

  it("changes nothing at all when the write fails", async () => {
    const { app, store } = await boot();
    store.failNext = true;
    await expect(app.bulkUpdateTasks(["a", "b"], { kind: "assign", employeeId: "e1" })).rejects.toThrow("disk full");
    expect(byId(app, "a").employeeId).toBeUndefined();
    expect(byId(app, "b").employeeId).toBeUndefined();
    expect((await store.exportSnapshot()).collections.tasks.every((t) => !t.employeeId)).toBe(true);
    expect(app.meta.changesSinceBackup).toBe(0);
  });
});
