import { describe, expect, it } from "vitest";
import { laneForStatus, statusChangeForLaneMove } from "../../src/domain/rules/laneStatus";

const TODAY = "2026-07-09";
const NOW = "2026-07-09T12:00:00.000Z";

describe("statusChangeForLaneMove", () => {
  const openTask = { status: "open" as const, completedDate: undefined, waitingSince: undefined };

  it("marks a task complete when dropped in a complete-mapped lane", () => {
    const change = statusChangeForLaneMove(openTask, { mapsToStatus: "complete" }, TODAY, NOW);
    expect(change).toEqual({ status: "complete", completedDate: TODAY });
  });

  it("starts the waiting clock when dropped in a waiting-mapped lane", () => {
    const change = statusChangeForLaneMove(openTask, { mapsToStatus: "waiting" }, TODAY, NOW);
    expect(change).toEqual({ status: "waiting", waitingSince: NOW });
  });

  it("reopens a completed task moved back to an open-mapped lane", () => {
    const change = statusChangeForLaneMove(
      { status: "complete", completedDate: "2026-07-01", waitingSince: undefined },
      { mapsToStatus: "open" },
      TODAY,
      NOW
    );
    expect(change).toEqual({ status: "open", completedDate: undefined, waitingSince: undefined });
  });

  it("clears the waiting clock when a waiting task moves to an open-mapped lane", () => {
    const change = statusChangeForLaneMove(
      { status: "waiting", completedDate: undefined, waitingSince: "2026-06-01T00:00:00.000Z" },
      { mapsToStatus: "open" },
      TODAY,
      NOW
    );
    expect(change).toEqual({ status: "open", completedDate: undefined, waitingSince: undefined });
  });

  it("does nothing for unmapped custom lanes", () => {
    expect(statusChangeForLaneMove(openTask, { mapsToStatus: undefined }, TODAY, NOW)).toBeUndefined();
    expect(statusChangeForLaneMove(openTask, undefined, TODAY, NOW)).toBeUndefined();
  });

  it("does nothing when the lane already matches the status", () => {
    expect(statusChangeForLaneMove(openTask, { mapsToStatus: "open" }, TODAY, NOW)).toBeUndefined();
  });

  it("never overrides a cancelled task", () => {
    const cancelled = { status: "cancelled" as const, completedDate: undefined, waitingSince: undefined };
    expect(statusChangeForLaneMove(cancelled, { mapsToStatus: "complete" }, TODAY, NOW)).toBeUndefined();
  });
});

describe("laneForStatus", () => {
  const columns = [
    { id: "done2", mapsToStatus: "complete" as const, sortOrder: 50 },
    { id: "inbox", mapsToStatus: "open" as const, sortOrder: 10 },
    { id: "done", mapsToStatus: "complete" as const, sortOrder: 40 },
    { id: "custom", mapsToStatus: undefined, sortOrder: 20 }
  ];

  it("returns the first matching lane by sort order", () => {
    expect(laneForStatus(columns, "complete")?.id).toBe("done");
    expect(laneForStatus(columns, "open")?.id).toBe("inbox");
  });

  it("returns undefined when no lane maps to the status", () => {
    expect(laneForStatus(columns, "waiting")).toBeUndefined();
  });
});
