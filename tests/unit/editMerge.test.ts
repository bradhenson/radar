import { describe, expect, it } from "vitest";
import {
  mergeAwardEdit,
  mergeLeaveEdit,
  mergeProjectEdit,
  mergeTeleworkEdit,
  mergeTravelEdit,
  type EditContext
} from "../../src/domain/rules/editMerge";
import type { AwardRecord, LeaveRecord, Project, TeleworkRecord, TravelRecord } from "../../src/domain/models";

// Round-trip guarantee: opening a fully-populated record in its edit dialog
// and saving without changes must preserve every field (except updatedAt).
// This is the regression net for the "silent field loss" class of bugs where
// forms rebuilt records from visible fields only.

const ctx: EditContext = { id: "new-id", now: "2026-07-09T12:00:00.000Z" };

describe("mergeProjectEdit", () => {
  const full: Project = {
    id: "p1",
    name: "Radar Upgrade",
    shortName: "RU",
    description: "Long description",
    status: "active",
    startDate: "2026-01-05",
    targetEndDate: "2026-12-01",
    leadEmployeeId: "e1",
    competencyId: "c1",
    sourceSystem: "ERP",
    sourceReference: "ERP-1234",
    lastVerifiedDate: "2026-06-30",
    tags: ["priority"],
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    isArchived: false
  };

  // Extract exactly the fields the dialog exposes, the way openForm does.
  const formFields = (p: Project) => ({
    name: p.name,
    shortName: p.shortName ?? "",
    description: p.description ?? "",
    status: p.status,
    startDate: p.startDate ?? "",
    targetEndDate: p.targetEndDate ?? "",
    leadEmployeeId: p.leadEmployeeId ?? ""
  });

  it("round-trips a fully populated record without loss", () => {
    const merged = mergeProjectEdit(full, formFields(full), ctx);
    expect(merged).toEqual({ ...full, updatedAt: ctx.now });
  });

  it("preserves hidden fields when visible fields change", () => {
    const merged = mergeProjectEdit(full, { ...formFields(full), name: "Renamed" }, ctx);
    expect(merged.name).toBe("Renamed");
    expect(merged.competencyId).toBe("c1");
    expect(merged.sourceSystem).toBe("ERP");
    expect(merged.sourceReference).toBe("ERP-1234");
    expect(merged.lastVerifiedDate).toBe("2026-06-30");
    expect(merged.tags).toEqual(["priority"]);
  });

  it("creates a new record with defaults when no existing record is given", () => {
    const merged = mergeProjectEdit(undefined, formFields(full), ctx);
    expect(merged.id).toBe(ctx.id);
    expect(merged.createdAt).toBe(ctx.now);
    expect(merged.tags).toEqual([]);
    expect(merged.isArchived).toBe(false);
  });
});

describe("mergeAwardEdit", () => {
  const full: AwardRecord = {
    id: "a1",
    employeeId: "e1",
    awardType: "On-the-spot",
    title: "Great work",
    accomplishmentPeriodStart: "2026-01-01",
    accomplishmentPeriodEnd: "2026-03-31",
    nominationDueDate: "2026-08-01",
    submittedDate: "2026-07-01",
    decisionDate: "2026-07-05",
    status: "Submitted",
    citationDraft: "Citation text",
    supportingNotes: "Notes",
    projectId: "p1",
    relatedPerformanceInputIds: ["pi1", "pi2"],
    sourceReference: "SRC-9",
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  };

  const formFields = (a: AwardRecord) => ({
    employeeId: a.employeeId,
    title: a.title,
    awardType: a.awardType ?? "",
    status: a.status,
    nominationDueDate: a.nominationDueDate ?? "",
    supportingNotes: a.supportingNotes ?? ""
  });

  it("round-trips a fully populated record without loss", () => {
    const merged = mergeAwardEdit(full, formFields(full), ctx);
    expect(merged).toEqual({ ...full, updatedAt: ctx.now });
  });

  it("preserves accomplishment dates, citation, project, and source on edit", () => {
    const merged = mergeAwardEdit(full, { ...formFields(full), status: "Approved" }, ctx);
    expect(merged.status).toBe("Approved");
    expect(merged.accomplishmentPeriodStart).toBe("2026-01-01");
    expect(merged.accomplishmentPeriodEnd).toBe("2026-03-31");
    expect(merged.submittedDate).toBe("2026-07-01");
    expect(merged.decisionDate).toBe("2026-07-05");
    expect(merged.citationDraft).toBe("Citation text");
    expect(merged.projectId).toBe("p1");
    expect(merged.sourceReference).toBe("SRC-9");
    expect(merged.relatedPerformanceInputIds).toEqual(["pi1", "pi2"]);
  });
});

