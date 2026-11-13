import type { IsoDate, Task } from "../models";
import { dueState } from "./dueState";

export type BoardSummaryFilter = "" | "due_soon" | "overdue" | "waiting" | "priority";

/** The board's quick split of the supervisor's own work: project work or competency work. */
export type WorkTypeFilter = "" | "project" | "competency";
export const WORK_TYPE_FILTERS: readonly WorkTypeFilter[] = ["", "project", "competency"];

/**
 * Project work is any task linked to a project; competency work is everything
 * else (a task's competency is optional, so "no project" is the dividing line).
 */
export function matchesWorkType(task: Pick<Task, "projectId">, filter: WorkTypeFilter): boolean {
  if (filter === "project") return Boolean(task.projectId);
  if (filter === "competency") return !task.projectId;
  return true;
}

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
