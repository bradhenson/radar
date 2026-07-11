// Runs the shared DataStore contract against the in-memory store and against
// WailsDataStore over fake bindings that mirror the Go SQLite store's
// semantics (JSON-string transport, validate-every-op-then-apply Mutate).
// desktop/store_test.go mirrors the same cases for the real Go side.

import { describe, expect, it } from "vitest";
import { COLLECTION_NAMES, putOp, type MutationOp } from "../../src/data/DataStore";
import { InMemoryDataStore } from "../../src/data/InMemoryDataStore";
import { WailsDataStore } from "../../src/data/WailsDataStore";
import type { StoreBindings } from "../../src/data/wailsBridge";
import { describeDataStoreContract, makeContractTask } from "./dataStoreContract";

/**
 * In-test stand-in for the Go store (desktop/store.go): collections hold raw
 * JSON strings keyed by id; unset settings/meta read back as ""; Mutate
 * validates every op before applying any, then applies to a staged copy and
 * swaps — the same all-or-nothing outcome as the Go transaction.
 */
class FakeStoreBindings implements StoreBindings {
  private collections = new Map<string, Map<string, string>>(COLLECTION_NAMES.map((n) => [n, new Map()]));
  private settings = "";
  private meta = "";

  private table(collection: string): Map<string, string> {
    const table = this.collections.get(collection);
    if (!table) throw new Error(`unknown collection: ${collection}`);
    return table;
  }

  private recordId(recordJson: string): string {
    const id = (JSON.parse(recordJson) as { id?: unknown }).id;
    if (typeof id !== "string" || id === "") throw new Error("record has no id");
    return id;
  }

  async GetAll(collection: string): Promise<string> {
    return `[${[...this.table(collection).values()].join(",")}]`;
  }

  async Put(collection: string, recordJson: string): Promise<void> {
    this.table(collection).set(this.recordId(recordJson), recordJson);
  }

  async BulkPut(collection: string, recordsJson: string): Promise<void> {
    for (const record of JSON.parse(recordsJson) as unknown[]) {
      await this.Put(collection, JSON.stringify(record));
    }
  }

  async Delete(collection: string, id: string): Promise<void> {
    this.table(collection).delete(id);
  }

  async Mutate(opsJson: string): Promise<void> {
    const ops = JSON.parse(opsJson) as MutationOp[];
    // Validate first, exactly like the Go side, so a bad op rejects the
    // whole batch before anything is applied.
    for (const op of ops) {
      if (op.kind === "put") {
        this.table(op.collection);
        this.recordId(JSON.stringify(op.record));
      } else if (op.kind === "delete") {
        this.table(op.collection);
      } else if (op.kind !== "saveSettings" && op.kind !== "saveMeta") {
        throw new Error(`unknown op kind: ${(op as { kind: string }).kind}`);
      }
    }
    const staged = new Map([...this.collections].map(([name, table]) => [name, new Map(table)]));
    let stagedSettings = this.settings;
    let stagedMeta = this.meta;
    for (const op of ops) {
      if (op.kind === "put") {
        const json = JSON.stringify(op.record);
        staged.get(op.collection)!.set(this.recordId(json), json);
      } else if (op.kind === "delete") {
        staged.get(op.collection)!.delete(op.id);
      } else if (op.kind === "saveSettings") {
        stagedSettings = JSON.stringify(op.settings);
      } else {
        stagedMeta = JSON.stringify(op.meta);
      }
    }
    this.collections = staged;
    this.settings = stagedSettings;
    this.meta = stagedMeta;
  }

  async GetSettings(): Promise<string> {
    return this.settings;
  }

  async SaveSettings(settingsJson: string): Promise<void> {
    this.settings = settingsJson;
  }

  async GetMeta(): Promise<string> {
    return this.meta;
  }

  async SaveMeta(metaJson: string): Promise<void> {
    this.meta = metaJson;
  }

  async ExportSnapshot(): Promise<string> {
    const collections: Record<string, unknown[]> = {};
    for (const [name, table] of this.collections) {
      collections[name] = [...table.values()].map((json) => JSON.parse(json) as unknown);
    }
    return JSON.stringify({
      collections,
      settings: this.settings === "" ? null : JSON.parse(this.settings),
      meta: this.meta === "" ? null : JSON.parse(this.meta)
    });
  }

  async ReplaceAll(snapshotJson: string): Promise<void> {
    const snapshot = JSON.parse(snapshotJson) as {
      collections: Record<string, { id: string }[]>;
      settings: unknown;
      meta: unknown;
    };
    for (const [name, table] of this.collections) {
      table.clear();
      for (const record of snapshot.collections[name] ?? []) {
        table.set(record.id, JSON.stringify(record));
      }
    }
    this.settings = snapshot.settings == null ? "" : JSON.stringify(snapshot.settings);
    this.meta = snapshot.meta == null ? "" : JSON.stringify(snapshot.meta);
  }

  async ClearAll(newMetaJson: string): Promise<void> {
    for (const table of this.collections.values()) table.clear();
    this.settings = "";
    this.meta = newMetaJson;
  }

  async GetDatabaseInfo(): Promise<string> {
    return JSON.stringify({ path: "(fake)", sizeBytes: 0, journalMode: "memory" });
  }
}

describeDataStoreContract("InMemoryDataStore", () => new InMemoryDataStore());
describeDataStoreContract("WailsDataStore (fake Go bindings)", () => new WailsDataStore(new FakeStoreBindings()));

describe("WailsDataStore specifics", () => {
  it("bootstraps meta exactly once on initialize", async () => {
    const bindings = new FakeStoreBindings();
    const store = new WailsDataStore(bindings);
    await store.initialize();
    const meta = await store.getMeta();
    expect(meta.databaseId).toBeTruthy();
    // A second initialize must keep the same database lineage.
    await store.initialize();
    expect((await store.getMeta()).databaseId).toBe(meta.databaseId);
  });

  it("rejects the whole mutate batch when any op is invalid", async () => {
    const store = new WailsDataStore(new FakeStoreBindings());
    await store.initialize();
    await store.put("tasks", makeContractTask("t1"));
    const bad = [
      putOp("tasks", makeContractTask("t2")),
      { kind: "put", collection: "notARealCollection", record: makeContractTask("t3") }
    ] as unknown as MutationOp[];
    await expect(store.mutate(bad)).rejects.toThrow(/unknown collection/);
    // Validate-first: nothing from the batch was applied.
    expect((await store.getAll("tasks")).map((t) => t.id)).toEqual(["t1"]);
  });

  it("reports kind sqlite and never a storage fault path", () => {
    const store = new WailsDataStore(new FakeStoreBindings());
    expect(store.kind).toBe("sqlite");
  });
});
