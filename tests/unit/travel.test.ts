import { describe, expect, it } from "vitest";
import type { TravelRecord } from "../../src/domain/models";
import {
  isPastTravel,
  isVoucherOwed,
  isVoucherSettled,
  matchesTravelSummaryFilter,
  travelPhase,
  travelActionLevel,
  travelPhaseRank,
  travelStepAdvance,
  travelSteps,
  travelVoucherDueDate,
  voucherStatusOf,
  voucherUrgency,
  VOUCHER_DUE_DAYS_AFTER_RETURN
} from "../../src/domain/rules/travel";

const TODAY = "2026-07-20";

function trip(overrides: Partial<TravelRecord> = {}): TravelRecord {
  return {
    id: "t1",
    employeeId: "e1",
    destination: "Norfolk, VA",
    startDate: "2026-07-06",
    endDate: "2026-07-10",
    iptConcurrence: "concurred",
    dtsAuthorizationStatus: "approved",
    voucherDueDate: "2026-07-15",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    ...overrides
  };
}

describe("travelVoucherDueDate", () => {
  it("is five days after the return date", () => {
    expect(VOUCHER_DUE_DAYS_AFTER_RETURN).toBe(5);
    expect(travelVoucherDueDate("2026-07-09")).toBe("2026-07-14");
  });

  it("uses date-only math across a month boundary", () => {
    expect(travelVoucherDueDate("2026-07-29")).toBe("2026-08-03");
  });

  it("uses date-only math across a year boundary", () => {
    expect(travelVoucherDueDate("2026-12-30")).toBe("2027-01-04");
  });
});

describe("voucherStatusOf", () => {
  it("treats records written before voucher tracking as still owing one", () => {
    expect(voucherStatusOf(trip())).toBe("not_submitted");
    expect(isVoucherSettled(trip())).toBe(false);
  });

  it("counts submitted and not-required vouchers as settled", () => {
    expect(isVoucherSettled(trip({ voucherStatus: "submitted" }))).toBe(true);
    expect(isVoucherSettled(trip({ voucherStatus: "not_required" }))).toBe(true);
  });
});

describe("travelPhase", () => {
  it("is upcoming before the start date", () => {
    expect(travelPhase(trip({ startDate: "2026-07-21", endDate: "2026-07-24" }), TODAY)).toBe("upcoming");
  });

  it("is on travel on the first and last day of the trip", () => {
    expect(travelPhase(trip({ startDate: TODAY, endDate: "2026-07-24" }), TODAY)).toBe("on_travel");
    expect(travelPhase(trip({ startDate: "2026-07-16", endDate: TODAY }), TODAY)).toBe("on_travel");
  });

  it("owes a voucher after return until the voucher is settled", () => {
    expect(travelPhase(trip(), TODAY)).toBe("voucher_due");
    expect(isVoucherOwed(trip(), TODAY)).toBe(true);
    expect(travelPhase(trip({ voucherStatus: "submitted" }), TODAY)).toBe("complete");
    expect(travelPhase(trip({ voucherStatus: "not_required" }), TODAY)).toBe("complete");
  });

  it("is cancelled regardless of the dates", () => {
    const upcoming = trip({ startDate: "2026-07-25", endDate: "2026-07-28", tripStatus: "cancelled" });
    expect(travelPhase(upcoming, TODAY)).toBe("cancelled");
    expect(travelPhase(trip({ tripStatus: "cancelled" }), TODAY)).toBe("cancelled");
  });

  it("treats an end date before the start as a one-day trip", () => {
    expect(travelPhase(trip({ startDate: TODAY, endDate: "2026-07-01" }), TODAY)).toBe("on_travel");
  });
});

describe("isPastTravel", () => {
  it("keeps a returned trip visible while its voucher is outstanding", () => {
    expect(isPastTravel(trip(), TODAY)).toBe(false);
  });

  it("treats settled and cancelled trips as past", () => {
    expect(isPastTravel(trip({ voucherStatus: "submitted" }), TODAY)).toBe(true);
    expect(isPastTravel(trip({ tripStatus: "cancelled" }), TODAY)).toBe(true);
  });

  it("never treats an upcoming or in-progress trip as past", () => {
    expect(isPastTravel(trip({ startDate: "2026-08-01", endDate: "2026-08-04" }), TODAY)).toBe(false);
    expect(isPastTravel(trip({ startDate: "2026-07-19", endDate: "2026-07-22" }), TODAY)).toBe(false);
  });
});

