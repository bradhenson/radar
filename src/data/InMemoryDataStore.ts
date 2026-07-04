import type { AppSettings } from "../domain/models";
import { DEFAULT_SETTINGS } from "../domain/models";
import { newId } from "../utils/ids";
import {
  COLLECTION_NAMES,
  emptyCollections,
  type CollectionName,
  type CollectionTypes,
  type DataStore,
  type DatabaseSnapshot,
  type StoreMeta
} from "./DataStore";

/**
 * Non-persistent store. Used for tests and as a runtime fallback when
 * IndexedDB is blocked (the UI warns that data will not survive the session
 * and that export/import is the only persistence path — plan section 9.5,
 * outcome C).
 */
export class InMemoryDataStore implements DataStore {
  readonly kind = "memory" as const;
  private collections = emptyCollections();
  private settings: AppSettings | undefined;
  private meta: StoreMeta = { databaseId: newId(), changesSinceBackup: 0 };

  async initialize(): Promise<void> {
    // Nothing to open.
  }

  async getAll<K extends CollectionName>(name: K): Promise<CollectionTypes[K][]> {
    return [...this.collections[name]] as CollectionTypes[K][];
  }

  async put<K extends CollectionName>(name: K, record: CollectionTypes[K]): Promise<void> {
    const list = this.collections[name] as CollectionTypes[K][];
    const idx = list.findIndex((r) => r.id === record.id);
    const copy = structuredClone(record);
    if (idx >= 0) list[idx] = copy;
    else list.push(copy);
  }

  async bulkPut<K extends CollectionName>(name: K, records: CollectionTypes[K][]): Promise<void> {
    for (const r of records) await this.put(name, r);
  }

  async delete(name: CollectionName, id: string): Promise<void> {
    const list = this.collections[name] as { id: string }[];
    const idx = list.findIndex((r) => r.id === id);
    if (idx >= 0) list.splice(idx, 1);
  }

  async getSettings(): Promise<AppSettings | undefined> {
    return this.settings ? structuredClone(this.settings) : undefined;
  }

  async saveSettings(settings: AppSettings): Promise<void> {
    this.settings = structuredClone(settings);
  }

  async getMeta(): Promise<StoreMeta> {
    return structuredClone(this.meta);
  }

  async saveMeta(meta: StoreMeta): Promise<void> {
    this.meta = structuredClone(meta);
  }

  async exportSnapshot(): Promise<DatabaseSnapshot> {
    return structuredClone({
      collections: this.collections,
      settings: this.settings ?? DEFAULT_SETTINGS,
      meta: this.meta
    });
  }

  async replaceAll(snapshot: DatabaseSnapshot): Promise<void> {
    this.collections = structuredClone(snapshot.collections);
    this.settings = structuredClone(snapshot.settings);
    this.meta = structuredClone(snapshot.meta);
  }

  async clearAll(): Promise<void> {
    this.collections = emptyCollections();
    this.settings = undefined;
    this.meta = { databaseId: newId(), changesSinceBackup: 0 };
    void COLLECTION_NAMES; // keep import for parity with IndexedDB store
  }
}
