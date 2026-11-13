import { describe, expect, it } from "vitest";
import type { AwardRecord, LeaveRecord, Task, TeleworkRecord, TravelRecord } from "../../src/domain/models";
import { calendarEvents, toIcs, type CalendarExportContext } from "../../src/domain/rules/icsExport";
import { SITUATIONAL_REQUEST_TYPE } from "../../src/domain/rules/telework";

const STAMP = { createdAt: "2026-07-01T00:00:00.000Z", updatedAt: "2026-07-01T00:00:00.000Z" };
const NAMES: Record<string, string> = { e1: "Avery Brooks", e2: "Riley Chen" };

const task = (id: string, overrides: Partial<Task> = {}): Task => ({
  id,
  title: `Task ${id}`,
  status: "open",
  priority: "normal",
  performanceInputCreated: false,
  tags: [],
  boardOrder: 1,
  isArchived: false,
  dueDate: "2026-07-20",
  ...STAMP,
  ...overrides
});
const leave = (id: string, overrides: Partial<LeaveRecord> = {}): LeaveRecord => ({
  id,
  employeeId: "e1",
  startDate: "2026-07-21",
  endDate: "2026-07-23",
  status: "approved",
  ...STAMP,
  ...overrides
});
const telework = (id: string, overrides: Partial<TeleworkRecord> = {}): TeleworkRecord => ({
  id,
  employeeId: "e2",
  recordType: SITUATIONAL_REQUEST_TYPE,
  status: "approved",
  effectiveDate: "2026-07-22",
  ...STAMP,
  ...overrides
});
const trip = (id: string, overrides: Partial<TravelRecord> = {}): TravelRecord => ({
  id,
  employeeId: "e2",
  destination: "Norfolk, VA",
  startDate: "2026-07-27",
  endDate: "2026-07-30",
  iptConcurrence: "concurred",
  dtsAuthorizationStatus: "approved",
  ...STAMP,
  ...overrides
});
const award = (id: string, overrides: Partial<AwardRecord> = {}): AwardRecord => ({
  id,
  employeeId: "e1",
  title: "Team excellence",
  status: "Drafting",
  nominationDueDate: "2026-07-31",
  relatedPerformanceInputIds: [],
  ...STAMP,
  ...overrides
});

function context(overrides: Partial<CalendarExportContext> = {}): CalendarExportContext {
  return {
    from: "2026-07-01",
    to: "2026-07-31",
    layers: { tasks: true, leave: true, telework: true, travel: true, awards: true },
    tasks: [],
    leaveRecords: [],
    teleworkRecords: [],
    travelRecords: [],
    awardRecords: [],
    employeeName: (id) => (id ? (NAMES[id] ?? "") : ""),
    ...overrides
  };
}

