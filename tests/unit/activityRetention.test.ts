import { describe, expect, it } from "vitest";
import { expiredActivityEntryIds } from "../../src/domain/rules/activityRetention";
import type { ActivityEntry } from "../../src/domain/models";

function entry(id: string, timestamp: string): ActivityEntry {
  return { id, entityType: "tasks", entityId: "t1", actionType: "updated", timestamp, summary: "x", sessionId: "s" };
}

describe("activity retention", () => {
  const today = "2026-07-18";

  it("returns ids strictly older than the cutoff", () => {
    const entries = [
      entry("old", "2025-07-17T10:00:00.000Z"), // 366 days before today
      entry("edge", "2025-07-18T23:59:59.000Z"), // exactly retention days old — kept
      entry("new", "2026-07-01T08:00:00.000Z")
    ];
    expect(expiredActivityEntryIds(entries, today, 365)).toEqual(["old"]);
  });

  it("disables pruning for zero or negative retention", () => {
    const entries = [entry("ancient", "2015-01-01T00:00:00.000Z")];
    expect(expiredActivityEntryIds(entries, today, 0)).toEqual([]);
    expect(expiredActivityEntryIds(entries, today, -5)).toEqual([]);
  });

  it("handles empty input", () => {
    expect(expiredActivityEntryIds([], today, 365)).toEqual([]);
  });
});
