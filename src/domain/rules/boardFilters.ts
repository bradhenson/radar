import type { IsoDate, Task } from "../models";
import { dueState } from "./dueState";

export type BoardSummaryFilter = "" | "due_soon" | "overdue" | "waiting" | "priority";

/**
 * Match the quick-filter summaries shown above the board. These filters are
 * intentionally single-choice, but continue to compose with the board's
 * search, employee, competency, project, priority, and active-only filters.
 */
export function matchesBoardSummaryFilter(
  task: Pick<Task, "dueDate" | "status" | "priority">,
  filter: BoardSummaryFilter,
  today: IsoDate,
  dueSoonDays: number
): boolean {
  if (!filter) return true;
  if (filter === "waiting") return task.status === "waiting";
  if (filter === "priority") return task.priority === "high" || task.priority === "critical";

  const state = dueState(task, today, dueSoonDays);
  if (filter === "overdue") return state === "overdue";
  return state === "due_today" || state === "due_soon";
}
