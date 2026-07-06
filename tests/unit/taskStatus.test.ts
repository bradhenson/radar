import { describe, expect, it } from "vitest";
import { normalizeTaskStatus, statusLabel, TASK_STATUSES } from "../../src/domain/models";

describe("normalizeTaskStatus", () => {
  it("keeps the statuses domain rules act on", () => {
    expect(normalizeTaskStatus("open")).toBe("open");
    expect(normalizeTaskStatus("waiting")).toBe("waiting");
    expect(normalizeTaskStatus("complete")).toBe("complete");
    expect(normalizeTaskStatus("cancelled")).toBe("cancelled");
  });

  it("collapses legacy workflow-stage statuses into open", () => {
    for (const legacy of ["inbox", "planned", "in_progress", "needs_review"]) {
      expect(normalizeTaskStatus(legacy)).toBe("open");
    }
  });

  it("normalizes unknown values from imported data to open", () => {
    expect(normalizeTaskStatus("")).toBe("open");
    expect(normalizeTaskStatus("something-else")).toBe("open");
  });
});

describe("statusLabel", () => {
  it("labels every selectable status and cancelled", () => {
    for (const s of TASK_STATUSES) {
      expect(statusLabel(s.value)).toBe(s.label);
    }
    expect(statusLabel("cancelled")).toBe("Cancelled");
  });
});
