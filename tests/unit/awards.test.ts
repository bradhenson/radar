import { describe, expect, it } from "vitest";
import type { AwardRecord } from "../../src/domain/models";
import { awardTypeOptions, filterAwards } from "../../src/domain/rules/awards";
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
