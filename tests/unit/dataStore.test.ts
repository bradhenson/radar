import { describe, expect, it } from "vitest";
import { InMemoryDataStore, type MutationDraft } from "../../src/data/InMemoryDataStore";
import { deleteOp, putOp, type MutationOp } from "../../src/data/DataStore";
import type { Task } from "../../src/domain/models";

function makeTask(id: string): Task {
  return {
    id,
    title: `Task ${id}`,
    status: "open",
    priority: "normal",
    performanceInputCreated: false,
    tags: [],
    boardOrder: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    isArchived: false
  };
}

/** Fails while applying any record whose id is "poison" — mid-batch failure. */
class PoisonedStore extends InMemoryDataStore {
  protected override applyToDraft(draft: MutationDraft, op: MutationOp): void {
    if (op.kind === "put" && op.record.id === "poison") throw new Error("poisoned record");
    super.applyToDraft(draft, op);
  }
}

describe("DataStore.mutate", () => {
  it("applies puts, deletes, and meta updates in one batch", async () => {
    const store = new InMemoryDataStore();
    await store.initialize();
    await store.put("tasks", makeTask("t1"));

    const meta = { ...(await store.getMeta()), changesSinceBackup: 7 };
    await store.mutate([
      putOp("tasks", makeTask("t2")),
      deleteOp("tasks", "t1"),
      { kind: "saveMeta", meta }
    ]);

    const tasks = await store.getAll("tasks");
    expect(tasks.map((t) => t.id)).toEqual(["t2"]);
    expect((await store.getMeta()).changesSinceBackup).toBe(7);
  });

  it("rolls back the entire batch when any op fails (failure injection)", async () => {
    const store = new PoisonedStore();
    await store.initialize();
    await store.put("tasks", makeTask("t1"));
    const metaBefore = await store.getMeta();

    const ops: MutationOp[] = [
      putOp("tasks", makeTask("t2")), // would succeed alone
      deleteOp("tasks", "t1"), // would succeed alone
      putOp("tasks", makeTask("poison")), // fails mid-batch
      { kind: "saveMeta", meta: { ...metaBefore, changesSinceBackup: 99 } }
    ];
    await expect(store.mutate(ops)).rejects.toThrow("poisoned record");

    // Nothing applied: t1 still present, t2 absent, meta untouched.
    const tasks = await store.getAll("tasks");
    expect(tasks.map((t) => t.id)).toEqual(["t1"]);
    expect(await store.getMeta()).toEqual(metaBefore);
  });

  it("is a no-op for an empty batch", async () => {
    const store = new InMemoryDataStore();
    await store.initialize();
    await expect(store.mutate([])).resolves.toBeUndefined();
  });
});
