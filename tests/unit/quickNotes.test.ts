import { describe, expect, it } from "vitest";
import { quickNotePurposeLabel, quickNoteTitle } from "../../src/domain/rules/quickNotes";

describe("quick note presentation rules", () => {
  it("derives a concise plain-text title from formatted content", () => {
    expect(quickNoteTitle("## Decision\n\nKeep the **weekly review** focused.")).toBe(
      "Decision Keep the weekly review focused."
    );
  });

  it("truncates long note titles and handles blank content", () => {
    expect(quickNoteTitle("abcdefghijk", 8)).toBe("abcdefg…");
    expect(quickNoteTitle("   ")).toBe("Untitled note");
  });

  it("uses readable labels for every non-prose purpose", () => {
    expect(quickNotePurposeLabel("follow_up")).toBe("Follow-up");
    expect(quickNotePurposeLabel("reference")).toBe("Reference");
  });
});
