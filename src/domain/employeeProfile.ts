import type {
  AppSettings,
  Employee,
  EmployeeProfileField,
  EmployeeProfileSection,
  EmployeeProfileValue
} from "./models";

export function activeProfileSections(settings: AppSettings): EmployeeProfileSection[] {
  return settings.employeeProfileSections
    .filter((section) => !section.isArchived)
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label));
}

export function activeProfileFields(settings: AppSettings, sectionId?: string): EmployeeProfileField[] {
  const activeSectionIds = new Set(activeProfileSections(settings).map((section) => section.id));
  return settings.employeeProfileFields
    .filter((field) => !field.isArchived && activeSectionIds.has(field.sectionId) && (!sectionId || field.sectionId === sectionId))
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label));
}

export function employeeProfileValue(employee: Employee, field: EmployeeProfileField): EmployeeProfileValue | undefined {
  if (field.builtInKey) {
    return (employee as unknown as Record<string, EmployeeProfileValue | undefined>)[field.builtInKey];
  }
  return employee.profileValues?.[field.id];
}

export function formattedProfileValue(employee: Employee, field: EmployeeProfileField): string {
  const value = employeeProfileValue(employee, field);
  if (value === undefined || value === "" || (Array.isArray(value) && value.length === 0)) return "";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) {
    return value.map((item) => field.options?.find((option) => option.value === item)?.label ?? item).join(", ");
  }
  return field.options?.find((option) => option.value === value)?.label ?? value;
}

export function profileValueForEdit(employee: Employee, field: EmployeeProfileField): EmployeeProfileValue | "" {
  return employeeProfileValue(employee, field) ?? "";
}

export function applyEmployeeProfileValues(
  employee: Employee,
  fields: EmployeeProfileField[],
  values: Record<string, EmployeeProfileValue | "">
): Employee {
  const next = { ...employee, profileValues: { ...(employee.profileValues ?? {}) } };
  const writable = next as unknown as Record<string, unknown>;
  for (const field of fields) {
    const raw = values[field.id];
    const value = normalizeValue(raw, field);
    if (field.builtInKey) {
      writable[field.builtInKey] = value;
    } else if (value === undefined) {
      delete next.profileValues![field.id];
    } else {
      next.profileValues![field.id] = value;
    }
  }
  if (Object.keys(next.profileValues!).length === 0) {
    const { profileValues: _empty, ...withoutEmptyValues } = next;
    return withoutEmptyValues;
  }
  return next;
}

function normalizeValue(value: EmployeeProfileValue | "" | undefined, field: EmployeeProfileField): EmployeeProfileValue | undefined {
  if (field.type === "boolean") return typeof value === "boolean" ? value : undefined;
  if (field.type === "multi_choice") return Array.isArray(value) && value.length ? value : undefined;
  if (typeof value !== "string") return undefined;
  const clean = value.trim();
  return clean || undefined;
}

export function profileFieldHref(field: EmployeeProfileField, value: string): string | undefined {
  if (!value) return undefined;
  if (field.type === "email") return `mailto:${value}`;
  if (field.type === "phone") return `tel:${value}`;
  if (field.type === "url" && /^(https?:\/\/)/i.test(value)) return value;
  return undefined;
}
