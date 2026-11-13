// Reports (plan section 32). Pure: records in, a plain report out. Every
// report is the same shape (sections of tables and paragraphs), so one page
// can show, print, and export any of them. Reports are informational
// summaries; none of them ranks employees.

import type {
  EvaluationCycle,
  IsoDate,
  LeaveRecord,
  PerformanceElement,
  PerformanceInput,
  TeleworkRecord,
  TravelRecord
} from "../models";
import { addDays, compareDates, daysBetween, formatDate } from "../../utils/dates";
import { toCsv } from "../../utils/csv";
import { richTextDocToPlainText } from "../../utils/richTextDoc";
import { cycleLabel, inputsInCycle } from "./evaluationCycles";
import {
  countsTowardTeleworkLimit,
  isPendingRequest,
  isSituationalRequest,
  payPeriodLabel,
  teleworkDays,
  type PayPeriod
} from "./telework";
import { absenceEntries, availabilityByWeek, type EmployeeWorkloadRow } from "./workload";

export type ReportCell = string | number;

export interface ReportColumn {
  key: string;
  label: string;
  /** Right-aligned in the table. */
  numeric?: boolean;
}

export interface ReportTable {
  columns: ReportColumn[];
  rows: Record<string, ReportCell>[];
  /** Shown instead of an empty table. */
  emptyText: string;
}

export interface ReportParagraph {
  label?: string;
  text: string;
}

export interface ReportSection {
  heading?: string;
  note?: string;
  table?: ReportTable;
  paragraphs?: ReportParagraph[];
}

export interface Report {
  title: string;
  subtitle: string;
  generated: IsoDate;
  sections: ReportSection[];
}

type NameLookup = (employeeId: string) => string;

/** "Nov 16", "Nov 16–18", "Nov 28 – Dec 1", or with years when they differ. */
export function shortDateRange(start: IsoDate, end: IsoDate): string {
  const short = (date: IsoDate) => formatDate(date).replace(/, \d{4}$/, "");
  if (start === end || compareDates(end, start) < 0) return short(start);
  if (start.slice(0, 4) !== end.slice(0, 4)) return `${formatDate(start)} – ${formatDate(end)}`;
  if (start.slice(0, 7) === end.slice(0, 7)) return `${short(start)}–${Number(end.slice(8, 10))}`;
  return `${short(start)} – ${short(end)}`;
}

function byName(a: string, b: string): number {
  return a.localeCompare(b);
}

// ---------------------------------------------------------------------------
// Availability

export interface AvailabilityReportContext {
  today: IsoDate;
  weeks: number;
  leaveRecords: LeaveRecord[];
  travelRecords: TravelRecord[];
  teleworkRecords: TeleworkRecord[];
  employeeName: NameLookup;
}

/** Who is on leave, on travel, or teleworking, week by week from this week on. */
export function availabilityReport(ctx: AvailabilityReportContext): Report {
  const weeks = availabilityByWeek(absenceEntries(ctx.leaveRecords, ctx.travelRecords), ctx.today, ctx.weeks);
  const teleworkers = ctx.teleworkRecords.filter(
    (record) => isSituationalRequest(record) && !["denied", "cancelled", "expired"].includes(record.status)
  );

  const rows = weeks.map((week) => {
    const clip = (start: IsoDate, end: IsoDate) =>
      shortDateRange(compareDates(start, week.weekStart) < 0 ? week.weekStart : start, compareDates(end, week.weekEnd) > 0 ? week.weekEnd : end);
    const people = (kind: "leave" | "travel") =>
      week.entries
        .filter((entry) => entry.kind === kind)
        .map((entry) => ({ name: ctx.employeeName(entry.employeeId), text: clip(entry.startDate, entry.endDate) }))
        .sort((a, b) => byName(a.name, b.name))
        .map((p) => `${p.name} (${p.text})`)
        .join("; ");
    const telework = teleworkers
      .map((record) => {
        const days = teleworkDays(record).filter((day) => compareDates(day, week.weekStart) >= 0 && compareDates(day, week.weekEnd) <= 0);
        if (days.length === 0) return undefined;
        const pending = isPendingRequest(record) ? ", pending" : "";
        return { name: ctx.employeeName(record.employeeId), text: `${shortDateRange(days[0]!, days[days.length - 1]!)}${pending}` };
      })
      .filter((p): p is { name: string; text: string } => p !== undefined)
      .sort((a, b) => byName(a.name, b.name))
      .map((p) => `${p.name} (${p.text})`)
      .join("; ");
    return {
      week: shortDateRange(week.weekStart, week.weekEnd),
      leave: people("leave"),
      travel: people("travel"),
      telework,
      out: new Set(week.entries.map((entry) => entry.employeeId)).size
    };
  });

  return {
    title: "Availability by week",
    subtitle: `${ctx.weeks} week${ctx.weeks === 1 ? "" : "s"} from ${formatDate(weeks[0]?.weekStart ?? ctx.today)}`,
    generated: ctx.today,
    sections: [
      {
        note: "Out counts each person once per week, on leave or on travel. Telework is listed but not counted as out.",
        table: {
          columns: [
            { key: "week", label: "Week" },
            { key: "leave", label: "On leave" },
            { key: "travel", label: "On travel" },
            { key: "telework", label: "Teleworking" },
            { key: "out", label: "Out", numeric: true }
          ],
          rows,
          emptyText: "No weeks selected."
        }
      }
    ]
  };
}

