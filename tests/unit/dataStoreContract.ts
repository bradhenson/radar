// Shared DataStore contract suite (plan section 8.6/8.10). Every DataStore
// implementation must pass these cases; desktop/store_test.go mirrors them
// for the Go SQLite store. Assertions use JSON round-trip equality — not
// structuredClone identity — so a JSON-transport backend (WailsDataStore)
// satisfies the same contract as the in-memory and IndexedDB stores.

import { describe, expect, it } from "vitest";
import { COLLECTION_NAMES, deleteOp, putOp, type DataStore } from "../../src/data/DataStore";
import { DEFAULT_SETTINGS, type AppSettings } from "../../src/domain/models";
import type { Task } from "../../src/domain/models";

export function makeContractTask(id: string, title = `Task ${id}`): Task {
  return {
    id,
    title,
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

/** JSON round-trip: normalizes away undefined-valued keys and class-ness. */
function j<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function describeDataStoreContract(label: string, makeStore: () => Promise<DataStore> | DataStore): void {
  async function freshStore(): Promise<DataStore> {
    const store = await makeStore();
    await store.initialize();
    return store;
  }

  describe(`DataStore contract: ${label}`, () => {
    it("returns undefined settings until saved, then round-trips them", async () => {
      const store = await freshStore();
      expect(await store.getSettings()).toBeUndefined();
      const settings: AppSettings = { ...DEFAULT_SETTINGS, theme: "dark" };
      await store.saveSettings(settings);
      expect(j(await store.getSettings())).toEqual(j(settings));
    });

    it("always exposes store meta with a database id", async () => {
      const store = await freshStore();
      const meta = await store.getMeta();
      expect(meta.databaseId).toBeTruthy();
      expect(meta.changesSinceBackup).toBe(0);
      await store.saveMeta({ ...meta, changesSinceBackup: 4, lastBackupAt: "2026-01-02T00:00:00.000Z" });
      const updated = await store.getMeta();
      expect(updated.changesSinceBackup).toBe(4);
      expect(updated.lastBackupAt).toBe("2026-01-02T00:00:00.000Z");
      expect(updated.databaseId).toBe(meta.databaseId);
    });

    it("round-trips put/getAll, upserts by id, and deletes", async () => {
      const store = await freshStore();
      await store.put("tasks", makeContractTask("t1"));
      await store.put("tasks", makeContractTask("t2"));
      expect((await store.getAll("tasks")).map((t) => t.id).sort()).toEqual(["t1", "t2"]);

      await store.put("tasks", makeContractTask("t1", "Renamed"));
      const tasks = await store.getAll("tasks");
      expect(tasks).toHaveLength(2);
      expect(tasks.find((t) => t.id === "t1")?.title).toBe("Renamed");

      await store.delete("tasks", "t1");
      expect((await store.getAll("tasks")).map((t) => t.id)).toEqual(["t2"]);
      // Deleting an absent id is a no-op, not an error.
      await expect(store.delete("tasks", "missing")).resolves.toBeUndefined();
    });

    it("bulkPut stores every record", async () => {
      const store = await freshStore();
      await store.bulkPut("tasks", [makeContractTask("a"), makeContractTask("b"), makeContractTask("c")]);
      expect((await store.getAll("tasks")).map((t) => t.id).sort()).toEqual(["a", "b", "c"]);
      await expect(store.bulkPut("tasks", [])).resolves.toBeUndefined();
    });

    it("applies mutate batches atomically and is a no-op when empty", async () => {
      const store = await freshStore();
      await store.put("tasks", makeContractTask("t1"));
      const meta = { ...(await store.getMeta()), changesSinceBackup: 7 };
      await store.mutate([putOp("tasks", makeContractTask("t2")), deleteOp("tasks", "t1"), { kind: "saveMeta", meta }]);
      expect((await store.getAll("tasks")).map((t) => t.id)).toEqual(["t2"]);
      expect((await store.getMeta()).changesSinceBackup).toBe(7);
      await expect(store.mutate([])).resolves.toBeUndefined();
    });

    it("exports a full snapshot with every collection and default settings", async () => {
      const store = await freshStore();
      await store.put("tasks", makeContractTask("t1"));
      const snapshot = await store.exportSnapshot();
      expect(Object.keys(snapshot.collections).sort()).toEqual([...COLLECTION_NAMES].sort());
      expect(snapshot.collections.tasks.map((t) => t.id)).toEqual(["t1"]);
      expect(snapshot.collections.employees).toEqual([]);
      expect(j(snapshot.settings)).toEqual(j(DEFAULT_SETTINGS));
      expect(snapshot.meta.databaseId).toBeTruthy();
    });

    it("replaceAll swaps in a snapshot wholesale", async () => {
      const store = await freshStore();
      await store.put("tasks", makeContractTask("old"));
      const snapshot = await store.exportSnapshot();
      snapshot.collections.tasks = [makeContractTask("new1"), makeContractTask("new2")];
      snapshot.settings = { ...DEFAULT_SETTINGS, theme: "dark" };
      snapshot.meta = { databaseId: "replaced-db", changesSinceBackup: 0 };
      await store.replaceAll(j(snapshot));
      expect((await store.getAll("tasks")).map((t) => t.id).sort()).toEqual(["new1", "new2"]);
      expect((await store.getSettings())?.theme).toBe("dark");
      expect((await store.getMeta()).databaseId).toBe("replaced-db");
    });

    it("clearAll wipes everything and starts a new database lineage", async () => {
      const store = await freshStore();
      await store.put("tasks", makeContractTask("t1"));
      await store.saveSettings({ ...DEFAULT_SETTINGS, theme: "dark" });
      const before = await store.getMeta();
      await store.clearAll();
      expect(await store.getAll("tasks")).toEqual([]);
      expect(await store.getSettings()).toBeUndefined();
      const after = await store.getMeta();
      expect(after.changesSinceBackup).toBe(0);
      expect(after.databaseId).toBeTruthy();
      expect(after.databaseId).not.toBe(before.databaseId);
    });
  });
}
