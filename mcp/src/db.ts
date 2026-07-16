// SQLite access for the RADAR MCP server (dev-only tool; see mcp/README.md).
//
// This is a *second writer* to a database the desktop app may have open, so
// every write here follows the same contract as the app's own service layer
// (src/stores/app.svelte.ts putRecord):
//   - the record, its ActivityEntry, and the backup-change counter commit in
//     one transaction, so they can never diverge;
//   - app_meta.external_write_at is stamped in that same transaction, which is
//     how a running desktop window learns to re-read (desktop/dbwatch.go).
//
// Types and helpers are imported from src/ rather than redefined, so this tool
// cannot drift from the app's model.

import { DatabaseSync } from "node:sqlite";
import { COLLECTION_NAMES, type CollectionName, type CollectionTypes, type StoreMeta } from "../../src/data/DataStore";
import { DEFAULT_SETTINGS, normalizeAppSettings, type ActivityEntry, type AppSettings } from "../../src/domain/models";
import { nowTimestamp } from "../../src/utils/dates";
import { newId } from "../../src/utils/ids";

/** Mirrors MUTATING_ACTIVITY in src/stores/app.svelte.ts. */
const MUTATING_ACTIVITY = new Set([
  "created",
  "updated",
  "status_changed",
  "completed",
  "reopened",
  "archived",
  "restored",
  "deleted"
]);

/** Must match externalWriteKey in desktop/dbwatch.go. */
const EXTERNAL_WRITE_KEY = "external_write_at";

export interface ActivityInput {
  actionType: string;
  summary: string;
  entityType?: string;
}

export class RadarDb {
  private db: DatabaseSync;
  /** One id per server process, matching the app's per-session id. */
  private readonly sessionId = newId();

  constructor(dbPath: string) {
    this.db = new DatabaseSync(dbPath);
    try {
      // Match desktop/store.go: DELETE journal keeps radar.db self-contained,
      // and a busy timeout lets writes wait out the desktop app instead of
      // failing instantly when both processes commit at once.
      this.db.exec("PRAGMA journal_mode=DELETE");
      this.db.exec("PRAGMA busy_timeout=5000");
      this.assertRadarDatabase(dbPath);
    } catch (e) {
      // Never leave the file handle open on a rejected database: on Windows
      // that keeps the file locked for the rest of the process.
      this.db.close();
      throw e;
    }
  }

  /** Refuse to touch a file that is not a RADAR database (store.go does the same). */
  private assertRadarDatabase(dbPath: string): void {
    let version: string | undefined;
    try {
      const row = this.db.prepare("SELECT value FROM app_meta WHERE key = 'schema_version'").get() as
        | { value?: string }
        | undefined;
      version = row?.value;
    } catch {
      throw new Error(`${dbPath} is not a RADAR database (no app_meta table).`);
    }
    if (version !== "1") {
      throw new Error(`${dbPath} has unsupported RADAR schema version ${version ?? "(none)"}.`);
    }
  }

  close(): void {
    this.db.close();
  }

  readAll<K extends CollectionName>(collection: K): CollectionTypes[K][] {
    assertCollection(collection);
    const rows = this.db.prepare(`SELECT data FROM "${collection}" ORDER BY rowid`).all() as { data: string }[];
    return rows.map((row) => JSON.parse(row.data) as CollectionTypes[K]);
  }

  readOne<K extends CollectionName>(collection: K, id: string): CollectionTypes[K] | undefined {
    assertCollection(collection);
    const row = this.db.prepare(`SELECT data FROM "${collection}" WHERE id = ?`).get(id) as
      | { data: string }
      | undefined;
    return row ? (JSON.parse(row.data) as CollectionTypes[K]) : undefined;
  }

  getSettings(): AppSettings {
    const row = this.db.prepare("SELECT value FROM app_meta WHERE key = 'settings'").get() as
      | { value?: string }
      | undefined;
    if (!row?.value) return { ...DEFAULT_SETTINGS };
    return normalizeAppSettings(JSON.parse(row.value) as Partial<AppSettings>);
  }

  getMeta(): StoreMeta {
    const row = this.db.prepare("SELECT value FROM app_meta WHERE key = 'meta'").get() as
      | { value?: string }
      | undefined;
    if (!row?.value) return { databaseId: "", changesSinceBackup: 0 };
    return JSON.parse(row.value) as StoreMeta;
  }

  /**
   * Writes one record plus its activity entry atomically, exactly as the app
   * would, and signals the change to any running desktop window.
   */
  putRecord<K extends CollectionName>(
    collection: K,
    record: CollectionTypes[K],
    activity: ActivityInput
  ): ActivityEntry {
    assertCollection(collection);
    const id = (record as { id?: string }).id;
    if (!id) throw new Error("record has no id");

    const entry: ActivityEntry = {
      id: newId(),
      entityType: activity.entityType ?? collection,
      entityId: id,
      actionType: activity.actionType,
      timestamp: nowTimestamp(),
      summary: activity.summary,
      sessionId: this.sessionId
    };

    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.upsert(collection, id, JSON.stringify(record));
      this.upsert("activityEntries", entry.id, JSON.stringify(entry));
      if (MUTATING_ACTIVITY.has(activity.actionType)) {
        const meta = this.getMeta();
        this.putMetaKey("meta", JSON.stringify({ ...meta, changesSinceBackup: meta.changesSinceBackup + 1 }));
      }
      // Stamp last so it is never observed ahead of the data it announces.
      // Includes a random suffix: two writes inside the same millisecond must
      // still produce a different value for the watcher to notice.
      this.putMetaKey(EXTERNAL_WRITE_KEY, `${nowTimestamp()}#${newId()}`);
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
    return entry;
  }

  private upsert(collection: string, id: string, data: string): void {
    this.db
      .prepare(`INSERT INTO "${collection}"(id, data) VALUES(?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`)
      .run(id, data);
  }

  private putMetaKey(key: string, value: string): void {
    this.db
      .prepare("INSERT INTO app_meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(key, value);
  }
}

/** Table names are interpolated into SQL, so they must come from the allowlist. */
function assertCollection(collection: string): asserts collection is CollectionName {
  if (!(COLLECTION_NAMES as string[]).includes(collection)) {
    throw new Error(`unknown collection: ${collection}`);
  }
}
