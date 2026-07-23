import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, type TeleworkRecord } from "../../src/domain/models";
import {
  allowanceState,
  countsTowardTeleworkLimit,
  isWithinTeleworkWindow,
  payPeriodFor,
  payPeriodLabel,
  payPeriodStartFor,
  PAY_PERIOD_DAYS,
  requestPayPeriodStart,
  SITUATIONAL_REQUEST_TYPE,
  teleworkDays,
  teleworkUsageByPayPeriod,
  usageKey
} from "../../src/domain/rules/telework";

const TS = "2026-07-01T00:00:00.000Z";
const TODAY = "2026-07-23"; // a Thursday
const ANCHOR = "2026-01-04"; // a Sunday

function request(partial: Partial<TeleworkRecord> & { id: string; employeeId: string }): TeleworkRecord {
  return {
    recordType: SITUATIONAL_REQUEST_TYPE,
    status: "approved",
    createdAt: TS,
    updatedAt: TS,
    ...partial
  };
}

describe("the shipped default pay period calendar", () => {
  const anchor = DEFAULT_SETTINGS.payPeriodAnchorDate;

  it("matches the federal bi-weekly calendar: July 2026 periods start the 12th and the 26th", () => {
    expect(payPeriodStartFor("2026-07-12", anchor)).toBe("2026-07-12");
    expect(payPeriodStartFor("2026-07-20", anchor)).toBe("2026-07-12");
    expect(payPeriodStartFor("2026-07-25", anchor)).toBe("2026-07-12");
    expect(payPeriodStartFor("2026-07-26", anchor)).toBe("2026-07-26");
    expect(payPeriodStartFor("2026-08-08", anchor)).toBe("2026-07-26");
  });

  it("keeps that cadence in earlier and later years", () => {
    expect(payPeriodStartFor("2026-06-28", anchor)).toBe("2026-06-28");
    expect(payPeriodStartFor("2025-12-31", anchor)).toBe("2025-12-28");
    expect(payPeriodStartFor("2027-01-05", anchor)).toBe("2026-12-27");
  });
});

describe("pay periods", () => {
  it("is two weeks long and starts on the anchor", () => {
    expect(PAY_PERIOD_DAYS).toBe(14);
    const period = payPeriodFor(ANCHOR, ANCHOR);
    expect(period.start).toBe(ANCHOR);
    expect(period.end).toBe("2026-01-17");
  });

  it("holds every day of the period, and rolls over on the fifteenth day", () => {
    expect(payPeriodStartFor("2026-01-04", ANCHOR)).toBe("2026-01-04");
    expect(payPeriodStartFor("2026-01-17", ANCHOR)).toBe("2026-01-04");
    expect(payPeriodStartFor("2026-01-18", ANCHOR)).toBe("2026-01-18");
  });

  it("counts backwards from the anchor without drifting", () => {
    expect(payPeriodStartFor("2026-01-03", ANCHOR)).toBe("2025-12-21");
    expect(payPeriodStartFor("2025-12-21", ANCHOR)).toBe("2025-12-21");
    expect(payPeriodStartFor("2025-12-20", ANCHOR)).toBe("2025-12-07");
  });

  it("labels a period as its inclusive date range", () => {
    expect(payPeriodLabel(payPeriodFor(TODAY, ANCHOR))).toBe("Jul 19, 2026 – Aug 1, 2026");
  });
});

describe("teleworkDays", () => {
  it("counts a single-day request as one day", () => {
    expect(teleworkDays({ effectiveDate: "2026-07-21", expirationDate: "2026-07-21" })).toEqual(["2026-07-21"]);
  });

  it("skips the weekend inside a range", () => {
    // Friday through Monday is two telework days, not four.
    expect(teleworkDays({ effectiveDate: "2026-07-24", expirationDate: "2026-07-27" })).toEqual([
      "2026-07-24",
      "2026-07-27"
    ]);
  });

  it("still counts a request that falls entirely on a weekend", () => {
    expect(teleworkDays({ effectiveDate: "2026-07-25", expirationDate: "2026-07-26" })).toEqual([
      "2026-07-25",
      "2026-07-26"
    ]);
  });

  it("treats a missing or backwards end date as a one-day request", () => {
    expect(teleworkDays({ effectiveDate: "2026-07-21" })).toEqual(["2026-07-21"]);
    expect(teleworkDays({ effectiveDate: "2026-07-21", expirationDate: "2026-07-01" })).toEqual(["2026-07-21"]);
  });

  it("has no days without a start date", () => {
    expect(teleworkDays({})).toEqual([]);
  });
});

