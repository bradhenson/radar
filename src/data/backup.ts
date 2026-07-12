// Backup package export/import/validation (plan sections 10 and 26).
// All imported data is untrusted: parsed with size limits, migrated through
// explicit per-version steps, checked against per-collection runtime schemas
// (required fields, enums, dates, timestamps, arrays, booleans, numbers),
// verified against the recorded integrity counts and checksum, and only then
// accepted. The UI always renders imported text as text.

import { DEFAULT_SETTINGS, EMPLOYEE_PROFILE_FIELD_TYPES, normalizeAppSettings, type AppSettings } from "../domain/models";
import { isValidIsoDate } from "../utils/dates";
import { COLLECTION_NAMES, emptyCollections, type CollectionName, type DatabaseSnapshot } from "./DataStore";

export const BACKUP_FORMAT = "SupervisorAssistantBackup";
// v2: integrity checksum; required arrays/booleans/enums validated strictly.
// v3: retired task follow-up/wait-detail fields are removed on import.
// Older backups are migrated on import.
export const BACKUP_FORMAT_VERSION = 3;
export const APPLICATION_VERSION = "0.1.0";

/** Hard ceiling on accepted backup file size (characters of JSON text). */
export const MAX_BACKUP_CHARS = 64 * 1024 * 1024;
/** Hard ceiling on records accepted in any one collection. */
export const MAX_RECORDS_PER_COLLECTION = 200_000;

export interface BackupPackage {
  format: typeof BACKUP_FORMAT;
  formatVersion: number;
  applicationVersion: string;
  exportedAt: string;
  databaseId: string;
  data: { [K in CollectionName]: unknown[] } & { settings: AppSettings };
  integrity: { recordCounts: Record<string, number>; checksum?: string };
}

const RETIRED_TASK_FIELDS = ["waitingOn", "waitingReason", "followUpDate"] as const;

/** Omit retired task fields from exports and restored snapshots. */
function stripRetiredTaskFields(tasks: readonly unknown[]): unknown[] {
  return tasks.map((task) => {
    if (typeof task !== "object" || task === null || Array.isArray(task)) return task;
    const cleaned = { ...(task as Record<string, unknown>) };
    for (const field of RETIRED_TASK_FIELDS) delete cleaned[field];
    return cleaned;
  });
}

/** Remove retired data from every import, including a malformed current-version backup. */
function stripRetiredTaskFieldsFromImport(data: Record<string, unknown>, warnings: string[]): void {
  const tasks = data.tasks;
  if (!Array.isArray(tasks)) return;

  let removed = 0;
  for (const task of tasks) {
    if (typeof task !== "object" || task === null || Array.isArray(task)) continue;
    const record = task as Record<string, unknown>;
    for (const field of RETIRED_TASK_FIELDS) {
      if (field in record) {
        delete record[field];
        removed++;
      }
    }
  }
  if (removed > 0) {
    warnings.push(`${removed} retired task field value(s) were removed during import.`);
  }
}

