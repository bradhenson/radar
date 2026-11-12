// Recurring task rules (plan section 23). Pure: a schedule in, dates out.
//
// A schedule is a first due date plus "every N days / weeks / months". Every
// occurrence is computed from the first date, never from the previous one, so
// a monthly schedule anchored on the 31st gives Jan 31, Feb 28, Mar 31 rather
// than drifting to the 28th for good. All dates are date-only strings.

import type { IsoDate, RecurrenceUnit, RecurringTask } from "../models";
import { addDays, addMonths, compareDates, daysBetween, formatDate, isValidIsoDate, isWeekend, startOfWeek } from "../../utils/dates";

/** The fields the schedule arithmetic reads. */
export type RecurrenceSchedule = Pick<RecurringTask, "unit" | "interval" | "firstDueDate" | "weekdaysOnly">;

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** A loop guard far above any real schedule (daily for ~27 years). */
const MAX_STEPS = 10_000;

function stepOf(schedule: RecurrenceSchedule): number {
  return Number.isInteger(schedule.interval) && schedule.interval > 0 ? schedule.interval : 1;
}

/** The occurrence at position `index` (0 = the first due date), before any weekday filtering. */
function occurrenceAt(schedule: RecurrenceSchedule, index: number): IsoDate {
  const step = stepOf(schedule) * index;
  if (schedule.unit === "months") return addMonths(schedule.firstDueDate, step);
  return addDays(schedule.firstDueDate, schedule.unit === "weeks" ? step * 7 : step);
}

/** A position at or before the first occurrence later than `after`, to skip most of a long history. */
function startIndex(schedule: RecurrenceSchedule, after: IsoDate | undefined): number {
  if (!after || compareDates(after, schedule.firstDueDate) < 0) return 0;
  const days = daysBetween(schedule.firstDueDate, after);
  const step = stepOf(schedule);
  // Months are counted as 31 days so the estimate can only fall short, never overshoot.
  const perStep = schedule.unit === "months" ? step * 31 : schedule.unit === "weeks" ? step * 7 : step;
  return Math.max(0, Math.floor(days / perStep) - 1);
}

/** A daily schedule marked weekdays-only has no Saturday or Sunday occurrences. */
function isSkipped(schedule: RecurrenceSchedule, date: IsoDate): boolean {
  return schedule.unit === "days" && Boolean(schedule.weekdaysOnly) && isWeekend(date);
}

/**
 * Every occurrence later than `after` (exclusive; omit for "from the start")
 * and no later than `through` (inclusive), in date order.
 */
export function occurrencesBetween(schedule: RecurrenceSchedule, after: IsoDate | undefined, through: IsoDate): IsoDate[] {
  if (!isValidIsoDate(schedule.firstDueDate)) return [];
  const out: IsoDate[] = [];
  for (let index = startIndex(schedule, after), steps = 0; steps < MAX_STEPS; index += 1, steps += 1) {
    const date = occurrenceAt(schedule, index);
    if (compareDates(date, through) > 0) break;
    if (after && compareDates(date, after) <= 0) continue;
    if (!isSkipped(schedule, date)) out.push(date);
  }
  return out;
}

/** The first occurrence strictly later than `after`. */
export function nextOccurrenceAfter(schedule: RecurrenceSchedule, after: IsoDate): IsoDate | undefined {
  if (!isValidIsoDate(schedule.firstDueDate)) return undefined;
  for (let index = startIndex(schedule, after), steps = 0; steps < MAX_STEPS; index += 1, steps += 1) {
    const date = occurrenceAt(schedule, index);
    if (compareDates(date, after) > 0 && !isSkipped(schedule, date)) return date;
  }
  return undefined;
}

/**
 * The due dates that should have a card created now.
 *
 * A card is created `advanceCreateDays` before it is due. Occurrences already
 * generated are never revisited (`lastGeneratedDueDate`), so a card the user
 * deleted does not come back. Coming back after time away does not bury the
 * board in a card for every missed week: of the occurrences that are already
 * past due, only the most recent one is created.
 */
export function dueOccurrences(
  task: RecurrenceSchedule & Pick<RecurringTask, "active" | "advanceCreateDays" | "lastGeneratedDueDate">,
  today: IsoDate
): IsoDate[] {
  if (!task.active) return [];
  const advance = Number.isFinite(task.advanceCreateDays) && task.advanceCreateDays > 0 ? Math.floor(task.advanceCreateDays) : 0;
  const pending = occurrencesBetween(task, task.lastGeneratedDueDate, addDays(today, advance));
  const missed = pending.filter((date) => compareDates(date, today) < 0);
  const current = pending.filter((date) => compareDates(date, today) >= 0);
  return missed.length > 0 ? [missed[missed.length - 1]!, ...current] : current;
}

/**
 * The high-water mark for a schedule that starts or resumes today: nothing
 * due before today is created, so a new schedule with a first due date in
 * the past, or one resumed after a long pause, does not open with an overdue
 * card. An existing later mark is kept.
 */
export function resumeFrom(lastGeneratedDueDate: IsoDate | undefined, today: IsoDate): IsoDate {
  const yesterday = addDays(today, -1);
  return lastGeneratedDueDate && compareDates(lastGeneratedDueDate, yesterday) > 0 ? lastGeneratedDueDate : yesterday;
}

/** Identifies one generated card, so the same occurrence is never created twice (plan 23.4). */
export function recurrenceInstanceKey(recurringTaskId: string, dueDate: IsoDate): string {
  return `${recurringTaskId}:${dueDate}`;
}

