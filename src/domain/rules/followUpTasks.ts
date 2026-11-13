// Board cards started from other records (pure). Each builder returns the
// prefill for the new-task editor, so the user confirms and adjusts the card
// before it exists; nothing is created automatically.

import type { AwardRecord, IsoDate, Task, TrainingRequirement, TravelRecord } from "../models";
import { compareDates, formatDate } from "../../utils/dates";
import { isTripCancelled, isVoucherSettled, travelPhase } from "./travel";

export type TaskPrefill = Pick<Task, "title"> & Partial<Pick<Task, "dueDate" | "employeeId" | "projectId" | "tags">>;

/**
 * The card a trip most needs right now. Before departure with paperwork open
 * it is the paperwork, due the day travel starts; from departure on it is the
 * voucher, due on the voucher date. A settled or cancelled trip needs nothing.
 */
export function travelFollowUpTask(trip: TravelRecord, travelerName: string, today: IsoDate): TaskPrefill | undefined {
  if (isTripCancelled(trip)) return undefined;
  const where = `${travelerName} to ${trip.destination}`;
  const phase = travelPhase(trip, today);
  const paperworkOpen = trip.iptConcurrence === "pending" || trip.dtsAuthorizationStatus !== "approved";
  if (phase === "upcoming" && paperworkOpen) {
    return {
      title: `Travel paperwork: ${where}`,
      dueDate: trip.startDate,
      employeeId: trip.employeeId,
      tags: ["travel"]
    };
  }
  if (isVoucherSettled(trip)) return undefined;
  return {
    title: `Travel voucher: ${where}`,
    dueDate: trip.voucherDueDate,
    employeeId: trip.employeeId,
    tags: ["travel"]
  };
}

/** A card to finish a nomination. It is the supervisor's own work, so it has no assignee. */
export function awardFollowUpTask(award: AwardRecord, nomineeName: string): TaskPrefill {
  return {
    title: `Award nomination: ${award.title}${nomineeName ? ` (${nomineeName})` : ""}`,
    dueDate: award.nominationDueDate,
    projectId: award.projectId,
    tags: ["award"]
  };
}

/** A card to chase a training requirement that has people overdue. */
export function trainingFollowUpTask(requirement: TrainingRequirement, overdueCount: number, today: IsoDate): TaskPrefill {
  const due = requirement.dueDate && compareDates(requirement.dueDate, today) >= 0 ? requirement.dueDate : undefined;
  const scope =
    overdueCount > 0
      ? `${overdueCount} overdue`
      : requirement.dueDate
        ? `due ${formatDate(requirement.dueDate)}`
        : "follow up";
  return {
    title: `Training: ${requirement.name} (${scope})`,
    dueDate: due,
    tags: ["training"]
  };
}
