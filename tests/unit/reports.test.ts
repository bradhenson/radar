import { describe, expect, it } from "vitest";
import type { Employee, EvaluationCycle, LeaveRecord, PerformanceInput, TeleworkRecord, TravelRecord } from "../../src/domain/models";
import {
  availabilityReport,
  payPeriodChoices,
  performanceWriteUpReport,
  reportHasTable,
  reportToCsv,
  reportToText,
  shortDateRange,
  teleworkPayPeriodReport,
  trainingComplianceReport,
  workloadReport,
  type Report,
  type TrainingReportRow
} from "../../src/domain/rules/reports";
import { SITUATIONAL_REQUEST_TYPE } from "../../src/domain/rules/telework";
import { richTextFromPlainText } from "../../src/utils/richTextDoc";

// 2026-07-20 is a Monday; its week runs Sun Jul 19 to Sat Jul 25.
const TODAY = "2026-07-20";
const STAMP = { createdAt: "2026-07-01T00:00:00.000Z", updatedAt: "2026-07-01T00:00:00.000Z" };
const NAMES: Record<string, string> = { e1: "Avery Brooks", e2: "Riley Chen", e3: "Morgan Patel" };
const employeeName = (id: string) => NAMES[id] ?? id;

const rowsOf = (report: Report, section = 0) => report.sections[section]!.table!.rows;

function leave(overrides: Partial<LeaveRecord>): LeaveRecord {
  return { id: "l", employeeId: "e1", startDate: "2026-07-21", endDate: "2026-07-22", status: "approved", ...STAMP, ...overrides };
}

function trip(overrides: Partial<TravelRecord>): TravelRecord {
  return {
    id: "t",
    employeeId: "e2",
    destination: "Norfolk, VA",
    startDate: "2026-07-23",
    endDate: "2026-07-28",
    iptConcurrence: "concurred",
    dtsAuthorizationStatus: "approved",
    ...STAMP,
    ...overrides
  };
}

function telework(overrides: Partial<TeleworkRecord>): TeleworkRecord {
  return { id: "w", employeeId: "e3", recordType: SITUATIONAL_REQUEST_TYPE, status: "approved", effectiveDate: "2026-07-22", ...STAMP, ...overrides };
}

describe("shortDateRange", () => {
  it("is as short as the range allows", () => {
    expect(shortDateRange("2026-07-20", "2026-07-20")).toBe("Jul 20");
    expect(shortDateRange("2026-07-20", "2026-07-24")).toBe("Jul 20–24");
    expect(shortDateRange("2026-07-28", "2026-08-02")).toBe("Jul 28 – Aug 2");
    expect(shortDateRange("2026-12-28", "2027-01-03")).toBe("Dec 28, 2026 – Jan 3, 2027");
    // A mis-entered end before the start reads as a single day.
    expect(shortDateRange("2026-07-20", "2026-07-10")).toBe("Jul 20");
  });
});

describe("availabilityReport", () => {
  const report = availabilityReport({
    today: TODAY,
    weeks: 2,
    leaveRecords: [
      leave({ id: "l1" }),
      leave({ id: "l2", employeeId: "e3", startDate: "2026-07-27", endDate: "2026-07-27" }),
      leave({ id: "l3", employeeId: "e2", status: "cancelled" })
    ],
    travelRecords: [trip({ id: "t1" }), trip({ id: "t2", employeeId: "e1", tripStatus: "cancelled" })],
    teleworkRecords: [
      telework({ id: "w1" }),
      telework({ id: "w2", employeeId: "e1", status: "pending", effectiveDate: "2026-07-24" }),
      telework({ id: "w3", employeeId: "e2", status: "denied", effectiveDate: "2026-07-21" }),
      telework({ id: "w4", employeeId: "e2", recordType: "Agreement", status: "active", effectiveDate: "2026-07-21" })
    ],
    employeeName
  });

  it("covers the requested weeks starting with the current one", () => {
    expect(rowsOf(report).map((row) => row.week)).toEqual(["Jul 19–25", "Jul 26 – Aug 1"]);
    expect(report.subtitle).toBe("2 weeks from Jul 19, 2026");
  });

  it("lists who is out each week, clipping a trip that spans two weeks", () => {
    const [first, second] = rowsOf(report);
    expect(first).toMatchObject({ leave: "Avery Brooks (Jul 21–22)", travel: "Riley Chen (Jul 23–25)", out: 2 });
    expect(second).toMatchObject({ leave: "Morgan Patel (Jul 27)", travel: "Riley Chen (Jul 26–28)", out: 2 });
  });

  it("lists telework without counting it as out, marks pending, and leaves out denied requests and agreements", () => {
    expect(rowsOf(report)[0]!.telework).toBe("Avery Brooks (Jul 24, pending); Morgan Patel (Jul 22)");
    expect(rowsOf(report)[1]!.telework).toBe("");
  });

  it("leaves out cancelled leave and cancelled trips", () => {
    const text = JSON.stringify(rowsOf(report));
    expect(text).not.toContain("Riley Chen (Jul 21");
    expect(rowsOf(report)[0]!.travel).not.toContain("Avery Brooks");
  });
});

