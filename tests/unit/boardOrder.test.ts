import { describe, expect, it } from "vitest";
import { needsRenormalize, orderBetween, orderForAppend, renormalizedOrders, ORDER_GAP } from "../../src/domain/rules/boardOrder";

describe("board ordering", () => {
  it("appends with a gap", () => {
    expect(orderForAppend([])).toBe(ORDER_GAP);
    expect(orderForAppend([1000, 2000])).toBe(3000);
  });

  it("inserts between neighbors", () => {
    expect(orderBetween(1000, 2000)).toBe(1500);
    expect(orderBetween(undefined, 1000)).toBe(0);
    expect(orderBetween(3000, undefined)).toBe(4000);
    expect(orderBetween(undefined, undefined)).toBe(ORDER_GAP);
  });

  it("detects collapsed gaps", () => {
    expect(needsRenormalize([1000, 2000, 3000])).toBe(false);
    expect(needsRenormalize([1000, 1000 + 1e-9])).toBe(true);
  });

  it("renormalizes with even spacing", () => {
    expect(renormalizedOrders(3)).toEqual([1000, 2000, 3000]);
  });

  it("supports many repeated insertions at the same point before renormalizing", () => {
    let low = 1000;
    let high = 2000;
    let count = 0;
    while (!needsRenormalize([low, high]) && count < 100) {
      high = orderBetween(low, high);
      count++;
    }
    expect(count).toBeGreaterThan(20); // plenty of headroom before rewrite
  });
});
