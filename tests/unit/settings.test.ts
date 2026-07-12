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

  it("adds the default employee profile configuration to legacy settings", () => {
    const normalized = normalizeAppSettings({ schemaVersion: 2, theme: "light" });
    expect(normalized.schemaVersion).toBe(3);
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
