import { describe, expect, it } from "vitest";
import { createSampleSnapshot } from "../../src/data/seed";

describe("sample seed data", () => {
  it("covers a realistic supervisor workload", () => {
    const snapshot = createSampleSnapshot();
    const c = snapshot.collections;

    expect(c.employees).toHaveLength(40);
    expect(c.employees.every((employee) => employee.activeStatus === "active")).toBe(true);
    expect(new Set(c.employees.map((employee) => employee.workEmail)).size).toBe(40);
    expect(c.trainingRequirements).toHaveLength(10);
    expect(c.performanceInputs.length).toBeGreaterThanOrEqual(20);
    expect(c.leaveRecords.length).toBeGreaterThanOrEqual(10);
    expect(c.teleworkRecords.length).toBeGreaterThanOrEqual(10);
    expect(c.meetingNotes.length).toBeGreaterThanOrEqual(5);
    expect(c.awardRecords.length).toBeGreaterThanOrEqual(5);

    const employeeLinkedTasks = c.tasks.filter((task) => task.employeeId).length;
    const supervisorOwnedTasks = c.tasks.length - employeeLinkedTasks;
    expect(supervisorOwnedTasks).toBeGreaterThan(employeeLinkedTasks);
  });
});
