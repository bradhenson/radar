import { describe, expect, it } from "vitest";
import {
  backupAttention,
  computeAttention,
  employeeAttention,
  taskAttention,
  teleworkAttention,
  trainingAttention,
  type AttentionContext
} from "../../src/domain/rules/attention";
import { dueState } from "../../src/domain/rules/dueState";
import { DEFAULT_SETTINGS, type Employee, type Task } from "../../src/domain/models";

const TODAY = "2026-07-04";
const TS = "2026-07-04T12:00:00.000Z";

function makeTask(overrides: Partial<Task>): Task {
  return {
    id: overrides.id ?? "t1",
    title: "Test task",
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

function makeEmployee(overrides: Partial<Employee>): Employee {
  return {
    id: overrides.id ?? "e1",
    displayName: "Test Person",
    competencyId: "c1",
    activeStatus: "active",
    tags: [],
    createdAt: TS,
    updatedAt: TS,
    isArchived: false,
    ...overrides
  };
}

function baseCtx(overrides: Partial<AttentionContext> = {}): AttentionContext {
  return {
    today: TODAY,
    settings: { ...DEFAULT_SETTINGS },
    tasks: [],
    employees: [],
    performanceInputs: [],
    interactions: [],
    trainingRecords: [],
    trainingRequirements: [],
    leaveRecords: [],
    teleworkRecords: [],
    changesSinceBackup: 0,
    snoozes: [],
    ...overrides
  };
}

describe("dueState boundaries", () => {
  it("classifies exactly", () => {
    expect(dueState(makeTask({ dueDate: "2026-07-03" }), TODAY, 7)).toBe("overdue");
    expect(dueState(makeTask({ dueDate: "2026-07-04" }), TODAY, 7)).toBe("due_today");
    expect(dueState(makeTask({ dueDate: "2026-07-05" }), TODAY, 7)).toBe("due_soon");
    expect(dueState(makeTask({ dueDate: "2026-07-11" }), TODAY, 7)).toBe("due_soon"); // exactly 7 days
    expect(dueState(makeTask({ dueDate: "2026-07-12" }), TODAY, 7)).toBe("future"); // 8 days
    expect(dueState(makeTask({}), TODAY, 7)).toBe("none");
    expect(dueState(makeTask({ dueDate: "2026-07-01", status: "complete" }), TODAY, 7)).toBe("complete");
  });
});

describe("task attention rules", () => {
  it("flags overdue with day count in the reason", () => {
    const items = taskAttention(baseCtx({ tasks: [makeTask({ dueDate: "2026-06-30" })] }));
    const overdue = items.find((i) => i.reasonCode === "overdue");
    expect(overdue).toBeDefined();
    expect(overdue!.reasonText).toBe("Overdue by 4 days");
    expect(overdue!.suggestedAction).toBeTruthy();
  });

  it("does not flag complete, cancelled, or archived tasks", () => {
    const tasks = [
      makeTask({ id: "a", dueDate: "2026-06-01", status: "complete" }),
      makeTask({ id: "b", dueDate: "2026-06-01", status: "cancelled" }),
      makeTask({ id: "c", dueDate: "2026-06-01", isArchived: true })
    ];
    expect(taskAttention(baseCtx({ tasks }))).toHaveLength(0);
  });

  it("flags reminder and follow-up dates on or before today", () => {
    const items = taskAttention(
      baseCtx({
        tasks: [makeTask({ reminderDate: "2026-07-04", followUpDate: "2026-07-01" })]
      })
    );
    expect(items.map((i) => i.reasonCode).sort()).toEqual(["follow_up_reached", "reminder_reached"]);
  });

  it("flags waiting tasks only past the threshold", () => {
    const fresh = makeTask({ id: "f", status: "waiting", waitingSince: "2026-07-01T00:00:00.000Z" });
    const old = makeTask({ id: "o", status: "waiting", waitingSince: "2026-06-01T00:00:00.000Z" });
    const items = taskAttention(baseCtx({ tasks: [fresh, old] }));
    expect(items.filter((i) => i.reasonCode === "waiting_too_long").map((i) => i.entityId)).toEqual(["o"]);
  });

  it("flags stale non-waiting tasks", () => {
    const stale = makeTask({ id: "s", updatedAt: "2026-05-01T00:00:00.000Z" });
    const items = taskAttention(baseCtx({ tasks: [stale] }));
    expect(items.some((i) => i.reasonCode === "stale")).toBe(true);
  });
});

describe("employee attention rules", () => {
  it("flags employees with no performance input and no check-in", () => {
    const items = employeeAttention(baseCtx({ employees: [makeEmployee({})] }));
    const codes = items.map((i) => i.reasonCode).sort();
    expect(codes).toEqual(["no_recent_check_in", "no_recent_performance_input"]);
  });

  it("does not flag when recent input and check-in exist", () => {
    const emp = makeEmployee({ lastCheckInDate: "2026-07-01" });
    const items = employeeAttention(
      baseCtx({
        employees: [emp],
        performanceInputs: [
          {
            id: "p1",
            employeeId: emp.id,
            inputDate: "2026-06-20",
            actionOrAccomplishment: "Did a thing",
            inputStatus: "ready",
            recognitionPotential: false,
            tags: [],
            createdAt: TS,
            updatedAt: TS,
            isArchived: false
          }
        ]
      })
    );
    expect(items).toHaveLength(0);
  });

  it("flags multiple overdue tasks", () => {
    const emp = makeEmployee({ lastCheckInDate: TODAY });
    const tasks = ["a", "b", "c"].map((id) => makeTask({ id, employeeId: emp.id, dueDate: "2026-06-01" }));
    const items = employeeAttention(
      baseCtx({
        employees: [emp],
        tasks,
        performanceInputs: [
          {
            id: "p1",
            employeeId: emp.id,
            inputDate: TODAY,
            actionOrAccomplishment: "x",
            inputStatus: "ready",
            recognitionPotential: false,
            tags: [],
            createdAt: TS,
            updatedAt: TS,
            isArchived: false
          }
        ]
      })
    );
    expect(items.map((i) => i.reasonCode)).toEqual(["multiple_overdue"]);
  });

  it("ignores inactive employees", () => {
    const items = employeeAttention(baseCtx({ employees: [makeEmployee({ activeStatus: "departed" })] }));
    expect(items).toHaveLength(0);
  });
});

describe("training attention rules", () => {
  const emp = makeEmployee({});
  const req = {
    id: "r1",
    name: "Cyber Awareness",
    warningDays: [30, 14, 7],
    active: true,
    createdAt: TS,
    updatedAt: TS
  };

  function record(overrides: Record<string, unknown>) {
    return {
      id: "tr1",
      employeeId: emp.id,
      trainingRequirementId: req.id,
      status: "assigned" as const,
      createdAt: TS,
      updatedAt: TS,
      ...overrides
    };
  }

  it("flags overdue training", () => {
    const items = trainingAttention(
      baseCtx({ employees: [emp], trainingRequirements: [req], trainingRecords: [record({ dueDate: "2026-07-01" })] })
    );
    expect(items[0]?.reasonCode).toBe("training_overdue");
    expect(items[0]?.reasonText).toBe("Training overdue by 3 days");
  });

  it("flags completed training whose expiration approaches", () => {
    const items = trainingAttention(
      baseCtx({
        employees: [emp],
        trainingRequirements: [req],
        trainingRecords: [record({ status: "complete", completedDate: "2025-08-01", expirationDate: "2026-07-20" })]
      })
    );
    expect(items[0]?.reasonCode).toBe("training_expiring");
  });

  it("ignores waived and not-applicable records", () => {
    const emp2 = makeEmployee({ id: "e2" });
    const items = trainingAttention(
      baseCtx({
        employees: [emp, emp2],
        trainingRequirements: [req],
        trainingRecords: [
          record({ status: "waived", dueDate: "2026-01-01" }),
          record({ id: "tr2", employeeId: emp2.id, status: "not_applicable", dueDate: "2026-01-01" })
        ]
      })
    );
    expect(items).toHaveLength(0);
  });

  it("flags employees with no record from the requirement's shared due date", () => {
    const items = trainingAttention(
      baseCtx({ employees: [emp], trainingRequirements: [{ ...req, dueDate: "2026-07-01" }], trainingRecords: [] })
    );
    expect(items[0]?.reasonCode).toBe("training_overdue");
  });

  it("aggregates many employees due for the same requirement into one item", () => {
    const emps = ["e1", "e2", "e3", "e4", "e5"].map((id) => makeEmployee({ id }));
    const items = trainingAttention(
      baseCtx({ employees: emps, trainingRequirements: [{ ...req, dueDate: "2026-07-20" }], trainingRecords: [] })
    );
    expect(items).toHaveLength(1);
    expect(items[0]?.reasonCode).toBe("training_due_soon");
    expect(items[0]?.title).toBe("Cyber Awareness — 5 employees");
    expect(items[0]?.reasonText).toBe("Training due soon for 5 employees");
    expect(items[0]?.entityId).toBe(req.id);
  });
});

describe("telework attention rules", () => {
  const emp = makeEmployee({});
  it("flags pending supervisor action and expiring agreements", () => {
    const items = teleworkAttention(
      baseCtx({
        employees: [emp],
        teleworkRecords: [
          {
            id: "tw1",
            employeeId: emp.id,
            recordType: "Agreement",
            status: "pending_supervisor",
            createdAt: TS,
            updatedAt: TS
          },
          {
            id: "tw2",
            employeeId: emp.id,
            recordType: "Agreement",
            status: "active",
            expirationDate: "2026-07-10",
            createdAt: TS,
            updatedAt: TS
          }
        ]
      })
    );
    const codes = items.map((i) => i.reasonCode).sort();
    expect(codes).toEqual(["telework_expiring", "telework_pending_action"]);
  });

  it("does not treat situational request end dates as agreement expirations", () => {
    const items = teleworkAttention(
      baseCtx({
        employees: [emp],
        teleworkRecords: [
          {
            id: "tw3",
            employeeId: emp.id,
            recordType: "Situational request",
            status: "approved",
            effectiveDate: "2026-07-10",
            expirationDate: "2026-07-10",
            createdAt: TS,
            updatedAt: TS
          }
        ]
      })
    );
    expect(items).toHaveLength(0);
  });
});

describe("backup attention rules", () => {
  it("stays quiet with no data and no backup", () => {
    expect(backupAttention(baseCtx({}))).toHaveLength(0);
  });
  it("flags never-backed-up once changes exist", () => {
    const items = backupAttention(baseCtx({ changesSinceBackup: 5 }));
    expect(items[0]?.reasonCode).toBe("backup_never");
  });
  it("flags old backups", () => {
    const items = backupAttention(baseCtx({ lastBackupAt: "2026-06-01T00:00:00.000Z", changesSinceBackup: 0 }));
    expect(items[0]?.reasonCode).toBe("backup_overdue");
  });
  it("flags change-count threshold", () => {
    const items = backupAttention(baseCtx({ lastBackupAt: "2026-07-03T00:00:00.000Z", changesSinceBackup: 51 }));
    expect(items[0]?.reasonCode).toBe("backup_change_threshold");
  });
});

describe("computeAttention", () => {
  it("sorts by score and respects snoozes", () => {
    const overdueTask = makeTask({ id: "od", dueDate: "2026-06-01", priority: "critical" });
    const soonTask = makeTask({ id: "ds", dueDate: "2026-07-08" });
    const ctx = baseCtx({ tasks: [soonTask, overdueTask] });
    const items = computeAttention(ctx);
    expect(items[0]?.entityId).toBe("od");

    const snoozed = computeAttention({
      ...ctx,
      snoozes: [{ id: "task:od:overdue", snoozedUntil: "2026-07-10" }]
    });
    expect(snoozed.some((i) => i.entityId === "od" && i.reasonCode === "overdue")).toBe(false);
  });

  it("does not hide items whose snooze has expired", () => {
    const overdueTask = makeTask({ id: "od", dueDate: "2026-06-01" });
    const items = computeAttention(
      baseCtx({ tasks: [overdueTask], snoozes: [{ id: "task:od:overdue", snoozedUntil: "2026-07-04" }] })
    );
    expect(items.some((i) => i.reasonCode === "overdue")).toBe(true);
  });
});
