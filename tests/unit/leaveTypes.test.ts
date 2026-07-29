import { describe, expect, it } from "vitest";
import { LEAVE_TYPES } from "../../src/domain/models";

describe("leave type options", () => {
  it("includes time-accounting availability categories", () => {
    expect(LEAVE_TYPES).toContain("Travel Comp");
    expect(LEAVE_TYPES).toContain("Scheduled Overtime");
    expect(LEAVE_TYPES).toContain("Non-Scheduled Overtime");
  });

  it("keeps Not specified available as the optional fallback", () => {
    expect(LEAVE_TYPES.at(-1)).toBe("Not specified");
  });
});
