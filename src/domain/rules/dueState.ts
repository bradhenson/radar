// Computed due state for a task (plan section 14.5). Never stored.

import type { IsoDate, Task } from "../models";
import { compareDates, daysBetween } from "../../utils/dates";

export type DueState = "none" | "future" | "due_soon" | "due_today" | "overdue" | "complete";

export function dueState(task: Pick<Task, "dueDate" | "status">, today: IsoDate, dueSoonDays: number): DueState {
  if (task.status === "complete" || task.status === "cancelled") return "complete";
  if (!task.dueDate) return "none";
  const cmp = compareDates(task.dueDate, today);
  if (cmp < 0) return "overdue";
  if (cmp === 0) return "due_today";
  if (daysBetween(today, task.dueDate) <= dueSoonDays) return "due_soon";
  return "future";
}

export const DUE_STATE_LABELS: Record<DueState, string> = {
  none: "",
  future: "",
  due_soon: "Due soon",
  due_today: "Due today",
  overdue: "Overdue",
  complete: ""
};