describe("countsTowardTeleworkLimit", () => {
  it("counts pending and approved situational requests", () => {
    expect(countsTowardTeleworkLimit({ recordType: SITUATIONAL_REQUEST_TYPE, status: "pending" })).toBe(true);
    expect(countsTowardTeleworkLimit({ recordType: SITUATIONAL_REQUEST_TYPE, status: "approved" })).toBe(true);
    expect(countsTowardTeleworkLimit({ recordType: SITUATIONAL_REQUEST_TYPE, status: "expired" })).toBe(true);
  });

  it("ignores denied and cancelled requests", () => {
    expect(countsTowardTeleworkLimit({ recordType: SITUATIONAL_REQUEST_TYPE, status: "denied" })).toBe(false);
    expect(countsTowardTeleworkLimit({ recordType: SITUATIONAL_REQUEST_TYPE, status: "cancelled" })).toBe(false);
  });

  it("ignores agreements, which are not per-day requests", () => {
    expect(countsTowardTeleworkLimit({ recordType: "Agreement", status: "active" })).toBe(false);
  });
});

describe("teleworkUsageByPayPeriod", () => {
  const records = [
    request({ id: "r1", employeeId: "e1", effectiveDate: "2026-07-21", expirationDate: "2026-07-21" }),
    request({ id: "r2", employeeId: "e1", effectiveDate: "2026-07-28", expirationDate: "2026-07-28" }),
    request({ id: "r3", employeeId: "e1", effectiveDate: "2026-07-30", expirationDate: "2026-07-30", status: "pending" }),
    request({ id: "r4", employeeId: "e1", effectiveDate: "2026-08-04", expirationDate: "2026-08-04" }),
    request({ id: "r5", employeeId: "e2", effectiveDate: "2026-07-22", expirationDate: "2026-07-22", status: "denied" }),
    request({ id: "r6", employeeId: "e2", recordType: "Agreement", status: "active", effectiveDate: "2026-07-22" })
  ];
  const usage = teleworkUsageByPayPeriod(records, ANCHOR);

  it("tallies each employee's days within one pay period", () => {
    const entry = usage.get(usageKey("e1", "2026-07-19"));
    expect(entry?.totalDays).toBe(3);
    expect(entry?.approvedDays).toBe(2);
    expect(entry?.pendingDays).toBe(1);
  });

  it("starts a fresh tally in the next pay period", () => {
    expect(usage.get(usageKey("e1", "2026-08-02"))?.totalDays).toBe(1);
  });

  it("leaves out denied requests and agreements entirely", () => {
    expect(usage.get(usageKey("e2", "2026-07-19"))).toBeUndefined();
  });

  it("splits a request that straddles a pay period boundary", () => {
    // Jul 30 (Thu) through Aug 4 (Tue): two days in one period, two in the next.
    const split = teleworkUsageByPayPeriod(
      [request({ id: "r7", employeeId: "e3", effectiveDate: "2026-07-30", expirationDate: "2026-08-04" })],
      ANCHOR
    );
    expect(split.get(usageKey("e3", "2026-07-19"))?.totalDays).toBe(2);
    expect(split.get(usageKey("e3", "2026-08-02"))?.totalDays).toBe(2);
  });
});

describe("requestPayPeriodStart", () => {
  it("files a request under the period of its first telework day", () => {
    const record = request({ id: "r1", employeeId: "e1", effectiveDate: "2026-07-30", expirationDate: "2026-08-04" });
    expect(requestPayPeriodStart(record, ANCHOR)).toBe("2026-07-19");
  });

  it("falls back to the request date when no telework date is set", () => {
    const record = request({ id: "r2", employeeId: "e1", requestDate: "2026-07-21" });
    expect(requestPayPeriodStart(record, ANCHOR)).toBe("2026-07-19");
  });
});

describe("isWithinTeleworkWindow", () => {
  it("keeps requests from the lookback window", () => {
    expect(isWithinTeleworkWindow({ effectiveDate: "2026-06-23", expirationDate: "2026-06-23" }, TODAY, 30)).toBe(true);
    expect(isWithinTeleworkWindow({ effectiveDate: "2026-06-22", expirationDate: "2026-06-22" }, TODAY, 30)).toBe(false);
  });

  it("always keeps upcoming requests", () => {
    expect(isWithinTeleworkWindow({ effectiveDate: "2027-01-04", expirationDate: "2027-01-04" }, TODAY, 30)).toBe(true);
  });

  it("keeps a request whose range is still running", () => {
    expect(isWithinTeleworkWindow({ effectiveDate: "2026-05-01", expirationDate: TODAY }, TODAY, 30)).toBe(true);
  });

  it("keeps an undated request so it cannot be forgotten", () => {
    expect(isWithinTeleworkWindow({}, TODAY, 30)).toBe(true);
  });
});

describe("allowanceState", () => {
  it("separates under, at, and over the allowance", () => {
    expect(allowanceState(1, 2)).toBe("under");
    expect(allowanceState(2, 2)).toBe("at");
    expect(allowanceState(3, 2)).toBe("over");
  });
});
