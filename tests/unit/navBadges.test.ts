import { describe, expect, it } from "vitest";
import type { LeaveRecord, TravelRecord } from "../../src/domain/models";
import type { AttentionItem } from "../../src/domain/rules/attention";
import { navBadges } from "../../src/domain/rules/navBadges";

const TODAY = "2026-07-20";

type Flag = Pick<AttentionItem, "entityType" | "entityId" | "reasonCode">;
const flag = (entityType: AttentionItem["entityType"], entityId: string, reasonCode: string): Flag => ({
  entityType,
  entityId,
  reasonCode
});

function leave(overrides: Partial<LeaveRecord> = {}): LeaveRecord {
  return {
    id: "l1",
    employeeId: "e1",
    startDate: "2026-07-27",
    endDate: "2026-07-29",
    status: "requested",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    ...overrides
  };
}

function trip(overrides: Partial<TravelRecord> = {}): TravelRecord {
  return {
    id: "t1",
    employeeId: "e1",
    destination: "Norfolk, VA",
    startDate: "2026-08-03",
    endDate: "2026-08-05",
    iptConcurrence: "concurred",
    dtsAuthorizationStatus: "approved",
    voucherDueDate: "2026-08-10",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    ...overrides
  };
}

function badges(
  ctx: { attention?: Flag[]; leaveRecords?: LeaveRecord[]; travelRecords?: TravelRecord[]; trainingOverdue?: number } = {}
) {
  return navBadges({
    today: TODAY,
    attention: ctx.attention ?? [],
    leaveRecords: ctx.leaveRecords ?? [],
    travelRecords: ctx.travelRecords ?? [],
    trainingOverdue: ctx.trainingOverdue ?? 0
  });
}

describe("navBadges", () => {
  it("shows no badge anywhere when nothing is waiting", () => {
    expect(badges({ leaveRecords: [leave({ status: "approved" })], travelRecords: [trip()] })).toEqual({});
  });

  it("counts overdue tasks on the board and ignores other task reasons", () => {
    const result = badges({
      attention: [flag("task", "a", "overdue"), flag("task", "b", "overdue"), flag("task", "c", "due_soon"), flag("task", "d", "stale")]
    });
    expect(result.board).toEqual({ count: 2, tone: "alert", description: "2 overdue tasks" });
  });

  it("uses the singular for one item", () => {
    expect(badges({ attention: [flag("task", "a", "overdue")] }).board?.description).toBe("1 overdue task");
  });

  it("shows the overdue training record count it is given, not the attention engine's folded lines", () => {
    // One aggregated attention line can stand for many people.
    const result = badges({ attention: [flag("training", "r1", "training_overdue")], trainingOverdue: 18 });
    expect(result.training).toEqual({ count: 18, tone: "alert", description: "18 training records overdue" });
    expect(badges({ attention: [flag("training", "r1", "training_overdue")] }).training).toBeUndefined();
  });

  it("counts requested leave that has not ended, and nothing else", () => {
    const result = badges({
      leaveRecords: [
        leave({ id: "a" }),
        leave({ id: "b", startDate: "2026-07-18", endDate: "2026-07-20" }),
        leave({ id: "c", startDate: "2026-07-10", endDate: "2026-07-12" }),
        leave({ id: "d", status: "approved" }),
        leave({ id: "e", status: "planned" })
      ]
    });
    expect(result.leave).toEqual({ count: 2, tone: "notice", description: "2 leave requests awaiting approval" });
  });

  it("separates telework decisions from expired agreements and alerts when either is late", () => {
    expect(badges({ attention: [flag("telework", "a", "telework_pending_action")] }).telework).toEqual({
      count: 1,
      tone: "notice",
      description: "1 request awaiting your decision"
    });
    expect(
      badges({
        attention: [
          flag("telework", "a", "telework_pending_action"),
          flag("telework", "b", "telework_pending_action"),
          flag("telework", "c", "telework_expired"),
          flag("telework", "d", "telework_expiring")
        ]
      }).telework
    ).toEqual({ count: 3, tone: "alert", description: "2 requests awaiting your decision, 1 agreement expired" });
  });

  it("counts a trip once, as late when a step is late and open when a voucher is owed", () => {
    const result = badges({
      travelRecords: [
        // On travel with paperwork still open: late.
        trip({ id: "late", startDate: "2026-07-19", endDate: "2026-07-22", iptConcurrence: "pending", dtsAuthorizationStatus: "created" }),
        // Back, voucher due in two days: open.
        trip({ id: "owed", startDate: "2026-07-13", endDate: "2026-07-17", voucherDueDate: "2026-07-22" }),
        // Upcoming and in order: nothing.
        trip({ id: "fine" }),
        // Cancelled and archived trips never count.
        trip({ id: "cancelled", tripStatus: "cancelled", startDate: "2026-07-19", endDate: "2026-07-22", iptConcurrence: "pending" }),
        trip({ id: "archived", isArchived: true, startDate: "2026-07-13", endDate: "2026-07-17", voucherDueDate: "2026-07-15" })
      ]
    });
    expect(result.travel).toEqual({
      count: 2,
      tone: "alert",
      description: "1 trip with a late step, 1 trip with paperwork open"
    });
  });

  it("adds a trip leaving soon with paperwork open, without double counting one already late", () => {
    const result = badges({
      attention: [flag("travel", "soon", "travel_paperwork_incomplete"), flag("travel", "late", "travel_paperwork_incomplete")],
      travelRecords: [
        trip({ id: "soon", startDate: "2026-07-23", endDate: "2026-07-25", iptConcurrence: "pending" }),
        trip({ id: "late", startDate: "2026-07-20", endDate: "2026-07-22", dtsAuthorizationStatus: "created" })
      ]
    });
    expect(result.travel).toEqual({
      count: 2,
      tone: "alert",
      description: "1 trip with a late step, 1 trip with paperwork open"
    });
  });

  it("counts overdue award nominations only", () => {
    const result = badges({
      attention: [flag("award", "a", "award_nomination_overdue"), flag("award", "b", "award_nomination_due_soon")]
    });
    expect(result.awards).toEqual({ count: 1, tone: "alert", description: "1 nomination overdue" });
  });
});