// ---------------------------------------------------------------------------
// Training compliance

export interface TrainingReportRow {
  requirementId: string;
  requirementName: string;
  employeeName: string;
  /** A TrainingState from domain/rules/training.ts. */
  state: string;
  dueDate?: IsoDate;
}

export function trainingComplianceReport(rows: TrainingReportRow[], today: IsoDate): Report {
  const counted = rows.filter((row) => row.state !== "waived" && row.state !== "not_applicable");
  const isOverdue = (row: TrainingReportRow) => row.state === "overdue" || row.state === "expired";
  const isDone = (row: TrainingReportRow) => row.state === "complete" || row.state === "expiring";

  const byRequirement = new Map<string, TrainingReportRow[]>();
  for (const row of counted) {
    const list = byRequirement.get(row.requirementId) ?? [];
    list.push(row);
    byRequirement.set(row.requirementId, list);
  }
  const summary = [...byRequirement.values()]
    .map((list) => {
      const done = list.filter(isDone).length;
      const overdue = list.filter(isOverdue).length;
      return {
        requirement: list[0]!.requirementName,
        applies: list.length,
        complete: done,
        overdue,
        remaining: list.length - done - overdue,
        percent: `${list.length ? Math.round((done / list.length) * 100) : 0}%`
      };
    })
    .sort((a, b) => byName(a.requirement, b.requirement));

  const overdue = counted
    .filter(isOverdue)
    .map((row) => ({
      requirement: row.requirementName,
      employee: row.employeeName,
      due: row.dueDate ? formatDate(row.dueDate) : "",
      days: row.dueDate ? Math.max(0, daysBetween(row.dueDate, today)) : ""
    }))
    .sort((a, b) => byName(a.requirement, b.requirement) || byName(a.employee, b.employee));

  return {
    title: "Training compliance",
    subtitle: `${summary.length} requirement${summary.length === 1 ? "" : "s"}, ${overdue.length} overdue record${overdue.length === 1 ? "" : "s"}`,
    generated: today,
    sections: [
      {
        heading: "By requirement",
        note: "Waived and not-applicable records are left out of every count.",
        table: {
          columns: [
            { key: "requirement", label: "Requirement" },
            { key: "applies", label: "Applies to", numeric: true },
            { key: "complete", label: "Complete", numeric: true },
            { key: "overdue", label: "Overdue", numeric: true },
            { key: "remaining", label: "Not yet due", numeric: true },
            { key: "percent", label: "Complete %", numeric: true }
          ],
          rows: summary,
          emptyText: "No active training requirements."
        }
      },
      {
        heading: "Overdue",
        table: {
          columns: [
            { key: "requirement", label: "Requirement" },
            { key: "employee", label: "Employee" },
            { key: "due", label: "Due" },
            { key: "days", label: "Days overdue", numeric: true }
          ],
          rows: overdue,
          emptyText: "Nothing is overdue."
        }
      }
    ]
  };
}

// ---------------------------------------------------------------------------
// Workload

export function workloadReport(rows: EmployeeWorkloadRow[], today: IsoDate): Report {
  const since = (date: IsoDate | undefined) => (date ? `${formatDate(date)} (${daysBetween(date, today)}d)` : "None");
  const sorted = [...rows].sort((a, b) => byName(a.employee.displayName, b.employee.displayName));
  return {
    title: "Workload by employee",
    subtitle: `${sorted.length} active employee${sorted.length === 1 ? "" : "s"}, ${sorted.reduce((sum, r) => sum + r.openCount, 0)} open assigned tasks`,
    generated: today,
    sections: [
      {
        note: "Listed by name. This shows where work sits; it is not a measure of anyone's performance.",
        table: {
          columns: [
            { key: "employee", label: "Employee" },
            { key: "open", label: "Open tasks", numeric: true },
            { key: "overdue", label: "Overdue", numeric: true },
            { key: "dueSoon", label: "Due soon", numeric: true },
            { key: "waiting", label: "Waiting", numeric: true },
            { key: "projects", label: "Projects", numeric: true },
            { key: "training", label: "Training to act on", numeric: true },
            { key: "lastInput", label: "Last performance input" },
            { key: "lastCheckIn", label: "Last check-in" }
          ],
          rows: sorted.map((r) => ({
            employee: r.employee.displayName,
            open: r.openCount,
            overdue: r.overdueCount,
            dueSoon: r.dueSoonCount,
            waiting: r.waitingCount,
            projects: r.projectCount,
            training: r.trainingActionCount,
            lastInput: since(r.lastInputDate),
            lastCheckIn: since(r.lastCheckInDate)
          })),
          emptyText: "No active employees."
        }
      }
    ]
  };
}

