// Central application state and service layer (plan section 8.7).
// All mutations pass through here: they persist via the DataStore,
// update reactive state, and record activity entries.

import type {
  ActivityEntry,
  AppSettings,
  IsoDate,
  AttentionSnooze,
  AwardRecord,
  BoardColumnDefinition,
  ChecklistItem,
  Competency,
  Employee,
  EmployeeInteraction,
  EmployeeNote,
  EmployeeTrainingRecord,
  EvaluationCycle,
  LeaveRecord,
  MeetingNote,
  PerformanceElement,
  PerformanceInput,
  Project,
  Task,
  TaskNote,
  TeleworkRecord,
  TravelRecord,
  TrainingRequirement
} from "../domain/models";
import { DEFAULT_BOARD_COLUMN_SEEDS, DEFAULT_SETTINGS, normalizeAppSettings, normalizeTaskStatus, statusLabel } from "../domain/models";
import type { CollectionName, CollectionTypes, DataStore, DatabaseSnapshot, MutationOp, StoreMeta } from "../data/DataStore";
import { COLLECTION_NAMES, deleteOp, putOp } from "../data/DataStore";
import { IndexedDbDataStore, StorageBlockedError, StorageLockedError, type ConnectionLossReason } from "../data/IndexedDbDataStore";
import { InMemoryDataStore } from "../data/InMemoryDataStore";
import { WailsDataStore } from "../data/WailsDataStore";
import { onDesktopDatabaseChanged, wailsAppBindings, wailsStoreBindings } from "../data/wailsBridge";
import { createBackupPackage, snapshotFromBackup, type BackupPackage } from "../data/backup";
import { createSampleSnapshot } from "../data/seed";
import { newId } from "../utils/ids";
import { formatDate, nowTimestamp, todayIso } from "../utils/dates";
import { orderForAppend } from "../domain/rules/boardOrder";
import { laneForStatus, statusChangeForLaneMove } from "../domain/rules/laneStatus";
import { computeAttention, snoozeKey, type AttentionItem } from "../domain/rules/attention";
import { expiredActivityEntryIds } from "../domain/rules/activityRetention";
import { requirementAppliesTo, rollingExpiration, trainingStatus, type TrainingStatus } from "../domain/rules/training";

export type SaveStatus = "saved" | "saving" | "error";

export interface TrainingStatusRow {
  requirement: TrainingRequirement;
  employee: Employee;
  record?: EmployeeTrainingRecord;
  status: TrainingStatus;
}

export interface Toast {
  id: string;
  message: string;
  kind: "info" | "success" | "error";
  undo?: () => void;
}

export interface StoragePersistenceStatus {
  supported: boolean;
  persistAvailable: boolean;
  estimateAvailable: boolean;
  persisted?: boolean;
  usageBytes?: number;
  quotaBytes?: number;
  error?: string;
}

const MUTATING_ACTIVITY = new Set(["created", "updated", "status_changed", "completed", "reopened", "archived", "restored", "deleted"]);

export class AppStore {
  // --- reactive entity state ------------------------------------------------
  competencies = $state<Competency[]>([]);
  employees = $state<Employee[]>([]);
  projects = $state<Project[]>([]);
  tasks = $state<Task[]>([]);
  boardColumns = $state<BoardColumnDefinition[]>([]);
  taskNotes = $state<TaskNote[]>([]);
  checklistItems = $state<ChecklistItem[]>([]);
  performanceElements = $state<PerformanceElement[]>([]);
  evaluationCycles = $state<EvaluationCycle[]>([]);
  performanceInputs = $state<PerformanceInput[]>([]);
  trainingRequirements = $state<TrainingRequirement[]>([]);
  employeeTrainingRecords = $state<EmployeeTrainingRecord[]>([]);
  leaveRecords = $state<LeaveRecord[]>([]);
  teleworkRecords = $state<TeleworkRecord[]>([]);
  travelRecords = $state<TravelRecord[]>([]);
  awardRecords = $state<AwardRecord[]>([]);
  employeeInteractions = $state<EmployeeInteraction[]>([]);
  employeeNotes = $state<EmployeeNote[]>([]);
  meetingNotes = $state<MeetingNote[]>([]);
  activityEntries = $state<ActivityEntry[]>([]);
  attentionSnoozes = $state<AttentionSnooze[]>([]);

  settings = $state<AppSettings>({ ...DEFAULT_SETTINGS });
  meta = $state<StoreMeta>({ databaseId: "", changesSinceBackup: 0 });
  saveStatus = $state<SaveStatus>("saved");
  storageKind = $state<"indexeddb" | "memory" | "sqlite" | "unknown">("unknown");
  storagePersistence = $state<StoragePersistenceStatus>({
    supported: false,
    persistAvailable: false,
    estimateAvailable: false
  });
  /** Database file details when running in the desktop (Wails) shell. */
  desktopInfo = $state<{ path: string; sizeBytes: number } | undefined>(undefined);
  /**
    * Blocking storage fault. "blocked": another window holds an older database
   * version open. "locked": another window holds the writer lease. The
   * connection-loss reasons arrive mid-session via onConnectionLost.
   */
  storageFault = $state<"blocked" | "locked" | ConnectionLossReason | undefined>(undefined);
  initialized = $state(false);
  initError = $state<string | undefined>(undefined);
  today = $state(todayIso());
  toasts = $state<Toast[]>([]);

  private store: DataStore = new InMemoryDataStore();
  private sessionId = newId();

  // --- derived --------------------------------------------------------------
  attention = $derived<AttentionItem[]>(
    computeAttention({
      today: this.today,
      settings: this.settings,
      tasks: this.tasks,
      employees: this.employees,
      performanceInputs: this.performanceInputs,
      interactions: this.employeeInteractions,
      trainingRecords: this.employeeTrainingRecords,
      trainingRequirements: this.trainingRequirements,
      leaveRecords: this.leaveRecords,
      teleworkRecords: this.teleworkRecords,
      travelRecords: this.travelRecords,
      awardRecords: this.awardRecords,
      lastBackupAt: this.meta.lastBackupAt,
      changesSinceBackup: this.meta.changesSinceBackup,
      snoozes: this.attentionSnoozes
    })
  );

