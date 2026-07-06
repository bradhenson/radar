// Backup package export/import/validation (plan sections 10 and 26).
// All imported data is untrusted: validated structurally before use,
// and always rendered as text by the UI.

import { DEFAULT_SETTINGS, type AppSettings } from "../domain/models";
import { isValidIsoDate } from "../utils/dates";
import { COLLECTION_NAMES, emptyCollections, type CollectionName, type DatabaseSnapshot } from "./DataStore";

export const BACKUP_FORMAT = "SupervisorAssistantBackup";
export const BACKUP_FORMAT_VERSION = 1;
export const APPLICATION_VERSION = "0.1.0";

export interface BackupPackage {
  format: typeof BACKUP_FORMAT;
  formatVersion: number;
  applicationVersion: string;
  exportedAt: string;
  databaseId: string;
  data: { [K in CollectionName]: unknown[] } & { settings: AppSettings };
  integrity: { recordCounts: Record<string, number> };
}

export function createBackupPackage(snapshot: DatabaseSnapshot): BackupPackage {
  const data = {} as BackupPackage["data"];
  const recordCounts: Record<string, number> = {};
  for (const name of COLLECTION_NAMES) {
    (data as Record<string, unknown>)[name] = snapshot.collections[name];
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
    integrity: { recordCounts }
  };
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

// Fields that must be non-empty strings on every record of a collection.
const REQUIRED_STRING_FIELDS: Partial<Record<CollectionName, string[]>> = {
  employees: ["id", "displayName", "activeStatus"],
  competencies: ["id", "code"],
  projects: ["id", "name", "status"],
  tasks: ["id", "title", "status", "priority", "category"],
  boardColumns: ["id", "label"],
  taskCategories: ["id", "label"],
  taskNotes: ["id", "taskId", "body"],
  checklistItems: ["id", "taskId", "title"],
  performanceInputs: ["id", "employeeId", "inputDate", "actionOrAccomplishment"],
  trainingRequirements: ["id", "name"],
  employeeTrainingRecords: ["id", "employeeId", "trainingRequirementId", "status"],
  leaveRecords: ["id", "employeeId", "startDate", "endDate", "status"],
  teleworkRecords: ["id", "employeeId", "recordType", "status"],
  awardRecords: ["id", "employeeId", "title", "status"],
  employeeInteractions: ["id", "employeeId", "interactionDate", "interactionType"],
  meetingNotes: ["id", "meetingDate", "title", "meetingType"],
  activityEntries: ["id", "entityType", "entityId", "actionType", "timestamp"]
};

const REQUIRED_STRING_ARRAY_FIELDS: Partial<Record<CollectionName, string[]>> = {
  meetingNotes: ["attendeeEmployeeIds"]
};

const DATE_FIELDS: Partial<Record<CollectionName, string[]>> = {
  tasks: ["startDate", "dueDate", "reminderDate", "followUpDate", "completedDate", "lastVerifiedDate"],
  employees: ["startDate", "lastCheckInDate", "teleworkAgreementValidThrough"],
  performanceInputs: ["inputDate"],
  trainingRequirements: ["dueDate"],
  employeeTrainingRecords: ["assignedDate", "dueDate", "completedDate", "expirationDate", "lastVerifiedDate"],
  leaveRecords: ["startDate", "endDate", "lastVerifiedDate"],
  teleworkRecords: ["requestDate", "effectiveDate", "expirationDate", "lastVerifiedDate"],
  awardRecords: ["accomplishmentPeriodStart", "accomplishmentPeriodEnd", "nominationDueDate", "submittedDate", "decisionDate"],
  meetingNotes: ["meetingDate"]
};

export function parseAndValidateBackup(jsonText: string): BackupValidationResult {
  const result: BackupValidationResult = { valid: false, errors: [], warnings: [], recordCounts: {} };

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
  if (typeof pkg.formatVersion !== "number" || pkg.formatVersion > BACKUP_FORMAT_VERSION) {
    result.errors.push(
      `Unsupported format version ${String(pkg.formatVersion)}. This application supports up to version ${BACKUP_FORMAT_VERSION}.`
    );
    return result;
  }
  if (typeof pkg.data !== "object" || pkg.data === null) {
    result.errors.push("Backup is missing its data section.");
    return result;
  }

  const data = pkg.data as Record<string, unknown>;
  const seenIds = new Map<CollectionName, Set<string>>();

  for (const name of COLLECTION_NAMES) {
    const raw = data[name];
    if (raw === undefined) {
      result.warnings.push(`Collection "${name}" missing; treated as empty.`);
      data[name] = [];
      result.recordCounts[name] = 0;
      continue;
    }
    if (!Array.isArray(raw)) {
      result.errors.push(`Collection "${name}" must be an array.`);
      continue;
    }
    result.recordCounts[name] = raw.length;
    const ids = new Set<string>();
    seenIds.set(name, ids);
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
    });
  }

  // Referential integrity warnings (non-blocking; plan 28.4).
  const empIds = seenIds.get("employees") ?? new Set();
  const projIds = seenIds.get("projects") ?? new Set();
  const taskArr = Array.isArray(data.tasks) ? (data.tasks as Record<string, unknown>[]) : [];
  let orphanTasks = 0;
  for (const t of taskArr) {
    if (typeof t.employeeId === "string" && t.employeeId && !empIds.has(t.employeeId)) orphanTasks++;
  }
  if (orphanTasks > 0) result.warnings.push(`${orphanTasks} task(s) reference an employee not present in the backup.`);

  const meetingArr = Array.isArray(data.meetingNotes) ? (data.meetingNotes as Record<string, unknown>[]) : [];
  let orphanMeetingEmployees = 0;
  let orphanMeetingProjects = 0;
  for (const note of meetingArr) {
    if (Array.isArray(note.attendeeEmployeeIds)) {
      orphanMeetingEmployees += note.attendeeEmployeeIds.filter((id) => typeof id === "string" && !empIds.has(id)).length;
    }
    if (typeof note.projectId === "string" && note.projectId && !projIds.has(note.projectId)) orphanMeetingProjects++;
  }
  if (orphanMeetingEmployees > 0) {
    result.warnings.push(`${orphanMeetingEmployees} meeting attendee link(s) reference an employee not present in the backup.`);
  }
  if (orphanMeetingProjects > 0) {
    result.warnings.push(`${orphanMeetingProjects} meeting note(s) reference a project not present in the backup.`);
  }

  if (result.errors.length > 0) return result;

  const settings = normalizeSettings(data.settings);
  data.settings = settings;

  result.valid = true;
  result.package = pkg as unknown as BackupPackage;
  result.exportedAt = typeof pkg.exportedAt === "string" ? pkg.exportedAt : undefined;
  result.applicationVersion = typeof pkg.applicationVersion === "string" ? pkg.applicationVersion : undefined;
  result.databaseId = typeof pkg.databaseId === "string" ? pkg.databaseId : undefined;
  return result;
}

/** Merge imported settings over defaults, keeping only known keys with correct types. */
function normalizeSettings(raw: unknown): AppSettings {
  const out: AppSettings = { ...DEFAULT_SETTINGS };
  if (typeof raw !== "object" || raw === null) return out;
  const src = raw as Record<string, unknown>;
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof AppSettings)[]) {
    const v = src[key];
    if (v !== undefined && typeof v === typeof DEFAULT_SETTINGS[key]) {
      (out as unknown as Record<string, unknown>)[key] = v;
    }
  }
  if (typeof src.userDisplayName === "string") out.userDisplayName = src.userDisplayName;
  return out;
}

/** Convert a validated backup package into a database snapshot for replaceAll. */
export function snapshotFromBackup(pkg: BackupPackage): DatabaseSnapshot {
  const collections = emptyCollections();
  for (const name of COLLECTION_NAMES) {
    (collections[name] as unknown[]) = (pkg.data[name] as unknown[]) ?? [];
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
