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

const DB_NAME = "supervisor-assistant";
const DB_VERSION = 5; // v5: employeeNotes object store
const META_STORE = "app_meta"; // holds settings + store metadata by key

export class IndexedDbDataStore implements DataStore {
  readonly kind = "indexeddb" as const;
  private db: IDBDatabase | null = null;

  static isSupported(): boolean {
    return typeof indexedDB !== "undefined";
  }

  async initialize(): Promise<void> {
    this.db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        // Migration framework: switch on oldVersion as versions are added.
        // Retired stores stay in the list so an older copy of the app opening a
        // freshly created database still finds every store it expects.
        const RETIRED_STORES = ["taskCategories"];
        for (const name of [...COLLECTION_NAMES, ...RETIRED_STORES]) {
          if (!db.objectStoreNames.contains(name)) {
            db.createObjectStore(name, { keyPath: "id" });
          }
        }
        if (!db.objectStoreNames.contains(META_STORE)) {
          db.createObjectStore(META_STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
      req.onblocked = () => reject(new Error("IndexedDB open blocked by another tab"));
    });
    // Ensure meta exists so databaseId is stable from first run.
    const meta = await this.readMeta();
    if (!meta) {
      await this.saveMeta({ databaseId: newId(), changesSinceBackup: 0 });
    }
  }

  private requireDb(): IDBDatabase {
    if (!this.db) throw new Error("DataStore not initialized");
    return this.db;
  }

  private tx(storeNames: string | string[], mode: IDBTransactionMode): IDBTransaction {
    return this.requireDb().transaction(storeNames, mode);
  }

  private request<T>(req: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed"));
    });
  }

  private done(tx: IDBTransaction): Promise<void> {
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("Transaction failed"));
      tx.onabort = () => reject(tx.error ?? new Error("Transaction aborted"));
    });
  }

  async getAll<K extends CollectionName>(name: K): Promise<CollectionTypes[K][]> {
    const tx = this.tx(name, "readonly");
    return this.request(tx.objectStore(name).getAll() as IDBRequest<CollectionTypes[K][]>);
  }

  async put<K extends CollectionName>(name: K, record: CollectionTypes[K]): Promise<void> {
    const tx = this.tx(name, "readwrite");
    tx.objectStore(name).put(record);
    await this.done(tx);
  }

  async bulkPut<K extends CollectionName>(name: K, records: CollectionTypes[K][]): Promise<void> {
    if (records.length === 0) return;
    const tx = this.tx(name, "readwrite");
    const store = tx.objectStore(name);
    for (const r of records) store.put(r);
    await this.done(tx);
  }

  async delete(name: CollectionName, id: string): Promise<void> {
    const tx = this.tx(name, "readwrite");
    tx.objectStore(name).delete(id);
    await this.done(tx);
  }

  async getSettings(): Promise<AppSettings | undefined> {
    const tx = this.tx(META_STORE, "readonly");
    return this.request(tx.objectStore(META_STORE).get("settings") as IDBRequest<AppSettings | undefined>);
  }

  async saveSettings(settings: AppSettings): Promise<void> {
    const tx = this.tx(META_STORE, "readwrite");
    tx.objectStore(META_STORE).put(settings, "settings");
    await this.done(tx);
  }

  private async readMeta(): Promise<StoreMeta | undefined> {
    const tx = this.tx(META_STORE, "readonly");
    return this.request(tx.objectStore(META_STORE).get("meta") as IDBRequest<StoreMeta | undefined>);
  }

  async getMeta(): Promise<StoreMeta> {
    return (await this.readMeta()) ?? { databaseId: newId(), changesSinceBackup: 0 };
  }

  async saveMeta(meta: StoreMeta): Promise<void> {
    const tx = this.tx(META_STORE, "readwrite");
    tx.objectStore(META_STORE).put(meta, "meta");
    await this.done(tx);
  }

  async exportSnapshot(): Promise<DatabaseSnapshot> {
    const collections = emptyCollections();
    for (const name of COLLECTION_NAMES) {
      (collections[name] as unknown[]) = await this.getAll(name);
    }
    return {
      collections,
      settings: (await this.getSettings()) ?? DEFAULT_SETTINGS,
      meta: await this.getMeta()
    };
  }

  async replaceAll(snapshot: DatabaseSnapshot): Promise<void> {
    // Single transaction across all stores so a failed import cannot leave
    // half-replaced data (plan section 33.3).
    const tx = this.tx([...COLLECTION_NAMES, META_STORE], "readwrite");
    for (const name of COLLECTION_NAMES) {
      const store = tx.objectStore(name);
      store.clear();
      for (const record of snapshot.collections[name]) store.put(record);
    }
    const meta = tx.objectStore(META_STORE);
    meta.put(snapshot.settings, "settings");
    meta.put(snapshot.meta, "meta");
    await this.done(tx);
  }

  async clearAll(): Promise<void> {
    const tx = this.tx([...COLLECTION_NAMES, META_STORE], "readwrite");
    for (const name of COLLECTION_NAMES) tx.objectStore(name).clear();
    tx.objectStore(META_STORE).clear();
    await this.done(tx);
    await this.saveMeta({ databaseId: newId(), changesSinceBackup: 0 });
  }
}
