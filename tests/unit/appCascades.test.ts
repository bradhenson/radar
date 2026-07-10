// Failure-injection tests around the cascading mutations in the app store.
// Every cascade is a single DataStore.mutate() batch, so a mid-cascade
// failure must leave both the store and the reactive state untouched.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppStore } from "../../src/stores/app.svelte";
import { InMemoryDataStore } from "../../src/data/InMemoryDataStore";
import { emptyCollections, type DatabaseSnapshot, type MutationOp } from "../../src/data/DataStore";
import { DEFAULT_SETTINGS, type Employee, type LeaveRecord, type PerformanceInput, type Project, type Task, type TaskNote } from "../../src/domain/models";

const NOW = "2026-01-01T00:00:00.000Z";

function makeEmployee(id: string): Employee {
  return {
    id,
    displayName: `Employee ${id}`,
    activeStatus: "active",
    tags: [],
    createdAt: NOW,
    updatedAt: NOW,
    isArchived: false
  };
}

function makeTask(id: string, partial: Partial<Task> = {}): Task {
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
    isArchived: false,
    ...partial
  };
}

function makeInput(id: string, employeeId: string, partial: Partial<PerformanceInput> = {}): PerformanceInput {
  return {
    id,
    employeeId,
    inputDate: "2026-01-01",
    actionOrAccomplishment: "Did a thing",
    inputStatus: "draft",
    recognitionPotential: false,
    tags: [],
    createdAt: NOW,
    updatedAt: NOW,
    isArchived: false,
    ...partial
  };
}

function makeLeave(id: string, employeeId: string, partial: Partial<LeaveRecord> = {}): LeaveRecord {
  return {
    id,
    employeeId,
    startDate: "2026-02-01",
    endDate: "2026-02-05",
    status: "approved",
    createdAt: NOW,
    updatedAt: NOW,
    ...partial
  };
}

function makeProject(id: string): Project {
  return {
    id,
    name: `Project ${id}`,
    status: "active",
    tags: [],
    createdAt: NOW,
    updatedAt: NOW,
    isArchived: false
  };
}

function makeNote(id: string, taskId: string): TaskNote {
  return { id, taskId, body: "note", noteType: "general", createdAt: NOW, updatedAt: NOW };
}

/** InMemory store whose next mutate() call fails before applying anything. */
class FailingMutateStore extends InMemoryDataStore {
  failNextMutate = false;
  override async mutate(ops: MutationOp[]): Promise<void> {
    if (this.failNextMutate) {
      this.failNextMutate = false;
      throw new Error("injected mutate failure");
    }
    return super.mutate(ops);
  }
}

function baseSnapshot(): DatabaseSnapshot {
  const collections = emptyCollections();
  collections.employees = [makeEmployee("e1")];
  collections.projects = [makeProject("p1")];
  collections.tasks = [
    makeTask("t1", { employeeId: "e1", projectId: "p1", performanceInputCreated: true }),
    makeTask("t2", { projectId: "p1" })
  ];
  collections.taskNotes = [makeNote("n1", "t1")];
  collections.performanceInputs = [makeInput("pi1", "e1", { relatedTaskId: "t1", projectId: "p1" })];
  collections.leaveRecords = [makeLeave("l1", "e1", { relatedTaskId: "t1" })];
  return {
    collections,
    settings: { ...DEFAULT_SETTINGS },
    meta: { databaseId: "test-db", changesSinceBackup: 0 }
  };
}

async function bootApp(): Promise<{ app: AppStore; store: FailingMutateStore }> {
  const store = new FailingMutateStore();
  await store.initialize();
  await store.replaceAll(baseSnapshot());
  const app = new AppStore();
  await app.initializeFrom(store);
  return { app, store };
}

