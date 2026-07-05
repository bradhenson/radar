// Central application state and service layer (plan section 8.7).
// All mutations pass through here: they persist via the DataStore,
// update reactive state, and record activity entries.

import type {
  ActivityEntry,
  AppSettings,
  AttentionSnooze,
  AwardRecord,
  BoardColumnDefinition,
  ChecklistItem,
  Competency,
  Employee,
  EmployeeInteraction,
  EmployeeTrainingRecord,
  EvaluationCycle,
  LeaveRecord,
  PerformanceElement,
  PerformanceInput,
  Project,
  Task,
  TaskCategoryDefinition,
  TaskNote,
  TaskStatus,
  TeleworkRecord,
  TrainingRequirement
} from "../domain/models";
import { DEFAULT_BOARD_COLUMN_SEEDS, DEFAULT_SETTINGS, DEFAULT_TASK_CATEGORY_SEEDS } from "../domain/models";
import type { CollectionName, CollectionTypes, DataStore, DatabaseSnapshot, StoreMeta } from "../data/DataStore";
import { COLLECTION_NAMES } from "../data/DataStore";
import { IndexedDbDataStore } from "../data/IndexedDbDataStore";
import { InMemoryDataStore } from "../data/InMemoryDataStore";
import { createBackupPackage, snapshotFromBackup, type BackupPackage } from "../data/backup";
import { createSampleSnapshot } from "../data/seed";
import { newId } from "../utils/ids";
import { nowTimestamp, todayIso } from "../utils/dates";
import { orderForAppend } from "../domain/rules/boardOrder";
import { computeAttention, snoozeKey, type AttentionItem } from "../domain/rules/attention";

export type SaveStatus = "saved" | "saving" | "error";

export interface Toast {
  id: string;
  message: string;
  kind: "info" | "success" | "error";
  undo?: () => void;
}

const MUTATING_ACTIVITY = new Set(["created", "updated", "status_changed", "completed", "reopened", "archived", "restored", "deleted"]);

class AppStore {
  // --- reactive entity state ------------------------------------------------
  competencies = $state<Competency[]>([]);
  employees = $state<Employee[]>([]);
  projects = $state<Project[]>([]);
  tasks = $state<Task[]>([]);
  boardColumns = $state<BoardColumnDefinition[]>([]);
  taskCategories = $state<TaskCategoryDefinition[]>([]);
  taskNotes = $state<TaskNote[]>([]);
  checklistItems = $state<ChecklistItem[]>([]);
  performanceElements = $state<PerformanceElement[]>([]);
  evaluationCycles = $state<EvaluationCycle[]>([]);
  performanceInputs = $state<PerformanceInput[]>([]);
  trainingRequirements = $state<TrainingRequirement[]>([]);
  employeeTrainingRecords = $state<EmployeeTrainingRecord[]>([]);
  leaveRecords = $state<LeaveRecord[]>([]);
  teleworkRecords = $state<TeleworkRecord[]>([]);
  awardRecords = $state<AwardRecord[]>([]);
  employeeInteractions = $state<EmployeeInteraction[]>([]);
  activityEntries = $state<ActivityEntry[]>([]);
  attentionSnoozes = $state<AttentionSnooze[]>([]);

