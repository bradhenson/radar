// Awards list filtering (plan 12.10, 21). Pure: records in, filtered and
// ordered records out. The employee name is resolved by the caller so this
// stays free of store imports.

import type { AwardRecord, PerformanceInput } from "../models";
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

// ---------------------------------------------------------------------------
// Stage tracker (the same drawing as Travel's IPT → DTS → Trip → Voucher).

export type AwardStepState = "done" | "current" | "todo" | "late";

export interface AwardStep {
  key: string;
  /** Short label under the marker. */
  label: string;
  state: AwardStepState;
  /** Full words for the tooltip and screen readers. */
  detail: string;
  /** What one click on this step would do, when it can be advanced from the list. */
  action?: string;
}

const AWARD_STEP_LABELS: Record<(typeof AWARD_PIPELINE)[number], string> = {
  Idea: "Idea",
  "Gathering input": "Input",
  Drafting: "Draft",
  "Ready for review": "Review",
  Submitted: "Submit"
};

/** Statuses after Submitted: the nomination's work is finished. */
const AWARD_DECIDED = new Set(["Approved", "Not selected", "Complete"]);

/**
 * One step per pipeline stage. Stages before the current one are done; the
 * current one is marked late when the nomination due date has passed before
 * submission; the next stage is the one a click moves to. A decided award shows
 * every stage done. A status outside the pipeline has no tracker.
 */
export function awardSteps(status: string, nominationDueDate: string | undefined, today: string): AwardStep[] {
  const decided = AWARD_DECIDED.has(status);
  const index = (AWARD_PIPELINE as readonly string[]).indexOf(status);
  if (index < 0 && !decided) return [];
  const last = AWARD_PIPELINE.length - 1;
  const overdue = Boolean(nominationDueDate && nominationDueDate < today);
  return AWARD_PIPELINE.map((stage, i) => {
    let state: AwardStepState;
    if (decided || i < index || (i === index && i === last)) state = "done";
    else if (i === index) state = overdue ? "late" : "current";
    else state = "todo";
    const step: AwardStep = {
      key: stage,
      label: AWARD_STEP_LABELS[stage],
      state,
      detail:
        state === "done"
          ? `${stage}: done`
          : state === "late"
            ? `${stage}: current stage, nomination past due`
            : state === "current"
              ? `${stage}: current stage`
              : `${stage}: not started`
    };
    if (!decided && i === index + 1) step.action = `Move to ${stage}`;
    return step;
  });
}

// ---------------------------------------------------------------------------
// Performance inputs → nomination text.

type CitationInput = { inputDate: string; actionOrAccomplishment: PerformanceInput["actionOrAccomplishment"]; result?: PerformanceInput["result"] };

/** One line per input, oldest first: "- Did the thing. Result: it worked." */
export function citationLines(inputs: CitationInput[]): string {
  return [...inputs]
    .sort((a, b) => (a.inputDate < b.inputDate ? -1 : a.inputDate > b.inputDate ? 1 : 0))
    .map((input) => {
      const action = richTextDocToPlainText(input.actionOrAccomplishment).replace(/\s+/g, " ").trim();
      const result = richTextDocToPlainText(input.result).replace(/\s+/g, " ").trim();
      return `- ${action}${result ? ` Result: ${result}` : ""}`;
    })
    .filter((line) => line !== "- ")
    .join("\n");
}

/** Adds text to the end of a draft, never replacing what is there. */
export function appendToDraft(existing: string | undefined, addition: string): string {
  const before = (existing ?? "").trimEnd();
  if (!addition.trim()) return existing ?? "";
  return before ? `${before}\n\n${addition}` : addition;
}
