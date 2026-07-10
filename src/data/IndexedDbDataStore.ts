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
  type MutationOp,
  type StoreMeta
} from "./DataStore";

const DB_NAME = "supervisor-assistant";
const DB_VERSION = 6; // v6: travelRecords object store
const META_STORE = "app_meta"; // holds settings + store metadata by key

// Single-writer lease (plan: one editing window at a time). The active window
// heartbeats its lease; a second window refuses to write unless the lease is
// stale or the user explicitly takes over.
const WRITER_LEASE_KEY = "writerLease";
const WRITER_SESSION_STORAGE_KEY = "radar.writerSessionId";
const LEASE_TTL_MS = 15_000;
const LEASE_HEARTBEAT_MS = 5_000;

interface WriterLease {
  sessionId: string;
  heartbeatAt: number; // ms epoch
}

/**
 * A reload is still the same editing window. Keep its lease identity in
 * sessionStorage (which is scoped to one tab) so a normal reload does not
 * mistake its own fresh lease for a competing writer. Storage can be blocked
 * for some file:// environments, so a random in-memory fallback is safe.
 */
function writerSessionId(): string {
  if (typeof sessionStorage === "undefined") return newId();
  try {
    const existing = sessionStorage.getItem(WRITER_SESSION_STORAGE_KEY);
    if (existing) return existing;
    const id = newId();
    sessionStorage.setItem(WRITER_SESSION_STORAGE_KEY, id);
    return id;
  } catch {
    return newId();
  }
}

/** The database is open in another window at an older version; the upgrade cannot proceed. */
export class StorageBlockedError extends Error {
  constructor() {
    super("Another RADAR window is holding an older version of the database open.");
    this.name = "StorageBlockedError";
  }
}

/** Another window currently holds the writer lease. */
export class StorageLockedError extends Error {
  constructor() {
    super("RADAR is already open in another window, which is the active editing window.");
    this.name = "StorageLockedError";
  }
}

export type ConnectionLossReason = "versionchange" | "lease_lost";

export interface IndexedDbDataStoreOptions {
  /** Called once when this connection must stop writing (upgrade elsewhere, lease taken over). */
  onConnectionLost?: (reason: ConnectionLossReason) => void;
  /** Claim the writer lease even if another window holds a fresh one (user-confirmed takeover). */
  forceWriterLease?: boolean;
}

export class IndexedDbDataStore implements DataStore {
  readonly kind = "indexeddb" as const;
  private db: IDBDatabase | null = null;
  private readonly options: IndexedDbDataStoreOptions;
  private readonly writerSessionId = writerSessionId();
  private heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  private connectionLost = false;
  private pagehideHandler: (() => void) | undefined;

