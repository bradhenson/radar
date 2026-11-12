import { describe, expect, it } from "vitest";
import type { AwardRecord, TrainingRequirement, TravelRecord } from "../../src/domain/models";
import { awardFollowUpTask, trainingFollowUpTask, travelFollowUpTask } from "../../src/domain/rules/followUpTasks";

const TODAY = "2026-07-20";
const STAMP = { createdAt: "2026-07-01T00:00:00.000Z", updatedAt: "2026-07-01T00:00:00.000Z" };

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
    ...STAMP,
    ...overrides
  };
}

describe("travelFollowUpTask", () => {
  it("is the paperwork, due at departure, while an upcoming trip has paperwork open", () => {
    expect(travelFollowUpTask(trip({ iptConcurrence: "pending" }), "Avery Brooks", TODAY)).toEqual({
      title: "Travel paperwork: Avery Brooks to Norfolk, VA",
      dueDate: "2026-08-03",
      employeeId: "e1",
      tags: ["travel"]
    });
    expect(travelFollowUpTask(trip({ dtsAuthorizationStatus: "created" }), "Avery Brooks", TODAY)?.title).toMatch(/^Travel paperwork/);
  });

  it("is the voucher, due on the voucher date, once paperwork is done or the trip has started", () => {
    const expected = { title: "Travel voucher: Avery Brooks to Norfolk, VA", dueDate: "2026-08-10", employeeId: "e1", tags: ["travel"] };
    expect(travelFollowUpTask(trip(), "Avery Brooks", TODAY)).toEqual(expected);
    // Under way with paperwork still open: the voucher is what remains to plan for.
    const underway = trip({ startDate: "2026-07-19", endDate: "2026-07-22", voucherDueDate: "2026-07-27", iptConcurrence: "pending" });
    expect(travelFollowUpTask(underway, "Avery Brooks", TODAY)).toMatchObject({ title: expected.title, dueDate: "2026-07-27" });
  });

  it("offers nothing for a settled or cancelled trip", () => {
    expect(travelFollowUpTask(trip({ voucherStatus: "submitted" }), "Avery Brooks", TODAY)).toBeUndefined();
    expect(travelFollowUpTask(trip({ voucherStatus: "not_required" }), "Avery Brooks", TODAY)).toBeUndefined();
    expect(travelFollowUpTask(trip({ tripStatus: "cancelled", iptConcurrence: "pending" }), "Avery Brooks", TODAY)).toBeUndefined();
  });
});

describe("awardFollowUpTask", () => {
  const award: AwardRecord = {
    id: "a1",
    employeeId: "e1",
    title: "Team excellence",
    status: "Drafting",
    nominationDueDate: "2026-09-01",
    projectId: "p1",
    relatedPerformanceInputIds: [],
    ...STAMP
  };

  it("is the supervisor's own card: due on the nomination date, no assignee, nominee in the title", () => {
    const task = awardFollowUpTask(award, "Avery Brooks");
    expect(task).toEqual({
      title: "Award nomination: Team excellence (Avery Brooks)",
      dueDate: "2026-09-01",
      projectId: "p1",
      tags: ["award"]
    });
    expect(task).not.toHaveProperty("employeeId");
  });

  it("copes with no nominee name and no due date", () => {
    expect(awardFollowUpTask({ ...award, nominationDueDate: undefined }, "")).toMatchObject({
      title: "Award nomination: Team excellence",
      dueDate: undefined
    });
  });
});

describe("trainingFollowUpTask", () => {
  const requirement: TrainingRequirement = {
    id: "req1",
    name: "Annual Cybersecurity Awareness",
    dueDate: "2026-08-15",
    warningDays: [30],
    active: true,
    ...STAMP
  };

  it("names how many people are overdue and keeps a due date that is still ahead", () => {
    expect(trainingFollowUpTask(requirement, 5, TODAY)).toEqual({
      title: "Training: Annual Cybersecurity Awareness (5 overdue)",
      dueDate: "2026-08-15",
      tags: ["training"]
    });
  });

  it("drops a due date that has already passed rather than creating an overdue card", () => {
    expect(trainingFollowUpTask({ ...requirement, dueDate: "2026-07-01" }, 13, TODAY).dueDate).toBeUndefined();
  });

  it("falls back to the due date or a plain follow-up when nobody is overdue", () => {
    expect(trainingFollowUpTask(requirement, 0, TODAY).title).toBe("Training: Annual Cybersecurity Awareness (due Aug 15, 2026)");
    expect(trainingFollowUpTask({ ...requirement, dueDate: undefined }, 0, TODAY).title).toBe(
      "Training: Annual Cybersecurity Awareness (follow up)"
    );
  });
});
