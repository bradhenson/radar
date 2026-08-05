import { describe, expect, it } from "vitest";
import { isWithinDateRange, resolveDateRange } from "../../src/domain/rules/dateRange";

const TODAY = "2026-08-05";

describe("resolveDateRange", () => {
  it("leaves both ends open for all dates", () => {
    expect(resolveDateRange("all", TODAY)).toEqual({});
  });

  it("rolls back by days without closing the upper bound", () => {
    expect(resolveDateRange("last30", TODAY)).toEqual({ from: "2026-07-06" });
    expect(resolveDateRange("last90", TODAY)).toEqual({ from: "2026-05-07" });
  });

  it("rolls back by calendar months", () => {
    expect(resolveDateRange("last12m", TODAY)).toEqual({ from: "2025-08-05" });
  });

  it("starts this year on January 1", () => {
    expect(resolveDateRange("thisYear", TODAY)).toEqual({ from: "2026-01-01" });
  });

  it("uses custom bounds and ignores invalid or empty ones", () => {
    expect(resolveDateRange("custom", TODAY, { from: "2026-01-15", to: "2026-02-15" })).toEqual({
      from: "2026-01-15",
      to: "2026-02-15"
    });
    expect(resolveDateRange("custom", TODAY, { from: "", to: "2026-02-15" })).toEqual({
      from: undefined,
      to: "2026-02-15"
    });
    expect(resolveDateRange("custom", TODAY, { from: "2026-02-30", to: "nonsense" })).toEqual({
      from: undefined,
      to: undefined
    });
  });
});

describe("isWithinDateRange", () => {
  it("includes both bounds", () => {
    const range = { from: "2026-01-15", to: "2026-02-15" };
    expect(isWithinDateRange("2026-01-15", range)).toBe(true);
    expect(isWithinDateRange("2026-02-15", range)).toBe(true);
    expect(isWithinDateRange("2026-01-14", range)).toBe(false);
    expect(isWithinDateRange("2026-02-16", range)).toBe(false);
  });

  it("accepts everything when unbounded", () => {
    expect(isWithinDateRange("2019-03-01", {})).toBe(true);
    expect(isWithinDateRange("2099-03-01", {})).toBe(true);
  });

  it("keeps future-dated notes visible in a rolling window", () => {
    const range = resolveDateRange("last30", TODAY);
    expect(isWithinDateRange("2026-09-01", range)).toBe(true);
    expect(isWithinDateRange("2026-06-01", range)).toBe(false);
  });
});
