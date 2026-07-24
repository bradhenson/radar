import { describe, expect, it } from "vitest";
import {
  BACKUP_FORMAT,
  BACKUP_FORMAT_VERSION,
  backupChecksum,
  createBackupPackage,
  parseAndValidateBackup,
  snapshotFromBackup,
  type BackupPackage
} from "../../src/data/backup";
import { createSampleSnapshot } from "../../src/data/seed";
import { InMemoryDataStore } from "../../src/data/InMemoryDataStore";
import { COLLECTION_NAMES } from "../../src/data/DataStore";
import { DEFAULT_SETTINGS } from "../../src/domain/models";

/**
 * Re-seal a deliberately mutated package (recompute counts + checksum) so a
 * test exercises the schema layer instead of tripping the integrity check.
 */
function reseal(pkg: BackupPackage): string {
  const recordCounts: Record<string, number> = {};
  for (const name of COLLECTION_NAMES) {
    const raw = pkg.data[name];
    recordCounts[name] = Array.isArray(raw) ? raw.length : 0;
  }
  pkg.integrity.recordCounts = recordCounts;
  pkg.integrity.checksum = backupChecksum(JSON.stringify(pkg.data));
  return JSON.stringify(pkg);
}

describe("backup round trip", () => {
  it("export -> validate -> import preserves every record", async () => {
    const store = new InMemoryDataStore();
    await store.initialize();
    await store.replaceAll(createSampleSnapshot());
    const original = await store.exportSnapshot();

    const pkg = createBackupPackage(original);
    const json = JSON.stringify(pkg);

    const result = parseAndValidateBackup(json);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);

    const restored = new InMemoryDataStore();
    await restored.initialize();
    await restored.replaceAll(snapshotFromBackup(result.package!));
    const roundTripped = await restored.exportSnapshot();

    for (const name of COLLECTION_NAMES) {
      expect(roundTripped.collections[name]).toEqual(original.collections[name]);
    }
    expect(roundTripped.settings).toEqual(original.settings);
  });

  it("records accurate counts and a checksum in integrity metadata", async () => {
    const snapshot = createSampleSnapshot();
    const pkg = createBackupPackage(snapshot);
    expect(pkg.integrity.recordCounts.employees).toBe(snapshot.collections.employees.length);
    expect(pkg.integrity.recordCounts.tasks).toBe(snapshot.collections.tasks.length);
    expect(pkg.integrity.recordCounts.meetingNotes).toBe(snapshot.collections.meetingNotes.length);
    expect(pkg.integrity.checksum).toMatch(/^[0-9a-f]{8}$/);
    expect(pkg.format).toBe(BACKUP_FORMAT);
    expect(pkg.formatVersion).toBe(BACKUP_FORMAT_VERSION);
  });
});

describe("backup integrity verification", () => {
  it("rejects a file whose data was modified after export (checksum mismatch)", () => {
    const pkg = createBackupPackage(createSampleSnapshot());
    (pkg.data.employees[0] as Record<string, unknown>).displayName = "Tampered Name";
    const r = parseAndValidateBackup(JSON.stringify(pkg)); // deliberately NOT resealed
    expect(r.valid).toBe(false);
    expect(r.errors[0]).toContain("checksum mismatch");
  });

  it("rejects a file whose record counts disagree with its metadata (truncation)", () => {
    const pkg = createBackupPackage(createSampleSnapshot());
    pkg.data.tasks.pop();
    // Recompute the checksum but keep the stale counts: pure count check.
    pkg.integrity.checksum = backupChecksum(JSON.stringify(pkg.data));
    const r = parseAndValidateBackup(JSON.stringify(pkg));
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("truncated") && e.includes("tasks"))).toBe(true);
  });

  it("rejects a truncated file as invalid JSON", () => {
    const json = JSON.stringify(createBackupPackage(createSampleSnapshot()));
    const r = parseAndValidateBackup(json.slice(0, json.length - 40));
    expect(r.valid).toBe(false);
    expect(r.errors[0]).toContain("not valid JSON");
  });

  it("rejects files over the size limit", () => {
    const json = JSON.stringify(createBackupPackage(createSampleSnapshot()));
    const r = parseAndValidateBackup(json, { maxChars: 100 });
    expect(r.valid).toBe(false);
    expect(r.errors[0]).toContain("too large");
  });

  it("rejects collections over the record cap", () => {
    const pkg = createBackupPackage(createSampleSnapshot());
    const r = parseAndValidateBackup(reseal(pkg), { maxRecordsPerCollection: 2 });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("limit is 2"))).toBe(true);
  });

  it("accepts checksum-free v1 backups with a warning", () => {
    const pkg = createBackupPackage(createSampleSnapshot());
    pkg.formatVersion = 1;
    delete pkg.integrity.checksum;
    const r = parseAndValidateBackup(JSON.stringify(pkg));
    expect(r.valid).toBe(true);
    expect(r.warnings.some((w) => w.includes("no integrity checksum"))).toBe(true);
  });
});