// ---------------------------------------------------------------------------
// Telework by pay period

export interface TeleworkReportContext {
  today: IsoDate;
  period: PayPeriod;
  /** Telework days allowed per pay period. */
  limit: number;
  teleworkRecords: TeleworkRecord[];
  employeeName: NameLookup;
}

/** Each person's situational telework days in one pay period, against the allowance. */
export function teleworkPayPeriodReport(ctx: TeleworkReportContext): Report {
  const inPeriod = (day: IsoDate) => compareDates(day, ctx.period.start) >= 0 && compareDates(day, ctx.period.end) <= 0;
  interface Tally {
    approved: number;
    pending: number;
    command: number;
    dates: { day: IsoDate; tag: string }[];
  }
  const tallies = new Map<string, Tally>();
  for (const record of ctx.teleworkRecords) {
    if (!isSituationalRequest(record)) continue;
    const command = record.status === "command_approved";
    if (!command && !countsTowardTeleworkLimit(record)) continue;
    const pending = isPendingRequest(record);
    for (const day of teleworkDays(record).filter(inPeriod)) {
      const tally = tallies.get(record.employeeId) ?? { approved: 0, pending: 0, command: 0, dates: [] };
      if (command) tally.command += 1;
      else if (pending) tally.pending += 1;
      else tally.approved += 1;
      tally.dates.push({ day, tag: command ? " (command approved)" : pending ? " (pending)" : "" });
      tallies.set(record.employeeId, tally);
    }
  }

  const rows = [...tallies.entries()]
    .map(([employeeId, tally]) => {
      const counted = tally.approved + tally.pending;
      return {
        employee: ctx.employeeName(employeeId),
        approved: tally.approved,
        pending: tally.pending,
        command: tally.command,
        counted,
        allowance: ctx.limit,
        status: counted > ctx.limit ? `Over by ${counted - ctx.limit}` : counted === ctx.limit ? "At allowance" : "Within allowance",
        dates: tally.dates
          .sort((a, b) => compareDates(a.day, b.day))
          .map((d) => `${formatDate(d.day).replace(/, \d{4}$/, "")}${d.tag}`)
          .join(", ")
      };
    })
    .sort((a, b) => byName(a.employee, b.employee));
  const over = rows.filter((row) => row.counted > ctx.limit).length;

  return {
    title: "Telework by pay period",
    subtitle: `${payPeriodLabel(ctx.period)} · ${rows.length} employee${rows.length === 1 ? "" : "s"} with telework, ${over} over the allowance`,
    generated: ctx.today,
    sections: [
      {
        note: `Allowance is ${ctx.limit} day${ctx.limit === 1 ? "" : "s"} per pay period. Counted is approved plus pending. Command-approved days are listed but not counted; denied and cancelled requests are left out.`,
        table: {
          columns: [
            { key: "employee", label: "Employee" },
            { key: "approved", label: "Approved", numeric: true },
            { key: "pending", label: "Pending", numeric: true },
            { key: "command", label: "Command approved", numeric: true },
            { key: "counted", label: "Counted", numeric: true },
            { key: "allowance", label: "Allowance", numeric: true },
            { key: "status", label: "Against allowance" },
            { key: "dates", label: "Dates" }
          ],
          rows,
          emptyText: "No situational telework in this pay period."
        }
      }
    ]
  };
}

// ---------------------------------------------------------------------------
// Performance write-up

export interface WriteUpContext {
  today: IsoDate;
  employeeName: string;
  /** Undefined means every date. */
  cycle: EvaluationCycle | undefined;
  /** This employee's inputs; archived ones are ignored. */
  inputs: PerformanceInput[];
  elements: PerformanceElement[];
  projectName: (projectId: string | undefined) => string;
}

const NO_ELEMENT = "No performance element";

/**
 * One employee's performance inputs for a cycle, grouped by performance
 * element and in date order: the raw material for a mid-year or annual
 * write-up.
 */
