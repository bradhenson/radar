// Awards list filtering (plan 12.10, 21). Pure: records in, filtered and
// ordered records out. The employee name is resolved by the caller so this
// stays free of store imports.

import type { AwardRecord } from "../models";
import { richTextDocToPlainText } from "../../utils/richTextDoc";

export interface AwardFilters {
  search?: string;
  employeeId?: string;
  status?: string;
  awardType?: string;
}

/** Nomination due date ascending; records with no due date sort last. */
const NO_DUE_DATE = "9999";

export function filterAwards(
  records: AwardRecord[],
  filters: AwardFilters,
  employeeName: (id: string) => string
): AwardRecord[] {
  const { search, employeeId, status, awardType } = filters;
  const needle = search?.trim().toLowerCase() ?? "";
  return [...records]
    .filter((record) => {
      if (employeeId && record.employeeId !== employeeId) return false;
      if (status && record.status !== status) return false;
      if (awardType && record.awardType !== awardType) return false;
      if (needle) {
        const title = record.title.toLowerCase();
        const type = (record.awardType ?? "").toLowerCase();
        const employee = employeeName(record.employeeId).toLowerCase();
        const notes = richTextDocToPlainText(record.supportingNotes).toLowerCase();
        if (!title.includes(needle) && !employee.includes(needle) && !type.includes(needle) && !notes.includes(needle)) {
          return false;
        }
      }
      return true;
    })
    .sort((a, b) => (a.nominationDueDate ?? NO_DUE_DATE).localeCompare(b.nominationDueDate ?? NO_DUE_DATE));
}

/** The distinct award types actually in use, for the type filter. */
export function awardTypeOptions(records: AwardRecord[]): string[] {
  const types = new Set<string>();
  for (const record of records) {
    const type = record.awardType?.trim();
    if (type) types.add(type);
  }
  return [...types].sort((a, b) => a.localeCompare(b));
}
