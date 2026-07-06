import { describe, expect, it } from "vitest";
import { createBackupPackage, parseAndValidateBackup, snapshotFromBackup, BACKUP_FORMAT } from "../../src/data/backup";
import { createSampleSnapshot } from "../../src/data/seed";
import { InMemoryDataStore } from "../../src/data/InMemoryDataStore";
import { COLLECTION_NAMES } from "../../src/data/DataStore";

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

  it("records accurate counts in integrity metadata", async () => {
    const snapshot = createSampleSnapshot();
    const pkg = createBackupPackage(snapshot);
    expect(pkg.integrity.recordCounts.employees).toBe(snapshot.collections.employees.length);
    expect(pkg.integrity.recordCounts.tasks).toBe(snapshot.collections.tasks.length);
    expect(pkg.integrity.recordCounts.meetingNotes).toBe(snapshot.collections.meetingNotes.length);
    expect(pkg.format).toBe(BACKUP_FORMAT);
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
    const r = parseAndValidateBackup(JSON.stringify(pkg));
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("displayName"))).toBe(true);
  });

  it("allows employee records without a competency", () => {
    const pkg = createBackupPackage(createSampleSnapshot());
    delete (pkg.data.employees[0] as Record<string, unknown>).competencyId;
    const r = parseAndValidateBackup(JSON.stringify(pkg));
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it("rejects employee notes missing their text", () => {
    const pkg = createBackupPackage(createSampleSnapshot());
    (pkg.data.employeeNotes[0] as Record<string, unknown>).noteText = "";
    const r = parseAndValidateBackup(JSON.stringify(pkg));
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("noteText"))).toBe(true);
  });

  it("rejects duplicate ids", () => {
    const pkg = createBackupPackage(createSampleSnapshot());
    (pkg.data.tasks[1] as Record<string, unknown>).id = (pkg.data.tasks[0] as Record<string, unknown>).id;
    const r = parseAndValidateBackup(JSON.stringify(pkg));
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("duplicate id"))).toBe(true);
  });

  it("rejects invalid calendar dates", () => {
    const pkg = createBackupPackage(createSampleSnapshot());
    (pkg.data.tasks[0] as Record<string, unknown>).dueDate = "2026-02-30";
    const r = parseAndValidateBackup(JSON.stringify(pkg));
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("dueDate"))).toBe(true);
  });

  it("rejects invalid employee profile dates", () => {
    const pkg = createBackupPackage(createSampleSnapshot());
    (pkg.data.employees[0] as Record<string, unknown>).teleworkAgreementValidThrough = "2026-02-30";
    const r = parseAndValidateBackup(JSON.stringify(pkg));
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("teleworkAgreementValidThrough"))).toBe(true);
  });

  it("warns (not errors) about missing collections and orphan references", () => {
    const pkg = createBackupPackage(createSampleSnapshot());
    const data = pkg.data as unknown as Record<string, unknown>;
    delete data.awardRecords;
    (pkg.data.tasks[0] as Record<string, unknown>).employeeId = "no-such-employee";
    const r = parseAndValidateBackup(JSON.stringify(pkg));
    expect(r.valid).toBe(true);
    expect(r.warnings.some((w) => w.includes("awardRecords"))).toBe(true);
    expect(r.warnings.some((w) => w.includes("reference an employee"))).toBe(true);
  });

  it("normalizes settings, dropping unknown keys and wrong types", () => {
    const pkg = createBackupPackage(createSampleSnapshot());
    const data = pkg.data as unknown as Record<string, unknown>;
    data.settings = { dueSoonDays: "nope", theme: "dark", userDisplayName: "Sample Supervisor", evil: "<script>" };
    const r = parseAndValidateBackup(JSON.stringify(pkg));
    expect(r.valid).toBe(true);
    const settings = r.package!.data.settings;
    expect(settings.dueSoonDays).toBe(7); // fell back to default
    expect(settings.theme).toBe("dark"); // valid override kept
    expect(settings.userDisplayName).toBe("Sample Supervisor");
    expect("evil" in settings).toBe(false);
  });
});
