import { describe, expect, it } from "vitest";
import type { TravelRecord } from "../../src/domain/models";
import {
  isPastTravel,
  isVoucherOwed,
  isVoucherSettled,
  matchesTravelSummaryFilter,
  travelPhase,
  travelPhaseRank,
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
