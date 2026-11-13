// Calendar file export (iCalendar, RFC 5545). Pure: records in, the text of
// an .ics file out. Outlook and other calendars import the file; nothing is
// sent anywhere and nothing syncs back. Every event is an all-day event, so
// no time zone is involved and a date never passes through a timestamp.

import type { AwardRecord, IsoDate, IsoTimestamp, LeaveRecord, Task, TeleworkRecord, TravelRecord } from "../models";
import { addDays, compareDates, isValidIsoDate } from "../../utils/dates";
import { AWARD_FINAL_STATUSES } from "./calendar";
import { isPendingRequest, isSituationalRequest } from "./telework";
import { isTripCancelled } from "./travel";

export interface CalendarEvent {
  /** Stable per record, so importing a newer file updates an event instead of duplicating it. */
  uid: string;
  title: string;
  /** First day, inclusive. */
  start: IsoDate;
  /** Last day, inclusive. */
  end: IsoDate;
  description?: string;
}

export type CalendarLayer = "tasks" | "leave" | "telework" | "travel" | "awards";

export interface CalendarExportContext {
  /** Only events overlapping this range (inclusive) are exported. */
  from: IsoDate;
  to: IsoDate;
  layers: Record<CalendarLayer, boolean>;
  /** When set, only this person's records. */
  employeeId?: string;
  tasks: Task[];
  leaveRecords: LeaveRecord[];
  teleworkRecords: TeleworkRecord[];
  travelRecords: TravelRecord[];
  awardRecords: AwardRecord[];
  employeeName: (employeeId: string | undefined) => string;
}

function overlaps(start: IsoDate, end: IsoDate, from: IsoDate, to: IsoDate): boolean {
  return compareDates(end, from) >= 0 && compareDates(start, to) <= 0;
}

/** An end date entered before the start reads as a one-day event. */
function clampEnd(start: IsoDate, end: IsoDate | undefined): IsoDate {
  return end && compareDates(end, start) >= 0 ? end : start;
}

/**
 * The events the Calendar page shows for the chosen layers and person, within
 * a date range. The same exclusions apply as on the calendar: no archived,
 * cancelled, or finished tasks; no cancelled leave or trips; no denied,
 * cancelled, or expired telework; no awards already submitted or decided.
 */
