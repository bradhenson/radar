// Global search (plan section 24.1). Pure functions: collections in, ranked
// results out. The index is rebuilt only when data changes; queries then run
// against pre-flattened text so keystrokes never re-parse rich text.

import type { Employee, MeetingNote, PerformanceInput, Project, Task } from "../models";
import { richTextToPlainText } from "../../utils/richText";

export type SearchResultType = "task" | "employee" | "project" | "meeting" | "performance" | "page";

export interface SearchEntry {
  type: SearchResultType;
  id: string;
  /** Primary line shown in results and matched with title weight. */
  title: string;
  /** Secondary context line (employee, project, date). */
  subtitle: string;
  /** Lowercased searchable text beyond the title (bodies, names, tags). */
  haystack: string;
  /** Lowercased title, precomputed for ranking. */
  titleLower: string;
}

export interface SearchIndexSource {
  tasks: Task[];
  employees: Employee[];
  projects: Project[];
  meetingNotes: MeetingNote[];
  performanceInputs: PerformanceInput[];
  /** Navigation destinations, e.g. [{ page: "board", label: "Board" }]. */
  pages: { page: string; label: string }[];
  employeeName: (id: string | undefined) => string;
  projectName: (id: string | undefined) => string;
  formatDate: (date: string | undefined) => string;
}

const TYPE_LABEL: Record<SearchResultType, string> = {
  task: "Task",
  employee: "Employee",
  project: "Project",
  meeting: "Meeting note",
  performance: "Performance input",
  page: "Go to page"
};

export function searchTypeLabel(type: SearchResultType): string {
  return TYPE_LABEL[type];
}

/** Build the searchable entries. Archived records are excluded (plan 24.2). */
export function buildSearchIndex(src: SearchIndexSource): SearchEntry[] {
  const entries: SearchEntry[] = [];

  for (const item of src.pages) {
    entries.push(entry("page", item.page, item.label, "", ""));
  }

  for (const e of src.employees) {
    if (e.isArchived || e.activeStatus === "archived") continue;
    entries.push(
      entry("employee", e.id, e.displayName, e.positionTitle ?? "", [e.preferredName, e.team, ...e.tags].filter(Boolean).join(" "))
    );
  }

  for (const p of src.projects) {
    if (p.isArchived) continue;
    entries.push(
      entry("project", p.id, p.name, p.status.replace("_", " "), [p.shortName, p.description, ...p.tags].filter(Boolean).join(" "))
    );
  }

  for (const t of src.tasks) {
    if (t.isArchived || t.status === "cancelled") continue;
    const subtitle = [
      t.status === "complete" ? "Complete" : undefined,
      src.employeeName(t.employeeId) || undefined,
      src.projectName(t.projectId) || undefined,
      t.dueDate ? `due ${src.formatDate(t.dueDate)}` : undefined
    ]
      .filter(Boolean)
      .join(" · ");
    entries.push(entry("task", t.id, t.title, subtitle, [t.description, ...t.tags].filter(Boolean).join(" ")));
  }

  for (const note of src.meetingNotes) {
    if (note.isArchived) continue;
    const attendees = note.attendeeEmployeeIds.map((id) => src.employeeName(id)).filter(Boolean).join(" ");
    const subtitle = [src.formatDate(note.meetingDate), note.meetingType, src.projectName(note.projectId) || undefined]
      .filter(Boolean)
      .join(" · ");
    entries.push(
      entry(
        "meeting",
        note.id,
        note.title,
        subtitle,
        [attendees, richTextToPlainText(note.notes), richTextToPlainText(note.actionItems)].join(" ")
      )
    );
  }

  for (const input of src.performanceInputs) {
    if (input.isArchived) continue;
    const action = richTextToPlainText(input.actionOrAccomplishment).replace(/\s*\n\s*/g, " ");
    const title = `${src.employeeName(input.employeeId)} — ${truncate(action, 80)}`;
    const subtitle = [src.formatDate(input.inputDate), src.projectName(input.projectId) || undefined].filter(Boolean).join(" · ");
    entries.push(
      entry(
        "performance",
        input.id,
        title,
        subtitle,
        [richTextToPlainText(input.situationOrContext), richTextToPlainText(input.result)].join(" ")
      )
    );
  }

  return entries;
}

function entry(type: SearchResultType, id: string, title: string, subtitle: string, haystack: string): SearchEntry {
  return { type, id, title, subtitle, titleLower: title.toLowerCase(), haystack: haystack.toLowerCase() };
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max - 1).trimEnd() + "…";
}

export interface SearchOptions {
  /** Cap per result type so one noisy collection can't bury the rest. */
  perTypeLimit?: number;
  totalLimit?: number;
}

/**
 * Every whitespace-separated term must match the title or haystack.
 * Title matches rank above body matches; prefix-of-title ranks highest.
 */
export function querySearchIndex(index: SearchEntry[], query: string, options: SearchOptions = {}): SearchEntry[] {
  const perTypeLimit = options.perTypeLimit ?? 5;
  const totalLimit = options.totalLimit ?? 25;
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];

  const scored: { entry: SearchEntry; score: number }[] = [];
  for (const item of index) {
    let score = 0;
    let matched = true;
    for (const term of terms) {
      const inTitle = item.titleLower.includes(term);
      const inBody = item.haystack.includes(term);
      if (!inTitle && !inBody) {
        matched = false;
        break;
      }
      score += inTitle ? (item.titleLower.startsWith(term) ? 30 : 20) : 5;
    }
    if (matched) scored.push({ entry: item, score });
  }

  scored.sort((a, b) => b.score - a.score || a.entry.title.localeCompare(b.entry.title));

  const perType = new Map<SearchResultType, number>();
  const out: SearchEntry[] = [];
  for (const { entry: item } of scored) {
    const used = perType.get(item.type) ?? 0;
    if (used >= perTypeLimit) continue;
    perType.set(item.type, used + 1);
    out.push(item);
    if (out.length >= totalLimit) break;
  }
  return out;
}
