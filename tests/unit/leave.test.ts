import { describe, expect, it } from "vitest";
import type { LeaveRecord } from "../../src/domain/models";
import { groupLeave, leavePhase, peopleOutOn } from "../../src/domain/rules/leave";

const TODAY = "2026-11-13";
const TS = "2026-10-01T12:00:00.000Z";
const leave = (id: string, start: string, end: string, p: Partial<LeaveRecord> = {}): LeaveRecord => ({
  id, employeeId: "e1", startDate: start, endDate: end, status: "approved", createdAt: TS, updatedAt: TS, ...p
});

describe("leavePhase", () => {
  it("puts a request waiting on a decision first, whatever its dates", () => {
    expect(leavePhase(leave("a", "2026-12-01", "2026-12-02", { status: "requested" }), TODAY)).toBe("requested");
    expect(leavePhase(leave("b", "2026-11-01", "2026-11-02", { status: "requested" }), TODAY)).toBe("requested");
  });

  it("sorts the rest by the calendar, with cancelled apart", () => {
    expect(leavePhase(leave("now", "2026-11-12", "2026-11-14"), TODAY)).toBe("out_now");
    expect(leavePhase(leave("today", "2026-11-13", "2026-11-13"), TODAY)).toBe("out_now");
    expect(leavePhase(leave("next", "2026-11-14", "2026-11-15", { status: "planned" }), TODAY)).toBe("upcoming");
    expect(leavePhase(leave("done", "2026-11-01", "2026-11-12"), TODAY)).toBe("past");
    expect(leavePhase(leave("x", "2026-11-14", "2026-11-15", { status: "cancelled" }), TODAY)).toBe("cancelled");
  });

  it("reads an end before the start as a one-day absence", () => {
    expect(leavePhase(leave("odd", "2026-11-13", "2026-11-10"), TODAY)).toBe("out_now");
  });
});

describe("groupLeave", () => {
  it("orders groups and the records inside them", () => {
    const groups = groupLeave(
      [
        leave("past-old", "2026-10-01", "2026-10-02"),
        leave("up-late", "2026-12-10", "2026-12-11"),
        leave("now-long", "2026-11-10", "2026-11-20"),
        leave("req", "2026-12-01", "2026-12-01", { status: "requested" }),
        leave("past-new", "2026-11-05", "2026-11-06"),
        leave("up-soon", "2026-11-20", "2026-11-21"),
        leave("now-short", "2026-11-12", "2026-11-14")
      ],
      TODAY
    );
    expect(groups.map((g) => g.phase)).toEqual(["requested", "out_now", "upcoming", "past"]);
    expect(groups[1]!.records.map((r) => r.id)).toEqual(["now-short", "now-long"]);
    expect(groups[2]!.records.map((r) => r.id)).toEqual(["up-soon", "up-late"]);
    expect(groups[3]!.records.map((r) => r.id)).toEqual(["past-new", "past-old"]);
  });
});

describe("peopleOutOn", () => {
  it("counts each person once and ignores cancelled leave", () => {
    const records = [
      leave("a", "2026-11-12", "2026-11-14", { employeeId: "e1" }),
      leave("b", "2026-11-13", "2026-11-13", { employeeId: "e1" }),
      leave("c", "2026-11-13", "2026-11-15", { employeeId: "e2" }),
      leave("d", "2026-11-13", "2026-11-13", { employeeId: "e3", status: "cancelled" })
    ];
    expect(peopleOutOn(records, "2026-11-13")).toBe(2);
    expect(peopleOutOn(records, "2026-11-15")).toBe(1);
    expect(peopleOutOn(records, "2026-11-16")).toBe(0);
  });
});