describe("calendarEvents", () => {
  it("makes one event per record, in date order, with stable ids", () => {
    const events = calendarEvents(
      context({
        tasks: [task("t1", { employeeId: "e1", priority: "high" })],
        leaveRecords: [leave("l1", { leaveType: "Annual" })],
        teleworkRecords: [telework("w1", { status: "pending" })],
        travelRecords: [trip("v1")],
        awardRecords: [award("a1")]
      })
    );
    expect(events).toEqual([
      { uid: "task-t1@radar", title: "Due: Task t1", start: "2026-07-20", end: "2026-07-20", description: "Assigned to Avery Brooks\nPriority: high" },
      { uid: "leave-l1@radar", title: "Avery Brooks: Annual leave", start: "2026-07-21", end: "2026-07-23", description: "Status: approved" },
      { uid: "telework-w1@radar", title: "Riley Chen: telework (pending)", start: "2026-07-22", end: "2026-07-22" },
      { uid: "travel-v1@radar", title: "Riley Chen: travel to Norfolk, VA", start: "2026-07-27", end: "2026-07-30" },
      { uid: "award-a1@radar", title: "Award nomination due: Team excellence", start: "2026-07-31", end: "2026-07-31", description: "For Avery Brooks. Status: Drafting" }
    ]);
  });

  it("leaves out what the calendar itself hides", () => {
    const events = calendarEvents(
      context({
        tasks: [
          task("archived", { isArchived: true }),
          task("cancelled", { status: "cancelled" }),
          task("done", { status: "complete" }),
          task("undated", { dueDate: undefined })
        ],
        leaveRecords: [leave("cancelled", { status: "cancelled" })],
        teleworkRecords: [
          telework("denied", { status: "denied" }),
          telework("expired", { status: "expired" }),
          telework("agreement", { recordType: "Agreement", status: "active" }),
          telework("undated", { effectiveDate: undefined })
        ],
        travelRecords: [trip("cancelled", { tripStatus: "cancelled" }), trip("archived", { isArchived: true })],
        awardRecords: [award("submitted", { status: "Submitted" }), award("undated", { nominationDueDate: undefined })]
      })
    );
    expect(events).toEqual([]);
  });

  it("exports only the layers switched on and only the chosen person", () => {
    const all = { tasks: [task("t1", { employeeId: "e1" })], leaveRecords: [leave("l1")], travelRecords: [trip("v1")] };
    const leaveOnly = calendarEvents(context({ ...all, layers: { tasks: false, leave: true, telework: false, travel: false, awards: false } }));
    expect(leaveOnly.map((e) => e.uid)).toEqual(["leave-l1@radar"]);
    const riley = calendarEvents(context({ ...all, employeeId: "e2" }));
    expect(riley.map((e) => e.uid)).toEqual(["travel-v1@radar"]);
  });

  it("keeps anything that overlaps the range and drops what falls wholly outside", () => {
    const events = calendarEvents(
      context({
        from: "2026-07-22",
        to: "2026-07-27",
        leaveRecords: [leave("straddles-start"), leave("before", { startDate: "2026-07-10", endDate: "2026-07-21" })],
        travelRecords: [trip("starts-on-last-day"), trip("after", { startDate: "2026-07-28", endDate: "2026-07-30" })]
      })
    );
    expect(events.map((e) => e.uid)).toEqual(["leave-straddles-start@radar", "travel-starts-on-last-day@radar"]);
  });

  it("treats an end date before the start as a single day", () => {
    const [event] = calendarEvents(context({ leaveRecords: [leave("l1", { endDate: "2026-07-01" })] }));
    expect(event).toMatchObject({ start: "2026-07-21", end: "2026-07-21" });
  });
});

describe("toIcs", () => {
  const stamp = "2026-07-20T15:04:05.123Z";

  it("writes all-day events whose end is the day after the last day", () => {
    const text = toIcs(
      [{ uid: "leave-l1@radar", title: "Avery Brooks: Annual leave", start: "2026-07-21", end: "2026-07-23", description: "Status: approved" }],
      stamp
    );
    expect(text.split("\r\n")).toEqual([
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//RADAR//Supervisor Calendar//EN",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      "X-WR-CALNAME:RADAR",
      "BEGIN:VEVENT",
      "UID:leave-l1@radar",
      "DTSTAMP:20260720T150405Z",
      "DTSTART;VALUE=DATE:20260721",
      "DTEND;VALUE=DATE:20260724",
      "SUMMARY:Avery Brooks: Annual leave",
      "DESCRIPTION:Status: approved",
      "TRANSP:TRANSPARENT",
      "END:VEVENT",
      "END:VCALENDAR",
      ""
    ]);
  });

  it("rolls the end date over a month and a year boundary", () => {
    const text = toIcs([{ uid: "a", title: "x", start: "2026-12-31", end: "2026-12-31" }], stamp);
    expect(text).toContain("DTSTART;VALUE=DATE:20261231\r\nDTEND;VALUE=DATE:20270101");
  });

  it("escapes commas, semicolons, backslashes, and line breaks in text", () => {
    const text = toIcs([{ uid: "a", title: "Norfolk, VA; path C:\\temp", start: "2026-07-20", end: "2026-07-20", description: "Line one\nLine two" }], stamp);
    expect(text).toContain("SUMMARY:Norfolk\\, VA\\; path C:\\\\temp");
    expect(text).toContain("DESCRIPTION:Line one\\nLine two");
  });

  it("folds long lines at 75 bytes without splitting a multi-byte character", () => {
    const title = `${"Résumé review — ".repeat(8)}end`;
    const text = toIcs([{ uid: "a", title, start: "2026-07-20", end: "2026-07-20" }], stamp);
    const encoder = new TextEncoder();
    const lines = text.split("\r\n");
    for (const line of lines) expect(encoder.encode(line).length).toBeLessThanOrEqual(75);
    // Unfolding (removing CRLF + one space) gives back the original line exactly.
    expect(text.replace(/\r\n /g, "")).toContain(`SUMMARY:${title}`);
    expect(lines.filter((line) => line.startsWith(" ")).length).toBeGreaterThan(0);
  });

  it("is a valid empty calendar when there are no events", () => {
    const text = toIcs([], stamp);
    expect(text.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(text.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(text).not.toContain("VEVENT");
  });
});
