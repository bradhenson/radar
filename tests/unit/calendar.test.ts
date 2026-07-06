import { describe, expect, it } from "vitest";
import { leaveDayMap, monthGrid, monthOf, monthTitle, taskDueMap, teleworkDayMap } from "../../src/domain/rules/calendar";
import type { LeaveRecord, Task, TeleworkRecord } from "../../src/domain/models";

function makeTask(partial: Partial<Task> & { id: string }): Task {
  return {
    title: partial.id,
    status: "open",
    priority: "normal",
    performanceInputCreated: false,
    tags: [],
    boardOrder: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    isArchived: false,
    ...partial
  };
}

function makeLeave(partial: Partial<LeaveRecord> & { id: string; startDate: string; endDate: string }): LeaveRecord {
  return {
    employeeId: "e1",
    status: "approved",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...partial
  };
}

function makeTelework(partial: Partial<TeleworkRecord> & { id: string }): TeleworkRecord {
  return {
    employeeId: "e1",
    recordType: "Situational request",
    status: "approved",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...partial
  };
}

describe("monthGrid", () => {
  it("covers the month with Sunday-first weeks padded to 7 cells", () => {
    // July 2026: the 1st is a Wednesday, the 31st a Friday.
    const weeks = monthGrid(2026, 7);
    expect(weeks[0]!.map((c) => c.date)).toEqual([
      "2026-06-28", "2026-06-29", "2026-06-30", "2026-07-01", "2026-07-02", "2026-07-03", "2026-07-04"
    ]);
    const last = weeks[weeks.length - 1]!;
    expect(last[last.length - 1]!.date).toBe("2026-08-01");
    expect(weeks.every((w) => w.length === 7)).toBe(true);
    expect(weeks[0]![2]!.inMonth).toBe(false);
    expect(weeks[0]![3]!.inMonth).toBe(true);
  });

  it("handles a month starting on Sunday with no leading pad", () => {
    // February 2026 starts on a Sunday and has exactly 4 weeks.
    const weeks = monthGrid(2026, 2);
    expect(weeks[0]![0]!.date).toBe("2026-02-01");
    expect(weeks.length).toBe(4);
    expect(weeks[3]![6]!.date).toBe("2026-02-28");
    expect(weeks.flat().every((c) => c.inMonth)).toBe(true);
  });

  it("crosses year boundaries in the padding", () => {
    const weeks = monthGrid(2026, 1);
    expect(weeks[0]![0]!.date).toBe("2025-12-28");
    const lastWeek = weeks[weeks.length - 1]!;
    expect(lastWeek[6]!.date).toBe("2026-01-31");
  });
});

describe("monthOf / monthTitle", () => {
  it("extracts and formats months", () => {
    expect(monthOf("2026-07-05")).toEqual({ year: 2026, month: 7 });
    expect(monthTitle(2026, 7)).toBe("July 2026");
    expect(monthTitle(2025, 12)).toBe("December 2025");
  });
});

describe("taskDueMap", () => {
  it("buckets tasks by due date within the range and excludes archived/cancelled/undated", () => {
    const tasks = [
      makeTask({ id: "a", dueDate: "2026-07-10" }),
      makeTask({ id: "b", dueDate: "2026-07-10" }),
      makeTask({ id: "outside", dueDate: "2026-08-15" }),
      makeTask({ id: "archived", dueDate: "2026-07-10", isArchived: true }),
      makeTask({ id: "cancelled", dueDate: "2026-07-10", status: "cancelled" }),
      makeTask({ id: "undated" })
    ];
    const map = taskDueMap(tasks, "2026-07-01", "2026-07-31");
    expect([...map.keys()]).toEqual(["2026-07-10"]);
    expect(map.get("2026-07-10")!.map((t) => t.id).sort()).toEqual(["a", "b"]);
  });

  it("orders a day: incomplete first, then priority, then title", () => {
    const tasks = [
      makeTask({ id: "z-normal", title: "zebra", dueDate: "2026-07-10" }),
      makeTask({ id: "done", title: "aardvark", dueDate: "2026-07-10", status: "complete" }),
      makeTask({ id: "crit", title: "middle", dueDate: "2026-07-10", priority: "critical" }),
      makeTask({ id: "a-normal", title: "apple", dueDate: "2026-07-10" })
    ];
    const map = taskDueMap(tasks, "2026-07-01", "2026-07-31");
    expect(map.get("2026-07-10")!.map((t) => t.id)).toEqual(["crit", "a-normal", "z-normal", "done"]);
  });
});

