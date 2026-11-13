// How long a card has sat in its board column (pure). The store stamps
// `columnEnteredAt` whenever a task lands in a different column; the board
// shows the age only once it is long enough to be worth noticing.

import type { IsoDate, IsoTimestamp, Task } from "../models";
import { daysSinceTimestamp } from "../../utils/dates";

/**
 * The record to save, with `columnEnteredAt` stamped when the task is new or
 * changes column. A caller that set the field itself (an Undo restoring the
 * earlier record) is left alone, so undoing a move restores the old age too.
 */
export function withColumnEntry(
  previous: Pick<Task, "columnEnteredAt"> | undefined,
  previousColumnId: string | undefined,
  next: Task,
  nextColumnId: string,
  now: IsoTimestamp
): Task {
  if (!previous) return next.columnEnteredAt ? next : { ...next, columnEnteredAt: now };
  if (previousColumnId === nextColumnId) return next;
  if (next.columnEnteredAt !== previous.columnEnteredAt) return next;
  return { ...next, columnEnteredAt: now };
}

/**
 * Whole days the card has been in its column, when that has reached
 * `staleDays`; otherwise undefined. Cards saved before the time was recorded
 * have no age: the board never guesses one from other timestamps.
 */
export function staleColumnDays(
  task: Pick<Task, "columnEnteredAt">,
  today: IsoDate,
  staleDays: number
): number | undefined {
  if (!task.columnEnteredAt || staleDays <= 0) return undefined;
  const days = daysSinceTimestamp(task.columnEnteredAt, today);
  return days >= staleDays ? days : undefined;
}
