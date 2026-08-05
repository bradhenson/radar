// Lane → active-status synchronization (board/status ambiguity fix).
// Completion is an explicit Done action that archives the task; moving a card
// between lanes never finishes work.

import type { BoardColumnDefinition, IsoTimestamp, Task } from "../models";

/**
 * Task field changes implied by moving a card into `column`. Undefined when
 * the move should not touch status: unmapped custom lanes, retired Complete
 * mappings from older databases, no-op moves, and cancelled tasks.
 */
export function statusChangeForLaneMove(
  task: Pick<Task, "status" | "completedDate" | "waitingSince">,
  column: Pick<BoardColumnDefinition, "mapsToStatus"> | undefined,
  now: IsoTimestamp
): Partial<Task> | undefined {
  const target = column?.mapsToStatus;
  if (!target || target === task.status) return undefined;
  if (task.status === "cancelled") return undefined;
  switch (target) {
    case "waiting":
      return { status: "waiting", waitingSince: now };
    case "open":
      // Reopening: the completion date and waiting clock no longer apply.
      return { status: "open", completedDate: undefined, waitingSince: undefined };
    default:
      return undefined;
  }
}
