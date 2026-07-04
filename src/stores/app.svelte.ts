// Central application state and service layer (plan section 8.7).
// All mutations pass through here: they persist via the DataStore,
// update reactive state, and record activity entries.

import type {
  ActivityEntry,
  AppSettings,
  AttentionSnooze,
  AwardRecord,
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
  TaskNote,
  TaskStatus,
  TeleworkRecord,
  TrainingRequirement
} from "../domain/models";
import { DEFAULT_SETTINGS } from "../domain/models";
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
  }

  private applySnapshotToState(snapshot: DatabaseSnapshot): void {
    this.competencies = snapshot.collections.competencies;
    this.employees = snapshot.collections.employees;
    this.projects = snapshot.collections.projects;
    this.tasks = snapshot.collections.tasks;
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

  // --- generic persistence helpers -------------------------------------------
  async putRecord<K extends CollectionName>(
    name: K,
    record: CollectionTypes[K],
    activity?: { actionType: string; summary: string; entityType?: string }
  ): Promise<void> {
    this.saveStatus = "saving";
    try {
      const persisted = $state.snapshot(record) as CollectionTypes[K];
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

  // --- task service -----------------------------------------------------------
  createTask(partial: Partial<Task> & { title: string }): Task {
    const now = nowTimestamp();
    const status = partial.status ?? "inbox";
    return {
      id: newId(),
      status,
      priority: "normal",
      category: "general",
      performanceInputCreated: false,
      tags: [],
      boardOrder: orderForAppend(this.tasks.filter((t) => t.status === status && !t.isArchived).map((t) => t.boardOrder)),
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