  constructor(options: IndexedDbDataStoreOptions = {}) {
    this.options = options;
  }

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
      req.onblocked = () => reject(new StorageBlockedError());
    });
    // If another window later upgrades (or deletes) the database, this
    // connection must close — holding it open would block that window forever,
    // and writing through it could corrupt the upgraded data.
    this.db.onversionchange = () => {
      this.db?.close();
      this.db = null;
      this.markConnectionLost("versionchange");
    };

    // Ensure meta exists so databaseId is stable from first run.
    const meta = await this.readMeta();
    if (!meta) {
      await this.saveMeta({ databaseId: newId(), changesSinceBackup: 0 });
    }

    await this.acquireWriterLease();
    if (typeof window !== "undefined") {
      // The following document instance is about to go away. A reload keeps
      // the same session ID above; stopping this heartbeat avoids a stale
      // page racing the newly loaded one while it starts.
      this.pagehideHandler = () => this.stopHeartbeat();
      window.addEventListener("pagehide", this.pagehideHandler);
    }
  }

  /** Stop heartbeating and release resources (used by tests and takeover flows). */
  close(): void {
    this.stopHeartbeat();
    if (this.pagehideHandler && typeof window !== "undefined") {
      window.removeEventListener("pagehide", this.pagehideHandler);
      this.pagehideHandler = undefined;
    }
    this.db?.close();
    this.db = null;
  }

  private markConnectionLost(reason: ConnectionLossReason): void {
    if (this.connectionLost) return;
    this.connectionLost = true;
    this.stopHeartbeat();
    this.options.onConnectionLost?.(reason);
  }

  /**
   * Read and conditionally replace the lease inside one read/write
   * transaction. Keeping the decision and write together is essential: two
   * tabs that start at the same time must not both observe an empty lease and
   * each declare themselves the writer.
   */
  private async claimWriterLease(force = false): Promise<boolean> {
    const tx = this.tx(META_STORE, "readwrite");
    const store = tx.objectStore(META_STORE);
    const existing = await this.request(store.get(WRITER_LEASE_KEY) as IDBRequest<WriterLease | undefined>);
    const fresh = existing && Date.now() - existing.heartbeatAt < LEASE_TTL_MS;
    if (fresh && existing.sessionId !== this.writerSessionId && !force) {
      // Let the transaction complete without a write before refusing the
      // connection. (Calling abort here turns a normal contention case into
      // an IndexedDB error.)
      await this.done(tx);
      return false;
    }
    store.put({ sessionId: this.writerSessionId, heartbeatAt: Date.now() } satisfies WriterLease, WRITER_LEASE_KEY);
    await this.done(tx);
    return true;
  }

  private async acquireWriterLease(): Promise<void> {
    if (!(await this.claimWriterLease(this.options.forceWriterLease))) {
      // Close so we don't block the active window's future upgrades.
      this.db?.close();
      this.db = null;
      throw new StorageLockedError();
    }
    this.heartbeatTimer = setInterval(() => void this.heartbeat(), LEASE_HEARTBEAT_MS);
  }

  private async heartbeat(): Promise<void> {
    if (this.connectionLost || !this.db) return;
    try {
      if (!(await this.claimWriterLease())) {
        // Another window took over (user-confirmed): stop writing here.
        this.markConnectionLost("lease_lost");
      }
    } catch {
      // Transient failure; the next heartbeat retries.
    }
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer !== undefined) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = undefined;
  }

  private requireDb(): IDBDatabase {
    if (this.connectionLost) {
      throw new Error("Storage connection lost (database in use by another RADAR window). Reload to continue.");
    }
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

  async mutate(ops: MutationOp[]): Promise<void> {
    if (ops.length === 0) return;
    // One transaction across every store the batch touches: all ops commit
    // together or the whole batch rolls back (same guarantee as replaceAll).
    const storeNames = new Set<string>();
    for (const op of ops) {
      storeNames.add(op.kind === "put" || op.kind === "delete" ? op.collection : META_STORE);
    }
    const tx = this.tx([...storeNames], "readwrite");
    for (const op of ops) {
      switch (op.kind) {
        case "put":
          tx.objectStore(op.collection).put(op.record);
          break;
        case "delete":
          tx.objectStore(op.collection).delete(op.id);
          break;
        case "saveSettings":
          tx.objectStore(META_STORE).put(op.settings, "settings");
          break;
        case "saveMeta":
          tx.objectStore(META_STORE).put(op.meta, "meta");
          break;
      }
    }
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
    // All reads share one readonly transaction so an export cannot contain a
    // parent record from one instant and children from a later edit.
    const collections = emptyCollections();
    const tx = this.tx([...COLLECTION_NAMES, META_STORE], "readonly");
    const reads = COLLECTION_NAMES.map(async (name) => {
      const records = await this.request(tx.objectStore(name).getAll() as IDBRequest<CollectionTypes[typeof name][]>);
      (collections[name] as unknown[]) = records;
    });
    const settingsRequest = this.request(tx.objectStore(META_STORE).get("settings") as IDBRequest<AppSettings | undefined>);
    const metaRequest = this.request(tx.objectStore(META_STORE).get("meta") as IDBRequest<StoreMeta | undefined>);
    await Promise.all([...reads, settingsRequest, metaRequest]);
    await this.done(tx);
    return {
      collections,
      settings: (await settingsRequest) ?? DEFAULT_SETTINGS,
      meta: (await metaRequest) ?? { databaseId: newId(), changesSinceBackup: 0 }
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
