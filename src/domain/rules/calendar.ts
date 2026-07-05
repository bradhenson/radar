// Combined month-calendar rules: which records appear on which day.
// Pure and unit-tested; no DOM or store imports (plan section 38 layout rules).

import type { IsoDate, LeaveRecord, Task, TeleworkRecord } from "../models";
import { addDays } from "../../utils/dates";

export interface CalendarCell {
  date: IsoDate;
  inMonth: boolean;
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** 0 = Sunday … 6 = Saturday. Date.UTC used purely for weekday arithmetic. */
function weekdayOf(date: IsoDate): number {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Month (1-12) of an ISO date, for month navigation. */
export function monthOf(date: IsoDate): { year: number; month: number } {
  const [y, m] = date.split("-").map(Number) as [number, number];
  return { year: y, month: m };
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

export function monthTitle(year: number, month: number): string {
  return `${MONTH_NAMES[month - 1]} ${year}`;
}

/**
 * Sunday-first weeks covering the given month (1-12), padded with leading and
 * trailing days from the adjacent months so every week has 7 cells.
 */
export function monthGrid(year: number, month: number): CalendarCell[][] {
  const first: IsoDate = `${year}-${pad(month)}-01`;
  const monthPrefix = `${year}-${pad(month)}-`;
  let cursor = addDays(first, -weekdayOf(first));
  const weeks: CalendarCell[][] = [];
  do {
    const week: CalendarCell[] = [];
    for (let i = 0; i < 7; i++) {
      week.push({ date: cursor, inMonth: cursor.startsWith(monthPrefix) });
      cursor = addDays(cursor, 1);
    }
    weeks.push(week);
  } while (cursor.startsWith(monthPrefix));
  return weeks;
}

function pushTo<T>(map: Map<IsoDate, T[]>, date: IsoDate, record: T): void {
  const list = map.get(date);
  if (list) list.push(record);
  else map.set(date, [record]);
}

const PRIORITY_RANK: Record<Task["priority"], number> = { critical: 0, high: 1, normal: 2, low: 3 };

/**
 * Tasks bucketed by due date within [start, end]. Archived and cancelled tasks
 * are excluded; completed tasks are included (the view can hide them). Within a
 * day: incomplete before complete, then by priority, then title.
 */
export function taskDueMap(tasks: Task[], start: IsoDate, end: IsoDate): Map<IsoDate, Task[]> {
  const map = new Map<IsoDate, Task[]>();
  for (const task of tasks) {
    if (task.isArchived || task.status === "cancelled") continue;
    if (!task.dueDate || task.dueDate < start || task.dueDate > end) continue;
    pushTo(map, task.dueDate, task);
  }
  for (const list of map.values()) {
    list.sort(
      (a, b) =>
        Number(a.status === "complete") - Number(b.status === "complete") ||
        PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
        a.title.localeCompare(b.title)
    );
  }
  return map;
}

/**
 * Leave records expanded to every day of their range (clamped to [start, end]).
 * Cancelled leave is excluded; completed leave still shows as history. A record
 * whose end date is before its start date renders on the start date only.
 */
export function leaveDayMap(records: LeaveRecord[], start: IsoDate, end: IsoDate): Map<IsoDate, LeaveRecord[]> {
  const map = new Map<IsoDate, LeaveRecord[]>();
  for (const leave of records) {
    if (leave.status === "cancelled") continue;
    const rangeEnd = leave.endDate < leave.startDate ? leave.startDate : leave.endDate;
    if (rangeEnd < start || leave.startDate > end) continue;
    let day = leave.startDate < start ? start : leave.startDate;
    const last = rangeEnd > end ? end : rangeEnd;
    while (day <= last) {
      pushTo(map, day, leave);
      day = addDays(day, 1);
    }
  }
  return map;
}

const TELEWORK_HIDDEN_STATUSES = new Set<TeleworkRecord["status"]>(["denied", "cancelled", "expired"]);

/**
 * Situational telework days expanded like leave: `effectiveDate` through
 * `expirationDate` marks the days the person teleworks (matches the Telework
 * page's calendar, plan 20). Denied/cancelled/expired requests and records
 * without a start date are excluded; an end before the start renders on the
 * start date only.
 */
export function teleworkDayMap(records: TeleworkRecord[], start: IsoDate, end: IsoDate): Map<IsoDate, TeleworkRecord[]> {
  const map = new Map<IsoDate, TeleworkRecord[]>();
  for (const record of records) {
    if (record.recordType !== "Situational request") continue;
    if (TELEWORK_HIDDEN_STATUSES.has(record.status)) continue;
    if (!record.effectiveDate) continue;
    const rawEnd = record.expirationDate ?? record.effectiveDate;
    const rangeEnd = rawEnd < record.effectiveDate ? record.effectiveDate : rawEnd;
    if (rangeEnd < start || record.effectiveDate > end) continue;
    let day = record.effectiveDate < start ? start : record.effectiveDate;
    const last = rangeEnd > end ? end : rangeEnd;
    while (day <= last) {
      pushTo(map, day, record);
      day = addDays(day, 1);
    }
  }
  return map;
}
