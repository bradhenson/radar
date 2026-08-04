// Sorting for the task list view (the board's alternative layout).
//
// The board orders tasks by hand; the list orders them by a column the user
// picks. Keeping the comparator here — pure, over pre-resolved rows — means the
// page never has to reach into the store mid-sort, and the rules that are easy
// to get wrong (blanks, priority rank, direction) are unit-tested.

import type { Task, TaskPriority, TaskStatus } from "../models";

export type TaskListSortKey = "title" | "employee" | "project" | "column" | "due" | "priority" | "status";
export type SortDirection = "asc" | "desc";

/**
 * A task with the display values the list shows resolved. Names arrive resolved
 * because sorting by employee must order by the name on screen, not by the id.
 */
export interface TaskListRow {
  task: Task;
  employeeName: string;
  projectName: string;
  columnLabel: string;
  /** Position of the task's board column, so "Column" sorts in board order. */
  columnIndex: number;
}

/** Highest first when descending; the label order is lowest-to-highest. */
const PRIORITY_RANK: Record<TaskPriority, number> = { low: 0, normal: 1, high: 2, critical: 3 };

/** Open work sorts ahead of finished work, matching how the board reads. */
const STATUS_RANK: Record<TaskStatus, number> = { open: 0, waiting: 1, complete: 2, cancelled: 3 };

/**
 * Compare two values of the same kind, reporting blanks separately so the
 * caller can keep them at the bottom in both directions.
 */
function compareText(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: "base" });
}

/** The value a key sorts on, plus whether this row has no value for it. */
function sortValue(row: TaskListRow, key: TaskListSortKey): { blank: boolean; text?: string; num?: number } {
  switch (key) {
    case "title":
      return { blank: false, text: row.task.title };
    case "employee":
      return { blank: !row.employeeName, text: row.employeeName };
    case "project":
      return { blank: !row.projectName, text: row.projectName };
    case "column":
      return { blank: false, num: row.columnIndex };
    case "due":
      // Date-only strings compare correctly as text (working rule 8): no
      // timestamp conversion, so no timezone can shift a calendar date.
      return { blank: !row.task.dueDate, text: row.task.dueDate ?? "" };
    case "priority":
      return { blank: false, num: PRIORITY_RANK[row.task.priority] ?? 0 };
    case "status":
      return { blank: false, num: STATUS_RANK[row.task.status] ?? 99 };
  }
}

/**
 * Sort a copy of `rows`. Rows with no value for the active key (no due date, no
 * assignee, no project) always sit at the bottom, in either direction: reversing
 * the sort is meant to flip the answers, not to bring the blanks to the top.
 * Ties break by board column then hand-ordering, so equal rows keep the order
 * the board would have shown them in.
 */
export function sortTaskListRows(
  rows: readonly TaskListRow[],
  key: TaskListSortKey,
  direction: SortDirection
): TaskListRow[] {
  const sign = direction === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const left = sortValue(a, key);
    const right = sortValue(b, key);

    if (left.blank !== right.blank) return left.blank ? 1 : -1;
    if (!left.blank) {
      if (left.num !== undefined && right.num !== undefined && left.num !== right.num) {
        return (left.num - right.num) * sign;
      }
      if (left.text !== undefined && right.text !== undefined) {
        const byText = compareText(left.text, right.text);
        if (byText !== 0) return byText * sign;
      }
    }

    if (a.columnIndex !== b.columnIndex) return a.columnIndex - b.columnIndex;
    if (a.task.boardOrder !== b.task.boardOrder) return a.task.boardOrder - b.task.boardOrder;
    return compareText(a.task.title, b.task.title);
  });
}
