import type { IsoDate, Task } from "../models";
import { dueState } from "./dueState";

export type BoardSummaryFilter = "" | "due_soon" | "overdue" | "waiting" | "priority";

/**
 * Project filter values besides a project id: "Any project" keeps every task
 * linked to a project, "No project" the rest (competency work, since a task's
 * competency is optional and the project is the dividing line).
 */
export const ANY_PROJECT = "__any";
export const NO_PROJECT = "__none";

export function matchesProjectFilter(task: Pick<Task, "projectId">, filter: string): boolean {
  if (!filter) return true;
  if (filter === ANY_PROJECT) return Boolean(task.projectId);
  if (filter === NO_PROJECT) return !task.projectId;
  return task.projectId === filter;
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