describe("voucherUrgency", () => {
  it("flags an overdue voucher", () => {
    expect(voucherUrgency(trip({ voucherDueDate: "2026-07-19" }), TODAY)).toBe("overdue");
  });

  it("flags a voucher due within five days", () => {
    expect(voucherUrgency(trip({ voucherDueDate: TODAY }), TODAY)).toBe("due_soon");
    expect(voucherUrgency(trip({ voucherDueDate: "2026-07-25" }), TODAY)).toBe("due_soon");
    expect(voucherUrgency(trip({ voucherDueDate: "2026-07-26" }), TODAY)).toBe("");
  });

  it("goes quiet once the voucher is settled or the trip is cancelled", () => {
    expect(voucherUrgency(trip({ voucherDueDate: "2026-07-19", voucherStatus: "submitted" }), TODAY)).toBe("");
    expect(voucherUrgency(trip({ voucherDueDate: "2026-07-19", voucherStatus: "not_required" }), TODAY)).toBe("");
    expect(voucherUrgency(trip({ voucherDueDate: "2026-07-19", tripStatus: "cancelled" }), TODAY)).toBe("");
  });
});

describe("matchesTravelSummaryFilter", () => {
  it("does not narrow trips when no quick filter is selected", () => {
    expect(matchesTravelSummaryFilter(trip({ tripStatus: "cancelled" }), "", TODAY)).toBe(true);
  });

  it("matches only the selected phase", () => {
    expect(matchesTravelSummaryFilter(trip(), "voucher_due", TODAY)).toBe(true);
    expect(matchesTravelSummaryFilter(trip(), "on_travel", TODAY)).toBe(false);
    expect(matchesTravelSummaryFilter(trip({ startDate: "2026-08-01", endDate: "2026-08-03" }), "upcoming", TODAY)).toBe(true);
  });

  it("never matches a cancelled trip", () => {
    const cancelled = trip({ startDate: "2026-08-01", endDate: "2026-08-03", tripStatus: "cancelled" });
    expect(matchesTravelSummaryFilter(cancelled, "upcoming", TODAY)).toBe(false);
  });
});

describe("travelPhaseRank", () => {
  it("orders action-needed phases ahead of history", () => {
    expect(travelPhaseRank("voucher_due")).toBeLessThan(travelPhaseRank("on_travel"));
    expect(travelPhaseRank("on_travel")).toBeLessThan(travelPhaseRank("upcoming"));
    expect(travelPhaseRank("upcoming")).toBeLessThan(travelPhaseRank("complete"));
    expect(travelPhaseRank("complete")).toBeLessThan(travelPhaseRank("cancelled"));
  });
});

describe("travelSteps", () => {
  const states = (t: TravelRecord, today = TODAY) => travelSteps(t, today).map((s) => `${s.key}:${s.state}`).join(" ");

  it("walks an upcoming trip: paperwork in progress, trip and voucher still to come", () => {
    const upcoming = trip({ startDate: "2026-08-03", endDate: "2026-08-05", voucherDueDate: "2026-08-10", iptConcurrence: "pending", dtsAuthorizationStatus: "not_started" });
    expect(states(upcoming)).toBe("ipt:current dts:todo trip:todo voucher:todo");
  });

  it("marks paperwork still open after departure as late", () => {
    const underway = trip({ startDate: "2026-07-19", endDate: "2026-07-22", iptConcurrence: "pending", dtsAuthorizationStatus: "created" });
    expect(states(underway)).toBe("ipt:late dts:late trip:current voucher:todo");
  });

  it("shows the voucher as current when due and late when past due", () => {
    expect(states(trip({ voucherDueDate: "2026-07-22" }))).toBe("ipt:done dts:done trip:done voucher:current");
    expect(states(trip({ voucherDueDate: "2026-07-15" }))).toBe("ipt:done dts:done trip:done voucher:late");
  });

  it("finishes when the voucher is submitted, and skips steps that are not required", () => {
    expect(states(trip({ voucherStatus: "submitted" }))).toBe("ipt:done dts:done trip:done voucher:done");
    expect(states(trip({ iptConcurrence: "not_required", voucherStatus: "not_required" }))).toBe("ipt:skipped dts:done trip:done voucher:skipped");
  });

  it("has no tracker for a cancelled trip", () => {
    expect(travelSteps(trip({ tripStatus: "cancelled" }), TODAY)).toEqual([]);
  });
});

