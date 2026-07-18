// Reports (plan 32): pure aggregations for the Reports page. Informational
// views for coverage and planning — never an employee performance ranking.

import type { Employee, EmployeeInteraction, IsoDate, LeaveRecord, PerformanceInput, Task, TravelRecord } from "../models";
import { addDays, compareDates, daysBetween } from "../../utils/dates";

function isOpen(task: Task): boolean {
  return !task.isArchived && task.status !== "complete" && task.status !== "cancelled";
}

export interface SupervisorWorkload {
  open: number;
  overdue: number;
  waiting: number;
  dueIn7: number;
  dueIn14: number;
  dueIn30: number;
  unassigned: number;
}

export function supervisorWorkload(tasks: Task[], today: IsoDate): SupervisorWorkload {
  const open = tasks.filter(isOpen);
  const dueWithin = (days: number) =>
    open.filter((t) => t.dueDate && daysBetween(today, t.dueDate) >= 0 && daysBetween(today, t.dueDate) <= days).length;
  return {
    open: open.length,
    overdue: open.filter((t) => t.dueDate && compareDates(t.dueDate, today) < 0).length,
    waiting: open.filter((t) => t.status === "waiting").length,
    dueIn7: dueWithin(7),
    dueIn14: dueWithin(14),
    dueIn30: dueWithin(30),
    unassigned: open.filter((t) => !t.employeeId).length
  };
}

export interface EmployeeWorkloadRow {
  employee: Employee;
  openCount: number;
  overdueCount: number;
  waitingCount: number;
  dueSoonCount: number;
  projectCount: number;
  trainingActionCount: number;
  lastInputDate?: IsoDate;
  lastCheckInDate?: IsoDate;
}

export interface EmployeeWorkloadContext {
  today: IsoDate;
  dueSoonDays: number;
  employees: Employee[];
  tasks: Task[];
  performanceInputs: PerformanceInput[];
  interactions: EmployeeInteraction[];
  /** Count of training roster rows needing action, keyed by employee id. */
  trainingActionCounts: Map<string, number>;
}

export function employeeWorkload(ctx: EmployeeWorkloadContext): EmployeeWorkloadRow[] {
  const openByEmployee = new Map<string, Task[]>();
  for (const task of ctx.tasks) {
    if (!isOpen(task) || !task.employeeId) continue;
    const list = openByEmployee.get(task.employeeId) ?? [];
    list.push(task);
    openByEmployee.set(task.employeeId, list);
  }

  return ctx.employees
    .filter((e) => e.activeStatus === "active" && !e.isArchived)
    .map((employee) => {
      const open = openByEmployee.get(employee.id) ?? [];
      const lastInputDate = latest(
        ctx.performanceInputs.filter((p) => p.employeeId === employee.id && !p.isArchived).map((p) => p.inputDate)
      );
      const lastCheckInDate = latest([
        ...(employee.lastCheckInDate ? [employee.lastCheckInDate] : []),
        ...ctx.interactions.filter((i) => i.employeeId === employee.id).map((i) => i.interactionDate)
      ]);
      return {
        employee,
        openCount: open.length,
        overdueCount: open.filter((t) => t.dueDate && compareDates(t.dueDate, ctx.today) < 0).length,
        waitingCount: open.filter((t) => t.status === "waiting").length,
        dueSoonCount: open.filter(
          (t) => t.dueDate && daysBetween(ctx.today, t.dueDate) >= 0 && daysBetween(ctx.today, t.dueDate) <= ctx.dueSoonDays
        ).length,
        projectCount: new Set(open.map((t) => t.projectId).filter(Boolean)).size,
        trainingActionCount: ctx.trainingActionCounts.get(employee.id) ?? 0,
        lastInputDate,
        lastCheckInDate
      };
    })
    .sort((a, b) => a.employee.displayName.localeCompare(b.employee.displayName));
}

function latest(dates: IsoDate[]): IsoDate | undefined {
  return dates.length ? dates.reduce((a, b) => (compareDates(a, b) >= 0 ? a : b)) : undefined;
}

// ---------------------------------------------------------------------------
// Availability: who is out, week by week.

export interface AbsenceEntry {
  kind: "leave" | "travel";
  employeeId: string;
  startDate: IsoDate;
  endDate: IsoDate;
  /** Leave type or travel destination. */
  detail?: string;
}

export interface AvailabilityWeek {
  weekStart: IsoDate;
  weekEnd: IsoDate;
  entries: AbsenceEntry[];
}

const EXCLUDED_LEAVE_STATUSES = new Set(["cancelled"]);

export function absenceEntries(leaveRecords: LeaveRecord[], travelRecords: TravelRecord[]): AbsenceEntry[] {
  const entries: AbsenceEntry[] = [];
  for (const leave of leaveRecords) {
    if (EXCLUDED_LEAVE_STATUSES.has(leave.status)) continue;
    entries.push({ kind: "leave", employeeId: leave.employeeId, startDate: leave.startDate, endDate: leave.endDate, detail: leave.leaveType });
  }
  for (const trip of travelRecords) {
    if (trip.isArchived) continue;
    entries.push({ kind: "travel", employeeId: trip.employeeId, startDate: trip.startDate, endDate: trip.endDate, detail: trip.destination });
  }
  return entries;
}

/** Sunday on or before the given date, matching the calendar grid. */
export function weekStartOf(date: IsoDate): IsoDate {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return addDays(date, -dow);
}

/**
 * The next `weeks` calendar weeks starting from today's week; each week lists
 * every absence overlapping it, ordered by start date then employee id.
 */
export function availabilityByWeek(entries: AbsenceEntry[], today: IsoDate, weeks: number): AvailabilityWeek[] {
  const out: AvailabilityWeek[] = [];
  let weekStart = weekStartOf(today);
  for (let i = 0; i < weeks; i++) {
    const weekEnd = addDays(weekStart, 6);
    const overlapping = entries
      .filter((entry) => entry.startDate <= weekEnd && entry.endDate >= weekStart)
      .sort((a, b) => compareDates(a.startDate, b.startDate) || a.employeeId.localeCompare(b.employeeId));
    out.push({ weekStart, weekEnd, entries: overlapping });
    weekStart = addDays(weekStart, 7);
  }
  return out;
}

/** Absences covering a single day (the Reports "out today" strip). */
export function absencesOn(entries: AbsenceEntry[], date: IsoDate): AbsenceEntry[] {
  return entries
    .filter((entry) => entry.startDate <= date && entry.endDate >= date)
    .sort((a, b) => a.employeeId.localeCompare(b.employeeId));
}
