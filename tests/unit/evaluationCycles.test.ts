import { describe, expect, it } from "vitest";
import type { EvaluationCycle } from "../../src/domain/models";
import {
  cycleContains,
  cycleForDate,
  cycleLabel,
  cyclePhase,
  evaluationCycleError,
  inputsInCycle,
  sortedCycles
} from "../../src/domain/rules/evaluationCycles";

const fy26: EvaluationCycle = { id: "c26", name: "FY2026", startDate: "2025-10-01", endDate: "2026-09-30", midyearDate: "2026-04-01", active: true };
const fy27: EvaluationCycle = { id: "c27", name: "FY2027", startDate: "2026-10-01", endDate: "2027-09-30", active: true };

describe("cycle membership", () => {
  it("includes both the first and the last day of a cycle", () => {
    expect(cycleContains(fy26, "2025-10-01")).toBe(true);
    expect(cycleContains(fy26, "2026-09-30")).toBe(true);
    expect(cycleContains(fy26, "2025-09-30")).toBe(false);
    expect(cycleContains(fy26, "2026-10-01")).toBe(false);
  });

  it("finds the cycle a date falls in, or none between cycles", () => {
    expect(cycleForDate([fy26, fy27], "2026-07-20")?.id).toBe("c26");
    expect(cycleForDate([fy26, fy27], "2026-10-01")?.id).toBe("c27");
    expect(cycleForDate([fy26], "2026-11-12")).toBeUndefined();
    expect(cycleForDate([], "2026-11-12")).toBeUndefined();
  });

  it("keeps the inputs dated inside the cycle, and all of them when no cycle is chosen", () => {
    const inputs = [{ inputDate: "2025-09-30" }, { inputDate: "2025-10-01" }, { inputDate: "2026-09-30" }, { inputDate: "2026-10-01" }];
    expect(inputsInCycle(inputs, fy26).map((i) => i.inputDate)).toEqual(["2025-10-01", "2026-09-30"]);
    expect(inputsInCycle(inputs, undefined)).toHaveLength(4);
  });

  it("lists cycles newest first without changing the original array", () => {
    const list = [fy26, fy27];
    expect(sortedCycles(list).map((c) => c.id)).toEqual(["c27", "c26"]);
    expect(list.map((c) => c.id)).toEqual(["c26", "c27"]);
  });

  it("labels a cycle with its dates", () => {
    expect(cycleLabel(fy26)).toBe("FY2026 (Oct 1, 2025 – Sep 30, 2026)");
  });
});

describe("cyclePhase", () => {
  it("splits a cycle at its mid-year date", () => {
    expect(cyclePhase(fy26, "2025-09-30")).toBe("upcoming");
    expect(cyclePhase(fy26, "2026-03-31")).toBe("first_half");
    expect(cyclePhase(fy26, "2026-04-01")).toBe("second_half");
    expect(cyclePhase(fy26, "2026-09-30")).toBe("second_half");
    expect(cyclePhase(fy26, "2026-10-01")).toBe("ended");
  });

  it("treats a cycle with no mid-year date as one half", () => {
    expect(cyclePhase(fy27, "2027-06-01")).toBe("first_half");
  });
});

describe("evaluationCycleError", () => {
  const draft = { id: "new", name: "FY2028", startDate: "2027-10-01", endDate: "2028-09-30", midyearDate: undefined };

  it("accepts a cycle that follows the existing ones", () => {
    expect(evaluationCycleError(draft, [fy26, fy27])).toBeUndefined();
  });

  it("requires a name and real dates in order", () => {
    expect(evaluationCycleError({ ...draft, name: "  " }, [])).toMatch(/Name/);
    expect(evaluationCycleError({ ...draft, startDate: "" }, [])).toMatch(/Start and end/);
    expect(evaluationCycleError({ ...draft, endDate: "2028-02-30" }, [])).toMatch(/Start and end/);
    expect(evaluationCycleError({ ...draft, endDate: "2027-09-30" }, [])).toMatch(/on or after/);
  });

  it("keeps the mid-year date inside the cycle", () => {
    expect(evaluationCycleError({ ...draft, midyearDate: "2028-04-01" }, [])).toBeUndefined();
    expect(evaluationCycleError({ ...draft, midyearDate: "2028-10-01" }, [])).toMatch(/inside the cycle/);
    expect(evaluationCycleError({ ...draft, midyearDate: "nope" }, [])).toMatch(/not valid/);
  });

  it("refuses a duplicate name, ignoring case, and overlapping dates", () => {
    expect(evaluationCycleError({ ...draft, name: "fy2027" }, [fy26, fy27])).toMatch(/already exists/);
    // One shared day is an overlap: each date belongs to exactly one cycle.
    expect(evaluationCycleError({ ...draft, startDate: "2027-09-30" }, [fy26, fy27])).toMatch(/overlap FY2027/);
    expect(evaluationCycleError({ ...draft, startDate: "2024-10-01", endDate: "2029-09-30" }, [fy26])).toMatch(/overlap FY2026/);
  });

  it("lets a cycle be edited without colliding with itself", () => {
    expect(evaluationCycleError({ ...fy27, endDate: "2027-10-15" }, [fy26, fy27])).toBeUndefined();
    expect(evaluationCycleError({ ...fy27, startDate: "2026-09-01" }, [fy26, fy27])).toMatch(/overlap FY2026/);
  });
});
