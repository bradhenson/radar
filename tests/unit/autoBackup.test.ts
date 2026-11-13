// Automatic backup rules, and the app store's side of the desktop bridge. The
// shell that writes the file is Go (desktop/autobackup_test.go); here a fake
// bridge stands in for it.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppStore } from "../../src/stores/app.svelte";
import { InMemoryDataStore } from "../../src/data/InMemoryDataStore";
import { emptyCollections, type DatabaseSnapshot } from "../../src/data/DataStore";
import { parseAndValidateBackup } from "../../src/data/backup";
import type { AutoBackupInfo } from "../../src/data/wailsBridge";
import { DEFAULT_SETTINGS, type AppSettings, type Task } from "../../src/domain/models";
import {
  autoBackupDue,
  autoBackupFilename,
  changesAfterBackup,
  clampAutoBackupKeepDays
} from "../../src/domain/rules/autoBackup";

const NOW = "2026-07-01T00:00:00.000Z";
const TODAY = "2026-07-20";

describe("autoBackupFilename", () => {
  it("is one name per database per day, in the shape the desktop shell accepts", () => {
    const name = autoBackupFilename("3f2a9c1e-77aa-4b1d-9c0e-1234567890ab", TODAY);
    expect(name).toBe("RADAR_AutoBackup_3f2a9c1e_2026-07-20.json");
    // Mirrors autoBackupNamePattern in desktop/autobackup.go.
    expect(name).toMatch(/^RADAR_AutoBackup_([A-Za-z0-9]{1,16})_(\d{4}-\d{2}-\d{2})\.json$/);
  });

  it("never lets a database id put path characters into the name", () => {
    expect(autoBackupFilename("..\\..\\evil/../id", TODAY)).toBe("RADAR_AutoBackup_evilid_2026-07-20.json");
    expect(autoBackupFilename("", TODAY)).toBe("RADAR_AutoBackup_db_2026-07-20.json");
    expect(autoBackupFilename("---", TODAY)).toBe("RADAR_AutoBackup_db_2026-07-20.json");
  });
});

describe("clampAutoBackupKeepDays", () => {
  it("keeps the value inside 1 to 365 and falls back to 14 for nonsense", () => {
    expect(clampAutoBackupKeepDays(14)).toBe(14);
    expect(clampAutoBackupKeepDays(0)).toBe(1);
    expect(clampAutoBackupKeepDays(-3)).toBe(1);
    expect(clampAutoBackupKeepDays(9999)).toBe(365);
    expect(clampAutoBackupKeepDays(7.9)).toBe(7);
    expect(clampAutoBackupKeepDays(Number.NaN)).toBe(14);
  });
});

describe("autoBackupDue", () => {
  const state = { enabled: true, hasData: true, changesSinceBackup: 0, existingFiles: 3 };

  it("backs up whenever there are changes not yet in a backup", () => {
    expect(autoBackupDue({ ...state, changesSinceBackup: 1 }, "interval")).toBe(true);
    expect(autoBackupDue({ ...state, changesSinceBackup: 1 }, "startup")).toBe(true);
  });

  it("does nothing when nothing changed and a backup already exists", () => {
    expect(autoBackupDue(state, "interval")).toBe(false);
    expect(autoBackupDue(state, "startup")).toBe(false);
  });

  it("writes a first file at startup when the folder has none, but not on the timer", () => {
    expect(autoBackupDue({ ...state, existingFiles: 0 }, "startup")).toBe(true);
    expect(autoBackupDue({ ...state, existingFiles: 0 }, "interval")).toBe(false);
    // An unknown count is not treated as "empty".
    expect(autoBackupDue({ ...state, existingFiles: undefined }, "startup")).toBe(false);
  });

  it("never backs up when turned off or when the database is empty", () => {
    expect(autoBackupDue({ ...state, enabled: false, changesSinceBackup: 5 }, "startup")).toBe(false);
    expect(autoBackupDue({ ...state, hasData: false, changesSinceBackup: 5, existingFiles: 0 }, "startup")).toBe(false);
  });
});

