// Training status derivation (plan 18, revised): due dates live on the
// requirement, assignment is declarative (all active employees or a selected
// list), and per-employee records only store facts — completions, waivers,
// overrides. Every view derives the same status through trainingStatus so the
// page, attention engine, and reports can never disagree.

import type { Employee, EmployeeTrainingRecord, IsoDate, TrainingRequirement } from "../models";
import { addDays, addMonths, compareDates, daysBetween } from "../../utils/dates";

export type TrainingState =
  | "complete"
  | "expiring"
  | "expired"
  | "due_soon"
  | "overdue"
  | "not_completed"
  | "waived"
  | "not_applicable";

export interface TrainingStatus {
  state: TrainingState;
  /** Effective due or expiration date for this employee, when one exists. */
  dueDate?: IsoDate;
  completedDate?: IsoDate;
  /** True when the supervisor should act now (overdue, expired, or inside the warning window). */
  needsAction: boolean;
}

export const TRAINING_STATE_LABELS: Record<TrainingState, string> = {
  complete: "Complete",
  expiring: "Expiring",
  expired: "Expired",
  due_soon: "Due soon",
  overdue: "Overdue",
  not_completed: "Not completed",
  waived: "Waived",
  not_applicable: "N/A"
};

/** Sort weight for rosters: items needing action first, completed work last. */
export const TRAINING_STATE_ORDER: Record<TrainingState, number> = {
  overdue: 0,
  expired: 1,
  due_soon: 2,
  expiring: 3,
  not_completed: 4,
  complete: 5,
  waived: 6,
  not_applicable: 7
};

export function requirementAppliesTo(req: TrainingRequirement, employee: Employee): boolean {
  if (employee.isArchived || employee.activeStatus !== "active") return false;
  if ((req.assignmentScope ?? "all") === "all") return true;
  return (req.assignedEmployeeIds ?? []).includes(employee.id);
}

function isRolling(req: TrainingRequirement): boolean {
  return req.recurrenceType === "months" || req.recurrenceType === "days";
}

export function rollingExpiration(req: TrainingRequirement, completedDate: IsoDate): IsoDate | undefined {
  if (!isRolling(req)) return undefined;
  const interval = req.recurrenceInterval ?? 12;
  return req.recurrenceType === "days" ? addDays(completedDate, interval) : addMonths(completedDate, interval);
}

/**
 * Earliest completion date that still counts for the current cycle. An annual
 * requirement with a fixed due date resets automatically when the supervisor
 * bumps the date to the next cycle: completions older than 12 months before
 * the due date stop counting, with no per-record edits.
 */
function cycleStart(req: TrainingRequirement): IsoDate | undefined {
  if (req.recurrenceType === "annual" && req.dueDate) return addMonths(req.dueDate, -12);
  return undefined;
}

export function trainingStatus(
  req: TrainingRequirement,
  record: EmployeeTrainingRecord | undefined,
  today: IsoDate,
  warningDays: number
): TrainingStatus {
  if (record?.status === "waived") return { state: "waived", needsAction: false };
  if (record?.status === "not_applicable") return { state: "not_applicable", needsAction: false };

  const completed = record?.completedDate;
  const start = cycleStart(req);
  const completionCounts = Boolean(completed && (!start || compareDates(completed, start) >= 0));

  if (completionCounts && completed) {
    // Stored expirationDate (legacy or rolling) takes precedence; otherwise
    // rolling requirements derive expiration from the completion date.
    const expires = record?.expirationDate ?? rollingExpiration(req, completed);
    if (expires) {
      if (compareDates(expires, today) < 0) return { state: "expired", dueDate: expires, completedDate: completed, needsAction: true };
      if (daysBetween(today, expires) <= warningDays)
        return { state: "expiring", dueDate: expires, completedDate: completed, needsAction: true };
      return { state: "complete", dueDate: expires, completedDate: completed, needsAction: false };
    }
    return { state: "complete", completedDate: completed, needsAction: false };
  }

  // Not completed for the current cycle. Record dueDate is a per-employee
  // override; fixed-date requirements fall back to the shared date.
  const due = record?.dueDate ?? (isRolling(req) ? undefined : req.dueDate);
  if (due) {
    if (compareDates(due, today) < 0) return { state: "overdue", dueDate: due, completedDate: completed, needsAction: true };
    if (daysBetween(today, due) <= warningDays) return { state: "due_soon", dueDate: due, completedDate: completed, needsAction: true };
  }
  return { state: "not_completed", dueDate: due, completedDate: completed, needsAction: false };
}