export interface RecurrencePlanItem<T> {
  recurringTask: T;
  /** Due dates to create cards for, oldest first. Already-existing instances are excluded. */
  dueDates: IsoDate[];
  /** The value to store as the new `lastGeneratedDueDate`. */
  generatedThrough: IsoDate;
}

/**
 * What generation should do right now: for each active recurring task with
 * something due, the cards to create and the high-water mark to record.
 * `existingKeys` holds the instance keys of every task already in the
 * database (archived ones included), which guards against a second writer.
 */
export function planRecurringTasks<T extends RecurringTask>(
  recurringTasks: T[],
  existingKeys: ReadonlySet<string>,
  today: IsoDate
): RecurrencePlanItem<T>[] {
  const plan: RecurrencePlanItem<T>[] = [];
  for (const recurringTask of recurringTasks) {
    const due = dueOccurrences(recurringTask, today);
    if (due.length === 0) continue;
    plan.push({
      recurringTask,
      dueDates: due.filter((date) => !existingKeys.has(recurrenceInstanceKey(recurringTask.id, date))),
      generatedThrough: due[due.length - 1]!
    });
  }
  return plan;
}

function ordinal(day: number): string {
  const tens = day % 100;
  if (tens >= 11 && tens <= 13) return `${day}th`;
  return `${day}${["th", "st", "nd", "rd"][day % 10] ?? "th"}`;
}

function weekdayName(date: IsoDate): string {
  return WEEKDAY_NAMES[daysBetween(startOfWeek(date), date)] ?? "";
}

/** The schedule in words: "Every weekday", "Every 2 weeks on Sunday", "Monthly on the 15th". */
export function recurrenceSummary(schedule: RecurrenceSchedule): string {
  if (!isValidIsoDate(schedule.firstDueDate)) return "No schedule";
  const step = stepOf(schedule);
  if (schedule.unit === "days") {
    if (step === 1) return schedule.weekdaysOnly ? "Every weekday" : "Daily";
    return `Every ${step} days${schedule.weekdaysOnly ? ", weekdays only" : ""}`;
  }
  if (schedule.unit === "weeks") {
    const day = weekdayName(schedule.firstDueDate);
    return step === 1 ? `Weekly on ${day}` : `Every ${step} weeks on ${day}`;
  }
  const dayOfMonth = ordinal(Number(schedule.firstDueDate.slice(8, 10)));
  if (step === 1) return `Monthly on the ${dayOfMonth}`;
  if (step === 12) return `Yearly on ${formatDate(schedule.firstDueDate).replace(/,?\s*\d{4}$/, "")}`;
  if (step === 3) return `Quarterly on the ${dayOfMonth}`;
  return `Every ${step} months on the ${dayOfMonth}`;
}

/** Named schedules offered in the form; anything else is "custom". */
export const RECURRENCE_PRESETS = [
  { key: "weekdays", label: "Every weekday", unit: "days", interval: 1, weekdaysOnly: true, advanceCreateDays: 0 },
  { key: "weekly", label: "Weekly", unit: "weeks", interval: 1, weekdaysOnly: false, advanceCreateDays: 4 },
  { key: "pay_period", label: "Every pay period (2 weeks)", unit: "weeks", interval: 2, weekdaysOnly: false, advanceCreateDays: 7 },
  { key: "monthly", label: "Monthly", unit: "months", interval: 1, weekdaysOnly: false, advanceCreateDays: 7 },
  { key: "quarterly", label: "Quarterly", unit: "months", interval: 3, weekdaysOnly: false, advanceCreateDays: 14 },
  { key: "yearly", label: "Yearly", unit: "months", interval: 12, weekdaysOnly: false, advanceCreateDays: 30 }
] as const satisfies readonly {
  key: string;
  label: string;
  unit: RecurrenceUnit;
  interval: number;
  weekdaysOnly: boolean;
  advanceCreateDays: number;
}[];

export type RecurrencePresetKey = (typeof RECURRENCE_PRESETS)[number]["key"] | "custom";

/** Which named schedule a rule matches, for preselecting the form's Repeats menu. */
export function recurrencePresetKey(schedule: RecurrenceSchedule): RecurrencePresetKey {
  const match = RECURRENCE_PRESETS.find(
    (p) => p.unit === schedule.unit && p.interval === stepOf(schedule) && p.weekdaysOnly === Boolean(schedule.weekdaysOnly)
  );
  return match?.key ?? "custom";
}

/** Why a recurring task cannot be saved, or undefined when it is valid. */
export function recurringTaskError(
  input: Pick<RecurringTask, "title" | "unit" | "interval" | "firstDueDate" | "advanceCreateDays" | "weekdaysOnly">
): string | undefined {
  if (!input.title.trim()) return "Title is required.";
  if (!isValidIsoDate(input.firstDueDate)) return "First due date is required and must be valid.";
  if (!Number.isInteger(input.interval) || input.interval < 1 || input.interval > 365) {
    return "Repeat interval must be a whole number from 1 to 365.";
  }
  if (!Number.isInteger(input.advanceCreateDays) || input.advanceCreateDays < 0 || input.advanceCreateDays > 365) {
    return "Days before due must be a whole number from 0 to 365.";
  }
  if (input.unit === "days" && input.weekdaysOnly && isWeekend(input.firstDueDate)) {
    return "A weekdays-only schedule cannot start on a weekend.";
  }
  return undefined;
}