export function calendarEvents(ctx: CalendarExportContext): CalendarEvent[] {
  const mine = (employeeId: string | undefined) => !ctx.employeeId || employeeId === ctx.employeeId;
  const events: CalendarEvent[] = [];

  if (ctx.layers.tasks) {
    for (const task of ctx.tasks) {
      if (task.isArchived || task.status === "cancelled" || task.status === "complete") continue;
      if (!task.dueDate || !isValidIsoDate(task.dueDate) || !mine(task.employeeId)) continue;
      if (!overlaps(task.dueDate, task.dueDate, ctx.from, ctx.to)) continue;
      const assignee = ctx.employeeName(task.employeeId);
      events.push({
        uid: `task-${task.id}@radar`,
        title: `Due: ${task.title}`,
        start: task.dueDate,
        end: task.dueDate,
        description: [assignee ? `Assigned to ${assignee}` : "", `Priority: ${task.priority}`].filter(Boolean).join("\n")
      });
    }
  }

  if (ctx.layers.leave) {
    for (const leave of ctx.leaveRecords) {
      if (leave.status === "cancelled" || !mine(leave.employeeId) || !isValidIsoDate(leave.startDate)) continue;
      const end = clampEnd(leave.startDate, leave.endDate);
      if (!overlaps(leave.startDate, end, ctx.from, ctx.to)) continue;
      events.push({
        uid: `leave-${leave.id}@radar`,
        title: `${ctx.employeeName(leave.employeeId)}: ${leave.leaveType ? `${leave.leaveType} leave` : "leave"}`,
        start: leave.startDate,
        end,
        description: `Status: ${leave.status}`
      });
    }
  }

  if (ctx.layers.telework) {
    for (const record of ctx.teleworkRecords) {
      if (!isSituationalRequest(record) || ["denied", "cancelled", "expired"].includes(record.status)) continue;
      if (!record.effectiveDate || !isValidIsoDate(record.effectiveDate) || !mine(record.employeeId)) continue;
      const end = clampEnd(record.effectiveDate, record.expirationDate);
      if (!overlaps(record.effectiveDate, end, ctx.from, ctx.to)) continue;
      events.push({
        uid: `telework-${record.id}@radar`,
        title: `${ctx.employeeName(record.employeeId)}: telework${isPendingRequest(record) ? " (pending)" : ""}`,
        start: record.effectiveDate,
        end
      });
    }
  }

  if (ctx.layers.travel) {
    for (const trip of ctx.travelRecords) {
      if (trip.isArchived || isTripCancelled(trip) || !mine(trip.employeeId) || !isValidIsoDate(trip.startDate)) continue;
      const end = clampEnd(trip.startDate, trip.endDate);
      if (!overlaps(trip.startDate, end, ctx.from, ctx.to)) continue;
      events.push({
        uid: `travel-${trip.id}@radar`,
        title: `${ctx.employeeName(trip.employeeId)}: travel to ${trip.destination}`,
        start: trip.startDate,
        end
      });
    }
  }

  if (ctx.layers.awards) {
    for (const award of ctx.awardRecords) {
      if (AWARD_FINAL_STATUSES.has(award.status) || !mine(award.employeeId)) continue;
      if (!award.nominationDueDate || !isValidIsoDate(award.nominationDueDate)) continue;
      if (!overlaps(award.nominationDueDate, award.nominationDueDate, ctx.from, ctx.to)) continue;
      events.push({
        uid: `award-${award.id}@radar`,
        title: `Award nomination due: ${award.title}`,
        start: award.nominationDueDate,
        end: award.nominationDueDate,
        description: `For ${ctx.employeeName(award.employeeId)}. Status: ${award.status}`
      });
    }
  }

  return events.sort((a, b) => compareDates(a.start, b.start) || a.title.localeCompare(b.title));
}

/** Commas, semicolons, backslashes, and line breaks are escaped in iCalendar text. */
function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

const encoder = new TextEncoder();

/**
 * Lines longer than 75 bytes are folded: the continuation starts with one
 * space. Folding counts bytes and never splits a multi-byte character.
 */
function fold(line: string): string {
  const parts: string[] = [];
  let current = "";
  let bytes = 0;
  for (const char of line) {
    const size = encoder.encode(char).length;
    // Continuation lines spend one byte on their leading space.
    const limit = parts.length === 0 ? 75 : 74;
    if (bytes + size > limit) {
      parts.push(current);
      current = "";
      bytes = 0;
    }
    current += char;
    bytes += size;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

function compactDate(date: IsoDate): string {
  return date.replace(/-/g, "");
}

/** "2026-07-20T15:04:05.123Z" → "20260720T150405Z". */
function compactTimestamp(stamp: IsoTimestamp): string {
  return `${stamp.slice(0, 19).replace(/[-:]/g, "")}Z`;
}

/**
 * The text of an .ics file holding the events. `stamp` is when the file was
 * made (DTSTAMP). All-day events end on the day *after* their last day, as
 * the format requires.
 */
export function toIcs(events: CalendarEvent[], stamp: IsoTimestamp, calendarName = "RADAR"): string {
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//RADAR//Supervisor Calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(calendarName)}`
  ];
  for (const event of events) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${escapeText(event.uid)}`,
      `DTSTAMP:${compactTimestamp(stamp)}`,
      `DTSTART;VALUE=DATE:${compactDate(event.start)}`,
      `DTEND;VALUE=DATE:${compactDate(addDays(clampEnd(event.start, event.end), 1))}`,
      `SUMMARY:${escapeText(event.title)}`
    );
    if (event.description) lines.push(`DESCRIPTION:${escapeText(event.description)}`);
    // An exported event is information, not a meeting: it must not block the day as busy.
    lines.push("TRANSP:TRANSPARENT", "END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}
