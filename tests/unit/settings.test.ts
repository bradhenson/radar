import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, normalizeAppSettings } from "../../src/domain/models";

describe("application settings defaults", () => {
  it("defaults new browser and desktop databases to dark mode", () => {
    expect(DEFAULT_SETTINGS.theme).toBe("dark");
    expect(normalizeAppSettings({} as unknown).theme).toBe("dark");
  });

  it("preserves an existing explicit system-theme preference", () => {
    expect(normalizeAppSettings({ ...DEFAULT_SETTINGS, theme: "system" }).theme).toBe("system");
  });

  it("defaults the telework allowance and pay period anchor", () => {
    const normalized = normalizeAppSettings({ schemaVersion: 2 });
    expect(normalized.teleworkDaysPerPayPeriod).toBe(2);
    expect(normalized.teleworkLookbackDays).toBe(30);
    expect(normalized.payPeriodAnchorDate).toBe(DEFAULT_SETTINGS.payPeriodAnchorDate);
  });

  it("replaces the superseded pay period anchor but keeps a deliberate one", () => {
    // Schema 3 shipped an anchor a week off the federal bi-weekly calendar.
    expect(normalizeAppSettings({ ...DEFAULT_SETTINGS, schemaVersion: 3, payPeriodAnchorDate: "2026-01-04" }).payPeriodAnchorDate)
      .toBe(DEFAULT_SETTINGS.payPeriodAnchorDate);
    expect(normalizeAppSettings({ ...DEFAULT_SETTINGS, schemaVersion: 3, payPeriodAnchorDate: "2026-03-01" }).payPeriodAnchorDate)
      .toBe("2026-03-01");
    // Someone who deliberately picks that date after the migration keeps it.
    expect(normalizeAppSettings({ ...DEFAULT_SETTINGS, schemaVersion: 4, payPeriodAnchorDate: "2026-01-04" }).payPeriodAnchorDate)
      .toBe("2026-01-04");
  });

  it("keeps a configured pay period anchor but rejects a malformed one", () => {
    expect(normalizeAppSettings({ ...DEFAULT_SETTINGS, payPeriodAnchorDate: "2026-02-01" }).payPeriodAnchorDate).toBe("2026-02-01");
    // A bad anchor would misplace every pay period boundary.
    expect(normalizeAppSettings({ ...DEFAULT_SETTINGS, payPeriodAnchorDate: "not-a-date" }).payPeriodAnchorDate).toBe(
      DEFAULT_SETTINGS.payPeriodAnchorDate
    );
  });

  it("refuses a telework allowance below one day", () => {
    expect(normalizeAppSettings({ ...DEFAULT_SETTINGS, teleworkDaysPerPayPeriod: 0 }).teleworkDaysPerPayPeriod).toBe(2);
    expect(normalizeAppSettings({ ...DEFAULT_SETTINGS, teleworkDaysPerPayPeriod: 3 }).teleworkDaysPerPayPeriod).toBe(3);
  });

  it("adds the default employee profile configuration to legacy settings", () => {
    const normalized = normalizeAppSettings({ schemaVersion: 2, theme: "light" });
    expect(normalized.schemaVersion).toBe(4);
    expect(normalized.employeeProfileSections.map((section) => section.label)).toContain("Identity");
    expect(normalized.employeeProfileFields.some((field) => field.builtInKey === "workEmail")).toBe(true);
  });

  it("preserves a valid organization-defined employee profile and drops retired field flags", () => {
    const normalized = normalizeAppSettings({
      ...DEFAULT_SETTINGS,
      employeeProfileSections: [{ id: "company", label: "Company details", sortOrder: 0, isArchived: false }],
      employeeProfileFields: [{
        id: "office-region",
        sectionId: "company",
        label: "Office region",
        type: "choice",
        sortOrder: 0,
        // Legacy flags from pre-removal databases must be tolerated and dropped.
        isSensitive: false,
        includeInExport: true,
        isArchived: false,
        options: [{ value: "east", label: "East" }]
      }]
    });
    expect(normalized.employeeProfileSections).toEqual([{ id: "company", label: "Company details", sortOrder: 0, isArchived: false }]);
    expect(normalized.employeeProfileFields[0]?.options).toEqual([{ value: "east", label: "East" }]);
    expect("isSensitive" in normalized.employeeProfileFields[0]!).toBe(false);
    expect("includeInExport" in normalized.employeeProfileFields[0]!).toBe(false);
  });
});
