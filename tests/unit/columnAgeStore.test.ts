// The store stamps Task.columnEnteredAt on every path that changes a card's column.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppStore } from "../../src/stores/app.svelte";
import { InMemoryDataStore } from "../../src/data/InMemoryDataStore";
import { emptyCollections } from "../../src/data/DataStore";
import { DEFAULT_SETTINGS, type Task } from "../../src/domain/models";

const OLD = "2026-01-01T00:00:00.000Z";

function makeTask(id: string, partial: Partial<Task> = {}): Task {
  return {
    id,
    title: `Task ${id}`,
    status: "open",
    priority: "normal",
    performanceInputCreated: false,
    tags: [],
    boardOrder: 1,
    createdAt: OLD,
    updatedAt: OLD,
    isArchived: false,
    ...partial
  };
}

async function boot(): Promise<AppStore> {
  const store = new InMemoryDataStore();
  await store.initialize();
  const collections = emptyCollections();
  collections.tasks = [makeTask("t1"), makeTask("t2", { columnEnteredAt: OLD })];
  await store.replaceAll({ collections, settings: { ...DEFAULT_SETTINGS }, meta: { databaseId: "db", changesSinceBackup: 0 } });
  const app = new AppStore();
  await app.initializeFrom(store);
  return app;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-03-01T12:00:00.000Z"));
});
afterEach(() => vi.useRealTimers());

describe("columnEnteredAt in the store", () => {
  it("is set on a new task", async () => {
    const app = await boot();
    const task = app.createTask({ title: "New" });
    await app.saveNewTask(task);
    expect(app.tasks.find((t) => t.id === task.id)!.columnEnteredAt).toBe("2026-03-01T12:00:00.000Z");
  });

  it("is stamped by a move and left alone by an edit in place", async () => {
    const app = await boot();
    const t2 = app.tasks.find((t) => t.id === "t2")!;
    await app.updateTask({ ...t2, title: "Renamed" });
    expect(app.tasks.find((t) => t.id === "t2")!.columnEnteredAt).toBe(OLD);

    const other = app.activeBoardColumns.find((c) => c.id !== app.taskBoardColumnId(t2))!;
    await app.moveTaskToBoardColumn(app.tasks.find((t) => t.id === "t2")!, other.id, 5);
    expect(app.tasks.find((t) => t.id === "t2")!.columnEnteredAt).toBe("2026-03-01T12:00:00.000Z");
  });

  it("is stamped by a bulk move and restored by its Undo", async () => {
    const app = await boot();
    const t2 = app.tasks.find((t) => t.id === "t2")!;
    const other = app.activeBoardColumns.find((c) => c.id !== app.taskBoardColumnId(t2))!;
    await app.bulkUpdateTasks(["t1", "t2"], { kind: "column", columnId: other.id });
    expect(app.tasks.find((t) => t.id === "t1")!.columnEnteredAt).toBe("2026-03-01T12:00:00.000Z");
    expect(app.tasks.find((t) => t.id === "t2")!.columnEnteredAt).toBe("2026-03-01T12:00:00.000Z");

    const undo = app.toasts.at(-1)?.undo;
    expect(undo).toBeTypeOf("function");
    await undo!();
    expect(app.tasks.find((t) => t.id === "t1")!.columnEnteredAt).toBeUndefined();
    expect(app.tasks.find((t) => t.id === "t2")!.columnEnteredAt).toBe(OLD);
  });
});