describe("format v1 migration", () => {
  it("fills missing collections and required arrays with warnings", () => {
    const pkg = createBackupPackage(createSampleSnapshot());
    pkg.formatVersion = 1;
    delete pkg.integrity.checksum;
    const data = pkg.data as unknown as Record<string, unknown>;
    // Simulate an export from an app version that predates awardRecords:
    // neither the collection nor its integrity count exists.
    delete data.awardRecords;
    delete pkg.integrity.recordCounts.awardRecords;
    delete (pkg.data.employees[0] as Record<string, unknown>).tags;
    const r = parseAndValidateBackup(JSON.stringify(pkg));
    expect(r.valid).toBe(true);
    expect(r.warnings.some((w) => w.includes("awardRecords"))).toBe(true);
    expect(r.warnings.some((w) => w.includes("migrated from format version 1"))).toBe(true);
    expect((r.package!.data.employees[0] as Record<string, unknown>).tags).toEqual([]);
  });

  it("rejects missing collections in current-format backups", () => {
    const pkg = createBackupPackage(createSampleSnapshot());
    const data = pkg.data as unknown as Record<string, unknown>;
    delete data.awardRecords;
    const r = parseAndValidateBackup(reseal(pkg));
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes('"awardRecords" must be an array'))).toBe(true);
  });

  it("removes retired task follow-up fields from legacy imports", () => {
    const pkg = createBackupPackage(createSampleSnapshot());
    pkg.formatVersion = 2;
    const task = pkg.data.tasks[0] as Record<string, unknown>;
    task.waitingOn = "Example person";
    task.waitingReason = "Example reason";
    task.followUpDate = "2026-07-10";

    const result = parseAndValidateBackup(reseal(pkg));

    expect(result.valid).toBe(true);
    expect(result.warnings.some((warning) => warning.includes("retired task field"))).toBe(true);
    const restored = snapshotFromBackup(result.package!);
    expect(restored.collections.tasks[0]).not.toHaveProperty("waitingOn");
    expect(restored.collections.tasks[0]).not.toHaveProperty("waitingReason");
    expect(restored.collections.tasks[0]).not.toHaveProperty("followUpDate");
  });
});