describe("trainingComplianceReport", () => {
  const row = (requirementId: string, employee: string, state: string, dueDate?: string): TrainingReportRow => ({
    requirementId,
    requirementName: requirementId === "r1" ? "Cyber Awareness" : "Records Basics",
    employeeName: employee,
    state,
    dueDate
  });
  const report = trainingComplianceReport(
    [
      row("r1", "Riley Chen", "overdue", "2026-07-10"),
      row("r1", "Avery Brooks", "complete"),
      row("r1", "Morgan Patel", "expiring", "2026-08-01"),
      row("r1", "Quinn Foster", "due_soon", "2026-08-01"),
      row("r1", "Drew Bennett", "waived"),
      row("r2", "Avery Brooks", "expired", "2026-06-20"),
      row("r2", "Riley Chen", "not_applicable")
    ],
    TODAY
  );

  it("counts each requirement without waived or not-applicable records", () => {
    expect(rowsOf(report, 0)).toEqual([
      { requirement: "Cyber Awareness", applies: 4, complete: 2, overdue: 1, remaining: 1, percent: "50%" },
      { requirement: "Records Basics", applies: 1, complete: 0, overdue: 1, remaining: 0, percent: "0%" }
    ]);
  });

  it("lists overdue and expired records by requirement then name, with days overdue", () => {
    expect(rowsOf(report, 1)).toEqual([
      { requirement: "Cyber Awareness", employee: "Riley Chen", due: "Jul 10, 2026", days: 10 },
      { requirement: "Records Basics", employee: "Avery Brooks", due: "Jun 20, 2026", days: 30 }
    ]);
    expect(report.subtitle).toBe("2 requirements, 2 overdue records");
  });

  it("says so when nothing is overdue", () => {
    const clean = trainingComplianceReport([row("r1", "Avery Brooks", "complete")], TODAY);
    expect(rowsOf(clean, 1)).toEqual([]);
    expect(clean.sections[1]!.table!.emptyText).toBe("Nothing is overdue.");
  });
});

