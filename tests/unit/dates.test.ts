import { describe, expect, it } from "vitest";
import {
  addDays,
  addMonths,
  compareDates,
  formatDateRange,
  daysBetween,
  describeDueDistance,
  formatDate,
  formatLongDate,
  isValidIsoDate
} from "../../src/utils/dates";

describe("isValidIsoDate", () => {
  it("accepts real dates", () => {
    expect(isValidIsoDate("2026-07-04")).toBe(true);
    expect(isValidIsoDate("2024-02-29")).toBe(true); // leap year
    expect(isValidIsoDate("2000-02-29")).toBe(true); // 400-year leap rule
  });
  it("rejects invalid dates", () => {
    expect(isValidIsoDate("2026-02-30")).toBe(false);
    expect(isValidIsoDate("2026-13-01")).toBe(false);
    expect(isValidIsoDate("2100-02-29")).toBe(false); // not a leap year
    expect(isValidIsoDate("2026-7-4")).toBe(false);
    expect(isValidIsoDate("July 4 2026")).toBe(false);
    expect(isValidIsoDate("")).toBe(false);
  });
});

describe("addDays", () => {
  it("crosses month boundaries", () => {
    expect(addDays("2026-07-31", 1)).toBe("2026-08-01");
    expect(addDays("2026-08-01", -1)).toBe("2026-07-31");
  });
  it("crosses year boundaries", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
  });
  it("handles leap days", () => {
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
    expect(addDays("2025-02-28", 1)).toBe("2025-03-01");
  });
});

describe("addMonths", () => {
  it("adds a year for annual recurrence", () => {
    expect(addMonths("2026-07-04", 12)).toBe("2027-07-04");
  });
  it("clamps to end of shorter months", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2024-01-31", 1)).toBe("2024-02-29");
  });
  it("crosses year boundaries", () => {
    expect(addMonths("2026-11-15", 3)).toBe("2027-02-15");
  });
});

describe("daysBetween", () => {
  it("is positive when b is after a", () => {
    expect(daysBetween("2026-07-04", "2026-07-11")).toBe(7);
    expect(daysBetween("2026-07-11", "2026-07-04")).toBe(-7);
    expect(daysBetween("2026-07-04", "2026-07-04")).toBe(0);
  });
  it("is unaffected by DST-length days", () => {
    // US DST transitions in March and November.
    expect(daysBetween("2026-03-07", "2026-03-09")).toBe(2);
    expect(daysBetween("2026-10-31", "2026-11-02")).toBe(2);
  });
});

describe("compareDates", () => {
  it("orders ISO dates", () => {
    expect(compareDates("2026-07-04", "2026-07-05")).toBe(-1);
    expect(compareDates("2026-07-05", "2026-07-04")).toBe(1);
    expect(compareDates("2026-07-04", "2026-07-04")).toBe(0);
  });
});

describe("formatting", () => {
  it("formats dates", () => {
    expect(formatDate("2026-07-04")).toBe("Jul 4, 2026");
    expect(formatDate(undefined)).toBe("");
  });
  it("describes due distance", () => {
    expect(describeDueDistance("2026-07-04", "2026-07-04")).toBe("due today");
    expect(describeDueDistance("2026-07-03", "2026-07-04")).toBe("overdue by 1 day");
    expect(describeDueDistance("2026-07-01", "2026-07-04")).toBe("overdue by 3 days");
    expect(describeDueDistance("2026-07-05", "2026-07-04")).toBe("due in 1 day");
  });
});

describe("formatLongDate", () => {
  it("spells out the weekday and month without timezone drift", () => {
    expect(formatLongDate("2026-09-24")).toBe("Thursday, September 24, 2026");
    expect(formatLongDate("2026-01-04")).toBe("Sunday, January 4, 2026");
    expect(formatLongDate("")).toBe("");
    expect(formatLongDate("not-a-date")).toBe("not-a-date");
  });
});

describe("formatDateRange", () => {
  it("shows a single day once", () => {
    expect(formatDateRange("2026-11-21", "2026-11-21")).toBe("Nov 21, 2026");
    expect(formatDateRange("2026-11-21", undefined)).toBe("Nov 21, 2026");
  });

  it("shares the month and year within one month", () => {
    expect(formatDateRange("2026-11-21", "2026-11-23")).toBe("Nov 21–23, 2026");
  });

  it("shares the year across months", () => {
    expect(formatDateRange("2026-11-28", "2026-12-02")).toBe("Nov 28 – Dec 2, 2026");
  });

  it("spells out both dates across years", () => {
    expect(formatDateRange("2026-12-28", "2027-01-03")).toBe("Dec 28, 2026 – Jan 3, 2027");
  });

  it("drops the shared year when asked", () => {
    expect(formatDateRange("2026-11-21", "2026-11-23", { withYear: false })).toBe("Nov 21–23");
    expect(formatDateRange("2026-11-28", "2026-12-02", { withYear: false })).toBe("Nov 28 – Dec 2");
    expect(formatDateRange("2026-11-21", "2026-11-21", { withYear: false })).toBe("Nov 21");
  });

  it("shows the start alone when the end is earlier or invalid", () => {
    expect(formatDateRange("2026-11-21", "2026-11-20")).toBe("Nov 21, 2026");
    expect(formatDateRange("2026-11-21", "not-a-date")).toBe("Nov 21, 2026");
  });
});
