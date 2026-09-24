// Travel rules (pure). No DOM or store imports.
import type { IsoDate, TravelRecord, TravelTripStatus, TravelVoucherStatus } from "../models";
import { addDays, compareDates } from "../../utils/dates";

/** A DTS travel voucher is due five days after the traveler returns. */
export const VOUCHER_DUE_DAYS_AFTER_RETURN = 5;

/** How far ahead a voucher due date counts as "due soon" on the travel list. */
export const VOUCHER_DUE_SOON_DAYS = 5;

/** Default DTS voucher due date: five days after the travel end (return) date. */
export function travelVoucherDueDate(endDate: IsoDate): IsoDate {
  return addDays(endDate, VOUCHER_DUE_DAYS_AFTER_RETURN);
}

/**
 * Where a trip sits in its lifecycle. Cancellation wins over the dates: a
 * cancelled trip never counts as travel, no matter when it was scheduled.
 * A returned trip stays in `voucher_due` until its voucher is settled, which
 * is what keeps "who owes me a voucher" answerable from the list.
 */
export type TravelPhase = "upcoming" | "on_travel" | "voucher_due" | "complete" | "cancelled";

export const TRAVEL_PHASE_LABELS: Record<TravelPhase, string> = {
  voucher_due: "Voucher due",
  on_travel: "On travel now",
  upcoming: "Upcoming travel",
  complete: "Completed",
  cancelled: "Cancelled"
};

/** Fields the lifecycle rules read. Keeps the rules usable from tests and CSV. */
type TripLifecycleFields = Pick<
  TravelRecord,
  "startDate" | "endDate" | "tripStatus" | "voucherStatus" | "voucherDueDate"
>;

/** Records written before cancellation existed are scheduled trips. */
export function tripStatusOf(trip: Pick<TravelRecord, "tripStatus">): TravelTripStatus {
  return trip.tripStatus === "cancelled" ? "cancelled" : "scheduled";
}

export function isTripCancelled(trip: Pick<TravelRecord, "tripStatus">): boolean {
  return tripStatusOf(trip) === "cancelled";
}

/** Records written before voucher tracking existed still owe a voucher. */
export function voucherStatusOf(trip: Pick<TravelRecord, "voucherStatus">): TravelVoucherStatus {
  return trip.voucherStatus === "submitted" || trip.voucherStatus === "not_required"
    ? trip.voucherStatus
    : "not_submitted";
}

/** True once the voucher is submitted or was never required — nothing owed. */
export function isVoucherSettled(trip: Pick<TravelRecord, "voucherStatus">): boolean {
  return voucherStatusOf(trip) !== "not_submitted";
}

/** End date, clamped so a mis-entered end before the start behaves as a one-day trip. */
export function tripEndDate(trip: Pick<TravelRecord, "startDate" | "endDate">): IsoDate {
  return compareDates(trip.endDate, trip.startDate) < 0 ? trip.startDate : trip.endDate;
}

export function travelPhase(trip: TripLifecycleFields, today: IsoDate): TravelPhase {
  if (isTripCancelled(trip)) return "cancelled";
  if (compareDates(today, trip.startDate) < 0) return "upcoming";
  if (compareDates(today, tripEndDate(trip)) <= 0) return "on_travel";
  return isVoucherSettled(trip) ? "complete" : "voucher_due";
}

/**
 * True when the trip no longer needs the supervisor's attention, so the list
 * hides it unless "Show past travel" is on. A returned trip with an unsettled
 * voucher is deliberately *not* past.
 */
export function isPastTravel(trip: TripLifecycleFields, today: IsoDate): boolean {
  const phase = travelPhase(trip, today);
  return phase === "complete" || phase === "cancelled";
}

/** True when the traveler still owes a voucher for a trip they returned from. */
export function isVoucherOwed(trip: TripLifecycleFields, today: IsoDate): boolean {
  return travelPhase(trip, today) === "voucher_due";
}

