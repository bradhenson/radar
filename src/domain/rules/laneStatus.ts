// Lane ↔ status synchronization (board/status ambiguity fix).
// Pure rules: given a lane's status mapping and a task, decide what status
// fields change on a lane move, and which lane a status change lands in.

import type { BoardColumnDefinition, IsoDate, IsoTimestamp, Task, TaskStatus } from "../models";

/**
 * Task field changes implied by moving a card into `column`. Undefined when
 * the move should not touch status: unmapped custom lanes, no-op moves, and
 * cancelled tasks (cancellation is an explicit decision the board never
 * overrides).
 */
export function statusChangeForLaneMove(
  task: Pick<Task, "status" | "completedDate" | "waitingSince">,
  column: Pick<BoardColumnDefinition, "mapsToStatus"> | undefined,
  today: IsoDate,
  now: IsoTimestamp
): Partial<Task> | undefined {
  const target = column?.mapsToStatus;
  if (!target || target === task.status) return undefined;
  if (task.status === "cancelled") return undefined;
  switch (target) {
    case "complete":
      return { status: "complete", completedDate: today };
    case "waiting":
      return { status: "waiting", waitingSince: now };
    case "open":
      // Reopening: the completion date and waiting clock no longer apply.
      return { status: "open", completedDate: undefined, waitingSince: undefined };
    default:
      return undefined;
  }
}

/** First lane (by sort order) mapped to `status`, if any. */
export function laneForStatus(
  columns: Pick<BoardColumnDefinition, "id" | "mapsToStatus" | "sortOrder">[],
  status: TaskStatus
): Pick<BoardColumnDefinition, "id" | "mapsToStatus" | "sortOrder"> | undefined {
  return [...columns].sort((a, b) => a.sortOrder - b.sortOrder).find((c) => c.mapsToStatus === status);
}
