import { describe, expect, it } from "vitest";
import type { AwardRecord } from "../../src/domain/models";
import { AWARD_STATUSES } from "../../src/domain/models";
import { AWARD_PIPELINE, awardTypeOptions, filterAwards, nextAwardStatus } from "../../src/domain/rules/awards";
import { appendToDraft, awardSteps, citationLines } from "../../src/domain/rules/awards";
import { richTextFromPlainText } from "../../src/utils/richTextDoc";

const NAMES: Record<string, string> = { e1: "Avery Brooks", e2: "Riley Chen" };
const employeeName = (id: string) => NAMES[id] ?? "";

function award(overrides: Partial<AwardRecord> = {}): AwardRecord {
  return {
    id: "a1",
    employeeId: "e1",
    title: "Team excellence nomination",
    awardType: "Special Act",
    status: "Idea",
    createdAt: "2026-07-01T12:00:00.000Z",
    updatedAt: "2026-07-01T12:00:00.000Z",
    ...overrides
  } as AwardRecord;
}

const records = [
  award({ id: "a1", title: "Team excellence nomination", nominationDueDate: "2026-09-01" }),
  award({ id: "a2", employeeId: "e2", title: "Sustained superior", awardType: "QSI", status: "Submitted" }),
  award({
    id: "a3",
    title: "On-the-spot recognition",
    awardType: "",
    status: "Approved",
    nominationDueDate: "2026-08-15",
    supportingNotes: richTextFromPlainText("Led the migration rehearsal")
  })
];

function ids(result: AwardRecord[]): string[] {
  return result.map((r) => r.id);
}

describe("filterAwards", () => {
  it("sorts by nomination due date and puts undated records last", () => {
    expect(ids(filterAwards(records, {}, employeeName))).toEqual(["a3", "a1", "a2"]);
  });

  it("filters by employee, status, and award type", () => {
    expect(ids(filterAwards(records, { employeeId: "e2" }, employeeName))).toEqual(["a2"]);
    expect(ids(filterAwards(records, { status: "Approved" }, employeeName))).toEqual(["a3"]);
    expect(ids(filterAwards(records, { awardType: "QSI" }, employeeName))).toEqual(["a2"]);
  });

  it("searches title, employee name, award type, and supporting notes", () => {
    expect(ids(filterAwards(records, { search: "excellence" }, employeeName))).toEqual(["a1"]);
    expect(ids(filterAwards(records, { search: "riley" }, employeeName))).toEqual(["a2"]);
    expect(ids(filterAwards(records, { search: "qsi" }, employeeName))).toEqual(["a2"]);
    expect(ids(filterAwards(records, { search: "rehearsal" }, employeeName))).toEqual(["a3"]);
  });

  it("ignores surrounding whitespace and case in the search", () => {
    expect(ids(filterAwards(records, { search: "  SUSTAINED  " }, employeeName))).toEqual(["a2"]);
  });

  it("combines filters", () => {
    expect(ids(filterAwards(records, { employeeId: "e1", status: "Approved" }, employeeName))).toEqual(["a3"]);
    expect(filterAwards(records, { employeeId: "e2", status: "Approved" }, employeeName)).toEqual([]);
  });

  it("does not mutate the input order", () => {
    const input = [...records];
    filterAwards(input, {}, employeeName);
    expect(ids(input)).toEqual(["a1", "a2", "a3"]);
  });
});

describe("awardTypeOptions", () => {
  it("lists the distinct types in use, sorted, ignoring blanks", () => {
    expect(awardTypeOptions(records)).toEqual(["QSI", "Special Act"]);
  });

  it("trims and de-duplicates", () => {
    const dupes = [award({ id: "x", awardType: " Special Act " }), award({ id: "y", awardType: "Special Act" })];
    expect(awardTypeOptions(dupes)).toEqual(["Special Act"]);
  });

  it("returns nothing when no record carries a type", () => {
    expect(awardTypeOptions([award({ awardType: undefined })])).toEqual([]);
  });
});

describe("nextAwardStatus", () => {
  it("moves one working stage at a time up to Submitted", () => {
    expect(nextAwardStatus("Idea")).toBe("Gathering input");
    expect(nextAwardStatus("Gathering input")).toBe("Drafting");
    expect(nextAwardStatus("Drafting")).toBe("Ready for review");
    expect(nextAwardStatus("Ready for review")).toBe("Submitted");
  });

  it("offers nothing once submitted, decided, closed, or unrecognized", () => {
    for (const status of ["Submitted", "Approved", "Not selected", "Complete", "Cancelled", "Something else", ""]) {
      expect(nextAwardStatus(status)).toBeUndefined();
    }
  });

  it("only names stages the status list offers", () => {
    for (const stage of AWARD_PIPELINE) expect(AWARD_STATUSES).toContain(stage);
  });
});

describe("awardSteps", () => {
  const states = (status: string, due?: string) => awardSteps(status, due, "2026-11-13").map((s) => s.state);

  it("marks earlier stages done, the current one current, and the rest to do", () => {
    expect(states("Drafting")).toEqual(["done", "done", "current", "todo", "todo"]);
    expect(states("Idea")).toEqual(["current", "todo", "todo", "todo", "todo"]);
  });

  it("offers the next stage, and only that one, as the click", () => {
    const steps = awardSteps("Drafting", undefined, "2026-11-13");
    expect(steps.filter((s) => s.action).map((s) => [s.key, s.action])).toEqual([["Ready for review", "Move to Ready for review"]]);
  });

  it("marks the current stage late once the nomination is past due", () => {
    expect(states("Gathering input", "2026-11-01")).toEqual(["done", "late", "todo", "todo", "todo"]);
    expect(states("Gathering input", "2026-11-13")).toEqual(["done", "current", "todo", "todo", "todo"]);
  });

  it("shows submitted and decided awards as complete with nothing to click", () => {
    for (const status of ["Submitted", "Approved", "Not selected", "Complete"]) {
      const steps = awardSteps(status, "2026-01-01", "2026-11-13");
      expect(steps.every((s) => s.state === "done")).toBe(true);
      expect(steps.some((s) => s.action)).toBe(false);
    }
  });

  it("has no tracker for a cancelled or unknown status", () => {
    expect(awardSteps("Cancelled", undefined, "2026-11-13")).toEqual([]);
    expect(awardSteps("Something else", undefined, "2026-11-13")).toEqual([]);
  });
});

describe("citationLines and appendToDraft", () => {
  it("writes one line per input, oldest first, with the result when there is one", () => {
    const text = citationLines([
      { inputDate: "2026-09-01", actionOrAccomplishment: "Led the  migration", result: "Cut outages in half" },
      { inputDate: "2026-06-01", actionOrAccomplishment: "Trained three new hires" },
      { inputDate: "2026-07-01", actionOrAccomplishment: "" }
    ]);
    expect(text).toBe("- Trained three new hires\n- Led the migration Result: Cut outages in half");
  });

  it("appends after existing text and never replaces it", () => {
    expect(appendToDraft("Opening line.\n", "- One")).toBe("Opening line.\n\n- One");
    expect(appendToDraft(undefined, "- One")).toBe("- One");
    expect(appendToDraft("Keep me", "  ")).toBe("Keep me");
  });
});