/** Badge state for the voucher column; empty once the voucher is settled. */
export function voucherUrgency(trip: TripLifecycleFields, today: IsoDate): "overdue" | "due_soon" | "" {
  if (isTripCancelled(trip) || isVoucherSettled(trip) || !trip.voucherDueDate) return "";
  if (compareDates(trip.voucherDueDate, today) < 0) return "overdue";
  if (compareDates(trip.voucherDueDate, addDays(today, VOUCHER_DUE_SOON_DAYS)) <= 0) return "due_soon";
  return "";
}

/**
 * Quick filters above the travel list. Single-choice like the board's summary
 * pills, and composes with the employee filter and the past-travel toggle.
 */
export type TravelSummaryFilter = "" | "voucher_due" | "on_travel" | "upcoming";

export function matchesTravelSummaryFilter(
  trip: TripLifecycleFields,
  filter: TravelSummaryFilter,
  today: IsoDate
): boolean {
  if (!filter) return true;
  return travelPhase(trip, today) === filter;
}

/** Sort order for the grouped list: action needed first, history last. */
const PHASE_ORDER: Record<TravelPhase, number> = {
  voucher_due: 0,
  on_travel: 1,
  upcoming: 2,
  complete: 3,
  cancelled: 4
};

export function travelPhaseRank(phase: TravelPhase): number {
  return PHASE_ORDER[phase];
}

/**
 * One stop on the trip progress tracker. `state` drives the drawing (each
 * state has its own shape, not only its own color); `detail` is the words a
 * screen reader and the tooltip use.
 */
export type TravelStepState = "done" | "skipped" | "current" | "todo" | "late";

export interface TravelStep {
  key: "ipt" | "dts" | "trip" | "voucher";
  label: string;
  state: TravelStepState;
  detail: string;
}

/**
 * The paperwork-and-travel sequence for a trip: IPT concurrence, DTS
 * authorization, the trip itself, then the voucher. Paperwork still open once
 * the trip has started, and a voucher past its due date, read as late.
 * Cancelled trips have no tracker (returns an empty list).
 */
export function travelSteps(
  trip: TripLifecycleFields & Pick<TravelRecord, "iptConcurrence" | "dtsAuthorizationStatus">,
  today: IsoDate
): TravelStep[] {
  const phase = travelPhase(trip, today);
  if (phase === "cancelled") return [];
  const started = phase !== "upcoming";

  const ipt: TravelStep =
    trip.iptConcurrence === "concurred"
      ? { key: "ipt", label: "IPT", state: "done", detail: "IPT concurred" }
      : trip.iptConcurrence === "not_required"
        ? { key: "ipt", label: "IPT", state: "skipped", detail: "IPT concurrence not required" }
        : { key: "ipt", label: "IPT", state: started ? "late" : "current", detail: "IPT concurrence pending" };

  const dts: TravelStep =
    trip.dtsAuthorizationStatus === "approved"
      ? { key: "dts", label: "DTS", state: "done", detail: "DTS authorization approved" }
      : trip.dtsAuthorizationStatus === "created"
        ? { key: "dts", label: "DTS", state: started ? "late" : "current", detail: "DTS authorization created, not yet approved" }
        : { key: "dts", label: "DTS", state: started ? "late" : "todo", detail: "DTS authorization not started" };

  const tripStep: TravelStep =
    phase === "upcoming"
      ? { key: "trip", label: "Trip", state: "todo", detail: "Trip not started" }
      : phase === "on_travel"
        ? { key: "trip", label: "Trip", state: "current", detail: "On travel now" }
        : { key: "trip", label: "Trip", state: "done", detail: "Returned" };

  const voucherStatus = voucherStatusOf(trip);
  const voucher: TravelStep =
    voucherStatus === "submitted"
      ? { key: "voucher", label: "Voucher", state: "done", detail: "Voucher submitted" }
      : voucherStatus === "not_required"
        ? { key: "voucher", label: "Voucher", state: "skipped", detail: "Voucher not required" }
        : phase === "voucher_due"
          ? {
              key: "voucher",
              label: "Voucher",
              state: voucherUrgency(trip, today) === "overdue" ? "late" : "current",
              detail: voucherUrgency(trip, today) === "overdue" ? "Voucher past due" : "Voucher due"
            }
          : { key: "voucher", label: "Voucher", state: "todo", detail: "Voucher after return" };

  return [ipt, dts, tripStep, voucher];
}
