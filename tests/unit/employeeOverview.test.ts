import { describe, expect, it } from "vitest";
import type {
  AwardRecord,
  EmployeeInteraction,
  EmployeeNote,
  LeaveRecord,
  MeetingNote,
  PerformanceInput,
  Task,
  TeleworkRecord,
  TravelRecord
} from "../../src/domain/models";
import { employeeOverview, OVERVIEW_TASK_LIMIT, type EmployeeOverviewInput } from "../../src/domain/rules/employeeOverview";

const TODAY = "2026-11-13";
const TS = "2026-10-01T12:00:00.000Z";

const task = (id: string, p: Partial<Task> = {}): Task => ({
  id, title: `Task ${id}`, status: "open", priority: "normal", performanceInputCreated: false, tags: [],
  boardOrder: 1, createdAt: TS, updatedAt: TS, isArchived: false, employeeId: "e1", ...p
});
const leave = (id: string, start: string, end: string, p: Partial<LeaveRecord> = {}): LeaveRecord => ({
  id, employeeId: "e1", startDate: start, endDate: end, status: "approved", createdAt: TS, updatedAt: TS, ...p
});
const telework = (id: string, date: string, p: Partial<TeleworkRecord> = {}): TeleworkRecord => ({
  id, employeeId: "e1", recordType: "Situational request", effectiveDate: date, expirationDate: date,
  status: "approved", createdAt: TS, updatedAt: TS, ...p
});
const trip = (id: string, start: string, end: string, p: Partial<TravelRecord> = {}): TravelRecord => ({
  id, employeeId: "e1", destination: "Norfolk", startDate: start, endDate: end, iptConcurrence: "concurred",
  dtsAuthorizationStatus: "approved", createdAt: TS, updatedAt: TS, ...p
} as TravelRecord);
const input = (id: string, date: string, p: Partial<PerformanceInput> = {}): PerformanceInput => ({
  id, employeeId: "e1", inputDate: date, actionOrAccomplishment: "Did a thing", inputStatus: "draft",
  recognitionPotential: false, tags: [], createdAt: TS, updatedAt: TS, isArchived: false, ...p
});
const checkIn = (id: string, date: string, p: Partial<EmployeeInteraction> = {}): EmployeeInteraction => ({
  id, employeeId: "e1", interactionDate: date, interactionType: "Informal check-in", followUpRequired: false,
  createdAt: `${date}T15:00:00.000Z`, updatedAt: `${date}T15:00:00.000Z`, ...p
});

function base(overrides: Partial<EmployeeOverviewInput> = {}): EmployeeOverviewInput {
  return {
    today: TODAY, lookaheadDays: 30, inputReminderDays: 60,
    tasks: [], leave: [], telework: [], travel: [], training: [], awards: [], inputs: [],
    checkIns: [], meetings: [], notes: [], ...overrides
  };
}

describe("employeeOverview: open tasks", () => {
  it("lists overdue first, then by due date, then undated, capped at the limit", () => {
    const tasks = [
      task("undated"),
      task("later", { dueDate: "2026-12-01" }),
      task("overdue", { dueDate: "2026-11-01" }),
      task("soon", { dueDate: "2026-11-15" }),
      task("done", { status: "complete", completedDate: "2026-11-10", isArchived: true }),
      ...Array.from({ length: 5 }, (_, i) => task(`extra${i}`, { dueDate: "2026-12-20" }))
    ];
    const o = employeeOverview(base({ tasks }));
    expect(o.openTasks.map((t) => t.id).slice(0, 3)).toEqual(["overdue", "soon", "later"]);
    expect(o.openTasks).toHaveLength(OVERVIEW_TASK_LIMIT);
    expect(o.openTaskCount).toBe(9);
    expect(o.overdueTaskCount).toBe(1);
  });
});

describe("employeeOverview: away", () => {
  it("includes leave, telework, and travel under way or starting within the lookahead", () => {
    const o = employeeOverview(base({
      leave: [
        leave("now", "2026-11-12", "2026-11-14"),
        leave("soon", "2026-11-20", "2026-11-21", { status: "requested", leaveType: "Annual leave" }),
        leave("past", "2026-11-01", "2026-11-02"),
        leave("far", "2027-01-10", "2027-01-11"),
        leave("cancelled", "2026-11-18", "2026-11-18", { status: "cancelled" })
      ],
      telework: [
        telework("tw", "2026-11-17", { status: "pending" }),
        telework("denied", "2026-11-18", { status: "denied" }),
        telework("agreement", "2026-11-18", { recordType: "Agreement" })
      ],
      travel: [trip("trip", "2026-11-25", "2026-11-27"), trip("cancelled", "2026-11-26", "2026-11-27", { tripStatus: "cancelled" } as Partial<TravelRecord>)]
    }));
    expect(o.absences.map((a) => a.id)).toEqual(["now", "tw", "soon", "trip"]);
    expect(o.absences.find((a) => a.id === "now")!.current).toBe(true);
    expect(o.absences.find((a) => a.id === "tw")!.pending).toBe(true);
    expect(o.absences.find((a) => a.id === "soon")).toMatchObject({ pending: true, label: "Annual leave" });
    expect(o.absences.find((a) => a.id === "trip")!.label).toBe("Travel to Norfolk");
  });
});

