import { describe, expect, it } from "vitest";
import { toCsv } from "../../src/utils/csv";

describe("toCsv", () => {
  it("quotes every value and doubles embedded quotes", () => {
    const csv = toCsv(["A", "B"], [['He said "hi"', "x,y"]]);
    expect(csv).toBe('"A","B"\r\n"He said ""hi""","x,y"');
  });

  it("renders undefined as an empty quoted cell", () => {
    expect(toCsv(["A"], [[undefined]])).toBe('"A"\r\n""');
  });

  it("neutralizes spreadsheet formula prefixes in strings", () => {
    const csv = toCsv(["A"], [["=1+1"], ["+SUM(A1)"], ["-2+3"], ["@cmd"], ["\tX"], ["\rX"]]);
    const lines = csv.split("\r\n").slice(1);
    expect(lines[0]).toBe('"\'=1+1"');
    expect(lines[1]).toBe('"\'+SUM(A1)"');
    expect(lines[2]).toBe('"\'-2+3"');
    expect(lines[3]).toBe('"\'@cmd"');
    expect(lines[4]).toBe('"\'\tX"');
    expect(lines[5]).toBe('"\'\rX"');
  });

  it("does not alter numbers, dates, or ordinary text", () => {
    const csv = toCsv(["A", "B", "C"], [[-5, "2026-07-09", "plain text"]]);
    expect(csv.split("\r\n")[1]).toBe('"-5","2026-07-09","plain text"');
  });
});
