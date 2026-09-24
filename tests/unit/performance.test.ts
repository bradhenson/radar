import { describe, expect, it } from "vitest";
import { monthlyCounts } from "../../src/domain/rules/performance";

describe("monthlyCounts", () => {
  it("covers the last six calendar months, oldest first, ending this month", () => {
    const months = monthlyCounts([], "2026-09-24");
    expect(months.map((m) => m.month)).toEqual(["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"]);
    expect(months[0]!.label).toBe("Apr 2026");
  });

  it("crosses a year boundary", () => {
    expect(monthlyCounts([], "2026-02-10", 4).map((m) => m.month)).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
  });

  it("counts inputs per month and ignores dates outside the window", () => {
    const months = monthlyCounts(["2026-09-01", "2026-09-30", "2026-06-15", "2026-03-31", "2026-10-01"], "2026-09-24");
    expect(months.map((m) => m.count)).toEqual([0, 0, 1, 0, 0, 2]);
  });
});