/** FNV-1a 32-bit hash of the serialized data section (corruption detection). */
export function backupChecksum(serializedData: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < serializedData.length; i++) {
    hash ^= serializedData.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function createBackupPackage(snapshot: DatabaseSnapshot): BackupPackage {
  const data = {} as BackupPackage["data"];
  const recordCounts: Record<string, number> = {};
  for (const name of COLLECTION_NAMES) {
    (data as Record<string, unknown>)[name] =
      name === "tasks" ? stripRetiredTaskFields(snapshot.collections.tasks) : snapshot.collections[name];
    recordCounts[name] = snapshot.collections[name].length;
  }
  data.settings = snapshot.settings;
  return {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    applicationVersion: APPLICATION_VERSION,
    exportedAt: new Date().toISOString(),
    databaseId: snapshot.meta.databaseId,
    data,
    integrity: { recordCounts, checksum: backupChecksum(JSON.stringify(data)) }
  };
}

// ---------------------------------------------------------------------------
// Runtime schemas

// Fields that must be non-empty strings on every record of a collection.
const REQUIRED_STRING_FIELDS: Partial<Record<CollectionName, string[]>> = {
  employees: ["id", "displayName", "activeStatus"],
  competencies: ["id", "code"],
  projects: ["id", "name", "status"],
  tasks: ["id", "title", "status", "priority"],
  boardColumns: ["id", "label"],
  taskNotes: ["id", "taskId", "body"],
  checklistItems: ["id", "taskId", "title"],
  performanceElements: ["id", "name"],
  evaluationCycles: ["id", "name", "startDate", "endDate"],
  performanceInputs: ["id", "employeeId", "inputDate", "actionOrAccomplishment"],
  trainingRequirements: ["id", "name"],
  employeeTrainingRecords: ["id", "employeeId", "trainingRequirementId", "status"],
  leaveRecords: ["id", "employeeId", "startDate", "endDate", "status"],
  teleworkRecords: ["id", "employeeId", "recordType", "status"],
  travelRecords: ["id", "employeeId", "destination", "startDate", "endDate"],
  awardRecords: ["id", "employeeId", "title", "status"],
  employeeInteractions: ["id", "employeeId", "interactionDate", "interactionType"],
  employeeNotes: ["id", "employeeId", "noteText"],
  meetingNotes: ["id", "meetingDate", "title", "meetingType"],
  activityEntries: ["id", "entityType", "entityId", "actionType", "timestamp"],
  attentionSnoozes: ["id", "snoozedUntil"]
};

// Arrays of strings that must be present (filled by the v1 migration).
const REQUIRED_STRING_ARRAY_FIELDS: Partial<Record<CollectionName, string[]>> = {
  employees: ["tags"],
  projects: ["tags"],
  tasks: ["tags"],
  performanceInputs: ["tags"],
  awardRecords: ["relatedPerformanceInputIds"],
  meetingNotes: ["attendeeEmployeeIds"]
};

const DATE_FIELDS: Partial<Record<CollectionName, string[]>> = {
  tasks: ["startDate", "dueDate", "reminderDate", "completedDate", "lastVerifiedDate"],
  employees: ["startDate", "lastCheckInDate", "teleworkAgreementValidThrough"],
  projects: ["startDate", "targetEndDate", "lastVerifiedDate"],
  evaluationCycles: ["startDate", "endDate", "midyearDate"],
  performanceInputs: ["inputDate"],
  trainingRequirements: ["dueDate"],
  employeeTrainingRecords: ["assignedDate", "dueDate", "completedDate", "expirationDate", "lastVerifiedDate"],
  leaveRecords: ["startDate", "endDate", "lastVerifiedDate"],
  teleworkRecords: ["requestDate", "effectiveDate", "expirationDate", "lastVerifiedDate"],
  travelRecords: ["startDate", "endDate", "voucherDueDate"],
  awardRecords: ["accomplishmentPeriodStart", "accomplishmentPeriodEnd", "nominationDueDate", "submittedDate", "decisionDate"],
  meetingNotes: ["meetingDate"],
  employeeInteractions: ["interactionDate"],
  attentionSnoozes: ["snoozedUntil"]
};

// Required ISO timestamps (createdAt/updatedAt and friends).
const TIMESTAMP_FIELDS: Partial<Record<CollectionName, string[]>> = {
  competencies: ["createdAt", "updatedAt"],
  employees: ["createdAt", "updatedAt"],
  projects: ["createdAt", "updatedAt"],
  tasks: ["createdAt", "updatedAt"],
  boardColumns: ["createdAt", "updatedAt"],
  taskNotes: ["createdAt", "updatedAt"],
  performanceInputs: ["createdAt", "updatedAt"],
  trainingRequirements: ["createdAt", "updatedAt"],
  employeeTrainingRecords: ["createdAt", "updatedAt"],
  leaveRecords: ["createdAt", "updatedAt"],
  teleworkRecords: ["createdAt", "updatedAt"],
  travelRecords: ["createdAt", "updatedAt"],
  awardRecords: ["createdAt", "updatedAt"],
  employeeInteractions: ["createdAt", "updatedAt"],
  employeeNotes: ["createdAt", "updatedAt"],
  meetingNotes: ["createdAt", "updatedAt"],
  activityEntries: ["timestamp"]
};

// Optional ISO timestamps validated only when present.
const OPTIONAL_TIMESTAMP_FIELDS: Partial<Record<CollectionName, string[]>> = {
  checklistItems: ["completedAt"],
  tasks: ["waitingSince"]
};

// Allowed values per enum-typed field. Task statuses include the legacy
// workflow stages, which normalizeTaskStatus collapses to "open" on load.
const ENUM_FIELDS: Partial<Record<CollectionName, Record<string, readonly string[]>>> = {
  employees: {
    activeStatus: ["active", "temporary_inactive", "departed", "archived"]
  },
  projects: {
    status: ["proposed", "active", "on_hold", "complete", "cancelled", "archived"]
  },
  tasks: {
    status: ["open", "waiting", "complete", "cancelled", "inbox", "planned", "in_progress", "needs_review"],
    priority: ["low", "normal", "high", "critical"]
  },
  performanceInputs: {
    inputStatus: ["draft", "ready", "used_midyear", "used_annual", "archived"]
  },
  employeeTrainingRecords: {
    status: ["assigned", "complete", "not_applicable", "waived", "unknown"]
  },
  leaveRecords: {
    status: ["planned", "requested", "approved", "changed", "cancelled", "complete", "unknown"]
  },
  teleworkRecords: {
    status: [
      "draft", "pending", "pending_employee", "pending_supervisor", "pending_approval",
      "approved", "active", "expired", "denied", "cancelled"
    ]
  },
  travelRecords: {
    iptConcurrence: ["pending", "concurred", "not_required"],
    dtsAuthorizationStatus: ["not_started", "created", "approved"]
  }
};

// Optional enum fields validated only when present.
const OPTIONAL_ENUM_FIELDS: Partial<Record<CollectionName, Record<string, readonly string[]>>> = {
  boardColumns: {
    mapsToStatus: ["open", "waiting", "complete", "cancelled"]
  },
  employees: {
    computerAsset: ["rdte", "nmci"],
    clearance: ["s", "ts", "ts_sci"]
  },
  trainingRequirements: {
    recurrenceType: ["none", "days", "months", "annual"],
    assignmentScope: ["all", "selected"]
  },
  tasks: {
    verificationStatus: ["not_required", "unverified", "verified", "needs_recheck"],
    showOnCard: ["description", "checklist"]
  }
};

// Required finite-number fields.
const NUMBER_FIELDS: Partial<Record<CollectionName, string[]>> = {
  tasks: ["boardOrder"],
  boardColumns: ["sortOrder"],
  checklistItems: ["order"]
};

// Required boolean fields.
const BOOLEAN_FIELDS: Partial<Record<CollectionName, string[]>> = {
  competencies: ["active"],
  employees: ["isArchived"],
  projects: ["isArchived"],
  tasks: ["performanceInputCreated", "isArchived"],
  checklistItems: ["isComplete"],
  performanceElements: ["active"],
  evaluationCycles: ["active"],
  performanceInputs: ["recognitionPotential", "isArchived"],
  trainingRequirements: ["active"],
  employeeInteractions: ["followUpRequired"],
  employeeNotes: ["isArchived"],
  meetingNotes: ["isArchived"]
};

function isParseableTimestamp(v: unknown): boolean {
  return typeof v === "string" && v.length > 0 && !Number.isNaN(Date.parse(v));
}

// ---------------------------------------------------------------------------
// Validation

export interface BackupValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  /** Present when valid. */
  package?: BackupPackage;
  recordCounts: Record<string, number>;
  exportedAt?: string;
  applicationVersion?: string;
  databaseId?: string;
}

