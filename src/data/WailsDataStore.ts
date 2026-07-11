// Desktop (Wails) storage adapter, plan section 8.10. Each DataStore call
// crosses the Wails binding boundary as JSON text and is served by the Go
// SQLite store (desktop/store.go). Records round-trip verbatim on the Go
// side (json.RawMessage, never re-marshaled through Go structs), so field
// fidelity matches the backup JSON format exactly.
//
// Domain logic, migrations, identifier generation, and defaults all stay in
// TypeScript; Go is a dumb generic record store. mutate() maps to a single
// SQLite transaction, matching the IndexedDB single-transaction guarantee.
//
// This store never reports a storageFault: writer leases and version-change
// races are multi-window browser concerns, and the desktop shell enforces a
// single instance. Failures reject and surface through initError/saveStatus.

import type { AppSettings } from "../domain/models";
import { DEFAULT_SETTINGS } from "../domain/models";
import { newId } from "../utils/ids";
import type {
  CollectionName,
  CollectionTypes,
  DataStore,
  DatabaseSnapshot,
  MutationOp,
  StoreMeta
} from "./DataStore";
import { emptyCollections } from "./DataStore";
import type { StoreBindings } from "./wailsBridge";
import { wailsStoreBindings } from "./wailsBridge";

/** Snapshot as serialized by the Go side: settings/meta are null when unset. */
interface RawSnapshot {
  collections: Partial<DatabaseSnapshot["collections"]>;
  settings: AppSettings | null;
  meta: StoreMeta | null;
}

export class WailsDataStore implements DataStore {
  readonly kind = "sqlite" as const;
  private readonly bindings: StoreBindings;

  constructor(bindings: StoreBindings) {
    this.bindings = bindings;
  }

  static isAvailable(): boolean {
    return wailsStoreBindings() !== undefined;
  }

  async initialize(): Promise<void> {
    // The Go shell opens the database and runs DDL before the window loads;
    // here we only bootstrap store metadata on first run. Identifier
    // generation stays in TypeScript (plan section 8.9).
    const metaJson = await this.bindings.GetMeta();
    if (metaJson === "") {
      await this.bindings.SaveMeta(JSON.stringify(this.freshMeta()));
    }
  }

  async getAll<K extends CollectionName>(name: K): Promise<CollectionTypes[K][]> {
    return JSON.parse(await this.bindings.GetAll(name)) as CollectionTypes[K][];
  }

  async put<K extends CollectionName>(name: K, record: CollectionTypes[K]): Promise<void> {
    await this.bindings.Put(name, JSON.stringify(record));
  }

  async bulkPut<K extends CollectionName>(name: K, records: CollectionTypes[K][]): Promise<void> {
    if (records.length === 0) return;
    await this.bindings.BulkPut(name, JSON.stringify(records));
  }

  async delete(name: CollectionName, id: string): Promise<void> {
    await this.bindings.Delete(name, id);
  }

  async mutate(ops: MutationOp[]): Promise<void> {
    if (ops.length === 0) return;
    await this.bindings.Mutate(JSON.stringify(ops));
  }

  async getSettings(): Promise<AppSettings | undefined> {
    const json = await this.bindings.GetSettings();
    return json === "" ? undefined : (JSON.parse(json) as AppSettings);
  }

  async saveSettings(settings: AppSettings): Promise<void> {
    await this.bindings.SaveSettings(JSON.stringify(settings));
  }

  async getMeta(): Promise<StoreMeta> {
    const json = await this.bindings.GetMeta();
    if (json === "") {
      // Defensive parity with initialize(): getMeta never returns undefined.
      const meta = this.freshMeta();
      await this.bindings.SaveMeta(JSON.stringify(meta));
      return meta;
    }
    return JSON.parse(json) as StoreMeta;
  }

  async saveMeta(meta: StoreMeta): Promise<void> {
    await this.bindings.SaveMeta(JSON.stringify(meta));
  }

  async exportSnapshot(): Promise<DatabaseSnapshot> {
    const raw = JSON.parse(await this.bindings.ExportSnapshot()) as RawSnapshot;
    return {
      // Merge over the empty shape so every collection key is present even
      // if the Go allowlist ever lags behind COLLECTION_NAMES.
      collections: { ...emptyCollections(), ...raw.collections },
      settings: raw.settings ?? DEFAULT_SETTINGS,
      meta: raw.meta ?? this.freshMeta()
    };
  }

  async replaceAll(snapshot: DatabaseSnapshot): Promise<void> {
    await this.bindings.ReplaceAll(JSON.stringify(snapshot));
  }

  async clearAll(): Promise<void> {
    // One atomic wipe-and-reseed; a fresh databaseId marks the new database
    // lineage, matching InMemoryDataStore/IndexedDbDataStore semantics.
    await this.bindings.ClearAll(JSON.stringify(this.freshMeta()));
  }

  private freshMeta(): StoreMeta {
    return { databaseId: newId(), changesSinceBackup: 0 };
  }
}
