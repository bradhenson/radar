// Import a task into a performance input (plan 17.4/17.5): one shared mapping
// for the completion prompt, the Today page shortcut, and the in-form
// "Import from task" action. Pure — no store or DOM imports.

import type { ChecklistItem, IsoDate, PerformanceInput, Task, TaskNote } from "../models";

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
    .map((c) => `- ${c.title}`);
  const action = [task.title, ...completedChecklist].join("\n");

  const completionNotes = (ctx.notes ?? [])
    .filter((n) => n.taskId === task.id && n.noteType === "completion")
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))
    .map((n) => n.body);

  return {
    employeeId: task.employeeId,
    inputDate: task.completedDate ?? ctx.today,
    situationOrContext: task.description || undefined,
    actionOrAccomplishment: action,
    result: completionNotes.length ? completionNotes.join("\n") : undefined,
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
  situationOrContext: string;
  actionOrAccomplishment: string;
  result: string;
  projectId: string;
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
  const incoming: Partial<Record<keyof PerformanceInputDraftFields, string | undefined>> = {
    employeeId: prefill.employeeId,
    inputDate: prefill.inputDate,
    situationOrContext: prefill.situationOrContext,
    actionOrAccomplishment: prefill.actionOrAccomplishment,
    result: prefill.result,
    projectId: prefill.projectId
  };
  const merged = { ...draft };
  const skipped: string[] = [];
  for (const key of Object.keys(FIELD_LABELS) as (keyof PerformanceInputDraftFields)[]) {
    const value = incoming[key];
    if (!value) continue;
    if (draft[key].trim()) {
      if (draft[key].trim() !== value.trim() && !skipped.includes(FIELD_LABELS[key])) skipped.push(FIELD_LABELS[key]);
      continue;
    }
    merged[key] = value;
  }
  return { merged, skipped };
}