describe("mergeLeaveEdit", () => {
  const full: LeaveRecord = {
    id: "l1",
    employeeId: "e1",
    leaveType: "Annual",
    startDate: "2026-08-03",
    endDate: "2026-08-07",
    partialDay: "PM only on Friday",
    status: "approved",
    sourceSystem: "ERP",
    sourceReference: "LV-77",
    lastVerifiedDate: "2026-07-01",
    workloadImpactNote: "Coverage arranged",
    relatedTaskId: "t1",
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  };

  const formFields = (l: LeaveRecord) => ({
    employeeId: l.employeeId,
    leaveType: l.leaveType ?? "",
    startDate: l.startDate,
    endDate: l.endDate,
    status: l.status,
    workloadImpactNote: l.workloadImpactNote ?? ""
  });

  it("round-trips a fully populated record without loss", () => {
    const merged = mergeLeaveEdit(full, formFields(full), ctx);
    expect(merged).toEqual({ ...full, updatedAt: ctx.now });
  });

  it("preserves partial-day, related-task, and source fields on edit", () => {
    const merged = mergeLeaveEdit(full, { ...formFields(full), status: "changed" }, ctx);
    expect(merged.partialDay).toBe("PM only on Friday");
    expect(merged.relatedTaskId).toBe("t1");
    expect(merged.sourceSystem).toBe("ERP");
    expect(merged.sourceReference).toBe("LV-77");
    expect(merged.lastVerifiedDate).toBe("2026-07-01");
  });
});

describe("mergeTeleworkEdit", () => {
  const full: TeleworkRecord = {
    id: "tw1",
    employeeId: "e1",
    recordType: "Situational request",
    requestDate: "2026-07-01",
    effectiveDate: "2026-07-10",
    expirationDate: "2026-07-11",
    status: "approved",
    scheduleSummary: "Mon/Wed",
    sourceSystem: "Email",
    sourceReference: "MSG-1",
    lastVerifiedDate: "2026-07-02",
    relatedTaskId: "t1",
    notes: "Notes here",
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  };

  // The situational form passes the existing record's type (falling back to
  // its own fixed type for new records), matching the page's call site.
  const formFields = (t: TeleworkRecord) => ({
    employeeId: t.employeeId,
    recordType: t.recordType ?? "Situational request",
    status: t.status,
    requestDate: t.requestDate ?? "",
    effectiveDate: t.effectiveDate ?? "",
    expirationDate: t.expirationDate ?? "",
    notes: t.notes ?? ""
  });

  it("round-trips a fully populated record without loss", () => {
    const merged = mergeTeleworkEdit(full, formFields(full), ctx);
    expect(merged).toEqual({ ...full, updatedAt: ctx.now });
  });

  it("keeps the existing record type when editing", () => {
    const agreement = { ...full, recordType: "Agreement" };
    const merged = mergeTeleworkEdit(agreement, formFields(agreement), ctx);
    expect(merged.recordType).toBe("Agreement");
  });

  it("preserves schedule summary unless the form exposes it", () => {
    const untouched = mergeTeleworkEdit(full, formFields(full), ctx);
    expect(untouched.scheduleSummary).toBe("Mon/Wed");
    const updated = mergeTeleworkEdit(full, { ...formFields(full), scheduleSummary: "Tue only" }, ctx);
    expect(updated.scheduleSummary).toBe("Tue only");
    const cleared = mergeTeleworkEdit(full, { ...formFields(full), scheduleSummary: "  " }, ctx);
    expect(cleared.scheduleSummary).toBeUndefined();
  });
});

describe("mergeTravelEdit", () => {
  const full: TravelRecord = {
    id: "tr1",
    employeeId: "e1",
    destination: "Norfolk, VA",
    startDate: "2026-09-01",
    endDate: "2026-09-05",
    iptConcurrence: "concurred",
    dtsAuthorizationStatus: "approved",
    dtsAuthorizationId: "DTS-42",
    voucherDueDate: "2026-09-10",
    notes: "Conference",
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    isArchived: true
  };

  const formFields = (t: TravelRecord) => ({
    employeeId: t.employeeId,
    destination: t.destination,
    startDate: t.startDate,
    endDate: t.endDate,
    iptConcurrence: t.iptConcurrence,
    dtsAuthorizationStatus: t.dtsAuthorizationStatus,
    dtsAuthorizationId: t.dtsAuthorizationId ?? "",
    voucherDueDate: t.voucherDueDate ?? "",
    notes: t.notes ?? ""
  });

  it("round-trips a fully populated record without loss", () => {
    const merged = mergeTravelEdit(full, formFields(full), ctx);
    expect(merged).toEqual({ ...full, updatedAt: ctx.now });
  });

  it("preserves the archive flag on edit", () => {
    const merged = mergeTravelEdit(full, { ...formFields(full), destination: "San Diego, CA" }, ctx);
    expect(merged.isArchived).toBe(true);
  });
});