beforeEach(() => {
  // Toasts schedule an 8s dismissal; keep the test process free of real timers.
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("deleteEmployee cascade", () => {
  it("removes owned records, unlinks shared ones, and records activity atomically", async () => {
    const { app, store } = await bootApp();
    await app.deleteEmployee("e1");

    expect(app.employees).toHaveLength(0);
    expect(app.performanceInputs).toHaveLength(0);
    expect(app.leaveRecords).toHaveLength(0);
    // Shared task survives, unlinked, and gets its input flag back.
    const t1 = app.tasks.find((t) => t.id === "t1")!;
    expect(t1.employeeId).toBeUndefined();
    expect(t1.performanceInputCreated).toBe(false);
    // The audit trail landed in the same batch.
    expect(app.activityEntries.some((a) => a.actionType === "deleted" && a.entityType === "employees")).toBe(true);
    expect(app.meta.changesSinceBackup).toBe(1);
    // Store agrees with state.
    expect(await store.getAll("employees")).toHaveLength(0);
    expect(await store.getAll("performanceInputs")).toHaveLength(0);
  });

  it("leaves state and store untouched when the batch fails", async () => {
    const { app, store } = await bootApp();
    store.failNextMutate = true;

    await expect(app.deleteEmployee("e1")).rejects.toThrow("injected mutate failure");

    expect(app.employees).toHaveLength(1);
    expect(app.performanceInputs).toHaveLength(1);
    expect(app.leaveRecords).toHaveLength(1);
    expect(app.tasks.find((t) => t.id === "t1")!.employeeId).toBe("e1");
    expect(app.meta.changesSinceBackup).toBe(0);
    expect(app.saveStatus).toBe("error");
    expect(await store.getAll("employees")).toHaveLength(1);
    expect(await store.getAll("performanceInputs")).toHaveLength(1);
    expect((await store.getAll("activityEntries")).some((a) => a.actionType === "deleted")).toBe(false);
  });
});

describe("deleteTask cascade", () => {
  it("deletes notes and unlinks related records atomically", async () => {
    const { app, store } = await bootApp();
    await app.deleteTask("t1");

    expect(app.tasks.some((t) => t.id === "t1")).toBe(false);
    expect(app.taskNotes).toHaveLength(0);
    expect(app.performanceInputs[0]!.relatedTaskId).toBeUndefined();
    expect(app.leaveRecords[0]!.relatedTaskId).toBeUndefined();
    expect((await store.getAll("taskNotes"))).toHaveLength(0);
  });

  it("leaves everything untouched when the batch fails", async () => {
    const { app, store } = await bootApp();
    store.failNextMutate = true;

    await expect(app.deleteTask("t1")).rejects.toThrow("injected mutate failure");

    expect(app.tasks.some((t) => t.id === "t1")).toBe(true);
    expect(app.taskNotes).toHaveLength(1);
    expect(app.performanceInputs[0]!.relatedTaskId).toBe("t1");
    expect(app.leaveRecords[0]!.relatedTaskId).toBe("t1");
    expect((await store.getAll("tasks")).some((t) => t.id === "t1")).toBe(true);
    expect(await store.getAll("taskNotes")).toHaveLength(1);
  });
});

describe("deleteProject cascade", () => {
  it("unlinks tasks and inputs atomically", async () => {
    const { app, store } = await bootApp();
    await app.deleteProject("p1");

    expect(app.projects).toHaveLength(0);
    expect(app.tasks.every((t) => t.projectId === undefined)).toBe(true);
    expect(app.performanceInputs[0]!.projectId).toBeUndefined();
    expect(await store.getAll("projects")).toHaveLength(0);
  });

  it("leaves everything untouched when the batch fails", async () => {
    const { app, store } = await bootApp();
    store.failNextMutate = true;

    await expect(app.deleteProject("p1")).rejects.toThrow("injected mutate failure");

    expect(app.projects).toHaveLength(1);
    expect(app.tasks.filter((t) => t.projectId === "p1")).toHaveLength(2);
    expect(app.performanceInputs[0]!.projectId).toBe("p1");
    expect(await store.getAll("projects")).toHaveLength(1);
  });
});

describe("deletePerformanceInput cascade", () => {
  it("clears the task's input flag atomically", async () => {
    const { app } = await bootApp();
    await app.deletePerformanceInput("pi1");

    expect(app.performanceInputs).toHaveLength(0);
    expect(app.tasks.find((t) => t.id === "t1")!.performanceInputCreated).toBe(false);
  });

  it("leaves everything untouched when the batch fails", async () => {
    const { app, store } = await bootApp();
    store.failNextMutate = true;

    await expect(app.deletePerformanceInput("pi1")).rejects.toThrow("injected mutate failure");

    expect(app.performanceInputs).toHaveLength(1);
    expect(app.tasks.find((t) => t.id === "t1")!.performanceInputCreated).toBe(true);
    expect(await store.getAll("performanceInputs")).toHaveLength(1);
  });
});

describe("putRecord bundles record + activity + meta", () => {
  it("commits all three together", async () => {
    const { app, store } = await bootApp();
    await app.putRecord("tasks", makeTask("t9"), { actionType: "created", summary: 'Created task "t9"' });

    expect(app.tasks.some((t) => t.id === "t9")).toBe(true);
    expect(app.meta.changesSinceBackup).toBe(1);
    expect((await store.getAll("activityEntries")).some((a) => a.entityId === "t9")).toBe(true);
  });

  it("commits none of them on failure", async () => {
    const { app, store } = await bootApp();
    store.failNextMutate = true;

    await expect(
      app.putRecord("tasks", makeTask("t9"), { actionType: "created", summary: 'Created task "t9"' })
    ).rejects.toThrow("injected mutate failure");

    expect(app.tasks.some((t) => t.id === "t9")).toBe(false);
    expect(app.meta.changesSinceBackup).toBe(0);
    expect(await store.getAll("activityEntries")).toHaveLength(0);
    expect(app.saveStatus).toBe("error");
  });
});

describe("saveSettings", () => {
  it("commits settings, activity, and backup metadata together", async () => {
    const { app, store } = await bootApp();
    await app.saveSettings({ ...app.settings, dueSoonDays: 12 });

    expect(app.settings.dueSoonDays).toBe(12);
    expect((await store.getSettings())!.dueSoonDays).toBe(12);
    expect(app.meta.changesSinceBackup).toBe(1);
    expect((await store.getAll("activityEntries")).some((entry) => entry.entityType === "settings" && entry.actionType === "updated")).toBe(true);
  });

  it("keeps the current settings when the atomic save fails", async () => {
    const { app, store } = await bootApp();
    store.failNextMutate = true;

    await expect(app.saveSettings({ ...app.settings, dueSoonDays: 12 })).rejects.toThrow("injected mutate failure");

    expect(app.settings.dueSoonDays).toBe(DEFAULT_SETTINGS.dueSoonDays);
    expect((await store.getSettings())!.dueSoonDays).toBe(DEFAULT_SETTINGS.dueSoonDays);
    expect(app.meta.changesSinceBackup).toBe(0);
    expect(app.saveStatus).toBe("error");
  });
});
