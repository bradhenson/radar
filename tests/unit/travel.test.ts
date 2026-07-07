import { describe, expect, it } from "vitest";
import { travelVoucherDueDate, VOUCHER_DUE_DAYS_AFTER_RETURN } from "../../src/domain/rules/travel";

describe("travelVoucherDueDate", () => {
  it("is five days after the return date", () => {
    expect(VOUCHER_DUE_DAYS_AFTER_RETURN).toBe(5);
    expect(travelVoucherDueDate("2026-07-09")).toBe("2026-07-14");
  });

  it("uses date-only math across a month boundary", () => {
    expect(travelVoucherDueDate("2026-07-29")).toBe("2026-08-03");
  });

  it("uses date-only math across a year boundary", () => {
    expect(travelVoucherDueDate("2026-12-30")).toBe("2027-01-04");
  });
});
