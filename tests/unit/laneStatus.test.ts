import { describe, expect, it } from "vitest";
import { statusChangeForLaneMove } from "../../src/domain/rules/laneStatus";

const NOW = "2026-07-09T12:00:00.000Z";

describe("statusChangeForLaneMove", () => {
  const openTask = { status: "open" as const, completedDate: undefined, waitingSince: undefined };

  it("ignores retired complete mappings so lane movement never finishes work", () => {
    const change = statusChangeForLaneMove(openTask, { mapsToStatus: "complete" }, NOW);
    expect(change).toBeUndefined();
  });

  it("starts the waiting clock when dropped in a waiting-mapped lane", () => {
    const change = statusChangeForLaneMove(openTask, { mapsToStatus: "waiting" }, NOW);
    expect(change).toEqual({ status: "waiting", waitingSince: NOW });
  });

  it("reopens a completed task moved back to an open-mapped lane", () => {
    const change = statusChangeForLaneMove(
      { status: "complete", completedDate: "2026-07-01", waitingSince: undefined },
      { mapsToStatus: "open" },
      NOW
    );
    expect(change).toEqual({ status: "open", completedDate: undefined, waitingSince: undefined });
  });

  it("clears the waiting clock when a waiting task moves to an open-mapped lane", () => {
    const change = statusChangeForLaneMove(
      { status: "waiting", completedDate: undefined, waitingSince: "2026-06-01T00:00:00.000Z" },
      { mapsToStatus: "open" },
      NOW
    );
    expect(change).toEqual({ status: "open", completedDate: undefined, waitingSince: undefined });
  });

  it("does nothing for unmapped custom lanes", () => {
    expect(statusChangeForLaneMove(openTask, { mapsToStatus: undefined }, NOW)).toBeUndefined();
    expect(statusChangeForLaneMove(openTask, undefined, NOW)).toBeUndefined();
  });

  it("does nothing when the lane already matches the status", () => {
    expect(statusChangeForLaneMove(openTask, { mapsToStatus: "open" }, NOW)).toBeUndefined();
  });

  it("never overrides a cancelled task", () => {
    const cancelled = { status: "cancelled" as const, completedDate: undefined, waitingSince: undefined };
    expect(statusChangeForLaneMove(cancelled, { mapsToStatus: "complete" }, NOW)).toBeUndefined();
  });
});
