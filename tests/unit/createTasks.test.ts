// app.createTasks: several tasks in one batch (meeting action items), one Undo.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppStore } from "../../src/stores/app.svelte";
import { InMemoryDataStore } from "../../src/data/InMemoryDataStore";
import { emptyCollections } from "../../src/data/DataStore";
import { DEFAULT_SETTINGS } from "../../src/domain/models";

async function boot(): Promise<{ app: AppStore; store: InMemoryDataStore }> {
  const store = new InMemoryDataStore();
  await store.initialize();
  await store.replaceAll({ collections: emptyCollections(), settings: { ...DEFAULT_SETTINGS }, meta: { databaseId: "db", changesSinceBackup: 0 } });
  const app = new AppStore();
  await app.initializeFrom(store);
  return { app, store };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("createTasks", () => {
  it("creates every task with its own activity entry, in order at the bottom of the column", async () => {
    const { app, store } = await boot();
    const created = await app.createTasks(
      [{ title: "First", projectId: "p1" }, { title: "Second", employeeId: "e1", dueDate: "2026-12-01" }, { title: "Third" }],
      (t) => `Created task "${t.title}" from meeting`
    );
    expect(created.map((t) => t.title)).toEqual(["First", "Second", "Third"]);
    const orders = created.map((t) => t.boardOrder);
    expect([...orders].sort((a, b) => a - b)).toEqual(orders);
    expect(new Set(orders).size).toBe(3);
    expect(await store.getAll("tasks")).toHaveLength(3);
    expect((await store.getAll("activityEntries")).filter((a) => a.actionType === "created")).toHaveLength(3);
    expect(app.meta.changesSinceBackup).toBe(1);
  });

  it("removes exactly the created tasks on Undo", async () => {
    const { app, store } = await boot();
    const keep = app.createTask({ title: "Already here" });
    await app.saveNewTask(keep);
    await app.createTasks([{ title: "A" }, { title: "B" }], (t) => `Created "${t.title}"`);
    expect(app.tasks).toHaveLength(3);
    await app.toasts.at(-1)!.undo!();
    expect(app.tasks.map((t) => t.title)).toEqual(["Already here"]);
    expect((await store.getAll("tasks")).map((t) => t.title)).toEqual(["Already here"]);
  });

  it("does nothing for an empty list", async () => {
    const { app } = await boot();
    expect(await app.createTasks([], () => "")).toEqual([]);
    expect(app.toasts).toHaveLength(0);
  });
});