  settings = $state<AppSettings>({ ...DEFAULT_SETTINGS });
  meta = $state<StoreMeta>({ databaseId: "", changesSinceBackup: 0 });
  saveStatus = $state<SaveStatus>("saved");
  storageKind = $state<"indexeddb" | "memory" | "unknown">("unknown");
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
      lastBackupAt: this.meta.lastBackupAt,
      changesSinceBackup: this.meta.changesSinceBackup,
      snoozes: this.attentionSnoozes
    })
  );

  activeEmployees = $derived(this.employees.filter((e) => e.activeStatus === "active" && !e.isArchived));
  activeProjects = $derived(this.projects.filter((p) => p.status === "active" && !p.isArchived));
  boardColumnList = $derived(
    [...this.boardColumns].sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label))
  );
  activeBoardColumns = $derived(this.boardColumnList);
  taskCategoryList = $derived(
    [...this.taskCategories].sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label))
  );
  activeTaskCategories = $derived(this.taskCategoryList.filter((c) => !c.isArchived));

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

  taskCategoryLabel(id: string | undefined): string {
    if (!id) return "";
    return this.taskCategories.find((c) => c.id === id)?.label ?? this.legacyCategoryLabel(id);
  }

  taskCategoryOptions(currentCategory?: string): TaskCategoryDefinition[] {
    const options = this.taskCategoryList.filter((c) => !c.isArchived || c.id === currentCategory);
    if (currentCategory && !options.some((c) => c.id === currentCategory)) {
      options.push({
        id: currentCategory,
        label: this.taskCategoryLabel(currentCategory),
        sortOrder: Number.MAX_SAFE_INTEGER,
        isArchived: false,
        createdAt: "",
        updatedAt: ""
      });
    }
    return options;
  }

  taskCategoryUsage(id: string): number {
    return this.tasks.filter((t) => t.category === id).length;
  }

  defaultTaskCategoryId(): string {
    return this.activeTaskCategories.find((c) => c.id === "general")?.id ?? this.activeTaskCategories[0]?.id ?? "general";
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
  async initialize(): Promise<void> {
    try {
      if (IndexedDbDataStore.isSupported()) {
        try {
          const idb = new IndexedDbDataStore();
          await idb.initialize();
          this.store = idb;
          this.storageKind = "indexeddb";
        } catch (e) {
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
      // First run: seed the two default competencies (plan 15.3).
      if (this.competencies.length === 0) {
        const now = nowTimestamp();
        for (const code of ["55140", "55230"]) {
          const comp: Competency = { id: newId(), code, name: `Competency ${code}`, active: true, createdAt: now, updatedAt: now };
          await this.store.put("competencies", comp);
          this.competencies.push(comp);
        }
      }
      this.initialized = true;
    } catch (e) {
      this.initError = e instanceof Error ? e.message : String(e);
    }
    // Keep "today" current across midnight while the app stays open.
    setInterval(() => {
      this.today = todayIso();
    }, 60_000);
  }

  private async loadAll(): Promise<void> {
    const [snapshot, settings, meta] = await Promise.all([
      this.store.exportSnapshot(),
      this.store.getSettings(),
      this.store.getMeta()
    ]);
    this.applySnapshotToState(snapshot);
    this.settings = settings ?? { ...DEFAULT_SETTINGS };
    this.meta = meta;
    await this.ensureBoardColumns();
    await this.ensureTaskCategories();
  }

  private applySnapshotToState(snapshot: DatabaseSnapshot): void {
    this.competencies = snapshot.collections.competencies;
    this.employees = snapshot.collections.employees;
    this.projects = snapshot.collections.projects;
    this.tasks = snapshot.collections.tasks;
    this.boardColumns = snapshot.collections.boardColumns;
    this.taskCategories = snapshot.collections.taskCategories;
    this.taskNotes = snapshot.collections.taskNotes;
    this.checklistItems = snapshot.collections.checklistItems;
    this.performanceElements = snapshot.collections.performanceElements;
    this.evaluationCycles = snapshot.collections.evaluationCycles;
    this.performanceInputs = snapshot.collections.performanceInputs;
    this.trainingRequirements = snapshot.collections.trainingRequirements;
    this.employeeTrainingRecords = snapshot.collections.employeeTrainingRecords;
    this.leaveRecords = snapshot.collections.leaveRecords;
    this.teleworkRecords = snapshot.collections.teleworkRecords;
    this.awardRecords = snapshot.collections.awardRecords;
    this.employeeInteractions = snapshot.collections.employeeInteractions;
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

  private legacyCategoryLabel(id: string): string {
    const known = new Map<string, string>([
      ...DEFAULT_TASK_CATEGORY_SEEDS.map((c) => [c.id, c.label] as const),
      ["leave", "Leave"],
      ["telework", "Telework"],
      ["award", "Award"],
      ["timekeeping", "Timekeeping"],
      ["meeting", "Meeting Follow-up"]
    ]);
    return (
      known.get(id) ??
      id
        .split(/[-_]/)
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ")
    );
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

  private defaultBoardColumnIdForStatus(status: TaskStatus): string {
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

  private uniqueTaskCategoryId(label: string): string {
    const base = label
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "category";
    const existing = new Set(this.taskCategories.map((c) => c.id));
    if (!existing.has(base)) return base;
    let suffix = 2;
    while (existing.has(`${base}-${suffix}`)) suffix += 1;
    return `${base}-${suffix}`;
  }

  private async ensureTaskCategories(): Promise<void> {
    const now = nowTimestamp();
    const existing = new Map(this.taskCategories.map((c) => [c.id, c]));
    const additions: TaskCategoryDefinition[] = [];
    let nextOrder =
      this.taskCategories.reduce((max, c) => Math.max(max, Number.isFinite(c.sortOrder) ? c.sortOrder : 0), 0) + 10;

    for (const seed of DEFAULT_TASK_CATEGORY_SEEDS) {
      if (!existing.has(seed.id)) {
        const record: TaskCategoryDefinition = {
          id: seed.id,
          label: seed.label,
          sortOrder: seed.sortOrder,
          isArchived: false,
          createdAt: now,
          updatedAt: now
        };
        existing.set(record.id, record);
        additions.push(record);
      }
    }

    for (const task of this.tasks) {
      if (task.category && !existing.has(task.category)) {
        const record: TaskCategoryDefinition = {
          id: task.category,
          label: this.legacyCategoryLabel(task.category),
          sortOrder: nextOrder,
          isArchived: false,
          createdAt: now,
          updatedAt: now
        };
        nextOrder += 10;
        existing.set(record.id, record);
        additions.push(record);
      }
    }

    for (const category of additions) {
      await this.store.put("taskCategories", category);
      this.taskCategories.push(category);
    }
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

  // --- generic persistence helpers -------------------------------------------
  async putRecord<K extends CollectionName>(
    name: K,
    record: CollectionTypes[K],
    activity?: { actionType: string; summary: string; entityType?: string }
  ): Promise<void> {
    this.saveStatus = "saving";
    try {
      const persisted = this.plainRecord(record);
      await this.store.put(name, persisted);
      const list = this.stateList(name);
      const idx = list.findIndex((r) => r.id === persisted.id);
      if (idx >= 0) list[idx] = persisted;
      else list.push(persisted);
      if (activity) {
        await this.recordActivity(activity.entityType ?? name, persisted.id, activity.actionType, activity.summary);
      }
      await this.bumpChangeCount(activity?.actionType);
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
      await this.store.delete(name, id);
      const list = this.stateList(name) as { id: string }[];
      const idx = list.findIndex((r) => r.id === id);
      if (idx >= 0) list.splice(idx, 1);
      await this.recordActivity(name, id, "deleted", summary);
      await this.bumpChangeCount("deleted");
      this.saveStatus = "saved";
    } catch (e) {
      this.saveStatus = "error";
      this.toast(`Delete failed: ${e instanceof Error ? e.message : String(e)}`, "error");
      throw e;
    }
  }

  private async recordActivity(entityType: string, entityId: string, actionType: string, summary: string): Promise<void> {
    const entry: ActivityEntry = {
      id: newId(),
      entityType,
      entityId,
      actionType,
      timestamp: nowTimestamp(),
      summary,
      sessionId: this.sessionId
    };
    await this.store.put("activityEntries", entry);
    this.activityEntries.push(entry);
  }

  private async bumpChangeCount(actionType?: string): Promise<void> {
    if (actionType && !MUTATING_ACTIVITY.has(actionType)) return;
    this.meta = { ...this.meta, changesSinceBackup: this.meta.changesSinceBackup + 1 };
    await this.store.saveMeta($state.snapshot(this.meta));
  }

  async saveSettings(settings: AppSettings): Promise<void> {
    this.settings = settings;
    await this.store.saveSettings($state.snapshot(settings) as AppSettings);
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
      ordered.map((column) => (column.id === current.id ? other : column.id === other.id ? current : column))
    );
    await this.recordActivity("boardColumns", current.id, "updated", `Reordered board column "${current.label}"`);
    await this.bumpChangeCount("updated");
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
    await this.reorderBoardColumns(ordered);
    await this.recordActivity("boardColumns", dragged.id, "updated", `Reordered board column "${dragged.label}"`);
    await this.bumpChangeCount("updated");
  }

  private async reorderBoardColumns(ordered: BoardColumnDefinition[]): Promise<void> {
    const now = nowTimestamp();
    const updated = ordered.map((column, index) => ({
      ...column,
      sortOrder: (index + 1) * 10,
      updatedAt: now
    }));
    this.saveStatus = "saving";
    try {
      await this.store.bulkPut("boardColumns", this.plainRecords(updated));
      for (const column of updated) {
        const idx = this.boardColumns.findIndex((c) => c.id === column.id);
        if (idx >= 0) this.boardColumns[idx] = column;
      }
      this.saveStatus = "saved";
    } catch (e) {
      this.saveStatus = "error";
      this.toast(`Save failed: ${e instanceof Error ? e.message : String(e)}`, "error");
      throw e;
    }
  }

  // --- task category service --------------------------------------------------
  async createTaskCategory(label: string): Promise<void> {
    const trimmed = label.trim();
    if (!trimmed) throw new Error("Category name is required.");
    if (this.taskCategories.some((c) => c.label.toLowerCase() === trimmed.toLowerCase())) {
      throw new Error("A category with that name already exists.");
    }
    const now = nowTimestamp();
    const category: TaskCategoryDefinition = {
      id: this.uniqueTaskCategoryId(trimmed),
      label: trimmed,
      sortOrder:
        this.taskCategories.reduce((max, c) => Math.max(max, Number.isFinite(c.sortOrder) ? c.sortOrder : 0), 0) + 10,
      isArchived: false,
      createdAt: now,
      updatedAt: now
    };
    await this.putRecord("taskCategories", category, {
      actionType: "created",
      summary: `Created task category "${category.label}"`
    });
  }

  async renameTaskCategory(id: string, label: string): Promise<void> {
    const trimmed = label.trim();
    if (!trimmed) throw new Error("Category name is required.");
    const category = this.taskCategories.find((c) => c.id === id);
    if (!category) throw new Error("Category not found.");
    if (this.taskCategories.some((c) => c.id !== id && c.label.toLowerCase() === trimmed.toLowerCase())) {
      throw new Error("A category with that name already exists.");
    }
    if (category.label === trimmed) return;
    await this.putRecord(
      "taskCategories",
      { ...category, label: trimmed, updatedAt: nowTimestamp() },
      { actionType: "updated", summary: `Renamed task category "${category.label}" to "${trimmed}"` }
    );
  }

  async setTaskCategoryArchived(id: string, isArchived: boolean): Promise<void> {
    const category = this.taskCategories.find((c) => c.id === id);
    if (!category) throw new Error("Category not found.");
    if (category.isArchived === isArchived) return;
    if (isArchived && this.activeTaskCategories.length <= 1) {
      throw new Error("At least one active category is required.");
    }
    await this.putRecord(
      "taskCategories",
      { ...category, isArchived, updatedAt: nowTimestamp() },
      {
        actionType: isArchived ? "archived" : "restored",
        summary: `${isArchived ? "Archived" : "Restored"} task category "${category.label}"`
      }
    );
  }

  async moveTaskCategory(id: string, offset: -1 | 1): Promise<void> {
    const ordered = this.taskCategoryList;
    const idx = ordered.findIndex((c) => c.id === id);
    const other = ordered[idx + offset];
    const current = ordered[idx];
    if (!current || !other) return;

    const moved: TaskCategoryDefinition = { ...current, sortOrder: other.sortOrder, updatedAt: nowTimestamp() };
    const swapped: TaskCategoryDefinition = { ...other, sortOrder: current.sortOrder, updatedAt: nowTimestamp() };
    this.saveStatus = "saving";
    try {
      await this.store.bulkPut("taskCategories", this.plainRecords([moved, swapped]));
      for (const record of [moved, swapped]) {
        const stateIdx = this.taskCategories.findIndex((c) => c.id === record.id);
        if (stateIdx >= 0) this.taskCategories[stateIdx] = record;
      }
      await this.recordActivity("taskCategories", moved.id, "updated", `Reordered task category "${moved.label}"`);
      await this.bumpChangeCount("updated");
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
    const status = partial.status ?? "inbox";
    const boardColumnId = partial.boardColumnId ?? this.defaultBoardColumnId();
    return {
      id: newId(),
      status,
      boardColumnId,
      priority: "normal",
      category: this.defaultTaskCategoryId(),
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

  async moveTaskToBoardColumn(task: Task, boardColumnId: string, boardOrder: number): Promise<void> {
    const prev = this.taskBoardColumnId(task);
    const updated: Task = { ...task, boardColumnId, boardOrder, updatedAt: nowTimestamp() };
    await this.putRecord("tasks", updated, {
      actionType: "updated",
      summary: `Moved "${task.title}" from ${this.boardColumnLabel(prev)} to ${this.boardColumnLabel(boardColumnId)}`
    });
  }

  async moveTask(task: Task, status: TaskStatus, boardOrder: number): Promise<void> {
    const prev = task.status;
    const updated: Task = { ...task, status, boardOrder, updatedAt: nowTimestamp() };
    if (status === "waiting" && prev !== "waiting") updated.waitingSince = nowTimestamp();
    if (status === "complete" && prev !== "complete") updated.completedDate = this.today;
    if (status !== "complete") updated.completedDate = undefined;
    await this.putRecord("tasks", updated, {
      actionType: "status_changed",
      summary: `Moved "${task.title}" from ${prev} to ${status}`
    });
  }

  async completeTask(task: Task): Promise<Task> {
    const before = $state.snapshot(task) as Task;
    const updated: Task = { ...task, status: "complete", completedDate: this.today, updatedAt: nowTimestamp() };
    await this.putRecord("tasks", updated, { actionType: "completed", summary: `Completed "${task.title}"` });
    this.toast(`Completed "${task.title}"`, "success", async () => {
      await this.putRecord("tasks", { ...before, updatedAt: nowTimestamp() }, { actionType: "reopened", summary: `Reopened "${before.title}"` });
    });
    return updated;
  }

  // --- backup -----------------------------------------------------------------
  async buildBackup(): Promise<BackupPackage> {
    const snapshot = await this.store.exportSnapshot();
    const pkg = createBackupPackage(snapshot);
    this.meta = { ...this.meta, lastBackupAt: pkg.exportedAt, changesSinceBackup: 0 };
    await this.store.saveMeta($state.snapshot(this.meta));
    await this.recordActivity("system", "backup", "exported", `Exported backup with ${Object.values(pkg.integrity.recordCounts).reduce((a, b) => a + b, 0)} records`);
    return pkg;
  }

  async replaceDatabase(pkg: BackupPackage): Promise<void> {
    const snapshot = snapshotFromBackup(pkg);
    await this.store.replaceAll(snapshot);
    await this.loadAll();
    await this.recordActivity("system", "backup", "imported", `Imported backup exported at ${pkg.exportedAt}`);
  }

  async loadSampleData(): Promise<void> {
    const snapshot = createSampleSnapshot();
    await this.store.replaceAll(snapshot);
    await this.loadAll();
    await this.recordActivity("system", "sample", "imported", "Loaded sample data");
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
