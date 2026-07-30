import type { Employee } from "../models";

const DISPLAY_NAME_COLLATOR = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });

/**
 * The shared source for employee pickers: active records only, ordered by the
 * name the control actually displays. A copied array keeps the store's source
 * order untouched.
 */
export function activeEmployeesByDisplayName(employees: readonly Employee[]): Employee[] {
  return employees
    .filter((employee) => employee.activeStatus === "active" && !employee.isArchived)
    .sort(
      (a, b) =>
        DISPLAY_NAME_COLLATOR.compare(a.displayName, b.displayName) ||
        a.id.localeCompare(b.id)
    );
}
