// Leave list grouping and daily head-count (pure), mirroring Travel's phases:
// the answer to "who needs a decision, who is out, who is about to be" first.

import type { IsoDate, LeaveRecord } from "../models";
import { compareDates } from "../../utils/dates";

export type LeavePhase = "requested" | "out_now" | "upcoming" | "past" | "cancelled";

export const LEAVE_PHASE_ORDER: readonly LeavePhase[] = ["requested", "out_now", "upcoming", "past", "cancelled"];

export const LEAVE_PHASE_LABELS: Record<LeavePhase, string> = {
  requested: "Awaiting approval",
  out_now: "Out now",
  upcoming: "Upcoming",
  past: "Past",
  cancelled: "Cancelled"
};

/** The last day covered; an end before the start is read as a one-day absence. */
export function leaveEndDate(l: Pick<LeaveRecord, "startDate" | "endDate">): IsoDate {
  return compareDates(l.endDate, l.startDate) < 0 ? l.startDate : l.endDate;
}

/**
 * A request waiting on a decision is grouped by that, whatever its dates;
 * cancelled leave sits apart; everything else goes by the calendar.
 */
export function leavePhase(l: Pick<LeaveRecord, "status" | "startDate" | "endDate">, today: IsoDate): LeavePhase {
  if (l.status === "requested") return "requested";
  if (l.status === "cancelled") return "cancelled";
  if (compareDates(leaveEndDate(l), today) < 0) return "past";
  if (compareDates(l.startDate, today) <= 0) return "out_now";
  return "upcoming";
}

export interface LeaveGroup<T> {
  phase: LeavePhase;
  records: T[];
}

/**
 * Records grouped by phase in LEAVE_PHASE_ORDER, empty groups dropped. Within a
 * group: soonest first for what is ahead, back-in-soonest for who is out now,
 * most recent first for what is behind.
 */
export function groupLeave<T extends Pick<LeaveRecord, "status" | "startDate" | "endDate">>(records: T[], today: IsoDate): LeaveGroup<T>[] {
  const buckets = new Map<LeavePhase, T[]>();
  for (const r of records) {
    const phase = leavePhase(r, today);
    buckets.set(phase, [...(buckets.get(phase) ?? []), r]);
  }
  const order: Record<LeavePhase, (a: T, b: T) => number> = {
    requested: (a, b) => compareDates(a.startDate, b.startDate),
    out_now: (a, b) => compareDates(leaveEndDate(a), leaveEndDate(b)) || compareDates(a.startDate, b.startDate),
    upcoming: (a, b) => compareDates(a.startDate, b.startDate),
    past: (a, b) => compareDates(b.startDate, a.startDate),
    cancelled: (a, b) => compareDates(b.startDate, a.startDate)
  };
  return LEAVE_PHASE_ORDER.filter((phase) => buckets.has(phase)).map((phase) => ({
    phase,
    records: [...buckets.get(phase)!].sort(order[phase])
  }));
}

/** How many different people are out on a day (cancelled leave does not count). */
export function peopleOutOn(records: Pick<LeaveRecord, "employeeId" | "status" | "startDate" | "endDate">[], date: IsoDate): number {
  const people = new Set<string>();
  for (const r of records) {
    if (r.status === "cancelled") continue;
    if (compareDates(r.startDate, date) <= 0 && compareDates(date, leaveEndDate(r)) <= 0) people.add(r.employeeId);
  }
  return people.size;
}
