// Recurring task generation in the app store: each schedule's cards, activity
// entries, backup counter, and high-water mark commit together, and the same
// occurrence is never created twice.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppStore } from "../../src/stores/app.svelte";
import { InMemoryDataStore } from "../../src/data/InMemoryDataStore";
import { emptyCollections, type DatabaseSnapshot, type MutationOp } from "../../src/data/DataStore";
import { DEFAULT_SETTINGS, type Employee, type RecurringTask } from "../../src/domain/models";
import { recurrenceInstanceKey } from "../../src/domain/rules/recurrence";
import { richTextDocToPlainText } from "../../src/utils/richTextDoc";

const NOW = "2026-07-01T00:00:00.000Z";
// A Monday.
const TODAY = "2026-07-20";

function recurring(overrides: Partial<RecurringTask> = {}): RecurringTask {
  return {
    id: "r1",
    title: "Certify timecards",
    description: "Review exceptions first.",
    priority: "high",
    employeeId: "e1",
    tags: ["timekeeping"],
    unit: "weeks",
    interval: 1,
    firstDueDate: "2026-07-24",
    advanceCreateDays: 4,
    active: true,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides
  };
}

function employee(id: string): Employee {
  return { id, displayName: `Employee ${id}`, activeStatus: "active", tags: [], createdAt: NOW, updatedAt: NOW, isArchived: false };
}

class FailingMutateStore extends InMemoryDataStore {
  failNext = false;
  override async mutate(ops: MutationOp[]): Promise<void> {
    if (this.failNext) {
      this.failNext = false;
      throw new Error("disk full");
    }
    await super.mutate(ops);
  }
}

async function boot(recurringTasks: RecurringTask[], today = TODAY) {
  const collections = emptyCollections();
  collections.employees = [employee("e1")];
  collections.recurringTasks = recurringTasks;
  const snapshot: DatabaseSnapshot = {
    collections,
    settings: { ...DEFAULT_SETTINGS },
    meta: { databaseId: "db-test", changesSinceBackup: 0 }
  };
  const store = new FailingMutateStore();
  await store.initialize();
  await store.replaceAll(snapshot);
  const app = new AppStore();
  await app.initializeFrom(store);
  app.today = today;
  return { app, store };
}