describe("employeeOverview: development", () => {
  it("flags the last performance input once it is older than the reminder", () => {
    expect(employeeOverview(base({ inputs: [input("a", "2026-10-01"), input("b", "2026-08-01")] })).lastInput).toMatchObject({
      daysAgo: 43,
      stale: false
    });
    expect(employeeOverview(base({ inputReminderDays: 30, inputs: [input("a", "2026-10-01")] })).lastInput!.stale).toBe(true);
    expect(employeeOverview(base()).lastInput).toBeUndefined();
  });

  it("keeps only training that needs action, soonest first", () => {
    const o = employeeOverview(base({
      training: [
        { requirementId: "ok", name: "Ethics", status: { state: "complete", needsAction: false } },
        { requirementId: "late", name: "Cyber", status: { state: "overdue", dueDate: "2026-10-01", needsAction: true } },
        { requirementId: "soon", name: "OPSEC", status: { state: "due_soon", dueDate: "2026-11-20", needsAction: true } }
      ]
    }));
    expect(o.training.map((t) => t.requirementId)).toEqual(["late", "soon"]);
  });

  it("keeps nominations that are still being worked", () => {
    const award = (id: string, status: string) => ({ id, employeeId: "e1", title: id, status, relatedPerformanceInputIds: [], createdAt: TS, updatedAt: TS }) as AwardRecord;
    const o = employeeOverview(base({ awards: [award("idea", "Idea"), award("drafting", "Drafting"), award("sub", "Submitted"), award("won", "Approved")] }));
    expect(o.awardsInProgress.map((a) => a.id)).toEqual(["idea", "drafting"]);
  });
});

describe("employeeOverview: since last check-in", () => {
  it("collects what happened after the latest check-in date", () => {
    const meeting = (id: string, date: string) => ({ id, meetingDate: date, title: id, meetingType: "1:1", attendeeEmployeeIds: ["e1"], createdAt: TS, updatedAt: TS, isArchived: false }) as MeetingNote;
    const note = (id: string, ts: string) => ({ id, employeeId: "e1", noteText: "x", createdAt: ts, updatedAt: ts, isArchived: false }) as EmployeeNote;
    const o = employeeOverview(base({
      checkIns: [checkIn("old", "2026-10-01"), checkIn("last", "2026-11-01", { followUpRequired: true })],
      tasks: [
        task("doneAfter", { status: "complete", completedDate: "2026-11-05", isArchived: true }),
        task("doneBefore", { status: "complete", completedDate: "2026-10-20", isArchived: true }),
        task("doneSameDay", { status: "complete", completedDate: "2026-11-01", isArchived: true }),
        task("newTask", { createdAt: "2026-11-08T14:00:00.000Z" })
      ],
      meetings: [meeting("m-after", "2026-11-10"), meeting("m-before", "2026-10-15")],
      notes: [note("n-after", "2026-11-09T14:00:00.000Z"), note("n-before", "2026-10-09T14:00:00.000Z")],
      inputs: [input("i-after", "2026-11-03"), input("i-before", "2026-10-03")]
    }));
    expect(o.lastCheckIn!.id).toBe("last");
    expect(o.followUpOpen).toBe(true);
    expect(o.since.from).toBe("2026-11-01");
    expect(o.since.tasksCompleted.map((t) => t.id)).toEqual(["doneAfter"]);
    expect(o.since.tasksAdded.map((t) => t.id)).toEqual(["newTask"]);
    expect(o.since.meetings.map((m) => m.id)).toEqual(["m-after"]);
    expect(o.since.notes.map((n) => n.id)).toEqual(["n-after"]);
    expect(o.since.inputs.map((i) => i.id)).toEqual(["i-after"]);
  });

  it("covers everything when there has never been a check-in", () => {
    const o = employeeOverview(base({ inputs: [input("a", "2025-01-01")] }));
    expect(o.since.from).toBeUndefined();
    expect(o.since.inputs).toHaveLength(1);
    expect(o.followUpOpen).toBe(false);
  });
});

describe("employeeOverview: check-in date sources and future records", () => {
  it("starts from the employee's last check-in date when it is later than any recorded check-in", () => {
    const o = employeeOverview(base({
      lastCheckInDate: "2026-11-05",
      checkIns: [checkIn("old", "2026-10-01")],
      inputs: [input("before", "2026-11-03"), input("after", "2026-11-07")]
    }));
    expect(o.since.from).toBe("2026-11-05");
    expect(o.since.inputs.map((i) => i.id)).toEqual(["after"]);
    expect(employeeOverview(base({ lastCheckInDate: "2026-10-28" })).since.from).toBe("2026-10-28");
  });

  it("leaves out records dated after today", () => {
    const meeting = { id: "future", meetingDate: "2026-11-18", title: "Upcoming", meetingType: "1:1", attendeeEmployeeIds: ["e1"], createdAt: TS, updatedAt: TS, isArchived: false } as MeetingNote;
    const o = employeeOverview(base({ checkIns: [checkIn("c", "2026-11-01")], meetings: [meeting], inputs: [input("future", "2026-12-01")] }));
    expect(o.since.meetings).toEqual([]);
    expect(o.since.inputs).toEqual([]);
  });
});
