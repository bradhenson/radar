import { describe, expect, it } from "vitest";
import { parseCompletionPaste, readyCompletions, type CompletionPasteContext } from "../../src/domain/rules/trainingImport";

const employees = [
  { id: "e1", displayName: "Avery Brooks", preferredName: "Ave", sortName: "Brooks, Avery" },
  { id: "e2", displayName: "Riley Chen" },
  { id: "e3", displayName: "Pat O'Brien" },
  { id: "e4", displayName: "Jordan Kim" },
  { id: "e5", displayName: "Jordan Kim" },
  { id: "e6", displayName: "Morgan Patel" }
];

const ctx: CompletionPasteContext = {
  employees,
  applicableIds: new Set(["e1", "e2", "e3", "e4", "e5"]),
  defaultDate: "2026-07-18",
  today: "2026-07-20"
};

const parse = (text: string, overrides: Partial<CompletionPasteContext> = {}) => parseCompletionPaste(text, { ...ctx, ...overrides });
const summary = (text: string) => parse(text).map((l) => `${l.lineNumber}:${l.employeeId ?? "-"}:${l.date}:${l.problem ?? "ok"}`);

describe("parseCompletionPaste", () => {
  it("reads tab-separated rows copied from a spreadsheet, with US or ISO dates", () => {
    expect(summary("Avery Brooks\t7/14/2026\nRiley Chen\t2026-07-15")).toEqual(["1:e1:2026-07-14:ok", "2:e2:2026-07-15:ok"]);
  });

  it("uses the default date for a line with no date and says so", () => {
    const [line] = parse("Riley Chen");
    expect(line).toMatchObject({ employeeId: "e2", date: "2026-07-18", dateFromLine: false });
    expect(line!.problem).toBeUndefined();
  });

  it("matches Last, First order, a preferred name, and ignores case and punctuation", () => {
    expect(summary("Brooks, Avery, 7/14/26\nCHEN, RILEY\nave\npat obrien")).toEqual([
      "1:e1:2026-07-14:ok",
      "2:e2:2026-07-18:ok",
      "3:e1:2026-07-18:Listed more than once; the first line is used.",
      "4:e3:2026-07-18:ok"
    ]);
  });

  it("finds the date wherever it sits on the line and accepts other separators", () => {
    expect(summary('2026-07-10; Riley Chen\n"Avery Brooks" | 07.11.2026')).toEqual(["1:e2:2026-07-10:ok", "2:e1:2026-07-11:ok"]);
  });

  it("skips blank lines and a header row, keeping the original line numbers", () => {
    expect(summary("Name\tCompletion Date\n\nRiley Chen\t7/1/2026\n   \nEmployee\n")).toEqual(["3:e2:2026-07-01:ok"]);
  });

  it("never guesses: an unknown or partial name is reported", () => {
    const lines = parse("Avery\nRiley Chenn\nSomeone Else");
    expect(lines.map((l) => l.problem)).toEqual(["No employee has this name.", "No employee has this name.", "No employee has this name."]);
    expect(lines.every((l) => l.employeeId === undefined)).toBe(true);
  });

  it("reports a name shared by two employees rather than picking one", () => {
    const [shared] = parse("Jordan Kim");
    expect(shared!.problem).toBe("More than one employee has this name.");
    expect(shared!.employeeId).toBeUndefined();
  });

  it("reports impossible and future dates", () => {
    expect(parse("Riley Chen\t2/30/2026")[0]!.problem).toBe('"2/30/2026" is not a real date.');
    expect(parse("Riley Chen\t7/21/2026")[0]!.problem).toBe("The completion date is in the future.");
    // Today itself is fine.
    expect(parse("Riley Chen\t7/20/2026")[0]!.problem).toBeUndefined();
  });

  it("reports an employee the requirement does not apply to", () => {
    expect(parse("Morgan Patel")[0]).toMatchObject({ employeeId: "e6", problem: "This requirement does not apply to this employee." });
  });

  it("reports a line that has only a date", () => {
    expect(parse("7/14/2026")[0]!.problem).toBe("No name on this line.");
  });

  it("returns nothing for empty text", () => {
    expect(parse("")).toEqual([]);
    expect(parse("\n\n  \n")).toEqual([]);
  });
});

describe("readyCompletions", () => {
  it("keeps only the lines that will be recorded", () => {
    const ready = readyCompletions(parse("Avery Brooks\t7/14/2026\nNobody Here\nRiley Chen\nRiley Chen\t7/1/2026"));
    expect(ready.map((l) => [l.employeeId, l.date])).toEqual([
      ["e1", "2026-07-14"],
      ["e2", "2026-07-18"]
    ]);
  });
});
