import { describe, expect, it } from "vitest";
import {
  mergeTaskImportIntoDraft,
  performanceInputPrefillFromTask,
  shouldOfferTaskArchive,
  type PerformanceInputDraftFields
} from "../../src/domain/rules/performanceImport";
import type { ChecklistItem, Task, TaskNote } from "../../src/domain/models";

const TODAY = "2026-07-05";
const TS = "2026-07-01T12:00:00.000Z";

function makeTask(overrides: Partial<Task>): Task {
  return {
    id: overrides.id ?? "t1",
    title: "Migrate lab network",
    status: "open",
    priority: "normal",
    performanceInputCreated: false,
    tags: [],
    boardOrder: 1000,
    createdAt: TS,
    updatedAt: TS,
    isArchived: false,
    ...overrides
  };
}

function makeNote(overrides: Partial<TaskNote>): TaskNote {
  return {
    id: overrides.id ?? "n1",
    taskId: "t1",
    body: "note",
    noteType: "general",
    createdAt: TS,
    updatedAt: TS,
    ...overrides
  };
}

function makeChecklist(overrides: Partial<ChecklistItem>): ChecklistItem {
  return {
    id: overrides.id ?? "c1",
    taskId: "t1",
    title: "item",
    isComplete: false,
    order: 1,
    ...overrides
  };
}

function emptyDraft(overrides: Partial<PerformanceInputDraftFields> = {}): PerformanceInputDraftFields {
  return {
    employeeId: "",
    inputDate: "",
    situationOrContext: "",
    actionOrAccomplishment: "",
    result: "",
    projectId: "",
    ...overrides
  };
}

describe("performanceInputPrefillFromTask", () => {
  it("maps task fields onto input fields", () => {
    const task = makeTask({
      employeeId: "e1",
      projectId: "p1",
      description: "Legacy switch stack was failing.",
      status: "complete",
      completedDate: "2026-06-30"
    });
    const prefill = performanceInputPrefillFromTask(task, { today: TODAY });
    expect(prefill.employeeId).toBe("e1");
    expect(prefill.projectId).toBe("p1");
    expect(prefill.inputDate).toBe("2026-06-30");
    expect(prefill.situationOrContext).toBe("Legacy switch stack was failing.");
    expect(prefill.actionOrAccomplishment).toBe("Migrate lab network");
    expect(prefill.relatedTaskId).toBe("t1");
    expect(prefill.source).toBe("Completed Task");
  });

  it("uses today and source 'Task' for an incomplete task", () => {
    const prefill = performanceInputPrefillFromTask(makeTask({}), { today: TODAY });
    expect(prefill.inputDate).toBe(TODAY);
    expect(prefill.source).toBe("Task");
    expect(prefill.situationOrContext).toBeUndefined();
    expect(prefill.result).toBeUndefined();
  });

  it("lists completed checklist items under the action, in order", () => {
    const prefill = performanceInputPrefillFromTask(makeTask({}), {
      today: TODAY,
      checklistItems: [
        makeChecklist({ id: "c2", title: "Cut over VLANs", isComplete: true, order: 2 }),
        makeChecklist({ id: "c1", title: "Stage new switches", isComplete: true, order: 1 }),
        makeChecklist({ id: "c3", title: "Decommission old stack", isComplete: false, order: 3 }),
        makeChecklist({ id: "c4", taskId: "other", title: "Unrelated", isComplete: true, order: 1 })
      ]
    });
    expect(prefill.actionOrAccomplishment).toBe(
      "Migrate lab network\n- Stage new switches\n- Cut over VLANs"
    );
  });

  it("suggests completion notes as the result, oldest first", () => {
    const prefill = performanceInputPrefillFromTask(makeTask({}), {
      today: TODAY,
      notes: [
        makeNote({ id: "n2", noteType: "completion", body: "Zero downtime.", createdAt: "2026-07-02T09:00:00.000Z" }),
        makeNote({ id: "n1", noteType: "completion", body: "Cutover done.", createdAt: "2026-07-01T09:00:00.000Z" }),
        makeNote({ id: "n3", noteType: "status", body: "In progress." }),
        makeNote({ id: "n4", taskId: "other", noteType: "completion", body: "Unrelated." })
      ]
    });
    expect(prefill.result).toBe("Cutover done.\nZero downtime.");
  });
});

describe("mergeTaskImportIntoDraft", () => {
  const prefill = {
    employeeId: "e1",
    inputDate: "2026-06-30",
    situationOrContext: "Context from task",
    actionOrAccomplishment: "Action from task",
    result: "Result from task",
    projectId: "p1"
  };

  it("fills every empty field and skips nothing", () => {
    const { merged, skipped } = mergeTaskImportIntoDraft(emptyDraft(), prefill);
    expect(merged).toEqual({
      employeeId: "e1",
      inputDate: "2026-06-30",
      situationOrContext: "Context from task",
      actionOrAccomplishment: "Action from task",
      result: "Result from task",
      projectId: "p1"
    });
    expect(skipped).toEqual([]);
  });

  it("never overwrites fields the user already filled, and reports them", () => {
    const draft = emptyDraft({
      employeeId: "e9",
      actionOrAccomplishment: "My own words",
      inputDate: "2026-07-04"
    });
    const { merged, skipped } = mergeTaskImportIntoDraft(draft, prefill);
    expect(merged.employeeId).toBe("e9");
    expect(merged.actionOrAccomplishment).toBe("My own words");
    expect(merged.inputDate).toBe("2026-07-04");
    expect(merged.situationOrContext).toBe("Context from task");
    expect(skipped).toEqual(["Employee", "Date", "Action"]);
  });

  it("does not report a field as kept when it already matches the import", () => {
    const draft = emptyDraft({ employeeId: "e1" });
    const { skipped } = mergeTaskImportIntoDraft(draft, prefill);
    expect(skipped).toEqual([]);
  });

  it("ignores fields the task does not provide", () => {
    const { merged } = mergeTaskImportIntoDraft(emptyDraft(), { relatedTaskId: "t1" });
    expect(merged).toEqual(emptyDraft());
  });
});

describe("shouldOfferTaskArchive", () => {
  it("offers archiving for a completed, unarchived task", () => {
    expect(shouldOfferTaskArchive(makeTask({ status: "complete", completedDate: TODAY }))).toBe(true);
  });

  it("does not offer archiving for open, waiting, or cancelled tasks", () => {
    expect(shouldOfferTaskArchive(makeTask({ status: "open" }))).toBe(false);
    expect(shouldOfferTaskArchive(makeTask({ status: "waiting" }))).toBe(false);
    expect(shouldOfferTaskArchive(makeTask({ status: "cancelled" }))).toBe(false);
  });

  it("does not offer archiving for an already archived task", () => {
    expect(shouldOfferTaskArchive(makeTask({ status: "complete", isArchived: true }))).toBe(false);
  });
});
