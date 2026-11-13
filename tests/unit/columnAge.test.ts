import { describe, expect, it } from "vitest";
import type { Task } from "../../src/domain/models";
import { staleColumnDays, withColumnEntry } from "../../src/domain/rules/columnAge";

const EARLIER = "2026-07-01T09:00:00.000Z";
const NOW = "2026-07-20T15:00:00.000Z";

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: "t1",
    title: "Task",
    status: "open",
    priority: "normal",
    performanceInputCreated: false,
    tags: [],
    boardOrder: 1,
    createdAt: EARLIER,
    updatedAt: EARLIER,
    isArchived: false,
    ...overrides
  };
}

describe("withColumnEntry", () => {
  it("stamps a new task that has no time yet", () => {
    expect(withColumnEntry(undefined, undefined, task(), "inbox", NOW).columnEnteredAt).toBe(NOW);
  });

  it("keeps the time a new task already carries", () => {
    expect(withColumnEntry(undefined, undefined, task({ columnEnteredAt: EARLIER }), "inbox", NOW).columnEnteredAt).toBe(EARLIER);
  });

  it("keeps the time when the column does not change", () => {
    const prev = task({ columnEnteredAt: EARLIER });
    const next = task({ columnEnteredAt: EARLIER, title: "Renamed" });
    expect(withColumnEntry(prev, "inbox", next, "inbox", NOW).columnEnteredAt).toBe(EARLIER);
  });

  it("stamps a move to another column", () => {
    const prev = task({ columnEnteredAt: EARLIER });
    expect(withColumnEntry(prev, "inbox", task({ columnEnteredAt: EARLIER }), "doing", NOW).columnEnteredAt).toBe(NOW);
  });

  it("stamps the first move of a task saved before the time was recorded", () => {
    expect(withColumnEntry(task(), "inbox", task(), "doing", NOW).columnEnteredAt).toBe(NOW);
  });

  it("leaves a time the caller set itself, so Undo restores the earlier age", () => {
    const moved = task({ columnEnteredAt: NOW });
    const restored = task({ columnEnteredAt: EARLIER });
    expect(withColumnEntry(moved, "doing", restored, "inbox", "2026-07-21T00:00:00.000Z").columnEnteredAt).toBe(EARLIER);
    const restoredUnknown = task();
    expect(withColumnEntry(moved, "doing", restoredUnknown, "inbox", "2026-07-21T00:00:00.000Z").columnEnteredAt).toBeUndefined();
  });
});

describe("staleColumnDays", () => {
  it("is undefined until the card has been in the column for the threshold", () => {
    expect(staleColumnDays({ columnEnteredAt: "2026-07-15T12:00:00.000Z" }, "2026-07-20", 14)).toBeUndefined();
  });

  it("returns whole days once the threshold is reached", () => {
    expect(staleColumnDays({ columnEnteredAt: "2026-07-06T12:00:00.000Z" }, "2026-07-20", 14)).toBe(14);
    expect(staleColumnDays({ columnEnteredAt: "2026-06-20T12:00:00.000Z" }, "2026-07-20", 14)).toBe(30);
  });

  it("never guesses an age for a task without a recorded time", () => {
    expect(staleColumnDays({}, "2026-07-20", 1)).toBeUndefined();
  });

  it("is off when the threshold is zero", () => {
    expect(staleColumnDays({ columnEnteredAt: "2026-01-01T12:00:00.000Z" }, "2026-07-20", 0)).toBeUndefined();
  });
});
