// Typed access to the Wails v2 runtime bindings injected by the desktop
// shell (desktop/main.go, plan section 8.10). The single-file browser
// artifact never defines window.go, so every accessor here returns undefined
// over file:// and the app falls through to IndexedDB.
//
// Bindings are looked up at call time, never captured at module scope: the
// Wails runtime scripts are classic scripts injected into <body> and run
// before the deferred app bundle, but under `wails dev` hot reload the page
// can re-evaluate in ways that make module-scope captures stale.

/** Go persistence bridge (desktop/store.go). All payloads are JSON text. */
export interface StoreBindings {
  GetAll(collection: string): Promise<string>;
  Put(collection: string, recordJson: string): Promise<void>;
  BulkPut(collection: string, recordsJson: string): Promise<void>;
  Delete(collection: string, id: string): Promise<void>;
  /** Applies a MutationOp[] batch as one SQLite transaction. */
  Mutate(opsJson: string): Promise<void>;
  /** Returns "" when no settings row exists yet. */
  GetSettings(): Promise<string>;
  SaveSettings(settingsJson: string): Promise<void>;
  /** Returns "" when no meta row exists yet. */
  GetMeta(): Promise<string>;
  SaveMeta(metaJson: string): Promise<void>;
  ExportSnapshot(): Promise<string>;
  ReplaceAll(snapshotJson: string): Promise<void>;
  ClearAll(newMetaJson: string): Promise<void>;
  /** JSON: {"path": string, "sizeBytes": number, "journalMode": string}. */
  GetDatabaseInfo(): Promise<string>;
}

/** Desktop shell helpers (desktop/app.go). */
export interface AppBindings {
  /** Native save dialog + write. Returns the saved path, or "" on cancel. */
  SaveTextFile(defaultFilename: string, content: string): Promise<string>;
  /** Selects and opens an existing RADAR .db file. Returns "" on cancel. */
  OpenDatabaseFile(): Promise<string>;
  /** Creates and switches to a new RADAR .db file. Returns "" on cancel. */
  CreateDatabaseFile(): Promise<string>;
  /** Opens the directory containing the active radar.db in File Explorer. */
  OpenDatabaseFolder(): Promise<void>;
}

interface WailsWindow {
  go?: {
    main?: {
      Store?: Partial<StoreBindings>;
      App?: Partial<AppBindings>;
    };
  };
}

function wailsGlobals(): WailsWindow["go"] {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as WailsWindow).go;
}

export function wailsStoreBindings(): StoreBindings | undefined {
  const store = wailsGlobals()?.main?.Store;
  // Probe one method so a partially injected runtime never half-works.
  return typeof store?.Mutate === "function" ? (store as StoreBindings) : undefined;
}

export function wailsAppBindings(): AppBindings | undefined {
  const app = wailsGlobals()?.main?.App;
  return typeof app?.SaveTextFile === "function" ? (app as AppBindings) : undefined;
}

export function isWailsHost(): boolean {
  return wailsStoreBindings() !== undefined;
}
