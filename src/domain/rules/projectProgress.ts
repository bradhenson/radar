// How far along a project's tasks are (pure). Done counts completed tasks
// even after Done has archived them; cancelled tasks and tasks archived
// without being completed are not part of the work.

import type { IsoDate, Task } from "../models";
import { compareDates } from "../../utils/dates";

export interface ProjectProgress {
  total: number;
  done: number;
  open: number;
  overdue: number;
  /** Earliest due date among open tasks that is today or later. */
  nextDue?: IsoDate;
}

export function projectProgress(
  tasks: Pick<Task, "projectId" | "status" | "isArchived" | "dueDate">[],
  projectId: string,
  today: IsoDate
): ProjectProgress {
  let total = 0;
  let done = 0;
  let open = 0;
  let overdue = 0;
  let nextDue: IsoDate | undefined;
  for (const t of tasks) {
    if (t.projectId !== projectId || t.status === "cancelled") continue;
    if (t.status === "complete") {
      total++;
      done++;
      continue;
    }
    if (t.isArchived) continue;
    total++;
    open++;
    if (!t.dueDate) continue;
    if (compareDates(t.dueDate, today) < 0) overdue++;
    else if (!nextDue || compareDates(t.dueDate, nextDue) < 0) nextDue = t.dueDate;
  }
  return { total, done, open, overdue, nextDue };
}
