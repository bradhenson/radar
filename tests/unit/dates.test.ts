import { describe, expect, it } from "vitest";
import {
  addDays,
  addMonths,
  compareDates,
  daysBetween,
  describeDueDistance,
  formatDate,
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