beforeEach(() => {
  // Toasts schedule an 8s dismissal; keep the test process free of real timers.
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("generateRecurringTasks", () => {
  it("creates the card with its schedule's details and records everything in one batch", async () => {
    const { app, store } = await boot([recurring()]);
    const before = app.meta.changesSinceBackup;

    expect(await app.generateRecurringTasks()).toBe(1);

    expect(app.tasks).toHaveLength(1);
    const task = app.tasks[0]!;
    expect(task).toMatchObject({
      title: "Certify timecards",
      status: "open",
      priority: "high",
      employeeId: "e1",
      tags: ["timekeeping"],
      dueDate: "2026-07-24",
      boardColumnId: app.defaultBoardColumnId(),
      recurrenceTemplateId: "r1",
      recurrenceInstanceKey: recurrenceInstanceKey("r1", "2026-07-24"),
      isArchived: false
    });
    expect(richTextDocToPlainText(task.description)).toBe("Review exceptions first.");
    expect(app.recurringTasks[0]!.lastGeneratedDueDate).toBe("2026-07-24");
    expect(app.activityEntries.some((e) => e.entityId === task.id && e.actionType === "created" && e.summary.includes("recurring"))).toBe(true);
    expect(app.meta.changesSinceBackup).toBe(before + 1);

    // The store holds the same thing the reactive state shows.
    const persisted = await store.exportSnapshot();
    expect(persisted.collections.tasks.map((t) => t.id)).toEqual([task.id]);
    expect(persisted.collections.recurringTasks[0]!.lastGeneratedDueDate).toBe("2026-07-24");
    expect(persisted.meta.changesSinceBackup).toBe(before + 1);
  });

  it("creates nothing the second time, and nothing after the card is deleted", async () => {
    const { app } = await boot([recurring()]);
    await app.generateRecurringTasks();
    expect(await app.generateRecurringTasks()).toBe(0);
    expect(app.tasks).toHaveLength(1);

    await app.deleteRecord("tasks", app.tasks[0]!.id, "Deleted for test");
    expect(app.tasks).toHaveLength(0);
    expect(await app.generateRecurringTasks()).toBe(0);
    expect(app.tasks).toHaveLength(0);
  });

  it("creates the next card when the following week comes into range", async () => {
    const { app } = await boot([recurring()]);
    await app.generateRecurringTasks();
    app.today = "2026-07-27";
    expect(await app.generateRecurringTasks()).toBe(1);
    expect(app.tasks.map((t) => t.dueDate)).toEqual(["2026-07-24", "2026-07-31"]);
    // Cards land at the end of the column, in due order.
    expect(app.tasks[1]!.boardOrder).toBeGreaterThan(app.tasks[0]!.boardOrder);
  });

  it("after time away creates the latest missed card and the upcoming one, in order", async () => {
    const { app } = await boot([recurring({ firstDueDate: "2026-05-01", lastGeneratedDueDate: "2026-06-05" })]);
    expect(await app.generateRecurringTasks()).toBe(2);
    expect(app.tasks.map((t) => t.dueDate)).toEqual(["2026-07-17", "2026-07-24"]);
    expect(app.tasks[1]!.boardOrder).toBeGreaterThan(app.tasks[0]!.boardOrder);
    expect(app.recurringTasks[0]!.lastGeneratedDueDate).toBe("2026-07-24");
  });

  it("creates nothing for a paused schedule or one not yet in range", async () => {
    const { app } = await boot([recurring({ active: false }), recurring({ id: "r2", firstDueDate: "2026-09-01" })]);
    expect(await app.generateRecurringTasks()).toBe(0);
    expect(app.tasks).toHaveLength(0);
    expect(app.recurringTasks.every((r) => r.lastGeneratedDueDate === undefined)).toBe(true);
  });

  it("leaves off an assignee or project that no longer exists", async () => {
    const { app } = await boot([recurring({ employeeId: "gone", projectId: "also-gone" })]);
    await app.generateRecurringTasks();
    expect(app.tasks[0]!.employeeId).toBeUndefined();
    expect(app.tasks[0]!.projectId).toBeUndefined();
  });

  it("does not duplicate a card another writer already created for the same occurrence", async () => {
    const { app } = await boot([recurring()]);
    await app.saveNewTask(
      app.createTask({ title: "Certify timecards", dueDate: "2026-07-24", recurrenceInstanceKey: recurrenceInstanceKey("r1", "2026-07-24") })
    );
    expect(await app.generateRecurringTasks()).toBe(0);
    expect(app.tasks).toHaveLength(1);
    expect(app.recurringTasks[0]!.lastGeneratedDueDate).toBe("2026-07-24");
  });

  it("changes nothing and does not throw when the write fails, then succeeds on the next run", async () => {
    const { app, store } = await boot([recurring()]);
    store.failNext = true;
    expect(await app.generateRecurringTasks()).toBe(0);
    expect(app.tasks).toHaveLength(0);
    expect(app.recurringTasks[0]!.lastGeneratedDueDate).toBeUndefined();
    expect((await store.exportSnapshot()).collections.tasks).toHaveLength(0);
    expect(app.toasts.some((t) => t.kind === "error")).toBe(true);

    expect(await app.generateRecurringTasks()).toBe(1);
    expect(app.tasks).toHaveLength(1);
  });

  it("saving a schedule creates its first card straight away when one is due", async () => {
    const { app } = await boot([]);
    await app.saveRecurringTask(recurring({ id: "r9", lastGeneratedDueDate: "2026-07-19" }), true);
    expect(app.recurringTasks).toHaveLength(1);
    expect(app.tasks.map((t) => t.dueDate)).toEqual(["2026-07-24"]);
    expect(app.activityEntries.some((e) => e.entityType === "recurringTasks" && e.actionType === "created")).toBe(true);
  });
});