/** Test-only knobs; production callers use the defaults. */
export interface BackupValidationLimits {
  maxChars?: number;
  maxRecordsPerCollection?: number;
}

// ---------------------------------------------------------------------------
// Migrations. Each step upgrades exactly one version and records what it did.

function migrateV1toV2(data: Record<string, unknown>, warnings: string[]): void {
  // v1 tolerated missing collections and missing required arrays; fill both
  // with safe defaults so the strict v2 schema accepts intact v1 backups.
  let filledArrays = 0;
  for (const name of COLLECTION_NAMES) {
    if (data[name] === undefined) {
      warnings.push(`Collection "${name}" missing; treated as empty (format v1 migration).`);
      data[name] = [];
      continue;
    }
    const raw = data[name];
    if (!Array.isArray(raw)) continue; // strict validation reports it
    const arrayFields = REQUIRED_STRING_ARRAY_FIELDS[name] ?? [];
    if (arrayFields.length === 0) continue;
    for (const record of raw) {
      if (typeof record !== "object" || record === null) continue;
      const rec = record as Record<string, unknown>;
      for (const field of arrayFields) {
        if (rec[field] === undefined) {
          rec[field] = [];
          filledArrays++;
        }
      }
    }
  }
  if (filledArrays > 0) {
    warnings.push(`${filledArrays} missing array field(s) defaulted to empty (format v1 migration).`);
  }
}