describe("leaveDayMap", () => {
  it("expands multi-day leave to each day, clamped to the range", () => {
    const leave = makeLeave({ id: "l1", startDate: "2026-06-29", endDate: "2026-07-02" });
    const map = leaveDayMap([leave], "2026-07-01", "2026-07-31");
    expect([...map.keys()]).toEqual(["2026-07-01", "2026-07-02"]);
  });

  it("excludes cancelled leave but keeps completed leave", () => {
    const map = leaveDayMap(
      [
        makeLeave({ id: "cancelled", startDate: "2026-07-10", endDate: "2026-07-10", status: "cancelled" }),
        makeLeave({ id: "complete", startDate: "2026-07-10", endDate: "2026-07-10", status: "complete" })
      ],
      "2026-07-01",
      "2026-07-31"
    );
    expect(map.get("2026-07-10")!.map((l) => l.id)).toEqual(["complete"]);
  });

  it("treats an inverted range as a single day at the start date", () => {
    const leave = makeLeave({ id: "l1", startDate: "2026-07-10", endDate: "2026-07-05" });
    const map = leaveDayMap([leave], "2026-07-01", "2026-07-31");
    expect([...map.keys()]).toEqual(["2026-07-10"]);
  });

  it("skips records entirely outside the range", () => {
    const leave = makeLeave({ id: "l1", startDate: "2026-08-01", endDate: "2026-08-05" });
    expect(leaveDayMap([leave], "2026-07-01", "2026-07-31").size).toBe(0);
  });
});

describe("teleworkDayMap", () => {
  it("expands situational telework to each covered day, clamped to the range", () => {
    const map = teleworkDayMap(
      [makeTelework({ id: "tw1", effectiveDate: "2026-06-30", expirationDate: "2026-07-02" })],
      "2026-07-01",
      "2026-07-31"
    );
    expect([...map.keys()]).toEqual(["2026-07-01", "2026-07-02"]);
  });

  it("uses the effective date alone when there is no expiration date", () => {
    const map = teleworkDayMap([makeTelework({ id: "tw1", effectiveDate: "2026-07-10" })], "2026-07-01", "2026-07-31");
    expect([...map.keys()]).toEqual(["2026-07-10"]);
  });

  it("excludes denied/cancelled/expired requests and non-situational records", () => {
    const map = teleworkDayMap(
      [
        makeTelework({ id: "denied", status: "denied", effectiveDate: "2026-07-10" }),
        makeTelework({ id: "cancelled", status: "cancelled", effectiveDate: "2026-07-10" }),
        makeTelework({ id: "expired", status: "expired", effectiveDate: "2026-07-10" }),
        makeTelework({ id: "agreement", recordType: "Agreement", effectiveDate: "2026-07-10" }),
        makeTelework({ id: "pending", status: "pending_supervisor", effectiveDate: "2026-07-10" }),
        makeTelework({ id: "no-start" })
      ],
      "2026-07-01",
      "2026-07-31"
    );
    expect(map.get("2026-07-10")!.map((r) => r.id)).toEqual(["pending"]);
    expect(map.size).toBe(1);
  });

  it("treats an inverted range as a single day at the effective date", () => {
    const map = teleworkDayMap(
      [makeTelework({ id: "tw1", effectiveDate: "2026-07-10", expirationDate: "2026-07-05" })],
      "2026-07-01",
      "2026-07-31"
    );
    expect([...map.keys()]).toEqual(["2026-07-10"]);
  });
});
