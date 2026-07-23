import { describe, expect, it } from "vitest";
import {
  absenceEntries,
  absencesOn,
  availabilityByWeek,
  employeeWorkload,
  supervisorWorkload,
  weekStartOf
} from "../../src/domain/rules/workload";
import type { Employee, LeaveRecord, Task, TravelRecord } from "../../src/domain/models";

const NOW = "2026-01-01T00:00:00.000Z";
const TODAY = "2026-07-18"; // a Saturday

function task(partial: Partial<Task> & { id: string }): Task {
  return {
    title: partial.id,
    status: "open",
    priority: "normal",
    performanceInputCreated: false,
    tags: [],
    boardOrder: 1000,
    createdAt: NOW,
    updatedAt: NOW,
    isArchived: false,
    ...partial
  };
}

function employee(id: string, name: string): Employee {
  return { id, displayName: name, activeStatus: "active", tags: [], createdAt: NOW, updatedAt: NOW, isArchived: false };
}

function leave(partial: Partial<LeaveRecord> & { id: string; employeeId: string; startDate: string; endDate: string }): LeaveRecord {
  return { status: "approved", createdAt: NOW, updatedAt: NOW, ...partial };
}

function travel(partial: Partial<TravelRecord> & { id: string; employeeId: string; startDate: string; endDate: string }): TravelRecord {
  return {
    destination: "Somewhere, ST",
    iptConcurrence: "concurred",
    dtsAuthorizationStatus: "approved",
    createdAt: NOW,
    updatedAt: NOW,
    ...partial
  };
}

describe("supervisor workload", () => {
  it("counts open, overdue, waiting, due windows, and unassigned", () => {
    const tasks = [
      task({ id: "overdue", dueDate: "2026-07-10", employeeId: "e1" }),
      task({ id: "due-soon", dueDate: "2026-07-20", employeeId: "e1" }),
      task({ id: "due-month", dueDate: "2026-08-10", employeeId: "e1" }),
      task({ id: "waiting", status: "waiting", employeeId: "e1" }),
      task({ id: "unassigned" }),
      task({ id: "done", status: "complete" }),
      task({ id: "gone", isArchived: true })
    ];
    const summary = supervisorWorkload(tasks, TODAY);
    expect(summary.open).toBe(5);
    expect(summary.overdue).toBe(1);
    expect(summary.waiting).toBe(1);
    expect(summary.dueIn7).toBe(1);
    expect(summary.dueIn30).toBe(2);
    expect(summary.unassigned).toBe(1);
  });
});

describe("employee workload", () => {
  it("aggregates per active employee without counting complete or archived work", () => {
    const rows = employeeWorkload({
      today: TODAY,
      dueSoonDays: 7,
      employees: [employee("e1", "Alex"), employee("e2", "Blake")],
      tasks: [
        task({ id: "a", employeeId: "e1", dueDate: "2026-07-01", projectId: "p1" }),
        task({ id: "b", employeeId: "e1", status: "waiting", projectId: "p1" }),
        task({ id: "c", employeeId: "e1", dueDate: "2026-07-21", projectId: "p2" }),
        task({ id: "d", employeeId: "e1", status: "complete" }),
        task({ id: "e", employeeId: "e2" })
      ],
      performanceInputs: [],
      interactions: [
        {
          id: "i1",
          employeeId: "e1",
          interactionDate: "2026-07-01",
          interactionType: "One-on-one",
          followUpRequired: false,
          createdAt: NOW,
          updatedAt: NOW
        }
      ],
      trainingActionCounts: new Map([["e2", 3]])
    });

    expect(rows.map((r) => r.employee.id)).toEqual(["e1", "e2"]);
    const alex = rows[0]!;
    expect(alex.openCount).toBe(3);
    expect(alex.overdueCount).toBe(1);
    expect(alex.waitingCount).toBe(1);
    expect(alex.dueSoonCount).toBe(1);
    expect(alex.projectCount).toBe(2);
    expect(alex.trainingActionCount).toBe(0);
    expect(alex.lastCheckInDate).toBe("2026-07-01");
    expect(alex.lastInputDate).toBeUndefined();

    const blake = rows[1]!;
    expect(blake.openCount).toBe(1);
    expect(blake.trainingActionCount).toBe(3);
  });
});

describe("availability", () => {
  const entries = absenceEntries(
    [
      leave({ id: "l1", employeeId: "e1", startDate: "2026-07-20", endDate: "2026-07-24" }),
      leave({ id: "l2", employeeId: "e2", startDate: "2026-07-01", endDate: "2026-07-03", status: "cancelled" })
    ],
    [
      travel({ id: "t1", employeeId: "e3", startDate: "2026-07-16", endDate: "2026-07-22" }),
      travel({ id: "t2", employeeId: "e4", startDate: "2026-08-20", endDate: "2026-08-22", isArchived: true }),
      travel({ id: "t3", employeeId: "e5", startDate: "2026-07-20", endDate: "2026-07-22", tripStatus: "cancelled" })
    ]
  );

  it("excludes cancelled leave and archived or cancelled travel", () => {
    expect(entries.map((e) => e.employeeId).sort()).toEqual(["e1", "e3"]);
  });

  it("computes the week start as the preceding Sunday", () => {
    expect(weekStartOf("2026-07-18")).toBe("2026-07-12"); // Saturday -> that week's Sunday
    expect(weekStartOf("2026-07-12")).toBe("2026-07-12"); // Sunday is its own week start
  });

  it("buckets overlapping absences into calendar weeks", () => {
    const weeks = availabilityByWeek(entries, TODAY, 2);
    expect(weeks).toHaveLength(2);
    // Week of Jul 12–18: only the trip that started Jul 16 overlaps.
    expect(weeks[0]!.entries.map((e) => e.employeeId)).toEqual(["e3"]);
    // Week of Jul 19–25: the leave and the trip both overlap.
    expect(weeks[1]!.entries.map((e) => e.employeeId).sort()).toEqual(["e1", "e3"]);
  });

  it("finds who is out on a single day", () => {
    expect(absencesOn(entries, "2026-07-18").map((e) => e.employeeId)).toEqual(["e3"]);
    expect(absencesOn(entries, "2026-07-21").map((e) => e.employeeId).sort()).toEqual(["e1", "e3"]);
    expect(absencesOn(entries, "2026-07-25")).toEqual([]);
  });
});
