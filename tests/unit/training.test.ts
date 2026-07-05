import { describe, expect, it } from "vitest";
import { requirementAppliesTo, rollingExpiration, trainingStatus } from "../../src/domain/rules/training";
import type { Employee, EmployeeTrainingRecord, TrainingRequirement } from "../../src/domain/models";

const TODAY = "2026-07-04";
const TS = "2026-07-04T12:00:00.000Z";
const WARN = 30;

function req(overrides: Partial<TrainingRequirement> = {}): TrainingRequirement {
  return {
    id: "r1",
    name: "Annual Cybersecurity Awareness",
    recurrenceType: "annual",
    recurrenceInterval: 1,
    dueDate: "2026-09-30",
    warningDays: [30, 14, 7],
    active: true,
    createdAt: TS,
    updatedAt: TS,
    ...overrides
  };
}

function rec(overrides: Partial<EmployeeTrainingRecord> = {}): EmployeeTrainingRecord {
  return {
    id: "tr1",
    employeeId: "e1",
    trainingRequirementId: "r1",
    status: "assigned",
    createdAt: TS,
    updatedAt: TS,
    ...overrides
  };
}

function empl(overrides: Partial<Employee> = {}): Employee {
  return {
    id: "e1",
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

describe("requirementAppliesTo", () => {
  it("applies to every active employee by default (missing scope = all)", () => {
    expect(requirementAppliesTo(req({ assignmentScope: undefined }), empl())).toBe(true);
    expect(requirementAppliesTo(req({ assignmentScope: "all" }), empl())).toBe(true);
  });

  it("never applies to departed or archived employees", () => {
    expect(requirementAppliesTo(req(), empl({ activeStatus: "departed" }))).toBe(false);
    expect(requirementAppliesTo(req(), empl({ isArchived: true }))).toBe(false);
  });

  it("selected scope applies only to the listed employees", () => {
    const r = req({ assignmentScope: "selected", assignedEmployeeIds: ["e2"] });
    expect(requirementAppliesTo(r, empl())).toBe(false);
    expect(requirementAppliesTo(r, empl({ id: "e2" }))).toBe(true);
  });
});

describe("trainingStatus — fixed annual date", () => {
  it("derives due state from the requirement date with no record at all", () => {
    expect(trainingStatus(req(), undefined, TODAY, WARN)).toEqual({
      state: "not_completed",
      dueDate: "2026-09-30",
      completedDate: undefined,
      needsAction: false
    });
    expect(trainingStatus(req({ dueDate: "2026-07-20" }), undefined, TODAY, WARN).state).toBe("due_soon");
    expect(trainingStatus(req({ dueDate: "2026-07-01" }), undefined, TODAY, WARN).state).toBe("overdue");
  });

  it("counts a completion inside the current cycle", () => {
    const status = trainingStatus(req(), rec({ status: "complete", completedDate: "2026-06-01" }), TODAY, WARN);
    expect(status.state).toBe("complete");
    expect(status.needsAction).toBe(false);
  });

  it("resets automatically when the due date is bumped past an old completion", () => {
    // Completed 2025-09-01; cycle for a 2026-09-30 due date starts 2025-09-30.
    const status = trainingStatus(req(), rec({ status: "complete", completedDate: "2025-09-01" }), TODAY, WARN);
    expect(status.state).toBe("not_completed");
    expect(status.dueDate).toBe("2026-09-30");
  });

  it("honors a per-employee due date override", () => {
    const status = trainingStatus(req(), rec({ dueDate: "2026-07-10" }), TODAY, WARN);
    expect(status.state).toBe("due_soon");
    expect(status.dueDate).toBe("2026-07-10");
  });

  it("respects waived and not applicable", () => {
    expect(trainingStatus(req(), rec({ status: "waived" }), TODAY, WARN).state).toBe("waived");
    expect(trainingStatus(req(), rec({ status: "not_applicable" }), TODAY, WARN).state).toBe("not_applicable");
  });

  it("honors a stored legacy expiration date on a completion", () => {
    const r = req({ dueDate: undefined });
    const status = trainingStatus(r, rec({ status: "complete", completedDate: "2025-08-01", expirationDate: "2026-07-20" }), TODAY, WARN);
    expect(status.state).toBe("expiring");
    expect(status.dueDate).toBe("2026-07-20");
  });
});

describe("trainingStatus — one-time", () => {
  it("keeps any completion forever", () => {
    const r = req({ recurrenceType: "none", dueDate: "2026-08-01" });
    expect(trainingStatus(r, rec({ status: "complete", completedDate: "2024-01-01" }), TODAY, WARN).state).toBe("complete");
  });

  it("uses the fixed date until completed", () => {
    const r = req({ recurrenceType: "none", dueDate: "2026-07-20" });
    expect(trainingStatus(r, undefined, TODAY, WARN).state).toBe("due_soon");
  });
});

describe("trainingStatus — rolling from completion", () => {
  const rolling = req({ recurrenceType: "months", recurrenceInterval: 12, dueDate: undefined });

  it("derives expiration from the completion date", () => {
    expect(trainingStatus(rolling, rec({ status: "complete", completedDate: "2026-05-01" }), TODAY, WARN)).toMatchObject({
      state: "complete",
      dueDate: "2027-05-01"
    });
    expect(trainingStatus(rolling, rec({ status: "complete", completedDate: "2025-08-01" }), TODAY, WARN).state).toBe("expiring");
    expect(trainingStatus(rolling, rec({ status: "complete", completedDate: "2025-06-01" }), TODAY, WARN).state).toBe("expired");
  });

  it("supports day-based intervals", () => {
    const r = req({ recurrenceType: "days", recurrenceInterval: 90, dueDate: undefined });
    const status = trainingStatus(r, rec({ status: "complete", completedDate: "2026-05-01" }), TODAY, WARN);
    expect(status.state).toBe("expiring");
    expect(status.dueDate).toBe("2026-07-30");
  });

  it("has no due date until first completion", () => {
    expect(trainingStatus(rolling, undefined, TODAY, WARN)).toEqual({
      state: "not_completed",
      dueDate: undefined,
      completedDate: undefined,
      needsAction: false
    });
  });
});

describe("rollingExpiration", () => {
  it("computes only for rolling requirements", () => {
    expect(rollingExpiration(req(), "2026-07-04")).toBeUndefined();
    expect(rollingExpiration(req({ recurrenceType: "none" }), "2026-07-04")).toBeUndefined();
    expect(rollingExpiration(req({ recurrenceType: "months", recurrenceInterval: 6 }), "2026-07-04")).toBe("2027-01-04");
    expect(rollingExpiration(req({ recurrenceType: "days", recurrenceInterval: 30 }), "2026-07-04")).toBe("2026-08-03");
  });
});