/** Upgrade the parsed package in place to the current format version. */
function migrateBackup(pkg: Record<string, unknown>, warnings: string[]): void {
  let version = pkg.formatVersion as number;
  if (version === 1) {
    migrateV1toV2(pkg.data as Record<string, unknown>, warnings);
    version = 2;
    warnings.push("Backup migrated from format version 1 to 2.");
  }
  if (version === 2) {
    version = 3;
    warnings.push("Backup migrated from format version 2 to 3.");
  }
  pkg.formatVersion = version;
}

export function parseAndValidateBackup(jsonText: string, limits: BackupValidationLimits = {}): BackupValidationResult {
  const result: BackupValidationResult = { valid: false, errors: [], warnings: [], recordCounts: {} };
  const maxChars = limits.maxChars ?? MAX_BACKUP_CHARS;
  const maxRecords = limits.maxRecordsPerCollection ?? MAX_RECORDS_PER_COLLECTION;

  if (jsonText.length > maxChars) {
    result.errors.push(
      `File is too large to import (${jsonText.length.toLocaleString()} characters; limit ${maxChars.toLocaleString()}).`
    );
    return result;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (e) {
    result.errors.push(`File is not valid JSON: ${e instanceof Error ? e.message : String(e)}`);
    return result;
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    result.errors.push("Backup root must be a JSON object.");
    return result;
  }
  const pkg = parsed as Record<string, unknown>;

  if (pkg.format !== BACKUP_FORMAT) {
    result.errors.push(`Unrecognized format "${String(pkg.format)}". Expected "${BACKUP_FORMAT}".`);
    return result;
  }
  if (typeof pkg.formatVersion !== "number" || !Number.isInteger(pkg.formatVersion) || pkg.formatVersion < 1) {
    result.errors.push(`Missing or invalid format version ${String(pkg.formatVersion)}.`);
    return result;
  }
  if (pkg.formatVersion > BACKUP_FORMAT_VERSION) {
    result.errors.push(
      `Unsupported format version ${String(pkg.formatVersion)}. This application supports up to version ${BACKUP_FORMAT_VERSION}.`
    );
    return result;
  }
  if (typeof pkg.data !== "object" || pkg.data === null || Array.isArray(pkg.data)) {
    result.errors.push("Backup is missing its data section.");
    return result;
  }

  // Integrity checksum: computed over the data section exactly as exported.
  // Verified BEFORE migration mutates the data. Absent on v1 backups.
  const integrity =
    typeof pkg.integrity === "object" && pkg.integrity !== null ? (pkg.integrity as Record<string, unknown>) : undefined;
  const recordedChecksum = typeof integrity?.checksum === "string" ? integrity.checksum : undefined;
  if (recordedChecksum !== undefined) {
    const actual = backupChecksum(JSON.stringify(pkg.data));
    if (actual !== recordedChecksum) {
      result.errors.push(
        `Integrity checksum mismatch (recorded ${recordedChecksum}, computed ${actual}). The file was modified or corrupted after export.`
      );
      return result;
    }
  } else {
    result.warnings.push("Backup has no integrity checksum (older format); corruption cannot be fully detected.");
  }

  migrateBackup(pkg, result.warnings);

  const data = pkg.data as Record<string, unknown>;
  stripRetiredTaskFieldsFromImport(data, result.warnings);
  const recordedCounts =
    typeof integrity?.recordCounts === "object" && integrity.recordCounts !== null
      ? (integrity.recordCounts as Record<string, unknown>)
      : undefined;
  if (!recordedCounts) {
    result.warnings.push("Backup has no integrity record counts; count verification skipped.");
  }

  const seenIds = new Map<CollectionName, Set<string>>();

  for (const name of COLLECTION_NAMES) {
    const raw = data[name];
    if (!Array.isArray(raw)) {
      result.errors.push(`Collection "${name}" must be an array.`);
      continue;
    }
    if (raw.length > maxRecords) {
      result.errors.push(`Collection "${name}" has ${raw.length} records; limit is ${maxRecords}.`);
      continue;
    }
    result.recordCounts[name] = raw.length;

    // Verify the recorded integrity count where one exists (truncation check).
    const recorded = recordedCounts?.[name];
    if (typeof recorded === "number" && recorded !== raw.length) {
      result.errors.push(
        `Collection "${name}" contains ${raw.length} record(s) but the backup metadata recorded ${recorded}. The file may be truncated or modified.`
      );
    }

    const ids = new Set<string>();
    seenIds.set(name, ids);
    const enums = ENUM_FIELDS[name] ?? {};
    const optionalEnums = OPTIONAL_ENUM_FIELDS[name] ?? {};

    raw.forEach((record, i) => {
      if (typeof record !== "object" || record === null || Array.isArray(record)) {
        result.errors.push(`${name}[${i}] is not an object.`);
        return;
      }
      const rec = record as Record<string, unknown>;
      for (const field of REQUIRED_STRING_FIELDS[name] ?? ["id"]) {
        const v = rec[field];
        if (typeof v !== "string" || v.trim() === "") {
          result.errors.push(`${name}[${i}] is missing required field "${field}".`);
        }
      }
      for (const field of REQUIRED_STRING_ARRAY_FIELDS[name] ?? []) {
        const v = rec[field];
        if (!Array.isArray(v)) {
          result.errors.push(`${name}[${i}] is missing required array field "${field}".`);
        } else if (v.some((item) => typeof item !== "string")) {
          result.errors.push(`${name}[${i}].${field} must contain only strings.`);
        }
      }
      const id = rec.id;
      if (typeof id === "string") {
        if (ids.has(id)) result.errors.push(`${name}[${i}] has duplicate id "${id}".`);
        ids.add(id);
      }
      for (const field of DATE_FIELDS[name] ?? []) {
        const v = rec[field];
        if (v !== undefined && v !== null && (typeof v !== "string" || !isValidIsoDate(v))) {
          result.errors.push(`${name}[${i}].${field} is not a valid YYYY-MM-DD date.`);
        }
      }
      for (const field of TIMESTAMP_FIELDS[name] ?? []) {
        if (!isParseableTimestamp(rec[field])) {
          result.errors.push(`${name}[${i}].${field} is not a valid timestamp.`);
        }
      }
      for (const field of OPTIONAL_TIMESTAMP_FIELDS[name] ?? []) {
        const v = rec[field];
        if (v !== undefined && v !== null && !isParseableTimestamp(v)) {
          result.errors.push(`${name}[${i}].${field} is not a valid timestamp.`);
        }
      }
      for (const [field, allowed] of Object.entries(enums)) {
        const v = rec[field];
        if (typeof v !== "string" || !allowed.includes(v)) {
          result.errors.push(`${name}[${i}].${field} has unrecognized value "${String(v)}".`);
        }
      }
      for (const [field, allowed] of Object.entries(optionalEnums)) {
        const v = rec[field];
        if (v !== undefined && v !== null && (typeof v !== "string" || !allowed.includes(v))) {
          result.errors.push(`${name}[${i}].${field} has unrecognized value "${String(v)}".`);
        }
      }
      for (const field of NUMBER_FIELDS[name] ?? []) {
        const v = rec[field];
        if (typeof v !== "number" || !Number.isFinite(v)) {
          result.errors.push(`${name}[${i}].${field} must be a finite number.`);
        }
      }
      for (const field of BOOLEAN_FIELDS[name] ?? []) {
        if (typeof rec[field] !== "boolean") {
          result.errors.push(`${name}[${i}].${field} must be true or false.`);
        }
      }
      if (name === "trainingRequirements") {
        const v = rec.warningDays;
        if (v !== undefined && (!Array.isArray(v) || v.some((n) => typeof n !== "number" || !Number.isFinite(n)))) {
          result.errors.push(`${name}[${i}].warningDays must be an array of numbers.`);
        }
      }
      if (name === "employees" && rec.profileValues !== undefined) {
        validateEmployeeProfileValues(rec.profileValues, `employees[${i}].profileValues`, result.errors);
      }
    });
  }

  // Referential integrity warnings (non-blocking; plan 28.4). Orphan links are
  // repairable in the app, so they warn rather than block the import.
  checkRelationships(data, seenIds, result.warnings);
  checkCompositeKeys(data, result.errors);
  validateSettings(data.settings, result.errors);

  if (result.errors.length > 0) return result;

  const settings = normalizeAppSettings(data.settings);
  data.settings = settings;

  if (pkg.exportedAt !== undefined && !isParseableTimestamp(pkg.exportedAt)) {
    result.warnings.push("Backup exportedAt timestamp is not valid; the export time cannot be shown.");
  }

  result.valid = true;
  result.package = pkg as unknown as BackupPackage;
  result.exportedAt = isParseableTimestamp(pkg.exportedAt) ? (pkg.exportedAt as string) : undefined;
  result.applicationVersion = typeof pkg.applicationVersion === "string" ? pkg.applicationVersion : undefined;
  result.databaseId = typeof pkg.databaseId === "string" ? pkg.databaseId : undefined;
  return result;
}

/** Fields on each collection that must reference an existing record elsewhere. */
const RELATIONSHIPS: { from: CollectionName; field: string; to: CollectionName; describe: string }[] = [
  { from: "tasks", field: "employeeId", to: "employees", describe: "task(s) reference an employee" },
  { from: "tasks", field: "projectId", to: "projects", describe: "task(s) reference a project" },
  { from: "taskNotes", field: "taskId", to: "tasks", describe: "task note(s) reference a task" },
  { from: "checklistItems", field: "taskId", to: "tasks", describe: "checklist item(s) reference a task" },
  { from: "performanceInputs", field: "employeeId", to: "employees", describe: "performance input(s) reference an employee" },
  { from: "performanceInputs", field: "relatedTaskId", to: "tasks", describe: "performance input(s) reference a task" },
  { from: "employeeTrainingRecords", field: "employeeId", to: "employees", describe: "training record(s) reference an employee" },
  { from: "employeeTrainingRecords", field: "trainingRequirementId", to: "trainingRequirements", describe: "training record(s) reference a requirement" },
  { from: "leaveRecords", field: "employeeId", to: "employees", describe: "leave record(s) reference an employee" },
  { from: "teleworkRecords", field: "employeeId", to: "employees", describe: "telework record(s) reference an employee" },
  { from: "travelRecords", field: "employeeId", to: "employees", describe: "travel record(s) reference an employee" },
  { from: "awardRecords", field: "employeeId", to: "employees", describe: "award record(s) reference an employee" },
  { from: "employeeInteractions", field: "employeeId", to: "employees", describe: "interaction(s) reference an employee" },
  { from: "employeeNotes", field: "employeeId", to: "employees", describe: "employee note(s) reference an employee" },
  { from: "meetingNotes", field: "projectId", to: "projects", describe: "meeting note(s) reference a project" }
];

function checkRelationships(
  data: Record<string, unknown>,
  seenIds: Map<CollectionName, Set<string>>,
  warnings: string[]
): void {
  for (const rel of RELATIONSHIPS) {
    const records = Array.isArray(data[rel.from]) ? (data[rel.from] as Record<string, unknown>[]) : [];
    const targets = seenIds.get(rel.to) ?? new Set<string>();
    let orphans = 0;
    for (const rec of records) {
      const v = rec?.[rel.field];
      if (typeof v === "string" && v && !targets.has(v)) orphans++;
    }
    if (orphans > 0) warnings.push(`${orphans} ${rel.describe} not present in the backup.`);
  }

  // Meeting attendees are an id array, checked separately.
  const empIds = seenIds.get("employees") ?? new Set<string>();
  const meetings = Array.isArray(data.meetingNotes) ? (data.meetingNotes as Record<string, unknown>[]) : [];
  let orphanAttendees = 0;
  for (const note of meetings) {
    if (Array.isArray(note?.attendeeEmployeeIds)) {
      orphanAttendees += note.attendeeEmployeeIds.filter((id) => typeof id === "string" && !empIds.has(id)).length;
    }
  }
  if (orphanAttendees > 0) {
    warnings.push(`${orphanAttendees} meeting attendee link(s) reference an employee not present in the backup.`);
  }
}

/** Domain keys that must be unique even though their records have different IDs. */
function checkCompositeKeys(data: Record<string, unknown>, errors: string[]): void {
  const training = Array.isArray(data.employeeTrainingRecords)
    ? (data.employeeTrainingRecords as Record<string, unknown>[])
    : [];
  const seenTraining = new Set<string>();
  for (const [index, record] of training.entries()) {
    const employeeId = record.employeeId;
    const requirementId = record.trainingRequirementId;
    if (typeof employeeId !== "string" || typeof requirementId !== "string") continue;
    const key = `${employeeId}\u0000${requirementId}`;
    if (seenTraining.has(key)) {
      errors.push(`employeeTrainingRecords[${index}] duplicates the employee/training-requirement pair "${employeeId}" / "${requirementId}".`);
    }
    seenTraining.add(key);
  }
}

const SETTING_NUMBER_FIELDS: (keyof AppSettings)[] = [
  "schemaVersion",
  "dueSoonDays",
  "waitingStaleDays",
  "taskStaleDays",
  "performanceInputReminderDays",
  "checkInReminderDays",
  "completedVisibleDays",
  "backupReminderDays",
  "backupChangeThreshold",
  "trainingWarningDays",
  "leaveLookaheadDays"
];

/**
 * Settings are part of the untrusted import surface too. New settings may be
 * absent in an older backup and will receive defaults, but a present value
 * must have a valid type/range rather than merely matching JavaScript's broad
 * `typeof` category.
 */
function validateSettings(raw: unknown, errors: string[]): void {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    errors.push("Backup settings must be an object.");
    return;
  }
  const settings = raw as Record<string, unknown>;
  if (settings.applicationName !== undefined && (typeof settings.applicationName !== "string" || settings.applicationName.trim() === "" || settings.applicationName.length > 120)) {
    errors.push("settings.applicationName must be a non-empty string of at most 120 characters.");
  }
  if (settings.userDisplayName !== undefined && (typeof settings.userDisplayName !== "string" || settings.userDisplayName.length > 120)) {
    errors.push("settings.userDisplayName must be a string of at most 120 characters.");
  }
  for (const key of SETTING_NUMBER_FIELDS) {
    const value = settings[key];
    if (value !== undefined && (!Number.isInteger(value) || (value as number) < 0 || (value as number) > 1_000_000)) {
      errors.push(`settings.${key} must be a whole number from 0 to 1,000,000.`);
    }
  }
  if (settings.theme !== undefined && !["light", "dark", "system"].includes(String(settings.theme))) {
    errors.push("settings.theme must be light, dark, or system.");
  }
  if (settings.colorTheme !== undefined && !["default", "ocean", "forest", "violet", "sunset", "graphite"].includes(String(settings.colorTheme))) {
    errors.push("settings.colorTheme is not recognized.");
  }
  if (settings.enableSingleKeyShortcuts !== undefined && typeof settings.enableSingleKeyShortcuts !== "boolean") {
    errors.push("settings.enableSingleKeyShortcuts must be true or false.");
  }
  validateEmployeeProfileSettings(settings, errors);
}

