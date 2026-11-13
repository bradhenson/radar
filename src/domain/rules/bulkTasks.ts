// Bulk task changes (pure). One change applied to many tasks at once from the
// Task List. Each rule mirrors what the single-task action does, so a bulk
// move follows the same lane/status rules as dragging one card and a bulk
// Done matches the Done button.

import type { BoardColumnDefinition, IsoDate, IsoTimestamp, Task, TaskPriority } from "../models";
import { statusChangeForLaneMove } from "./laneStatus";

export type BulkTaskChange =
  | { kind: "column"; columnId: string }
  | { kind: "assign"; employeeId: string | undefined }
  | { kind: "priority"; priority: TaskPriority }
  | { kind: "due"; dueDate: IsoDate | undefined }
  | { kind: "done" };

export interface BulkTaskContext {
  today: IsoDate;
  now: IsoTimestamp;
  columns: BoardColumnDefinition[];
  /** The lane a task currently sits in (legacy tasks derive it). */
  columnIdOf: (task: Task) => string;
  /** Board order that places a card at the end of a lane, given the orders already there. */
  orderForAppend: (existingOrders: number[]) => number;
  /** Board orders currently in each lane, excluding archived tasks. */
  ordersByColumn: Map<string, number[]>;
}

/**
 * The task after the change, or undefined when the change does nothing to it
 * (already in that column, already that priority, and so on), so untouched
 * tasks are not rewritten or logged. Moving several cards into a lane appends
 * them in the order given; `ctx.ordersByColumn` is updated as cards land.
 */
export function applyBulkTaskChange(task: Task, change: BulkTaskChange, ctx: BulkTaskContext): Task | undefined {
  switch (change.kind) {
    case "column": {
      const from = ctx.columnIdOf(task);
      if (from === change.columnId) return undefined;
      const column = ctx.columns.find((c) => c.id === change.columnId);
      if (!column) return undefined;
      const orders = ctx.ordersByColumn.get(change.columnId) ?? [];
      const boardOrder = ctx.orderForAppend(orders);
      ctx.ordersByColumn.set(change.columnId, [...orders, boardOrder]);
      return {
        ...task,
        ...statusChangeForLaneMove(task, column, ctx.now),
        boardColumnId: change.columnId,
        boardOrder,
        updatedAt: ctx.now
      };
    }
    case "assign":
      if ((task.employeeId ?? "") === (change.employeeId ?? "")) return undefined;
      return { ...task, employeeId: change.employeeId, updatedAt: ctx.now };
    case "priority":
      if (task.priority === change.priority) return undefined;
      return { ...task, priority: change.priority, updatedAt: ctx.now };
    case "due":
      if ((task.dueDate ?? "") === (change.dueDate ?? "")) return undefined;
      return { ...task, dueDate: change.dueDate, updatedAt: ctx.now };
    case "done":
      if (task.isArchived && task.status === "complete") return undefined;
      return {
        ...task,
        status: "complete",
        completedDate: ctx.today,
        waitingSince: undefined,
        isArchived: true,
        updatedAt: ctx.now
      };
  }
}

/** What the change is called in the activity log and the toast: "moved to Waiting", "assigned to Avery Brooks". */
export function bulkChangePhrase(
  change: BulkTaskChange,
  names: { column: (id: string) => string; employee: (id: string | undefined) => string; priority: (p: TaskPriority) => string; date: (d: IsoDate) => string }
): string {
  switch (change.kind) {
    case "column":
      return `moved to ${names.column(change.columnId)}`;
    case "assign":
      return change.employeeId ? `assigned to ${names.employee(change.employeeId)}` : "unassigned";
    case "priority":
      return `set to ${names.priority(change.priority)} priority`;
    case "due":
      return change.dueDate ? `due date set to ${names.date(change.dueDate)}` : "due date cleared";
    case "done":
      return "marked done and archived";
  }
}

/** The activity action type the single-task version of this change records. */
export function bulkChangeAction(change: BulkTaskChange, before: Task, after: Task): string {
  if (change.kind === "done") return "completed";
  return before.status !== after.status ? "status_changed" : "updated";
}
