import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyCollections, type DatabaseSnapshot } from "../../src/data/DataStore";
import { InMemoryDataStore } from "../../src/data/InMemoryDataStore";
import { DEFAULT_BOARD_COLUMN_SEEDS, DEFAULT_SETTINGS, type BoardColumnDefinition, type Task } from "../../src/domain/models";
import { AppStore } from "../../src/stores/app.svelte";

const NOW = "2026-08-01T12:00:00.000Z";
const TODAY = "2026-08-05";

function column(seed: (typeof DEFAULT_BOARD_COLUMN_SEEDS)[number]): BoardColumnDefinition {
  return { ...seed, createdAt: NOW, updatedAt: NOW };
}

function task(partial: Partial<Task> = {}): Task {
  return {
    id: "task-1",
    title: "Prepare decision brief",
    status: "waiting",
    boardColumnId: "complete",
    priority: "normal",
    waitingSince: NOW,
    performanceInputCreated: false,
    tags: [],
    boardOrder: 10,
    createdAt: NOW,
    updatedAt: NOW,
    isArchived: false,
    ...partial
  };
}

function snapshot(columns = DEFAULT_BOARD_COLUMN_SEEDS.map(column)): DatabaseSnapshot {
  const collections = emptyCollections();
  collections.boardColumns = columns;
  collections.tasks = [task()];
  return {
    collections,
    settings: { ...DEFAULT_SETTINGS },
    meta: { databaseId: "task-done-test", changesSinceBackup: 0 }
  };
}

async function boot(initial = snapshot()): Promise<{ app: AppStore; store: InMemoryDataStore }> {
  const store = new InMemoryDataStore();
  await store.initialize();
  await store.replaceAll(initial);
  const app = new AppStore();
  await app.initializeFrom(store);
  app.today = TODAY;
  return { app, store };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("task Done workflow", () => {
  it("marks the task complete and archives it without moving its board column", async () => {
    const { app, store } = await boot();

    const updated = await app.markTaskDone(app.tasks[0]!);

    expect(updated).toMatchObject({
      status: "complete",
      completedDate: TODAY,
      waitingSince: undefined,
      boardColumnId: "complete",
      isArchived: true
    });
    expect(app.tasks[0]).toMatchObject(updated);
    expect((await store.exportSnapshot()).collections.tasks[0]).toMatchObject(updated);
    expect(app.activityEntries.at(-1)).toMatchObject({
      entityType: "tasks",
      entityId: "task-1",
      actionType: "completed",
      summary: "Marked \"Prepare decision brief\" done and archived it"
    });
    expect(app.meta.changesSinceBackup).toBe(1);
  });

  it("Undo restores the exact active state and original column", async () => {
    const { app } = await boot();
    await app.markTaskDone(app.tasks[0]!);

    const toast = app.toasts.at(-1);
    expect(toast?.message).toBe('Moved "Prepare decision brief" to Archive');
    expect(toast?.undo).toBeTypeOf("function");
    await toast!.undo!();

    expect(app.tasks[0]).toMatchObject({
      status: "waiting",
      waitingSince: NOW,
      boardColumnId: "complete",
      isArchived: false
    });
    expect(app.tasks[0]?.completedDate).toBeUndefined();
    expect(app.activityEntries.at(-1)?.actionType).toBe("reopened");
  });

  it("retires completion mappings from built-in and custom columns on load", async () => {
    const completeMapped: BoardColumnDefinition[] = [
      { ...column(DEFAULT_BOARD_COLUMN_SEEDS[3]!), mapsToStatus: "complete" },
      { id: "reviewed", label: "Reviewed", sortOrder: 50, mapsToStatus: "complete", createdAt: NOW, updatedAt: NOW }
    ];
    const { app, store } = await boot(snapshot(completeMapped));

    expect(app.boardColumns.find((item) => item.id === "complete")?.mapsToStatus).toBeUndefined();
    expect(app.boardColumns.find((item) => item.id === "reviewed")?.mapsToStatus).toBeUndefined();
    const persisted = (await store.exportSnapshot()).collections.boardColumns;
    expect(persisted.filter((item) => ["complete", "reviewed"].includes(item.id)).every((item) => item.mapsToStatus === undefined)).toBe(true);
  });
});