  activeEmployees = $derived(this.employees.filter((e) => e.activeStatus === "active" && !e.isArchived));
  hasOperatorData = $derived(
    this.competencies.length > 0 ||
      this.employees.length > 0 ||
      this.projects.length > 0 ||
      this.tasks.length > 0 ||
      this.taskNotes.length > 0 ||
      this.checklistItems.length > 0 ||
      this.performanceElements.length > 0 ||
      this.evaluationCycles.length > 0 ||
      this.performanceInputs.length > 0 ||
      this.trainingRequirements.length > 0 ||
      this.employeeTrainingRecords.length > 0 ||
      this.leaveRecords.length > 0 ||
      this.teleworkRecords.length > 0 ||
      this.travelRecords.length > 0 ||
      this.awardRecords.length > 0 ||
      this.employeeInteractions.length > 0 ||
      this.employeeNotes.length > 0 ||
      this.meetingNotes.length > 0
  );
  competencyList = $derived(
    [...this.competencies].sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }) || a.id.localeCompare(b.id))
  );
  activeCompetencies = $derived(this.competencyList.filter((c) => c.active));

  // One derived roster row per (active requirement × applicable employee);
  // every training view reads status from here so they cannot disagree.
  trainingStatusList = $derived.by<TrainingStatusRow[]>(() => {
    const recByKey = new Map(this.employeeTrainingRecords.map((r) => [`${r.employeeId}|${r.trainingRequirementId}`, r]));
    const rows: TrainingStatusRow[] = [];
    for (const requirement of this.trainingRequirements) {
      if (!requirement.active) continue;
      for (const employee of this.activeEmployees) {
        if (!requirementAppliesTo(requirement, employee)) continue;
        const record = recByKey.get(`${employee.id}|${requirement.id}`);
        rows.push({
          requirement,
          employee,
          record,
          status: trainingStatus(requirement, record, this.today, this.settings.trainingWarningDays)
        });
      }
    }
    return rows;
  });
  activeProjects = $derived(this.projects.filter((p) => p.status === "active" && !p.isArchived));
  boardColumnList = $derived(
    [...this.boardColumns].sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label))
  );
  activeBoardColumns = $derived(this.boardColumnList);

  employeeName(id: string | undefined): string {
    if (!id) return "";
    return this.employees.find((e) => e.id === id)?.displayName ?? "(unknown)";
  }

  projectName(id: string | undefined): string {
    if (!id) return "";
    const p = this.projects.find((p) => p.id === id);
    return p?.shortName || p?.name || "(unknown)";
  }

  competencyCode(id: string | undefined): string {
    if (!id) return "";
    return this.competencies.find((c) => c.id === id)?.code ?? "";
  }

  competencyOptions(currentCompetencyId?: string): Competency[] {
    const options = this.competencyList.filter((c) => c.active || c.id === currentCompetencyId);
    if (currentCompetencyId && !options.some((c) => c.id === currentCompetencyId)) {
      options.push({
        id: currentCompetencyId,
        code: "(missing)",
        name: "Missing competency",
        active: false,
        createdAt: "",
        updatedAt: ""
      });
    }
    return options;
  }

  competencyEmployeeCount(id: string): number {
    return this.employees.filter((e) => e.competencyId === id && !e.isArchived).length;
  }

  competencyProjectCount(id: string): number {
    return this.projects.filter((p) => p.competencyId === id && !p.isArchived).length;
  }

  competencyTaskCount(id: string): number {
    return this.tasks.filter((t) => t.competencyId === id && !t.isArchived).length;
  }

  boardColumnLabel(id: string | undefined): string {
    if (!id) return "";
    return this.boardColumns.find((c) => c.id === id)?.label ?? this.legacyBoardColumnLabel(id);
  }

  boardColumnOptions(currentColumnId?: string): BoardColumnDefinition[] {
    const options = [...this.activeBoardColumns];
    if (currentColumnId && !options.some((c) => c.id === currentColumnId)) {
      options.push({
        id: currentColumnId,
        label: this.boardColumnLabel(currentColumnId),
        sortOrder: Number.MAX_SAFE_INTEGER,
        createdAt: "",
        updatedAt: ""
      });
    }
    return options;
  }

  taskBoardColumnId(task: Task): string {
    return task.boardColumnId || this.defaultBoardColumnIdForStatus(task.status);
  }

  boardColumnTaskCount(id: string): number {
    return this.tasks.filter((t) => this.taskBoardColumnId(t) === id).length;
  }

  defaultBoardColumnId(): string {
    return this.activeBoardColumns.find((c) => c.id === "inbox")?.id ?? this.activeBoardColumns[0]?.id ?? "inbox";
  }

  // --- lifecycle --------------------------------------------------------------
  /**
   * Open storage and load state. A blocked upgrade or a writer lease held by
   * another window is a BLOCKING fault (recovery screen), never a silent
   * fallback to memory — memory-only mode is reserved for environments where
   * IndexedDB is genuinely unavailable (plan 9.5 outcome C).
   */
  async initialize(options: { takeOverWriterLease?: boolean } = {}): Promise<void> {
    this.storageFault = undefined;
    this.initError = undefined;
    try {
      const desktopBindings = wailsStoreBindings();
      if (desktopBindings) {
        // Desktop shell (Wails): SQLite via the Go bridge. Deliberately no
        // fallback to IndexedDB here — that would silently split data into
        // the WebView2 profile. A failed bridge surfaces as initError.
        const desktop = new WailsDataStore(desktopBindings);
        await desktop.initialize();
        this.store = desktop;
        this.storageKind = "sqlite";
        // A second writer (the optional MCP server) commits directly to
        // radar.db. Re-read when it does, so this window neither hides those
        // records nor overwrites them from stale memory (working rule 18).
        onDesktopDatabaseChanged(() => void this.refreshFromDisk());
      } else if (IndexedDbDataStore.isSupported()) {
        try {
          const idb = new IndexedDbDataStore({
            forceWriterLease: options.takeOverWriterLease,
            onConnectionLost: (reason) => {
              this.storageFault = reason;
            }
          });
          await idb.initialize();
          this.store = idb;
          this.storageKind = "indexeddb";
        } catch (e) {
          if (e instanceof StorageBlockedError) {
            this.storageFault = "blocked";
            return;
          }
          if (e instanceof StorageLockedError) {
            this.storageFault = "locked";
            return;
          }
          console.warn("IndexedDB unavailable, falling back to in-memory store", e);
          this.store = new InMemoryDataStore();
          await this.store.initialize();
          this.storageKind = "memory";
        }
      } else {
        await this.store.initialize();
        this.storageKind = "memory";
      }
      await this.loadAll();
      await this.pruneActivityEntries();
      await this.refreshStoragePersistence();
      await this.refreshDesktopInfo();
      this.initialized = true;
    } catch (e) {
      this.initError = e instanceof Error ? e.message : String(e);
    }
    this.startClock();
  }

  /**
   * Re-read every collection after an external writer committed to the same
   * database file (desktop/dbwatch.go emits the signal). Records already
   * open in a form keep their draft state; only the persisted lists reload.
   */
  private refreshing = false;
  async refreshFromDisk(): Promise<void> {
    if (this.refreshing || !this.initialized) return;
    this.refreshing = true;
    try {
      await this.loadAll();
      this.toast("Reloaded — the database changed outside this window", "info");
    } catch (e) {
      this.toast(`Reload failed: ${e instanceof Error ? e.message : String(e)}`, "error");
    } finally {
      this.refreshing = false;
    }
  }

  private clockStarted = false;
  /** Keep "today" current across midnight while the app stays open. */
  private startClock(): void {
    if (this.clockStarted) return;
    this.clockStarted = true;
    setInterval(() => {
      this.today = todayIso();
    }, 60_000);
  }

  /** Boot from an already-initialized store (unit tests, alternate hosts). */
  async initializeFrom(store: DataStore): Promise<void> {
    this.store = store;
    this.storageKind = store.kind;
    await this.loadAll();
    this.initialized = true;
  }

  private async loadAll(): Promise<void> {
    const snapshot = await this.store.exportSnapshot();
    this.applySnapshotToState(snapshot);
    this.settings = this.migrateSettings(snapshot.settings ?? { ...DEFAULT_SETTINGS });
    this.meta = snapshot.meta;
    if (!snapshot.settings || JSON.stringify(snapshot.settings) !== JSON.stringify(this.settings)) {
      await this.store.saveSettings(this.plainRecord(this.settings));
    }
    await this.ensureBoardColumns();
    await this.migrateTaskStatuses();
    await this.removeRetiredTaskFields();
  }

  private migrateSettings(settings: unknown): AppSettings {
    return normalizeAppSettings(settings);
  }

  private async refreshStoragePersistence(): Promise<void> {
    const storage = typeof navigator !== "undefined" ? navigator.storage : undefined;
    if (!storage) {
      this.storagePersistence = {
        supported: false,
        persistAvailable: false,
        estimateAvailable: false
      };
      return;
    }

    try {
      const persistAvailable = typeof storage.persist === "function";
      const estimateAvailable = typeof storage.estimate === "function";
      const persisted =
        typeof storage.persisted === "function" ? await storage.persisted() : undefined;
      const estimate = estimateAvailable ? await storage.estimate() : {};
      this.storagePersistence = {
        supported: true,
        persistAvailable,
        estimateAvailable,
        persisted,
        usageBytes: estimate.usage,
        quotaBytes: estimate.quota
      };
    } catch (e) {
      this.storagePersistence = {
        supported: true,
        persistAvailable: typeof storage.persist === "function",
        estimateAvailable: typeof storage.estimate === "function",
        error: e instanceof Error ? e.message : String(e)
      };
    }
  }

  /** Refresh database file details from the desktop shell, if present. */
  private async refreshDesktopInfo(): Promise<void> {
    if (this.storageKind !== "sqlite") return;
    const bindings = wailsStoreBindings();
    if (!bindings) return;
    try {
      const info = JSON.parse(await bindings.GetDatabaseInfo()) as { path: string; sizeBytes: number };
      this.desktopInfo = { path: info.path, sizeBytes: info.sizeBytes };
    } catch {
      this.desktopInfo = undefined;
    }
  }

  async requestPersistentStorage(): Promise<void> {
    const storage = typeof navigator !== "undefined" ? navigator.storage : undefined;
    if (!storage || typeof storage.persist !== "function") {
      await this.refreshStoragePersistence();
      this.toast("This browser does not expose persistent storage requests", "info");
      return;
    }

    try {
      const granted = await storage.persist();
      await this.refreshStoragePersistence();
      if (granted) {
        this.toast("Persistent browser storage granted", "success");
      } else {
        this.toast("Persistent browser storage was not granted by this browser", "info");
      }
    } catch (e) {
      await this.refreshStoragePersistence();
      this.toast(`Persistent storage request failed: ${e instanceof Error ? e.message : String(e)}`, "error");
    }
  }

  async openDesktopDatabaseFile(): Promise<void> {
    if (this.storageKind !== "sqlite") return;
    const bindings = wailsAppBindings();
    if (!bindings) return;
    try {
      const path = await bindings.OpenDatabaseFile();
      if (path === "") return;
      await this.loadAll();
      await this.refreshDesktopInfo();
      this.toast("Database opened", "success");
    } catch (e) {
      this.toast(`Could not open database: ${e instanceof Error ? e.message : String(e)}`, "error");
    }
  }

  async createDesktopDatabaseFile(): Promise<void> {
    if (this.storageKind !== "sqlite") return;
    const bindings = wailsAppBindings();
    if (!bindings) return;
    try {
      const path = await bindings.CreateDatabaseFile();
      if (path === "") return;
      await this.loadAll();
      await this.refreshDesktopInfo();
      this.toast("New database created", "success");
    } catch (e) {
      this.toast(`Could not create database: ${e instanceof Error ? e.message : String(e)}`, "error");
    }
  }

  async openDesktopDatabaseFolder(): Promise<void> {
    if (this.storageKind !== "sqlite") return;
    const bindings = wailsAppBindings();
    if (!bindings) return;
    try {
      await bindings.OpenDatabaseFolder();
    } catch (e) {
      this.toast(`Could not open database folder: ${e instanceof Error ? e.message : String(e)}`, "error");
    }
  }

  private applySnapshotToState(snapshot: DatabaseSnapshot): void {
    this.competencies = snapshot.collections.competencies;
    this.employees = snapshot.collections.employees;
    this.projects = snapshot.collections.projects;
    this.tasks = snapshot.collections.tasks;
    this.boardColumns = snapshot.collections.boardColumns;
    this.taskNotes = snapshot.collections.taskNotes;
    this.checklistItems = snapshot.collections.checklistItems;
    this.performanceElements = snapshot.collections.performanceElements;
    this.evaluationCycles = snapshot.collections.evaluationCycles;
    this.performanceInputs = snapshot.collections.performanceInputs;
    this.trainingRequirements = snapshot.collections.trainingRequirements;
    this.employeeTrainingRecords = snapshot.collections.employeeTrainingRecords;
    this.leaveRecords = snapshot.collections.leaveRecords;
    this.teleworkRecords = snapshot.collections.teleworkRecords;
    this.travelRecords = snapshot.collections.travelRecords;
    this.awardRecords = snapshot.collections.awardRecords;
    this.employeeInteractions = snapshot.collections.employeeInteractions;
    this.employeeNotes = snapshot.collections.employeeNotes;
    this.meetingNotes = snapshot.collections.meetingNotes;
    this.activityEntries = snapshot.collections.activityEntries;
    this.attentionSnoozes = snapshot.collections.attentionSnoozes;
  }

  private stateList<K extends CollectionName>(name: K): CollectionTypes[K][] {
    return this[name] as unknown as CollectionTypes[K][];
  }

  private plainRecord<T>(record: T): T {
    return $state.snapshot(record) as T;
  }

  private plainRecords<T>(records: T[]): T[] {
    return records.map((record) => this.plainRecord(record));
  }

  private legacyBoardColumnLabel(id: string): string {
    return (
      DEFAULT_BOARD_COLUMN_SEEDS.find((c) => c.id === id)?.label ??
      id
        .split(/[-_]/)
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ")
    );
  }

  private defaultBoardColumnIdForStatus(status: string): string {
    return this.boardColumns.some((c) => c.id === status) ? status : this.defaultBoardColumnId();
  }

  private uniqueBoardColumnId(label: string): string {
    const base = label
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "column";
    const existing = new Set(this.boardColumns.map((c) => c.id));
    if (!existing.has(base)) return base;
    let suffix = 2;
    while (existing.has(`${base}-${suffix}`)) suffix += 1;
    return `${base}-${suffix}`;
  }

  private async ensureBoardColumns(): Promise<void> {
    const now = nowTimestamp();
    const existing = new Map(this.boardColumns.map((c) => [c.id, c]));
    const additions: BoardColumnDefinition[] = [];
    for (const seed of DEFAULT_BOARD_COLUMN_SEEDS) {
      if (!existing.has(seed.id)) {
        const record: BoardColumnDefinition = {
          id: seed.id,
          label: seed.label,
          sortOrder: seed.sortOrder,
          mapsToStatus: seed.mapsToStatus,
          createdAt: now,
          updatedAt: now
        };
        existing.set(record.id, record);
        additions.push(record);
      }
    }

    for (const column of additions) {
      await this.store.put("boardColumns", column);
      this.boardColumns.push(column);
    }

    // Migration: default columns created before lane→status mappings existed
    // pick up their seed mapping. Custom columns stay unmapped.
    const seedStatusById = new Map(DEFAULT_BOARD_COLUMN_SEEDS.map((s) => [s.id, s.mapsToStatus]));
    const mappingFixes = this.boardColumns
      .filter((c) => c.mapsToStatus === undefined && seedStatusById.get(c.id))
      .map((c) => ({ ...c, mapsToStatus: seedStatusById.get(c.id), updatedAt: now }));
    if (mappingFixes.length) {
      await this.store.bulkPut("boardColumns", this.plainRecords(mappingFixes));
      for (const column of mappingFixes) {
        const idx = this.boardColumns.findIndex((c) => c.id === column.id);
        if (idx >= 0) this.boardColumns[idx] = column;
      }
    }

    const migratedTasks = this.tasks
      .filter((task) => !task.boardColumnId)
      .map((task) => ({ ...task, boardColumnId: this.defaultBoardColumnIdForStatus(task.status) }));
    if (migratedTasks.length) {
      const persistedTasks = this.plainRecords(migratedTasks);
      await this.store.bulkPut("tasks", persistedTasks);
      for (const task of migratedTasks) {
        const idx = this.tasks.findIndex((t) => t.id === task.id);
        if (idx >= 0) this.tasks[idx] = task;
      }
    }
  }

  /**
   * Collapse legacy workflow-stage statuses into "open" (see normalizeTaskStatus).
   * Must run after ensureBoardColumns so tasks that still lacked a boardColumnId
   * got their column derived from the original status first.
   */
  private async migrateTaskStatuses(): Promise<void> {
    const migrated = this.tasks
      .filter((task) => task.status !== normalizeTaskStatus(task.status))
      .map((task) => ({ ...task, status: normalizeTaskStatus(task.status) }));
    if (!migrated.length) return;
    await this.store.bulkPut("tasks", this.plainRecords(migrated));
    for (const task of migrated) {
      const idx = this.tasks.findIndex((t) => t.id === task.id);
      if (idx >= 0) this.tasks[idx] = task;
    }
  }

  /** Remove task fields retired from the product, including data from local pre-change records. */
  private async removeRetiredTaskFields(): Promise<void> {
    type LegacyTask = Task & { waitingOn?: unknown; waitingReason?: unknown; followUpDate?: unknown };
    const migrated = this.tasks
      .filter((task) => {
        const legacy = task as LegacyTask;
        return "waitingOn" in legacy || "waitingReason" in legacy || "followUpDate" in legacy;
      })
      .map((task) => {
        const legacy = { ...(task as LegacyTask) };
        delete legacy.waitingOn;
        delete legacy.waitingReason;
        delete legacy.followUpDate;
        return legacy as Task;
      });
    if (!migrated.length) return;
    await this.store.bulkPut("tasks", this.plainRecords(migrated));
    for (const task of migrated) {
      const idx = this.tasks.findIndex((current) => current.id === task.id);
      if (idx >= 0) this.tasks[idx] = task;
    }
  }

  // --- generic persistence helpers -------------------------------------------
  // Record, activity entry, and backup-change counter are written in ONE
  // atomic mutate() batch, so the audit trail can never diverge from the data.
  async putRecord<K extends CollectionName>(
    name: K,
    record: CollectionTypes[K],
    activity?: { actionType: string; summary: string; entityType?: string }
  ): Promise<void> {
    this.saveStatus = "saving";
    try {
      const persisted = this.plainRecord(record);
      const entry = activity
        ? this.buildActivityEntry(activity.entityType ?? name, persisted.id, activity.actionType, activity.summary)
        : undefined;
      const nextMeta = this.bumpedMeta(activity?.actionType);
      const ops: MutationOp[] = [putOp(name, persisted)];
      if (entry) ops.push(putOp("activityEntries", entry));
      if (nextMeta) ops.push({ kind: "saveMeta", meta: nextMeta });
      await this.store.mutate(ops);

      const list = this.stateList(name);
      const idx = list.findIndex((r) => r.id === persisted.id);
      if (idx >= 0) list[idx] = persisted;
      else list.push(persisted);
      if (entry) this.activityEntries.push(entry);
      if (nextMeta) this.meta = nextMeta;
      this.saveStatus = "saved";
    } catch (e) {
      this.saveStatus = "error";
      this.toast(`Save failed: ${e instanceof Error ? e.message : String(e)}`, "error");
      throw e;
    }
  }

  async deleteRecord(name: CollectionName, id: string, summary: string): Promise<void> {
    this.saveStatus = "saving";
    try {
      const entry = this.buildActivityEntry(name, id, "deleted", summary);
      const nextMeta = this.bumpedMeta("deleted");
      const ops: MutationOp[] = [deleteOp(name, id), putOp("activityEntries", entry)];
      if (nextMeta) ops.push({ kind: "saveMeta", meta: nextMeta });
      await this.store.mutate(ops);

      const list = this.stateList(name) as { id: string }[];
      const idx = list.findIndex((r) => r.id === id);
      if (idx >= 0) list.splice(idx, 1);
      this.activityEntries.push(entry);
      if (nextMeta) this.meta = nextMeta;
      this.saveStatus = "saved";
    } catch (e) {
      this.saveStatus = "error";
      this.toast(`Delete failed: ${e instanceof Error ? e.message : String(e)}`, "error");
      throw e;
    }
  }

  private buildActivityEntry(entityType: string, entityId: string, actionType: string, summary: string): ActivityEntry {
    return {
      id: newId(),
      entityType,
      entityId,
      actionType,
      timestamp: nowTimestamp(),
      summary,
      sessionId: this.sessionId
    };
  }

  /**
   * Delete activity entries older than the retention window (startup
   * maintenance). One summary entry records the prune. Never blocks startup:
   * a failed prune is a warning, not an initialization error.
   */
  async pruneActivityEntries(): Promise<void> {
    try {
      const retentionDays = this.settings.activityRetentionDays;
      const ids = expiredActivityEntryIds(this.activityEntries, this.today, retentionDays);
      if (ids.length === 0) return;
      const entry = this.buildActivityEntry(
        "system",
        "activity",
        "maintenance",
        `Pruned ${ids.length} activity entr${ids.length === 1 ? "y" : "ies"} older than ${retentionDays} days`
      );
      const ops: MutationOp[] = ids.map((id) => deleteOp("activityEntries", id));
      ops.push(putOp("activityEntries", entry));
      await this.store.mutate(ops);
      const removed = new Set(ids);
      this.activityEntries = this.activityEntries.filter((e) => !removed.has(e.id));
      this.activityEntries.push(entry);
    } catch (e) {
      console.warn("Activity prune failed", e);
    }
  }

  /** Standalone activity write for non-cascading events (imports, backups). */
  private async recordActivity(entityType: string, entityId: string, actionType: string, summary: string): Promise<void> {
    const entry = this.buildActivityEntry(entityType, entityId, actionType, summary);
    await this.store.put("activityEntries", entry);
    this.activityEntries.push(entry);
  }

  /**
   * Next meta with the backup-change counter bumped, or undefined when the
   * action type is not a data mutation. Callers include it in their mutate()
   * batch and assign it to this.meta only after the batch commits.
   */
  private bumpedMeta(actionType?: string): StoreMeta | undefined {
    if (actionType && !MUTATING_ACTIVITY.has(actionType)) return undefined;
    return { ...($state.snapshot(this.meta) as StoreMeta), changesSinceBackup: this.meta.changesSinceBackup + 1 };
  }

  async saveSettings(settings: AppSettings): Promise<void> {
    this.saveStatus = "saving";
    try {
      const persisted = this.plainRecord(settings);
      const entry = this.buildActivityEntry("settings", "settings", "updated", "Updated application settings");
      const nextMeta = this.bumpedMeta("updated");
      const ops: MutationOp[] = [{ kind: "saveSettings", settings: persisted }, putOp("activityEntries", entry)];
      if (nextMeta) ops.push({ kind: "saveMeta", meta: nextMeta });
      await this.store.mutate(ops);
      this.settings = persisted;
      this.activityEntries.push(entry);
      if (nextMeta) this.meta = nextMeta;
      this.saveStatus = "saved";
    } catch (e) {
      this.saveStatus = "error";
      this.toast(`Settings save failed: ${e instanceof Error ? e.message : String(e)}`, "error");
      throw e;
    }
  }

  // --- competency service -----------------------------------------------------
  async createCompetency(code: string, name: string): Promise<void> {
    const trimmedCode = code.trim();
    const trimmedName = name.trim();
    if (!trimmedCode) throw new Error("Competency code is required.");
    if (this.competencies.some((c) => c.code.toLowerCase() === trimmedCode.toLowerCase())) {
      throw new Error("A competency with that code already exists.");
    }
    const now = nowTimestamp();
    const competency: Competency = {
      id: newId(),
      code: trimmedCode,
      name: trimmedName || undefined,
      active: true,
      createdAt: now,
      updatedAt: now
    };
    await this.putRecord("competencies", competency, {
      actionType: "created",
      summary: `Created competency "${competency.code}"`
    });
  }

  async updateCompetency(id: string, code: string, name: string): Promise<void> {
    const competency = this.competencies.find((c) => c.id === id);
    if (!competency) throw new Error("Competency not found.");
    const trimmedCode = code.trim();
    const trimmedName = name.trim();
    if (!trimmedCode) throw new Error("Competency code is required.");
    if (this.competencies.some((c) => c.id !== id && c.code.toLowerCase() === trimmedCode.toLowerCase())) {
      throw new Error("A competency with that code already exists.");
    }
    if (competency.code === trimmedCode && (competency.name ?? "") === trimmedName) return;
    await this.putRecord(
      "competencies",
      { ...competency, code: trimmedCode, name: trimmedName || undefined, updatedAt: nowTimestamp() },
      { actionType: "updated", summary: `Updated competency "${trimmedCode}"` }
    );
  }

  async setCompetencyActive(id: string, active: boolean): Promise<void> {
    const competency = this.competencies.find((c) => c.id === id);
    if (!competency) throw new Error("Competency not found.");
    if (competency.active === active) return;
    await this.putRecord(
      "competencies",
      { ...competency, active, updatedAt: nowTimestamp() },
      {
        actionType: active ? "restored" : "archived",
        summary: `${active ? "Reactivated" : "Deactivated"} competency "${competency.code}"`
      }
    );
  }

  // --- board column service ---------------------------------------------------
  async createBoardColumn(label: string): Promise<void> {
    const trimmed = label.trim();
    if (!trimmed) throw new Error("Column name is required.");
    if (this.boardColumns.some((c) => c.label.toLowerCase() === trimmed.toLowerCase())) {
      throw new Error("A board column with that name already exists.");
    }
    const now = nowTimestamp();
    const column: BoardColumnDefinition = {
      id: this.uniqueBoardColumnId(trimmed),
      label: trimmed,
      sortOrder:
        this.boardColumns.reduce((max, c) => Math.max(max, Number.isFinite(c.sortOrder) ? c.sortOrder : 0), 0) + 10,
      createdAt: now,
      updatedAt: now
    };
    await this.putRecord("boardColumns", column, {
      actionType: "created",
      summary: `Created board column "${column.label}"`
    });
  }

  async renameBoardColumn(id: string, label: string): Promise<void> {
    const trimmed = label.trim();
    if (!trimmed) throw new Error("Column name is required.");
    const column = this.boardColumns.find((c) => c.id === id);
    if (!column) throw new Error("Board column not found.");
    if (this.boardColumns.some((c) => c.id !== id && c.label.toLowerCase() === trimmed.toLowerCase())) {
      throw new Error("A board column with that name already exists.");
    }
    if (column.label === trimmed) return;
    await this.putRecord(
      "boardColumns",
      { ...column, label: trimmed, updatedAt: nowTimestamp() },
      { actionType: "updated", summary: `Renamed board column "${column.label}" to "${trimmed}"` }
    );
  }

  async setBoardColumnStatusMapping(id: string, mapsToStatus: Task["status"] | undefined): Promise<void> {
    const column = this.boardColumns.find((c) => c.id === id);
    if (!column) throw new Error("Board column not found.");
    if (column.mapsToStatus === mapsToStatus) return;
    await this.putRecord(
      "boardColumns",
      { ...column, mapsToStatus, updatedAt: nowTimestamp() },
      {
        actionType: "updated",
        summary: `Board column "${column.label}" now ${mapsToStatus ? `marks tasks ${statusLabel(mapsToStatus)}` : "leaves task status unchanged"}`
      }
    );
  }

  async deleteBoardColumn(id: string): Promise<void> {
    const column = this.boardColumns.find((c) => c.id === id);
    if (!column) throw new Error("Board column not found.");
    if (this.activeBoardColumns.length <= 1) throw new Error("At least one board column is required.");
    const taskCount = this.boardColumnTaskCount(id);
    if (taskCount > 0) throw new Error("Move all tasks out of this column before deleting it.");
    await this.deleteRecord("boardColumns", id, `Deleted board column "${column.label}"`);
  }

  async moveBoardColumn(id: string, offset: -1 | 1): Promise<void> {
    const ordered = this.boardColumnList;
    const idx = ordered.findIndex((c) => c.id === id);
    const other = ordered[idx + offset];
    const current = ordered[idx];
    if (!current || !other) return;
    await this.reorderBoardColumns(
      ordered.map((column) => (column.id === current.id ? other : column.id === other.id ? current : column)),
      { entityId: current.id, summary: `Reordered board column "${current.label}"` }
    );
  }

  async reorderBoardColumn(draggedId: string, targetId: string, position: "before" | "after"): Promise<void> {
    if (draggedId === targetId) return;
    const withoutDragged = this.boardColumnList.filter((column) => column.id !== draggedId);
    const dragged = this.boardColumns.find((column) => column.id === draggedId);
    if (!dragged) return;
    const targetIndex = withoutDragged.findIndex((column) => column.id === targetId);
    if (targetIndex < 0) return;
    const insertAt = targetIndex + (position === "after" ? 1 : 0);
    const ordered = [...withoutDragged.slice(0, insertAt), dragged, ...withoutDragged.slice(insertAt)];
    await this.reorderBoardColumns(ordered, {
      entityId: dragged.id,
      summary: `Reordered board column "${dragged.label}"`
    });
  }

  private async reorderBoardColumns(
    ordered: BoardColumnDefinition[],
    activity: { entityId: string; summary: string }
  ): Promise<void> {
    const now = nowTimestamp();
    const updated = ordered.map((column, index) => ({
      ...column,
      sortOrder: (index + 1) * 10,
      updatedAt: now
    }));
    this.saveStatus = "saving";
    try {
      const entry = this.buildActivityEntry("boardColumns", activity.entityId, "updated", activity.summary);
      const nextMeta = this.bumpedMeta("updated");
      const ops: MutationOp[] = this.plainRecords(updated).map((column) => putOp("boardColumns", column));
      ops.push(putOp("activityEntries", entry));
      if (nextMeta) ops.push({ kind: "saveMeta", meta: nextMeta });
      await this.store.mutate(ops);

      for (const column of updated) {
        const idx = this.boardColumns.findIndex((c) => c.id === column.id);
        if (idx >= 0) this.boardColumns[idx] = column;
      }
      this.activityEntries.push(entry);
      if (nextMeta) this.meta = nextMeta;
      this.saveStatus = "saved";
    } catch (e) {
      this.saveStatus = "error";
      this.toast(`Save failed: ${e instanceof Error ? e.message : String(e)}`, "error");
      throw e;
    }
  }

  // --- task service -----------------------------------------------------------
  createTask(partial: Partial<Task> & { title: string }): Task {
    const now = nowTimestamp();
    const status = partial.status ?? "open";
    const boardColumnId = partial.boardColumnId ?? this.defaultBoardColumnId();
    return {
      id: newId(),
      status,
      boardColumnId,
      priority: "normal",
      performanceInputCreated: false,
      tags: [],
      boardOrder: orderForAppend(
        this.tasks.filter((t) => this.taskBoardColumnId(t) === boardColumnId && !t.isArchived).map((t) => t.boardOrder)
      ),
      createdAt: now,
      updatedAt: now,
      isArchived: false,
      ...partial,
      title: partial.title.trim()
    };
  }

  async saveNewTask(task: Task): Promise<void> {
    await this.putRecord("tasks", task, { actionType: "created", summary: `Created task "${task.title}"` });
  }

  async updateTask(task: Task, summary = `Updated task "${task.title}"`, actionType = "updated"): Promise<void> {
    const updated = { ...task, updatedAt: nowTimestamp() };
    await this.putRecord("tasks", updated, { actionType, summary });
  }

  /**
   * Move a card to a lane. If the lane maps to a status (Waiting, Complete,
   * open lanes), the task status follows the card so the board never shows a
   * state the domain rules disagree with.
   */
  async moveTaskToBoardColumn(task: Task, boardColumnId: string, boardOrder: number): Promise<Task> {
    const prev = this.taskBoardColumnId(task);
    const before = this.plainRecord(task);
    const column = this.boardColumns.find((c) => c.id === boardColumnId);
    const statusChange = statusChangeForLaneMove(task, column, this.today, nowTimestamp());
    const updated: Task = { ...task, ...statusChange, boardColumnId, boardOrder, updatedAt: nowTimestamp() };
    const moveText = `Moved "${task.title}" from ${this.boardColumnLabel(prev)} to ${this.boardColumnLabel(boardColumnId)}`;
    await this.putRecord("tasks", updated, {
      actionType: statusChange?.status === "complete" ? "completed" : statusChange ? "status_changed" : "updated",
      summary: statusChange ? `${moveText} (status: ${statusLabel(updated.status)})` : moveText
    });
    if (statusChange?.status === "complete") {
      this.toast(`Completed "${task.title}"`, "success", async () => {
        await this.putRecord(
          "tasks",
          { ...before, updatedAt: nowTimestamp() },
          { actionType: "reopened", summary: `Reopened "${before.title}"` }
        );
      });
    }
    return updated;
  }

  /** Set or clear a task's due date (calendar drag-to-reschedule and its keyboard alternative). */
  async rescheduleTask(task: Task, dueDate: string | undefined): Promise<void> {
    if (task.dueDate === dueDate) return;
    const updated: Task = { ...task, dueDate, updatedAt: nowTimestamp() };
    await this.putRecord("tasks", updated, {
      actionType: "updated",
      summary: dueDate
        ? `Rescheduled "${task.title}" to ${formatDate(dueDate)}`
        : `Removed due date from "${task.title}"`
    });
  }

  async completeTask(task: Task): Promise<Task> {
    const before = $state.snapshot(task) as Task;
    // Completing a task also moves its card to the complete-mapped lane, so
    // the board reflects the status change (lane/status stay in step).
    const currentLane = this.taskBoardColumnId(task);
    const completeLane = laneForStatus(this.boardColumnList, "complete");
    const laneMove =
      completeLane && completeLane.id !== currentLane
        ? {
            boardColumnId: completeLane.id,
            boardOrder: orderForAppend(
              this.tasks
                .filter((t) => t.id !== task.id && this.taskBoardColumnId(t) === completeLane.id && !t.isArchived)
                .map((t) => t.boardOrder)
            )
          }
        : {};
    const updated: Task = { ...task, ...laneMove, status: "complete", completedDate: this.today, updatedAt: nowTimestamp() };
    await this.putRecord("tasks", updated, { actionType: "completed", summary: `Completed "${task.title}"` });
    this.toast(`Completed "${task.title}"`, "success", async () => {
      await this.putRecord("tasks", { ...before, updatedAt: nowTimestamp() }, { actionType: "reopened", summary: `Reopened "${before.title}"` });
    });
    return updated;
  }

  async deleteTask(taskOrId: Task | string): Promise<void> {
    const task = typeof taskOrId === "string" ? this.tasks.find((t) => t.id === taskOrId) : taskOrId;
    if (!task) return;
    this.saveStatus = "saving";
    try {
      const id = task.id;
      const relatedNotes = this.taskNotes.filter((note) => note.taskId === id);
      const relatedChecklistItems = this.checklistItems.filter((item) => item.taskId === id);
      const updatedAt = nowTimestamp();

      const unlink = <T extends { relatedTaskId?: string }>(records: T[]): T[] =>
        records
          .filter((record) => record.relatedTaskId === id)
          .map((record) => this.plainRecord({ ...record, relatedTaskId: undefined, updatedAt }));
      const unlinkedInputs = unlink(this.performanceInputs);
      const unlinkedLeave = unlink(this.leaveRecords);
      const unlinkedTelework = unlink(this.teleworkRecords);
      const unlinkedInteractions = unlink(this.employeeInteractions);

      const entry = this.buildActivityEntry("tasks", id, "deleted", `Deleted task "${task.title}"`);
      const nextMeta = this.bumpedMeta("deleted");
      const ops: MutationOp[] = [
        ...relatedNotes.map((note) => deleteOp("taskNotes", note.id)),
        ...relatedChecklistItems.map((item) => deleteOp("checklistItems", item.id)),
        ...unlinkedInputs.map((record) => putOp("performanceInputs", record)),
        ...unlinkedLeave.map((record) => putOp("leaveRecords", record)),
        ...unlinkedTelework.map((record) => putOp("teleworkRecords", record)),
        ...unlinkedInteractions.map((record) => putOp("employeeInteractions", record)),
        deleteOp("tasks", id),
        putOp("activityEntries", entry)
      ];
      if (nextMeta) ops.push({ kind: "saveMeta", meta: nextMeta });
      await this.store.mutate(ops);

      this.taskNotes = this.taskNotes.filter((note) => note.taskId !== id);
      this.checklistItems = this.checklistItems.filter((item) => item.taskId !== id);
      this.performanceInputs = this.performanceInputs.map((record) =>
        record.relatedTaskId === id ? { ...record, relatedTaskId: undefined, updatedAt } : record
      );
      this.leaveRecords = this.leaveRecords.map((record) =>
        record.relatedTaskId === id ? { ...record, relatedTaskId: undefined, updatedAt } : record
      );
      this.teleworkRecords = this.teleworkRecords.map((record) =>
        record.relatedTaskId === id ? { ...record, relatedTaskId: undefined, updatedAt } : record
      );
      this.employeeInteractions = this.employeeInteractions.map((record) =>
        record.relatedTaskId === id ? { ...record, relatedTaskId: undefined, updatedAt } : record
      );
      this.tasks = this.tasks.filter((t) => t.id !== id);

      this.activityEntries.push(entry);
      if (nextMeta) this.meta = nextMeta;
      this.saveStatus = "saved";
      this.toast(`Deleted "${task.title}"`, "success");
    } catch (e) {
      this.saveStatus = "error";
      this.toast(`Delete failed: ${e instanceof Error ? e.message : String(e)}`, "error");
      throw e;
    }
  }

  async deletePerformanceInput(inputOrId: PerformanceInput | string): Promise<void> {
    const input = typeof inputOrId === "string" ? this.performanceInputs.find((p) => p.id === inputOrId) : inputOrId;
    if (!input) return;
    this.saveStatus = "saving";
    try {
      const id = input.id;
      const updatedAt = nowTimestamp();
      const unlinkedAwards = this.awardRecords
        .filter((award) => award.relatedPerformanceInputIds.includes(id))
        .map((award) =>
          this.plainRecord({
            ...award,
            relatedPerformanceInputIds: award.relatedPerformanceInputIds.filter((inputId) => inputId !== id),
            updatedAt
          })
        );
      let updatedTask: Task | undefined;

      if (input.relatedTaskId) {
        const task = this.tasks.find((t) => t.id === input.relatedTaskId);
        const hasOtherInputForTask = this.performanceInputs.some(
          (record) => record.id !== id && record.relatedTaskId === input.relatedTaskId
        );
        if (task && task.performanceInputCreated && !hasOtherInputForTask) {
          updatedTask = this.plainRecord({ ...task, performanceInputCreated: false, updatedAt });
        }
      }

      const entry = this.buildActivityEntry(
        "performanceInputs",
        id,
        "deleted",
        `Deleted performance input for ${this.employeeName(input.employeeId)} (${formatDate(input.inputDate)})`
      );
      const nextMeta = this.bumpedMeta("deleted");
      const ops: MutationOp[] = [
        ...unlinkedAwards.map((award) => putOp("awardRecords", award)),
        ...(updatedTask ? [putOp("tasks", updatedTask)] : []),
        deleteOp("performanceInputs", id),
        putOp("activityEntries", entry)
      ];
      if (nextMeta) ops.push({ kind: "saveMeta", meta: nextMeta });
      await this.store.mutate(ops);

      this.awardRecords = this.awardRecords.map((award) =>
        award.relatedPerformanceInputIds.includes(id)
          ? { ...award, relatedPerformanceInputIds: award.relatedPerformanceInputIds.filter((inputId) => inputId !== id), updatedAt }
          : award
      );
      if (updatedTask) {
        this.tasks = this.tasks.map((task) => (task.id === updatedTask.id ? updatedTask : task));
      }
      this.performanceInputs = this.performanceInputs.filter((p) => p.id !== id);

      this.activityEntries.push(entry);
      if (nextMeta) this.meta = nextMeta;
      this.saveStatus = "saved";
      this.toast("Performance input deleted", "success");
    } catch (e) {
      this.saveStatus = "error";
      this.toast(`Delete failed: ${e instanceof Error ? e.message : String(e)}`, "error");
      throw e;
    }
  }

  // --- employee service ---------------------------------------------------------
  /** Everything deleteEmployee will remove or unlink, for the confirmation dialog. */
  employeeLinkedRecordCounts(employeeId: string) {
    return {
      performanceInputs: this.performanceInputs.filter((r) => r.employeeId === employeeId).length,
      trainingRecords: this.employeeTrainingRecords.filter((r) => r.employeeId === employeeId).length,
      leaveRecords: this.leaveRecords.filter((r) => r.employeeId === employeeId).length,
      teleworkRecords: this.teleworkRecords.filter((r) => r.employeeId === employeeId).length,
      travelRecords: this.travelRecords.filter((r) => r.employeeId === employeeId).length,
      awardRecords: this.awardRecords.filter((r) => r.employeeId === employeeId).length,
      interactions: this.employeeInteractions.filter((r) => r.employeeId === employeeId).length,
      notes: this.employeeNotes.filter((r) => r.employeeId === employeeId).length,
      linkedTasks: this.tasks.filter((t) => t.employeeId === employeeId).length,
      meetingAttendances: this.meetingNotes.filter((n) => n.attendeeEmployeeIds.includes(employeeId)).length,
      projectLeads: this.projects.filter((p) => p.leadEmployeeId === employeeId).length,
      trainingAssignments: this.trainingRequirements.filter((r) => r.assignedEmployeeIds?.includes(employeeId)).length
    };
  }

  /**
   * Permanently delete an employee together with the records that only exist
   * for them (performance inputs, training, leave, telework, awards, check-ins,
   * notes). Shared records survive: tasks and meeting notes are unlinked, and
   * project lead / training-requirement assignments are cleared.
   */
  async deleteEmployee(employeeOrId: Employee | string): Promise<void> {
    const employee =
      typeof employeeOrId === "string" ? this.employees.find((e) => e.id === employeeOrId) : employeeOrId;
    if (!employee) return;
    this.saveStatus = "saving";
    try {
      const id = employee.id;
      const name = employee.displayName;
      const updatedAt = nowTimestamp();

      const inputs = this.performanceInputs.filter((r) => r.employeeId === id);
      const training = this.employeeTrainingRecords.filter((r) => r.employeeId === id);
      const leave = this.leaveRecords.filter((r) => r.employeeId === id);
      const telework = this.teleworkRecords.filter((r) => r.employeeId === id);
      const travel = this.travelRecords.filter((r) => r.employeeId === id);
      const awards = this.awardRecords.filter((r) => r.employeeId === id);
      const interactions = this.employeeInteractions.filter((r) => r.employeeId === id);
      const notes = this.employeeNotes.filter((r) => r.employeeId === id);

      // Tasks survive but lose the employee link; a task whose only performance
      // input was just deleted also gets its "input created" flag back (same
      // rule as deletePerformanceInput).
      const deletedInputIds = new Set(inputs.map((r) => r.id));
      const taskIdsWithDeletedInputs = new Set(
        inputs.map((r) => r.relatedTaskId).filter((tid): tid is string => Boolean(tid))
      );
      const survivingInputs = this.performanceInputs.filter((r) => r.employeeId !== id);
      const keepInputFlag = (t: Task) =>
        t.performanceInputCreated &&
        (!taskIdsWithDeletedInputs.has(t.id) || survivingInputs.some((p) => p.relatedTaskId === t.id));
      const updatedTasks = this.tasks
        .filter((t) => t.employeeId === id || (t.performanceInputCreated && taskIdsWithDeletedInputs.has(t.id)))
        .map((t) => ({
          ...t,
          employeeId: t.employeeId === id ? undefined : t.employeeId,
          performanceInputCreated: keepInputFlag(t),
          updatedAt
        }));

      const updatedAwards = this.awardRecords
        .filter((a) => a.employeeId !== id && a.relatedPerformanceInputIds.some((i) => deletedInputIds.has(i)))
        .map((a) => ({
          ...a,
          relatedPerformanceInputIds: a.relatedPerformanceInputIds.filter((i) => !deletedInputIds.has(i)),
          updatedAt
        }));

      const updatedMeetings = this.meetingNotes
        .filter((n) => n.attendeeEmployeeIds.includes(id))
        .map((n) => ({ ...n, attendeeEmployeeIds: n.attendeeEmployeeIds.filter((e) => e !== id), updatedAt }));

      const updatedProjects = this.projects
        .filter((p) => p.leadEmployeeId === id)
        .map((p) => ({ ...p, leadEmployeeId: undefined, updatedAt }));

      const updatedRequirements = this.trainingRequirements
        .filter((r) => r.assignedEmployeeIds?.includes(id))
        .map((r) => ({ ...r, assignedEmployeeIds: r.assignedEmployeeIds!.filter((e) => e !== id), updatedAt }));

      const entry = this.buildActivityEntry("employees", id, "deleted", `Deleted employee ${name} and their linked records`);
      const nextMeta = this.bumpedMeta("deleted");
      const ops: MutationOp[] = [
        ...inputs.map((r) => deleteOp("performanceInputs", r.id)),
        ...training.map((r) => deleteOp("employeeTrainingRecords", r.id)),
        ...leave.map((r) => deleteOp("leaveRecords", r.id)),
        ...telework.map((r) => deleteOp("teleworkRecords", r.id)),
        ...travel.map((r) => deleteOp("travelRecords", r.id)),
        ...awards.map((r) => deleteOp("awardRecords", r.id)),
        ...interactions.map((r) => deleteOp("employeeInteractions", r.id)),
        ...notes.map((r) => deleteOp("employeeNotes", r.id)),
        ...updatedTasks.map((t) => putOp("tasks", this.plainRecord(t))),
        ...updatedAwards.map((a) => putOp("awardRecords", this.plainRecord(a))),
        ...updatedMeetings.map((n) => putOp("meetingNotes", this.plainRecord(n))),
        ...updatedProjects.map((p) => putOp("projects", this.plainRecord(p))),
        ...updatedRequirements.map((r) => putOp("trainingRequirements", this.plainRecord(r))),
        deleteOp("employees", id),
        putOp("activityEntries", entry)
      ];
      if (nextMeta) ops.push({ kind: "saveMeta", meta: nextMeta });
      await this.store.mutate(ops);

      this.performanceInputs = survivingInputs;
      this.employeeTrainingRecords = this.employeeTrainingRecords.filter((r) => r.employeeId !== id);
      this.leaveRecords = this.leaveRecords.filter((r) => r.employeeId !== id);
      this.teleworkRecords = this.teleworkRecords.filter((r) => r.employeeId !== id);
      this.travelRecords = this.travelRecords.filter((r) => r.employeeId !== id);
      this.employeeInteractions = this.employeeInteractions.filter((r) => r.employeeId !== id);
      this.employeeNotes = this.employeeNotes.filter((r) => r.employeeId !== id);
      this.awardRecords = this.awardRecords
        .filter((a) => a.employeeId !== id)
        .map((a) => updatedAwards.find((u) => u.id === a.id) ?? a);
      this.tasks = this.tasks.map((t) => updatedTasks.find((u) => u.id === t.id) ?? t);
      this.meetingNotes = this.meetingNotes.map((n) => updatedMeetings.find((u) => u.id === n.id) ?? n);
      this.projects = this.projects.map((p) => updatedProjects.find((u) => u.id === p.id) ?? p);
      this.trainingRequirements = this.trainingRequirements.map(
        (r) => updatedRequirements.find((u) => u.id === r.id) ?? r
      );
      this.employees = this.employees.filter((e) => e.id !== id);

      this.activityEntries.push(entry);
      if (nextMeta) this.meta = nextMeta;
      this.saveStatus = "saved";
      this.toast(`Deleted employee ${name}`, "success");
    } catch (e) {
      this.saveStatus = "error";
      this.toast(`Delete failed: ${e instanceof Error ? e.message : String(e)}`, "error");
      throw e;
    }
  }

  // --- project service ----------------------------------------------------------
  /** Records that reference a project and will be unlinked when it is deleted. */
  projectLinkedRecordCounts(projectId: string) {
    return {
      tasks: this.tasks.filter((t) => t.projectId === projectId).length,
      meetingNotes: this.meetingNotes.filter((n) => n.projectId === projectId).length,
      performanceInputs: this.performanceInputs.filter((p) => p.projectId === projectId).length
    };
  }

  /**
   * Permanently delete a project. Tasks, meeting notes, and performance inputs
   * that referenced it survive but are unlinked (their projectId is cleared),
   * so nothing is left pointing at a project that no longer exists.
   */
  async deleteProject(projectOrId: Project | string): Promise<void> {
    const project = typeof projectOrId === "string" ? this.projects.find((p) => p.id === projectOrId) : projectOrId;
    if (!project) return;
    this.saveStatus = "saving";
    try {
      const id = project.id;
      const name = project.name;
      const updatedAt = nowTimestamp();

      const updatedTasks = this.tasks.filter((t) => t.projectId === id).map((t) => ({ ...t, projectId: undefined, updatedAt }));

      const updatedMeetings = this.meetingNotes
        .filter((n) => n.projectId === id)
        .map((n) => ({ ...n, projectId: undefined, updatedAt }));

      const updatedInputs = this.performanceInputs
        .filter((p) => p.projectId === id)
        .map((p) => ({ ...p, projectId: undefined, updatedAt }));

      const entry = this.buildActivityEntry("projects", id, "deleted", `Deleted project ${name}`);
      const nextMeta = this.bumpedMeta("deleted");
      const ops: MutationOp[] = [
        ...updatedTasks.map((t) => putOp("tasks", this.plainRecord(t))),
        ...updatedMeetings.map((n) => putOp("meetingNotes", this.plainRecord(n))),
        ...updatedInputs.map((p) => putOp("performanceInputs", this.plainRecord(p))),
        deleteOp("projects", id),
        putOp("activityEntries", entry)
      ];
      if (nextMeta) ops.push({ kind: "saveMeta", meta: nextMeta });
      await this.store.mutate(ops);

      this.tasks = this.tasks.map((t) => updatedTasks.find((u) => u.id === t.id) ?? t);
      this.meetingNotes = this.meetingNotes.map((n) => updatedMeetings.find((u) => u.id === n.id) ?? n);
      this.performanceInputs = this.performanceInputs.map((p) => updatedInputs.find((u) => u.id === p.id) ?? p);
      this.projects = this.projects.filter((p) => p.id !== id);

      this.activityEntries.push(entry);
      if (nextMeta) this.meta = nextMeta;
      this.saveStatus = "saved";
      this.toast(`Deleted project ${name}`, "success");
    } catch (e) {
      this.saveStatus = "error";
      this.toast(`Delete failed: ${e instanceof Error ? e.message : String(e)}`, "error");
      throw e;
    }
  }

  // --- training service ---------------------------------------------------------
  /**
   * Record a completion for one employee, creating the fact record on first
   * touch. Returns the pre-mutation record (undefined when newly created) so
   * callers can offer Undo.
   */
  async markTrainingComplete(employee: Employee, req: TrainingRequirement, completedDate: IsoDate): Promise<EmployeeTrainingRecord | undefined> {
    const existing = this.employeeTrainingRecords.find(
      (r) => r.employeeId === employee.id && r.trainingRequirementId === req.id
    );
    const before = existing ? ($state.snapshot(existing) as EmployeeTrainingRecord) : undefined;
    const now = nowTimestamp();
    const updated: EmployeeTrainingRecord = {
      id: existing?.id ?? newId(),
      employeeId: employee.id,
      trainingRequirementId: req.id,
      ...existing,
      completedDate,
      // Rolling requirements carry their expiration; fixed-date cycles are
      // governed by the requirement's due date instead.
      expirationDate: rollingExpiration(req, completedDate),
      status: "complete",
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    };
    await this.putRecord("employeeTrainingRecords", updated, {
      actionType: "completed",
      summary: `Marked ${req.name} complete for ${employee.displayName}`
    });
    return before;
  }

  async undoTrainingComplete(req: TrainingRequirement, current: EmployeeTrainingRecord, before: EmployeeTrainingRecord | undefined): Promise<void> {
    const restored: EmployeeTrainingRecord = before
      ? { ...before, updatedAt: nowTimestamp() }
      : { ...current, completedDate: undefined, expirationDate: undefined, status: "assigned", updatedAt: nowTimestamp() };
    await this.putRecord("employeeTrainingRecords", restored, {
      actionType: "updated",
      summary: `Undid completion of ${req.name} for ${this.employeeName(current.employeeId)}`
    });
  }

  // --- backup -----------------------------------------------------------------
  /**
   * Build the backup package without touching any state. The caller records it
   * as completed only after the browser accepts the download request.
   */
  async buildBackup(): Promise<BackupPackage> {
    const snapshot = await this.store.exportSnapshot();
    return createBackupPackage(snapshot);
  }

  /** Record an initiated backup download: reset the change counter and reminder. */
  async markBackupCompleted(pkg: BackupPackage): Promise<void> {
    const totalRecords = Object.values(pkg.integrity.recordCounts).reduce((a, b) => a + b, 0);
    const entry = this.buildActivityEntry("system", "backup", "exported", `Exported backup with ${totalRecords} records`);
    const nextMeta: StoreMeta = {
      ...($state.snapshot(this.meta) as StoreMeta),
      lastBackupAt: pkg.exportedAt,
      changesSinceBackup: 0
    };
    await this.store.mutate([putOp("activityEntries", entry), { kind: "saveMeta", meta: nextMeta }]);
    this.activityEntries.push(entry);
    this.meta = nextMeta;
  }

  async replaceDatabase(pkg: BackupPackage): Promise<void> {
    // Unwrap any $state proxy: IndexedDB structured clone rejects Proxy objects.
    const snapshot = snapshotFromBackup(this.plainRecord(pkg));
    snapshot.collections.activityEntries.push(
      this.buildActivityEntry("system", "backup", "imported", `Imported backup exported at ${pkg.exportedAt}`)
    );
    await this.store.replaceAll(snapshot);
    await this.loadAll();
  }

  async loadSampleData(): Promise<void> {
    const snapshot = createSampleSnapshot();
    snapshot.collections.activityEntries.push(
      this.buildActivityEntry("system", "sample", "imported", "Loaded sample data")
    );
    await this.store.replaceAll(snapshot);
    await this.loadAll();
  }

  async resetAllData(): Promise<void> {
    await this.store.clearAll();
    await this.loadAll();
  }

  recordCounts(): Record<string, number> {
    return Object.fromEntries(COLLECTION_NAMES.map((n) => [n, this.stateList(n).length]));
  }

  // --- attention snooze ---------------------------------------------------------
  async snoozeAttention(item: AttentionItem, until: string, reason?: string): Promise<void> {
    const snooze: AttentionSnooze = { id: snoozeKey(item), snoozedUntil: until, snoozeReason: reason };
    await this.putRecord("attentionSnoozes", snooze);
  }

  // --- toasts -------------------------------------------------------------------
  toast(message: string, kind: Toast["kind"] = "info", undo?: () => void): void {
    const t: Toast = { id: newId(), message, kind, undo };
    this.toasts.push(t);
    setTimeout(() => {
      const idx = this.toasts.findIndex((x) => x.id === t.id);
      if (idx >= 0) this.toasts.splice(idx, 1);
    }, 8000);
  }

  dismissToast(id: string): void {
    const idx = this.toasts.findIndex((x) => x.id === id);
    if (idx >= 0) this.toasts.splice(idx, 1);
  }
}

export const app = new AppStore();
