import { describe, expect, it } from "vitest";
import { humanizeCode } from "../../src/utils/labels";

describe("humanizeCode", () => {
  it("turns stored codes into sentence-case labels", () => {
    expect(humanizeCode("on_hold")).toBe("On hold");
    expect(humanizeCode("used_midyear")).toBe("Used midyear");
    expect(humanizeCode("active")).toBe("Active");
    expect(humanizeCode("pending_supervisor")).toBe("Pending supervisor");
  });

  it("leaves empty values empty", () => {
    expect(humanizeCode("")).toBe("");
    expect(humanizeCode(undefined)).toBe("");
    expect(humanizeCode(null)).toBe("");
  });
});
