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

  it("ships Gov Passport, Passport Expiration, and SIPR Account as built-in fields", () => {
    const byKey = (key: string) => DEFAULT_SETTINGS.employeeProfileFields.find((field) => field.builtInKey === key)!;

    const passport = byKey("govPassport");
    expect(passport.label).toBe("Gov Passport");
    expect(passport.type).toBe("choice");
    expect(passport.options?.map((option) => option.label)).toEqual(["Yes", "No", "In process"]);

    expect(byKey("passportExpiration").type).toBe("date");
    expect(byKey("passportExpiration").label).toBe("Passport Expiration");

    const sipr = byKey("siprAccount");
    expect(sipr.label).toBe("SIPR Account");
    expect(sipr.options?.map((option) => option.value)).toEqual(["yes", "no", "in_process"]);
  });

  it("reads and writes the new fields through the generic profile plumbing", () => {
    const passport = DEFAULT_SETTINGS.employeeProfileFields.find((field) => field.builtInKey === "govPassport")!;
    const expiration = DEFAULT_SETTINGS.employeeProfileFields.find((field) => field.builtInKey === "passportExpiration")!;
    const sipr = DEFAULT_SETTINGS.employeeProfileFields.find((field) => field.builtInKey === "siprAccount")!;

    const updated = applyEmployeeProfileValues(employee, [passport, expiration, sipr], {
      [passport.id]: "in_process",
      [expiration.id]: "2029-04-30",
      [sipr.id]: "yes"
    });
    expect(updated.govPassport).toBe("in_process");
    expect(updated.passportExpiration).toBe("2029-04-30");
    expect(updated.siprAccount).toBe("yes");
    // Stored on the employee record itself, not in the custom-value bag.
    expect(updated.profileValues).toBeUndefined();
    expect(formattedProfileValue(updated, passport)).toBe("In process");
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