describe("travelStepAdvance", () => {
  const upcoming = (overrides: Partial<TravelRecord> = {}) =>
    trip({ startDate: "2026-08-03", endDate: "2026-08-05", voucherDueDate: "2026-08-10", ...overrides });

  it("moves pending IPT concurrence to concurred, and offers nothing once settled", () => {
    expect(travelStepAdvance(upcoming({ iptConcurrence: "pending" }), "ipt", TODAY)).toEqual({
      label: "Mark IPT concurred",
      changes: { iptConcurrence: "concurred" }
    });
    expect(travelStepAdvance(upcoming({ iptConcurrence: "concurred" }), "ipt", TODAY)).toBeUndefined();
    expect(travelStepAdvance(upcoming({ iptConcurrence: "not_required" }), "ipt", TODAY)).toBeUndefined();
  });

  it("walks DTS authorization one stage at a time: not started, created, approved", () => {
    expect(travelStepAdvance(upcoming({ dtsAuthorizationStatus: "not_started" }), "dts", TODAY)?.changes).toEqual({
      dtsAuthorizationStatus: "created"
    });
    expect(travelStepAdvance(upcoming({ dtsAuthorizationStatus: "created" }), "dts", TODAY)?.changes).toEqual({
      dtsAuthorizationStatus: "approved"
    });
    expect(travelStepAdvance(upcoming({ dtsAuthorizationStatus: "approved" }), "dts", TODAY)).toBeUndefined();
  });

  it("submits the voucher only once the traveler is back and still owes one", () => {
    expect(travelStepAdvance(trip(), "voucher", TODAY)).toEqual({
      label: "Mark voucher submitted",
      changes: { voucherStatus: "submitted", voucherSubmittedDate: TODAY }
    });
    expect(travelStepAdvance(upcoming(), "voucher", TODAY)).toBeUndefined();
    expect(travelStepAdvance(trip({ startDate: "2026-07-19", endDate: "2026-07-22" }), "voucher", TODAY)).toBeUndefined();
    expect(travelStepAdvance(trip({ voucherStatus: "submitted" }), "voucher", TODAY)).toBeUndefined();
    expect(travelStepAdvance(trip({ voucherStatus: "not_required" }), "voucher", TODAY)).toBeUndefined();
  });

  it("never advances the trip step or anything on a cancelled trip", () => {
    expect(travelStepAdvance(trip(), "trip", TODAY)).toBeUndefined();
    const cancelled = trip({ tripStatus: "cancelled", iptConcurrence: "pending", dtsAuthorizationStatus: "not_started" });
    expect(travelStepAdvance(cancelled, "ipt", TODAY)).toBeUndefined();
    expect(travelStepAdvance(cancelled, "dts", TODAY)).toBeUndefined();
    expect(travelStepAdvance(cancelled, "voucher", TODAY)).toBeUndefined();
  });

  it("labels exactly the tracker steps that can be advanced", () => {
    const actions = (t: TravelRecord) => travelSteps(t, TODAY).map((s) => `${s.key}:${s.action ?? "-"}`).join(" | ");
    expect(actions(upcoming({ iptConcurrence: "pending", dtsAuthorizationStatus: "created" }))).toBe(
      "ipt:Mark IPT concurred | dts:Mark DTS authorization approved | trip:- | voucher:-"
    );
    expect(actions(trip())).toBe("ipt:- | dts:- | trip:- | voucher:Mark voucher submitted");
    expect(actions(trip({ voucherStatus: "submitted" }))).toBe("ipt:- | dts:- | trip:- | voucher:-");
  });
});

describe("travelActionLevel", () => {
  it("is late when paperwork is open after departure or the voucher is past due", () => {
    expect(travelActionLevel(trip({ startDate: "2026-07-19", endDate: "2026-07-22", iptConcurrence: "pending" }), TODAY)).toBe("late");
    expect(travelActionLevel(trip({ voucherDueDate: "2026-07-15" }), TODAY)).toBe("late");
  });

  it("is due when the traveler is back and the voucher is not yet past due", () => {
    expect(travelActionLevel(trip({ voucherDueDate: "2026-07-22" }), TODAY)).toBe("due");
  });

  it("is nothing for upcoming, settled, and cancelled trips", () => {
    expect(travelActionLevel(trip({ startDate: "2026-08-03", endDate: "2026-08-05", iptConcurrence: "pending" }), TODAY)).toBe("");
    expect(travelActionLevel(trip({ voucherStatus: "submitted" }), TODAY)).toBe("");
    expect(travelActionLevel(trip({ tripStatus: "cancelled", iptConcurrence: "pending" }), TODAY)).toBe("");
  });
});
