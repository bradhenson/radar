// Import a task into a performance input (plan 17.4/17.5): one shared mapping
// for the completion prompt, the Today page shortcut, and the in-form
// "Import from task" action. Pure — no store or DOM imports.

import type { ChecklistItem, IsoDate, PerformanceInput, Task, TaskNote } from "../models";
import {
  concatRichText,
  isRichTextEmpty,
  normalizeRichText,
  richTextBulletList,
  richTextDocToPlainText,
  richTextFromPlainText,
  type RichTextValue
} from "../../utils/richTextDoc";

export interface TaskImportContext {
  today: IsoDate;
  /** Notes for this task; completion notes become the suggested Result. */
  notes?: TaskNote[];
  /** Checklist items for this task; completed ones are listed under the action. */
  checklistItems?: ChecklistItem[];
}

/** Map a task (plus optional notes/checklist) onto performance input fields. */
export function performanceInputPrefillFromTask(task: Task, ctx: TaskImportContext): Partial<PerformanceInput> {
  const completedChecklist = (ctx.checklistItems ?? [])
    .filter((c) => c.taskId === task.id && c.isComplete)
    .sort((a, b) => a.order - b.order)
    .map((c) => c.title);
  // The title is plain text, so it is wrapped rather than parsed; a task called
  // "1. Rewrite the SOP" must not become a numbered list.
  const action = concatRichText(richTextFromPlainText(task.title), richTextBulletList(completedChecklist));

  const completionNotes = (ctx.notes ?? [])
    .filter((n) => n.taskId === task.id && n.noteType === "completion")
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))
    .map((n) => normalizeRichText(n.body));

  return {
    employeeId: task.employeeId,
    inputDate: task.completedDate ?? ctx.today,
    situationOrContext: isRichTextEmpty(task.description) ? undefined : normalizeRichText(task.description),
    actionOrAccomplishment: action,
    result: completionNotes.length ? concatRichText(...completionNotes) : undefined,
    projectId: task.projectId,
    relatedTaskId: task.id,
    source: task.status === "complete" ? "Completed Task" : "Task"
  };
}

/**
 * After a new performance input is saved for a task, decide whether to offer
 * archiving that task: only finished work still visible on the board — never
 * open/waiting tasks, and never tasks already archived.
 */
export function shouldOfferTaskArchive(task: Task): boolean {
  return task.status === "complete" && !task.isArchived;
}

/** The free-form fields a task import can fill in the performance input form. */
export interface PerformanceInputDraftFields {
  employeeId: string;
  inputDate: string;
  situationOrContext: RichTextValue;
  actionOrAccomplishment: RichTextValue;
  result: RichTextValue;
  projectId: string;
}

/** The draft fields holding a document rather than a scalar. */
const RICH_TEXT_DRAFT_FIELDS = ["situationOrContext", "actionOrAccomplishment", "result"] as const;

type RichTextDraftField = (typeof RICH_TEXT_DRAFT_FIELDS)[number];

function isRichTextDraftField(key: keyof PerformanceInputDraftFields): key is RichTextDraftField {
  return (RICH_TEXT_DRAFT_FIELDS as readonly string[]).includes(key);
}

export interface TaskImportMergeResult {
  merged: PerformanceInputDraftFields;
  /** Human-readable names of fields left unchanged because they already had content. */
  skipped: string[];
}

const FIELD_LABELS: Record<keyof PerformanceInputDraftFields, string> = {
  employeeId: "Employee",
  inputDate: "Date",
  situationOrContext: "Context",
  actionOrAccomplishment: "Action",
  result: "Result / Impact",
  projectId: "Project"
};

/**
 * Apply an import onto in-progress form fields without discarding anything the
 * user already typed or selected: only empty fields are filled (plan 38.7 —
 * never silently overwrite). Callers pass inputDate as "" when the user has not
 * touched the default, so an untouched date can still be taken from the task.
 */
export function mergeTaskImportIntoDraft(
  draft: PerformanceInputDraftFields,
  prefill: Partial<PerformanceInput>
): TaskImportMergeResult {
  const merged = { ...draft };
  const skipped: string[] = [];

  const scalars = {
    employeeId: prefill.employeeId,
    inputDate: prefill.inputDate,
    projectId: prefill.projectId
  } satisfies Partial<Record<keyof PerformanceInputDraftFields, string | undefined>>;

  for (const key of Object.keys(FIELD_LABELS) as (keyof PerformanceInputDraftFields)[]) {
    if (isRichTextDraftField(key)) {
      const value = prefill[key];
      if (value === undefined || isRichTextEmpty(value)) continue;
      if (!isRichTextEmpty(draft[key])) {
        if (
          richTextDocToPlainText(draft[key]).trim() !== richTextDocToPlainText(value).trim() &&
          !skipped.includes(FIELD_LABELS[key])
        ) {
          skipped.push(FIELD_LABELS[key]);
        }
        continue;
      }
      merged[key] = normalizeRichText(value);
      continue;
    }

    const value = scalars[key];
    if (!value) continue;
    if (draft[key].trim()) {
      if (draft[key].trim() !== value.trim() && !skipped.includes(FIELD_LABELS[key])) skipped.push(FIELD_LABELS[key]);
      continue;
    }
    merged[key] = value;
  }
  return { merged, skipped };
}