describe("backup validation rejects bad input", () => {
  it("rejects non-JSON", () => {
    const r = parseAndValidateBackup("not json{");
    expect(r.valid).toBe(false);
    expect(r.errors[0]).toContain("not valid JSON");
  });

  it("rejects wrong format name", () => {
    const r = parseAndValidateBackup(JSON.stringify({ format: "SomethingElse", formatVersion: 1, data: {} }));
    expect(r.valid).toBe(false);
    expect(r.errors[0]).toContain("Unrecognized format");
  });

  it("rejects future format versions", () => {
    const r = parseAndValidateBackup(JSON.stringify({ format: "SupervisorAssistantBackup", formatVersion: 99, data: {} }));
    expect(r.valid).toBe(false);
    expect(r.errors[0]).toContain("Unsupported format version");
  });

  it("rejects records missing required fields", () => {
    const pkg = createBackupPackage(createSampleSnapshot());
    (pkg.data.employees[0] as Record<string, unknown>).displayName = "";
    const r = parseAndValidateBackup(reseal(pkg));
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("displayName"))).toBe(true);
  });

  it("allows employee records without a competency", () => {
    const pkg = createBackupPackage(createSampleSnapshot());
    delete (pkg.data.employees[0] as Record<string, unknown>).competencyId;
    const r = parseAndValidateBackup(reseal(pkg));
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it("rejects employee notes missing their text", () => {
    const pkg = createBackupPackage(createSampleSnapshot());
    (pkg.data.employeeNotes[0] as Record<string, unknown>).noteText = "";
    const r = parseAndValidateBackup(reseal(pkg));
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("noteText"))).toBe(true);
  });

  it("rejects duplicate ids", () => {
    const pkg = createBackupPackage(createSampleSnapshot());
    (pkg.data.tasks[1] as Record<string, unknown>).id = (pkg.data.tasks[0] as Record<string, unknown>).id;
    const r = parseAndValidateBackup(reseal(pkg));
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("duplicate id"))).toBe(true);
  });

  it("rejects invalid calendar dates", () => {
    const pkg = createBackupPackage(createSampleSnapshot());
    (pkg.data.tasks[0] as Record<string, unknown>).dueDate = "2026-02-30";
    const r = parseAndValidateBackup(reseal(pkg));
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("dueDate"))).toBe(true);
  });

  it("rejects invalid employee profile dates", () => {
    const pkg = createBackupPackage(createSampleSnapshot());
    (pkg.data.employees[0] as Record<string, unknown>).teleworkAgreementValidThrough = "2026-02-30";
    const r = parseAndValidateBackup(reseal(pkg));
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("teleworkAgreementValidThrough"))).toBe(true);
  });

  it("rejects unrecognized enum values but accepts legacy task statuses", () => {
    const pkg = createBackupPackage(createSampleSnapshot());
    (pkg.data.tasks[0] as Record<string, unknown>).status = "bogus_status";
    (pkg.data.tasks[1] as Record<string, unknown>).status = "in_progress"; // legacy, normalized on load
    const r = parseAndValidateBackup(reseal(pkg));
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("bogus_status"))).toBe(true);
    expect(r.errors.some((e) => e.includes("in_progress"))).toBe(false);
  });

  it("rejects invalid creation timestamps", () => {
    const pkg = createBackupPackage(createSampleSnapshot());
    (pkg.data.employees[0] as Record<string, unknown>).createdAt = "not-a-timestamp";
    const r = parseAndValidateBackup(reseal(pkg));
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("createdAt"))).toBe(true);
  });

  it("rejects missing required arrays in current-format backups", () => {
    const pkg = createBackupPackage(createSampleSnapshot());
    delete (pkg.data.employees[0] as Record<string, unknown>).tags;
    const r = parseAndValidateBackup(reseal(pkg));
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes('"tags"'))).toBe(true);
  });

  it("rejects non-boolean flags and non-numeric orders", () => {
    const pkg = createBackupPackage(createSampleSnapshot());
    (pkg.data.tasks[0] as Record<string, unknown>).isArchived = "no";
    (pkg.data.tasks[1] as Record<string, unknown>).boardOrder = "first";
    const r = parseAndValidateBackup(reseal(pkg));
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("isArchived"))).toBe(true);
    expect(r.errors.some((e) => e.includes("boardOrder"))).toBe(true);
  });

  it("warns (not errors) about orphan references", () => {
    const pkg = createBackupPackage(createSampleSnapshot());
    (pkg.data.tasks[0] as Record<string, unknown>).employeeId = "no-such-employee";
    (pkg.data.taskNotes[0] as Record<string, unknown>).taskId = "no-such-task";
    const r = parseAndValidateBackup(reseal(pkg));
    expect(r.valid).toBe(true);
    expect(r.warnings.some((w) => w.includes("task(s) reference an employee"))).toBe(true);
    expect(r.warnings.some((w) => w.includes("task note(s) reference a task"))).toBe(true);
  });

  it("normalizes known valid settings and drops unknown keys", () => {
    const pkg = createBackupPackage(createSampleSnapshot());
    const data = pkg.data as unknown as Record<string, unknown>;
    data.settings = { dueSoonDays: 12, theme: "dark", userDisplayName: "Sample Supervisor", evil: "<script>" };
    const r = parseAndValidateBackup(reseal(pkg));
    expect(r.valid).toBe(true);
    const settings = r.package!.data.settings;
    expect(settings.dueSoonDays).toBe(12);
    expect(settings.theme).toBe("dark"); // valid override kept
    expect(settings.userDisplayName).toBe("Sample Supervisor");
    expect("evil" in settings).toBe(false);
  });

  it("migrates legacy default backup reminder settings", () => {
    const pkg = createBackupPackage(createSampleSnapshot());
    pkg.data.settings = {
      ...pkg.data.settings,
      schemaVersion: 1,
      backupReminderDays: 7,
      backupChangeThreshold: 50
    };
    const r = parseAndValidateBackup(reseal(pkg));
    expect(r.valid).toBe(true);
    expect(r.package!.data.settings.schemaVersion).toBe(DEFAULT_SETTINGS.schemaVersion);
    expect(r.package!.data.settings.backupReminderDays).toBe(1);
    expect(r.package!.data.settings.backupChangeThreshold).toBe(10);
  });

  it("keeps customized legacy backup reminder settings", () => {
    const pkg = createBackupPackage(createSampleSnapshot());
    pkg.data.settings = {
      ...pkg.data.settings,
      schemaVersion: 1,
      backupReminderDays: 3,
      backupChangeThreshold: 25
    };
    const r = parseAndValidateBackup(reseal(pkg));
    expect(r.valid).toBe(true);
    expect(r.package!.data.settings.backupReminderDays).toBe(3);
    expect(r.package!.data.settings.backupChangeThreshold).toBe(25);
  });

  it("rejects invalid setting values instead of silently accepting them", () => {
    const pkg = createBackupPackage(createSampleSnapshot());
    const data = pkg.data as unknown as Record<string, unknown>;
    data.settings = { dueSoonDays: "nope", theme: "night", enableSingleKeyShortcuts: "yes", look: "frosted" };
    const r = parseAndValidateBackup(reseal(pkg));
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("settings.dueSoonDays"))).toBe(true);
    expect(r.errors.some((e) => e.includes("settings.theme"))).toBe(true);
    expect(r.errors.some((e) => e.includes("enableSingleKeyShortcuts"))).toBe(true);
    expect(r.errors.some((e) => e.includes("settings.look"))).toBe(true);
  });

  it("round-trips custom employee profile fields and values", () => {
    const pkg = createBackupPackage(createSampleSnapshot());
    pkg.data.settings.employeeProfileSections.push({ id: "company", label: "Company details", sortOrder: 10, isArchived: false });
    pkg.data.settings.employeeProfileFields.push({
      id: "office-region",
      sectionId: "company",
      label: "Office region",
      type: "choice",
      sortOrder: 0,
      // Legacy flags from older backups must still validate.
      isSensitive: false,
      includeInExport: true,
      isArchived: false,
      options: [{ value: "east", label: "East" }]
    } as unknown as (typeof pkg.data.settings.employeeProfileFields)[number]);
    (pkg.data.employees[0] as Record<string, unknown>).profileValues = { "office-region": "east" };
    const r = parseAndValidateBackup(reseal(pkg));
    expect(r.valid).toBe(true);
    expect((r.package!.data.employees[0] as Record<string, unknown>).profileValues).toEqual({ "office-region": "east" });
  });

  it("rejects unsupported custom employee profile values", () => {
    const pkg = createBackupPackage(createSampleSnapshot());
    (pkg.data.employees[0] as Record<string, unknown>).profileValues = { unsafe: { nested: true } };
    const r = parseAndValidateBackup(reseal(pkg));
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("profileValues.unsafe"))).toBe(true);
  });

  it("rejects profile fields assigned to an unknown section", () => {
    const pkg = createBackupPackage(createSampleSnapshot());
    pkg.data.settings.employeeProfileFields[0] = { ...pkg.data.settings.employeeProfileFields[0]!, sectionId: "missing" };
    const r = parseAndValidateBackup(reseal(pkg));
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("sectionId is not recognized"))).toBe(true);
  });

  it("rejects duplicate employee-training records for the same requirement", () => {
    const pkg = createBackupPackage(createSampleSnapshot());
    const first = pkg.data.employeeTrainingRecords[0] as Record<string, unknown>;
    const second = { ...(pkg.data.employeeTrainingRecords[1] as Record<string, unknown>), employeeId: first.employeeId, trainingRequirementId: first.trainingRequirementId };
    pkg.data.employeeTrainingRecords[1] = second;
    const r = parseAndValidateBackup(reseal(pkg));
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("duplicates the employee/training-requirement pair"))).toBe(true);
  });
});