describe("changesAfterBackup", () => {
  it("keeps counting edits made while the backup was being built", () => {
    expect(changesAfterBackup(5, 5)).toBe(0);
    expect(changesAfterBackup(7, 5)).toBe(2);
    expect(changesAfterBackup(3, 5)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Store behaviour against a fake desktop bridge.

interface FakeBridge {
  files: Map<string, string>;
  writes: { name: string; keep: number }[];
  failWith?: string;
}

function installBridge(): FakeBridge {
  const bridge: FakeBridge = { files: new Map(), writes: [] };
  const info = (created: boolean): string => {
    const names = [...bridge.files.keys()].sort().reverse();
    const value: AutoBackupInfo = {
      folder: "C:\\data\\backups",
      isDefault: true,
      count: names.length,
      latestName: names[0] ?? "",
      latestModified: names.length ? "2026-07-20T15:00:00Z" : "",
      created
    };
    return JSON.stringify(value);
  };
  vi.stubGlobal("window", {
    go: {
      main: {
        App: {
          GetAutoBackupInfo: async () => info(false),
          WriteAutoBackup: async (name: string, content: string, keep: number) => {
            if (bridge.failWith) throw new Error(bridge.failWith);
            const created = !bridge.files.has(name);
            bridge.files.set(name, content);
            bridge.writes.push({ name, keep });
            return info(created);
          }
        }
      }
    }
  });
  return bridge;
}

function task(id: string): Task {
  return {
    id,
    title: `Task ${id}`,
    status: "open",
    priority: "normal",
    performanceInputCreated: false,
    tags: [],
    boardOrder: 1,
    createdAt: NOW,
    updatedAt: NOW,
    isArchived: false
  };
}

async function boot(options: { tasks?: Task[]; changes?: number; settings?: Partial<AppSettings> } = {}) {
  const collections = emptyCollections();
  collections.tasks = options.tasks ?? [task("t1")];
  const snapshot: DatabaseSnapshot = {
    collections,
    settings: { ...DEFAULT_SETTINGS, ...options.settings },
    meta: { databaseId: "3f2a9c1e-77aa", changesSinceBackup: options.changes ?? 4 }
  };
  const store = new InMemoryDataStore();
  await store.initialize();
  await store.replaceAll(snapshot);
  const app = new AppStore();
  await app.initializeFrom(store);
  app.today = TODAY;
  return { app, store };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("runAutoBackup", () => {
  it("does nothing in the browser build, where there is no desktop bridge", async () => {
    const { app } = await boot();
    expect(await app.runAutoBackup("startup")).toBe(false);
    expect(app.meta.changesSinceBackup).toBe(4);
    expect(app.toasts).toHaveLength(0);
  });

  it("writes an importable backup, resets the reminder, and logs the day's first file once", async () => {
    const bridge = installBridge();
    const { app, store } = await boot();

    expect(await app.runAutoBackup("interval")).toBe(true);

    expect(bridge.writes).toEqual([{ name: "RADAR_AutoBackup_3f2a9c1e_2026-07-20.json", keep: 14 }]);
    const written = bridge.files.get("RADAR_AutoBackup_3f2a9c1e_2026-07-20.json")!;
    const parsed = parseAndValidateBackup(written);
    expect(parsed.valid).toBe(true);
    expect((parsed.package!.data.tasks as Task[]).map((t) => t.id)).toEqual(["t1"]);

    expect(app.meta.changesSinceBackup).toBe(0);
    expect(app.meta.lastBackupAt).toBe(parsed.package!.exportedAt);
    expect((await store.getMeta()).changesSinceBackup).toBe(0);
    expect(app.autoBackupInfo?.count).toBe(1);
    expect(app.autoBackupError).toBeUndefined();
    const logged = () => app.activityEntries.filter((e) => e.summary.startsWith("Saved automatic backup"));
    expect(logged()).toHaveLength(1);

    // Later the same day, after more edits: the file is replaced and nothing more is logged.
    await app.saveNewTask(app.createTask({ title: "Another" }));
    expect(app.meta.changesSinceBackup).toBe(1);
    expect(await app.runAutoBackup("interval")).toBe(true);
    expect(bridge.files.size).toBe(1);
    expect(parseAndValidateBackup([...bridge.files.values()][0]!).package!.data.tasks).toHaveLength(2);
    expect(logged()).toHaveLength(1);
  });

  it("skips the timer run when nothing changed, and honours the keep setting", async () => {
    const bridge = installBridge();
    const { app } = await boot({ changes: 0, settings: { autoBackupKeepDays: 30 } });
    expect(await app.runAutoBackup("interval")).toBe(false);
    expect(bridge.writes).toHaveLength(0);
    // Back up now always writes.
    expect(await app.runAutoBackup("manual")).toBe(true);
    expect(bridge.writes[0]!.keep).toBe(30);
  });

  it("stays off when the setting is off, and never backs up an empty database", async () => {
    const bridge = installBridge();
    const off = await boot({ settings: { autoBackupEnabled: false } });
    expect(await off.app.runAutoBackup("startup")).toBe(false);
    const empty = await boot({ tasks: [] });
    expect(await empty.app.runAutoBackup("startup")).toBe(false);
    expect(await empty.app.runAutoBackup("manual")).toBe(false);
    expect(bridge.writes).toHaveLength(0);
  });

  it("keeps the reminder and reports the reason once when the write fails", async () => {
    const bridge = installBridge();
    bridge.failWith = "access is denied";
    const { app } = await boot();

    expect(await app.runAutoBackup("interval")).toBe(false);
    expect(app.meta.changesSinceBackup).toBe(4);
    expect(app.meta.lastBackupAt).toBeUndefined();
    expect(app.autoBackupError).toBe("access is denied");
    expect(app.toasts.filter((t) => t.kind === "error")).toHaveLength(1);

    // The same failure half an hour later does not toast again.
    expect(await app.runAutoBackup("interval")).toBe(false);
    expect(app.toasts.filter((t) => t.kind === "error")).toHaveLength(1);

    // Recovery clears the error.
    bridge.failWith = undefined;
    expect(await app.runAutoBackup("interval")).toBe(true);
    expect(app.autoBackupError).toBeUndefined();
    expect(app.meta.changesSinceBackup).toBe(0);
  });
});