describe("workloadReport", () => {
  const employee = (id: string, displayName: string): Employee => ({ id, displayName, activeStatus: "active", tags: [], isArchived: false, ...STAMP });
  const base = { openCount: 0, overdueCount: 0, waitingCount: 0, dueSoonCount: 0, projectCount: 0, trainingActionCount: 0 };
  const report = workloadReport(
    [
      { ...base, employee: employee("e2", "Riley Chen"), openCount: 5, overdueCount: 2, lastInputDate: "2026-07-10" },
      { ...base, employee: employee("e1", "Avery Brooks"), openCount: 1, trainingActionCount: 3, lastCheckInDate: "2026-06-20" }
    ],
    TODAY
  );

  it("lists people by name, never by how much work they hold", () => {
    expect(rowsOf(report).map((row) => row.employee)).toEqual(["Avery Brooks", "Riley Chen"]);
    expect(report.sections[0]!.note).toMatch(/not a measure of anyone's performance/);
  });

  it("shows counts, and dates with how long ago they were", () => {
    expect(rowsOf(report)[0]).toMatchObject({ open: 1, training: 3, lastInput: "None", lastCheckIn: "Jun 20, 2026 (30d)" });
    expect(rowsOf(report)[1]).toMatchObject({ open: 5, overdue: 2, lastInput: "Jul 10, 2026 (10d)", lastCheckIn: "None" });
    expect(report.subtitle).toBe("2 active employees, 6 open assigned tasks");
  });
});

describe("teleworkPayPeriodReport", () => {
  const period = { start: "2026-07-12", end: "2026-07-25" };
  const report = teleworkPayPeriodReport({
    today: TODAY,
    period,
    limit: 2,
    teleworkRecords: [
      // Riley: two approved plus one pending, so one over.
      telework({ id: "a", employeeId: "e2", effectiveDate: "2026-07-13" }),
      telework({ id: "b", employeeId: "e2", effectiveDate: "2026-07-15" }),
      telework({ id: "c", employeeId: "e2", status: "pending", effectiveDate: "2026-07-21" }),
      // Avery: one approved and one command-approved, which is listed but not counted.
      telework({ id: "d", employeeId: "e1", effectiveDate: "2026-07-14" }),
      telework({ id: "e", employeeId: "e1", status: "command_approved", effectiveDate: "2026-07-16" }),
      // Morgan: a request spanning the period boundary counts only its days inside (Fri Jul 24), not Mon Jul 27.
      telework({ id: "f", employeeId: "e3", effectiveDate: "2026-07-24", expirationDate: "2026-07-27" }),
      // Left out: denied, a different period, and an agreement.
      telework({ id: "g", employeeId: "e3", status: "denied", effectiveDate: "2026-07-20" }),
      telework({ id: "h", employeeId: "e3", effectiveDate: "2026-08-03" }),
      telework({ id: "i", employeeId: "e3", recordType: "Agreement", status: "active", effectiveDate: "2026-07-20" })
    ],
    employeeName
  });

  it("tallies each person's days against the allowance", () => {
    expect(rowsOf(report)).toEqual([
      { employee: "Avery Brooks", approved: 1, pending: 0, command: 1, counted: 1, allowance: 2, status: "Within allowance", dates: "Jul 14, Jul 16 (command approved)" },
      { employee: "Morgan Patel", approved: 1, pending: 0, command: 0, counted: 1, allowance: 2, status: "Within allowance", dates: "Jul 24" },
      { employee: "Riley Chen", approved: 2, pending: 1, command: 0, counted: 3, allowance: 2, status: "Over by 1", dates: "Jul 13, Jul 15, Jul 21 (pending)" }
    ]);
    expect(report.subtitle).toBe("Jul 12, 2026 – Jul 25, 2026 · 3 employees with telework, 1 over the allowance");
  });

  it("reads 'At allowance' exactly at the limit and reports an empty period plainly", () => {
    const atLimit = teleworkPayPeriodReport({
      today: TODAY,
      period,
      limit: 1,
      teleworkRecords: [telework({ id: "a", employeeId: "e1", effectiveDate: "2026-07-14" })],
      employeeName
    });
    expect(rowsOf(atLimit)[0]!.status).toBe("At allowance");
    const empty = teleworkPayPeriodReport({ today: TODAY, period, limit: 2, teleworkRecords: [], employeeName });
    expect(rowsOf(empty)).toEqual([]);
    expect(empty.sections[0]!.table!.emptyText).toMatch(/No situational telework/);
  });

  it("offers two pay periods either side of the current one", () => {
    expect(payPeriodChoices(period)).toEqual([
      { start: "2026-06-14", end: "2026-06-27" },
      { start: "2026-06-28", end: "2026-07-11" },
      { start: "2026-07-12", end: "2026-07-25" },
      { start: "2026-07-26", end: "2026-08-08" },
      { start: "2026-08-09", end: "2026-08-22" }
    ]);
  });
});

describe("performanceWriteUpReport", () => {
  const cycle: EvaluationCycle = { id: "c26", name: "FY2026", startDate: "2025-10-01", endDate: "2026-09-30", active: true };
  const elements = [
    { id: "el-q", name: "Technical Quality", active: true },
    { id: "el-m", name: "Mission Delivery", active: true }
  ];
  const input = (id: string, inputDate: string, overrides: Partial<PerformanceInput> = {}): PerformanceInput => ({
    id,
    employeeId: "e1",
    inputDate,
    actionOrAccomplishment: richTextFromPlainText(`Action ${id}`),
    result: richTextFromPlainText(`Result ${id}`),
    inputStatus: "ready",
    recognitionPotential: false,
    tags: [],
    isArchived: false,
    ...STAMP,
    ...overrides
  });
  const inputs = [
    input("late", "2026-05-01", { performanceElementId: "el-q", projectId: "p1", recognitionPotential: true }),
    input("early", "2026-01-15", { performanceElementId: "el-q", situationOrContext: richTextFromPlainText("Context early"), result: undefined }),
    input("mission", "2026-03-01", { performanceElementId: "el-m" }),
    input("loose", "2026-02-01"),
    input("deleted-element", "2026-02-10", { performanceElementId: "gone" }),
    input("outside", "2025-09-01", { performanceElementId: "el-q" }),
    input("archived", "2026-04-01", { isArchived: true })
  ];
  const report = performanceWriteUpReport({
    today: TODAY,
    employeeName: "Avery Brooks",
    cycle,
    inputs,
    elements,
    projectName: (id) => (id === "p1" ? "Project Harbor" : "")
  });

  it("is titled for the person and the cycle", () => {
    expect(report.title).toBe("Performance write-up: Avery Brooks");
    expect(report.subtitle).toBe("FY2026 (Oct 1, 2025 – Sep 30, 2026)");
  });

  it("summarizes the cycle's inputs, leaving out archived ones and other cycles", () => {
    expect(report.sections[0]!.paragraphs![0]!.text).toBe(
      "5 inputs from Jan 15, 2026 to May 1, 2026. 1 still need a result or impact. 1 marked for recognition."
    );
  });

  it("groups by element in name order, with unassigned and deleted-element inputs last", () => {
    expect(report.sections.slice(1).map((s) => s.heading)).toEqual(["Mission Delivery", "Technical Quality", "No performance element"]);
    expect(report.sections[3]!.paragraphs!.map((p) => p.label)).toEqual(["Feb 1, 2026", "Feb 10, 2026"]);
  });

  it("lists each element's inputs in date order with context, action, and result", () => {
    const quality = report.sections[2]!.paragraphs!;
    expect(quality.map((p) => p.label)).toEqual(["Jan 15, 2026", "May 1, 2026 · Project Harbor · Recognition potential"]);
    expect(quality[0]!.text).toBe("Context: Context early\nAction: Action early\nResult / impact: not recorded");
    expect(quality[1]!.text).toBe("Action: Action late\nResult / impact: Result late");
  });

  it("covers every date when no cycle is chosen, and says so when there is nothing", () => {
    const all = performanceWriteUpReport({ today: TODAY, employeeName: "Avery Brooks", cycle: undefined, inputs, elements, projectName: () => "" });
    expect(all.subtitle).toBe("All dates");
    expect(all.sections[0]!.paragraphs![0]!.text).toMatch(/^6 inputs from Sep 1, 2025/);
    const none = performanceWriteUpReport({ today: TODAY, employeeName: "Avery Brooks", cycle, inputs: [], elements, projectName: () => "" });
    expect(none.sections).toHaveLength(1);
    expect(none.sections[0]!.paragraphs![0]!.text).toBe("No performance inputs are recorded for this period.");
  });

  it("uses a plain 'Inputs' heading when nothing is assigned to an element", () => {
    const plain = performanceWriteUpReport({
      today: TODAY,
      employeeName: "Avery Brooks",
      cycle,
      inputs: [input("a", "2026-02-01")],
      elements: [],
      projectName: () => ""
    });
    expect(plain.sections.map((s) => s.heading)).toEqual([undefined, "Inputs"]);
  });
});

describe("report export", () => {
  const report: Report = {
    title: "Sample report",
    subtitle: "Two sections",
    generated: TODAY,
    sections: [
      { paragraphs: [{ text: "Opening summary." }] },
      {
        heading: "People",
        note: "A note.",
        table: {
          columns: [
            { key: "name", label: "Name" },
            { key: "count", label: "Count", numeric: true }
          ],
          rows: [
            { name: 'Brooks, "Avery"', count: 3 },
            { name: "=SUM(A1)", count: 0 }
          ],
          emptyText: "Nobody."
        }
      },
      { heading: "Empty", table: { columns: [{ key: "x", label: "X" }], rows: [], emptyText: "Nothing here." } }
    ]
  };

  it("writes each table as CSV under its heading, quoting text and defusing formulas", () => {
    expect(reportToCsv(report)).toBe(
      ['"People"', '"Name","Count"', '"Brooks, ""Avery""","3"', '"\'=SUM(A1)","0"', "", '"Empty"', '"X"'].join("\r\n")
    );
    expect(reportHasTable(report)).toBe(true);
    expect(reportHasTable({ ...report, sections: [report.sections[0]!] })).toBe(false);
  });

  it("writes the whole report as plain text", () => {
    expect(reportToText(report).split("\r\n")).toEqual([
      "SAMPLE REPORT",
      "Two sections",
      "Generated Jul 20, 2026",
      "",
      "Opening summary.",
      "",
      "PEOPLE",
      "------",
      "A note.",
      "",
      'Name: Brooks, "Avery" | Count: 3',
      "Name: =SUM(A1) | Count: 0",
      "",
      "EMPTY",
      "-----",
      "Nothing here.",
      ""
    ]);
  });
});
