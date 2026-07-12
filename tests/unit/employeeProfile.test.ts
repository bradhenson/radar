import { describe, expect, it } from "vitest";
import {
  activeProfileFields,
  applyEmployeeProfileValues,
  formattedProfileValue
} from "../../src/domain/employeeProfile";
import { DEFAULT_SETTINGS, type Employee, type EmployeeProfileField } from "../../src/domain/models";

const employee: Employee = {
  id: "employee-1",
  displayName: "Sample Employee",
  workEmail: "sample@example.test",
  activeStatus: "active",
  tags: [],
  createdAt: "2026-01-01T12:00:00.000Z",
  updatedAt: "2026-01-01T12:00:00.000Z",
  isArchived: false
};

const customField: EmployeeProfileField = {
  id: "office-region",
  sectionId: "identity",
  label: "Office region",
  type: "choice",
  sortOrder: 100,
  isArchived: false,
  options: [{ value: "east", label: "East" }]
};

describe("employee profile configuration", () => {
  it("reads built-in fields and presents choice labels", () => {
    const workEmail = DEFAULT_SETTINGS.employeeProfileFields.find((field) => field.builtInKey === "workEmail")!;
    expect(formattedProfileValue(employee, workEmail)).toBe("sample@example.test");
    expect(formattedProfileValue({ ...employee, profileValues: { "office-region": "east" } }, customField)).toBe("East");
  });

  it("updates built-in and custom values without deleting unrelated custom data", () => {
    const workEmail = DEFAULT_SETTINGS.employeeProfileFields.find((field) => field.builtInKey === "workEmail")!;
    const updated = applyEmployeeProfileValues(
      { ...employee, profileValues: { retained: "keep" } },
      [workEmail, customField],
      { [workEmail.id]: " new@example.test ", [customField.id]: "east" }
    );
    expect(updated.workEmail).toBe("new@example.test");
    expect(updated.profileValues).toEqual({ retained: "keep", "office-region": "east" });
  });

  it("hides fields when either the field or its section is archived", () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      employeeProfileSections: DEFAULT_SETTINGS.employeeProfileSections.map((section) =>
        section.id === "identity" ? { ...section, isArchived: true } : section
      ),
      employeeProfileFields: [...DEFAULT_SETTINGS.employeeProfileFields, customField]
    };
    expect(activeProfileFields(settings).some((field) => field.sectionId === "identity")).toBe(false);
    expect(activeProfileFields({
      ...DEFAULT_SETTINGS,
      employeeProfileFields: [...DEFAULT_SETTINGS.employeeProfileFields, { ...customField, isArchived: true }]
    }).some((field) => field.id === customField.id)).toBe(false);
  });
});
