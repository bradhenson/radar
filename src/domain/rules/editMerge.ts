// Form-to-record merge rules for the simple record edit dialogs.
// Every edit dialog rebuilds its record through one of these functions so
// fields the form does not expose (import source metadata, linked records,
// archive flags, accomplishment details) survive the edit untouched.
// Round-trip tested in tests/unit/editMerge.test.ts.

import type {
  AwardRecord,
  IsoTimestamp,
  LeaveRecord,
  LeaveStatus,
  Project,
  ProjectStatus,
  TeleworkRecord,
  TeleworkStatus,
  TravelDtsAuthStatus,
  TravelIptConcurrence,
  TravelRecord
} from "../models";

/** Identity for a new record: pre-generated id plus the mutation timestamp. */
export interface EditContext {
  id: string;
  now: IsoTimestamp;
}

export interface ProjectEditFields {
  name: string;
  shortName: string;
  description: string;
  status: ProjectStatus;
  startDate: string;
  targetEndDate: string;
  leadEmployeeId: string;
}

export function mergeProjectEdit(existing: Project | undefined, f: ProjectEditFields, ctx: EditContext): Project {
  return {
    ...existing,
    id: existing?.id ?? ctx.id,
    name: f.name.trim(),
    shortName: f.shortName.trim() || undefined,
    description: f.description.trim() || undefined,
    status: f.status,
    startDate: f.startDate || undefined,
    targetEndDate: f.targetEndDate || undefined,
    leadEmployeeId: f.leadEmployeeId || undefined,
    tags: existing?.tags ?? [],
    createdAt: existing?.createdAt ?? ctx.now,
    updatedAt: ctx.now,
    isArchived: existing?.isArchived ?? false
  };
}

export interface AwardEditFields {
  employeeId: string;
  title: string;
  awardType: string;
  status: string;
  nominationDueDate: string;
  supportingNotes: string;
}

export function mergeAwardEdit(existing: AwardRecord | undefined, f: AwardEditFields, ctx: EditContext): AwardRecord {
  return {
    ...existing,
    id: existing?.id ?? ctx.id,
    employeeId: f.employeeId,
    title: f.title.trim(),
    awardType: f.awardType.trim() || undefined,
    status: f.status,
    nominationDueDate: f.nominationDueDate || undefined,
    supportingNotes: f.supportingNotes.trim() || undefined,
    relatedPerformanceInputIds: existing?.relatedPerformanceInputIds ?? [],
    createdAt: existing?.createdAt ?? ctx.now,
    updatedAt: ctx.now
  };
}

export interface LeaveEditFields {
  employeeId: string;
  /** Empty string means "not specified". */
  leaveType: string;
  startDate: string;
  endDate: string;
  status: LeaveStatus;
  workloadImpactNote: string;
}

export function mergeLeaveEdit(existing: LeaveRecord | undefined, f: LeaveEditFields, ctx: EditContext): LeaveRecord {
  return {
    ...existing,
    id: existing?.id ?? ctx.id,
    employeeId: f.employeeId,
    leaveType: f.leaveType || undefined,
    startDate: f.startDate,
    endDate: f.endDate,
    status: f.status,
    workloadImpactNote: f.workloadImpactNote.trim() || undefined,
    createdAt: existing?.createdAt ?? ctx.now,
    updatedAt: ctx.now
  };
}

export interface TeleworkEditFields {
  employeeId: string;
  /** Callers pass the existing record's type when the form doesn't expose it. */
  recordType: string;
  status: TeleworkStatus;
  requestDate: string;
  effectiveDate: string;
  expirationDate: string;
  notes: string;
  /** Only the agreement form exposes this; omit to preserve the stored value. */
  scheduleSummary?: string;
}

export function mergeTeleworkEdit(existing: TeleworkRecord | undefined, f: TeleworkEditFields, ctx: EditContext): TeleworkRecord {
  const record: TeleworkRecord = {
    ...existing,
    id: existing?.id ?? ctx.id,
    employeeId: f.employeeId,
    recordType: f.recordType,
    status: f.status,
    requestDate: f.requestDate || undefined,
    effectiveDate: f.effectiveDate || undefined,
    expirationDate: f.expirationDate || undefined,
    notes: f.notes.trim() || undefined,
    createdAt: existing?.createdAt ?? ctx.now,
    updatedAt: ctx.now
  };
  if (f.scheduleSummary !== undefined) record.scheduleSummary = f.scheduleSummary.trim() || undefined;
  return record;
}

export interface TravelEditFields {
  employeeId: string;
  destination: string;
  startDate: string;
  endDate: string;
  iptConcurrence: TravelIptConcurrence;
  dtsAuthorizationStatus: TravelDtsAuthStatus;
  dtsAuthorizationId: string;
  /** Already defaulted by the form (return + 5 days) when left blank. */
  voucherDueDate: string;
  notes: string;
}

export function mergeTravelEdit(existing: TravelRecord | undefined, f: TravelEditFields, ctx: EditContext): TravelRecord {
  return {
    ...existing,
    id: existing?.id ?? ctx.id,
    employeeId: f.employeeId,
    destination: f.destination.trim(),
    startDate: f.startDate,
    endDate: f.endDate,
    iptConcurrence: f.iptConcurrence,
    dtsAuthorizationStatus: f.dtsAuthorizationStatus,
    dtsAuthorizationId: f.dtsAuthorizationId.trim() || undefined,
    voucherDueDate: f.voucherDueDate || undefined,
    notes: f.notes.trim() || undefined,
    createdAt: existing?.createdAt ?? ctx.now,
    updatedAt: ctx.now
  };
}