function validateEmployeeProfileValues(raw: unknown, path: string, errors: string[]): void {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    errors.push(`${path} must be an object.`);
    return;
  }
  const entries = Object.entries(raw as Record<string, unknown>);
  if (entries.length > 200) errors.push(`${path} has more than 200 fields.`);
  for (const [id, value] of entries) {
    if (!id || id.length > 100) errors.push(`${path} contains an invalid field id.`);
    if (typeof value === "string") {
      if (value.length > 10_000) errors.push(`${path}.${id} exceeds 10,000 characters.`);
    } else if (typeof value === "boolean") {
      // Supported primitive.
    } else if (Array.isArray(value)) {
      if (value.length > 50 || value.some((item) => typeof item !== "string" || item.length > 100)) {
        errors.push(`${path}.${id} must be an array of at most 50 short strings.`);
      }
    } else {
      errors.push(`${path}.${id} must be text, true/false, or an array of text values.`);
    }
  }
}

function validateEmployeeProfileSettings(settings: Record<string, unknown>, errors: string[]): void {
  const sections = settings.employeeProfileSections;
  const fields = settings.employeeProfileFields;
  if (sections === undefined && fields === undefined) return; // Legacy backup receives defaults.
  if (!Array.isArray(sections) || sections.length === 0 || sections.length > 50) {
    errors.push("settings.employeeProfileSections must contain 1 to 50 sections.");
    return;
  }
  const sectionIds = new Set<string>();
  for (const [index, value] of sections.entries()) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      errors.push(`settings.employeeProfileSections[${index}] must be an object.`);
      continue;
    }
    const section = value as Record<string, unknown>;
    if (typeof section.id !== "string" || !section.id || section.id.length > 100 || sectionIds.has(section.id)) {
      errors.push(`settings.employeeProfileSections[${index}].id is invalid or duplicated.`);
    } else sectionIds.add(section.id);
    if (typeof section.label !== "string" || !section.label.trim() || section.label.length > 100) errors.push(`settings.employeeProfileSections[${index}].label is invalid.`);
    if (typeof section.sortOrder !== "number" || !Number.isFinite(section.sortOrder)) errors.push(`settings.employeeProfileSections[${index}].sortOrder must be a number.`);
    if (typeof section.isArchived !== "boolean") errors.push(`settings.employeeProfileSections[${index}].isArchived must be true or false.`);
  }
  if (!Array.isArray(fields) || fields.length > 200) {
    errors.push("settings.employeeProfileFields must be an array of at most 200 fields.");
    return;
  }
  const types = new Set(EMPLOYEE_PROFILE_FIELD_TYPES.map((item) => item.value));
  const fieldIds = new Set<string>();
  for (const [index, value] of fields.entries()) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      errors.push(`settings.employeeProfileFields[${index}] must be an object.`);
      continue;
    }
    const field = value as Record<string, unknown>;
    if (typeof field.id !== "string" || !field.id || field.id.length > 100 || fieldIds.has(field.id)) errors.push(`settings.employeeProfileFields[${index}].id is invalid or duplicated.`);
    else fieldIds.add(field.id);
    if (typeof field.sectionId !== "string" || !sectionIds.has(field.sectionId)) errors.push(`settings.employeeProfileFields[${index}].sectionId is not recognized.`);
    if (typeof field.label !== "string" || !field.label.trim() || field.label.length > 100) errors.push(`settings.employeeProfileFields[${index}].label is invalid.`);
    if (typeof field.type !== "string" || !types.has(field.type as never)) errors.push(`settings.employeeProfileFields[${index}].type is not recognized.`);
    if (typeof field.sortOrder !== "number" || !Number.isFinite(field.sortOrder)) errors.push(`settings.employeeProfileFields[${index}].sortOrder must be a number.`);
    if (typeof field.isArchived !== "boolean") errors.push(`settings.employeeProfileFields[${index}].isArchived must be true or false.`);
    if (field.options !== undefined && (!Array.isArray(field.options) || field.options.length > 50 || field.options.some((option) => {
      if (typeof option !== "object" || option === null || Array.isArray(option)) return true;
      const entry = option as Record<string, unknown>;
      return typeof entry.value !== "string" || !entry.value || entry.value.length > 100 || typeof entry.label !== "string" || !entry.label.trim() || entry.label.length > 100;
    }))) errors.push(`settings.employeeProfileFields[${index}].options is invalid.`);
  }
}

/** Convert a validated backup package into a database snapshot for replaceAll. */
export function snapshotFromBackup(pkg: BackupPackage): DatabaseSnapshot {
  const collections = emptyCollections();
  for (const name of COLLECTION_NAMES) {
    const records = (pkg.data[name] as unknown[]) ?? [];
    (collections[name] as unknown[]) = name === "tasks" ? stripRetiredTaskFields(records) : records;
  }
  return {
    collections,
    settings: pkg.data.settings ?? DEFAULT_SETTINGS,
    meta: {
      databaseId: pkg.databaseId || crypto.randomUUID(),
      lastBackupAt: pkg.exportedAt,
      changesSinceBackup: 0
    }
  };
}
