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

/**
 * The working stages a nomination moves through in order. Everything after
 * Submitted is a decision (Approved, Not selected) or a close-out, which is a
 * choice rather than a next step, so it stays in the edit form.
 */
export const AWARD_PIPELINE = ["Idea", "Gathering input", "Drafting", "Ready for review", "Submitted"] as const;

/** The stage one click would move an award to, or undefined once it is submitted or closed. */
export function nextAwardStatus(status: string): string | undefined {
  const index = (AWARD_PIPELINE as readonly string[]).indexOf(status);
  return index >= 0 && index < AWARD_PIPELINE.length - 1 ? AWARD_PIPELINE[index + 1] : undefined;
}