export function performanceWriteUpReport(ctx: WriteUpContext): Report {
  const inputs = inputsInCycle(
    ctx.inputs.filter((input) => !input.isArchived),
    ctx.cycle
  ).sort((a, b) => compareDates(a.inputDate, b.inputDate));
  const elementName = new Map(ctx.elements.map((element) => [element.id, element.name]));
  const groups = new Map<string, PerformanceInput[]>();
  for (const input of inputs) {
    const name = (input.performanceElementId && elementName.get(input.performanceElementId)) || NO_ELEMENT;
    const list = groups.get(name) ?? [];
    list.push(input);
    groups.set(name, list);
  }
  const headings = [...groups.keys()].sort((a, b) => (a === NO_ELEMENT ? 1 : b === NO_ELEMENT ? -1 : byName(a, b)));

  const missingResult = inputs.filter((input) => !richTextDocToPlainText(input.result).trim()).length;
  const recognition = inputs.filter((input) => input.recognitionPotential).length;
  const summary =
    inputs.length === 0
      ? "No performance inputs are recorded for this period."
      : [
          `${inputs.length} input${inputs.length === 1 ? "" : "s"} from ${formatDate(inputs[0]!.inputDate)} to ${formatDate(inputs[inputs.length - 1]!.inputDate)}.`,
          missingResult > 0 ? `${missingResult} still need a result or impact.` : "Every input has a result or impact.",
          recognition > 0 ? `${recognition} marked for recognition.` : ""
        ]
          .filter(Boolean)
          .join(" ");

  const sections: ReportSection[] = [{ paragraphs: [{ text: summary }] }];
  for (const heading of headings) {
    sections.push({
      heading: headings.length === 1 && heading === NO_ELEMENT ? "Inputs" : heading,
      paragraphs: groups.get(heading)!.map((input) => {
        const project = ctx.projectName(input.projectId);
        const lines = [
          richTextDocToPlainText(input.situationOrContext).trim() ? `Context: ${richTextDocToPlainText(input.situationOrContext).trim()}` : "",
          `Action: ${richTextDocToPlainText(input.actionOrAccomplishment).trim()}`,
          richTextDocToPlainText(input.result).trim()
            ? `Result / impact: ${richTextDocToPlainText(input.result).trim()}`
            : "Result / impact: not recorded"
        ].filter(Boolean);
        return {
          label: [formatDate(input.inputDate), project, input.recognitionPotential ? "Recognition potential" : ""].filter(Boolean).join(" · "),
          text: lines.join("\n")
        };
      })
    });
  }

  return {
    title: `Performance write-up: ${ctx.employeeName}`,
    subtitle: ctx.cycle ? cycleLabel(ctx.cycle) : "All dates",
    generated: ctx.today,
    sections
  };
}

// ---------------------------------------------------------------------------
// Export

/** Every table in the report as CSV, each preceded by its heading. Paragraph-only reports export as text instead. */
export function reportToCsv(report: Report): string {
  const blocks: string[] = [];
  for (const section of report.sections) {
    if (!section.table) continue;
    const table = section.table;
    const csv = toCsv(
      table.columns.map((column) => column.label),
      table.rows.map((row) => table.columns.map((column) => row[column.key]))
    );
    blocks.push(section.heading ? `${toCsv([section.heading], [])}\r\n${csv}` : csv);
  }
  return blocks.join("\r\n\r\n");
}

export function reportHasTable(report: Report): boolean {
  return report.sections.some((section) => section.table);
}

/** The whole report as plain text, for pasting into a document or an email. */
export function reportToText(report: Report): string {
  const lines: string[] = [report.title.toUpperCase(), report.subtitle, `Generated ${formatDate(report.generated)}`, ""];
  for (const section of report.sections) {
    if (section.heading) lines.push(section.heading.toUpperCase(), "-".repeat(Math.min(60, section.heading.length)));
    if (section.note) lines.push(section.note, "");
    for (const paragraph of section.paragraphs ?? []) {
      if (paragraph.label) lines.push(paragraph.label);
      lines.push(paragraph.text, "");
    }
    if (section.table) {
      if (section.table.rows.length === 0) lines.push(section.table.emptyText);
      for (const row of section.table.rows) {
        lines.push(section.table.columns.map((column) => `${column.label}: ${row[column.key] ?? ""}`).join(" | "));
      }
      lines.push("");
    }
  }
  return lines.join("\r\n").trimEnd() + "\r\n";
}

/** The weeks offered by the availability report. */
export const AVAILABILITY_WEEK_OPTIONS = [2, 4, 8, 12] as const;

/** Pay periods offered by the telework report: two back, the current one, two ahead. */
export function payPeriodChoices(current: PayPeriod): PayPeriod[] {
  return [-2, -1, 0, 1, 2].map((offset) => {
    const start = addDays(current.start, offset * 14);
    return { start, end: addDays(start, 13) };
  });
}
