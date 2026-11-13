// Saved views for the Tasks page (pure). A view is a named set of the page's
// filters. Views live in AppSettings, so they travel with backups; that makes
// them part of the untrusted import surface and they are normalized on load.

import type { SavedBoardView } from "../models";

export const MAX_SAVED_VIEWS = 30;
export const SAVED_VIEW_NAME_MAX = 60;

const SUMMARY_FILTERS = new Set(["", "due_soon", "overdue", "waiting", "priority"]);
const PRIORITIES = new Set(["", "low", "normal", "high", "critical"]);
const WORK_TYPES = new Set(["", "project", "competency"]);

/** The filter fields a view stores, in the shape the Tasks page holds them. */
export type BoardViewFilters = Omit<SavedBoardView, "id" | "name">;

export const EMPTY_BOARD_FILTERS: BoardViewFilters = {
  search: "",
  employee: "",
  competency: "",
  project: "",
  priority: "",
  summary: "",
  workType: ""
};

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.slice(0, max) : "";
}

/** Keeps well-formed views, drops anything else, and never lets two share an id or a name. */
export function normalizeSavedBoardViews(raw: unknown): SavedBoardView[] {
  if (!Array.isArray(raw)) return [];
  const views: SavedBoardView[] = [];
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const item of raw) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) continue;
    const src = item as Record<string, unknown>;
    const id = text(src.id, 100);
    const name = text(src.name, SAVED_VIEW_NAME_MAX).trim();
    if (!id || !name || ids.has(id) || names.has(name.toLowerCase())) continue;
    const summary = text(src.summary, 20);
    const priority = text(src.priority, 20);
    const workType = text(src.workType, 20);
    ids.add(id);
    names.add(name.toLowerCase());
    views.push({
      id,
      name,
      search: text(src.search, 200),
      employee: text(src.employee, 100),
      competency: text(src.competency, 100),
      project: text(src.project, 100),
      priority: PRIORITIES.has(priority) ? priority : "",
      summary: (SUMMARY_FILTERS.has(summary) ? summary : "") as SavedBoardView["summary"],
      workType: (WORK_TYPES.has(workType) ? workType : "") as SavedBoardView["workType"]
    });
    if (views.length >= MAX_SAVED_VIEWS) break;
  }
  return views;
}

export function filtersAreEmpty(filters: BoardViewFilters): boolean {
  return Object.values(filters).every((value) => !value);
}

export function sameFilters(a: BoardViewFilters, b: BoardViewFilters): boolean {
  return (Object.keys(EMPTY_BOARD_FILTERS) as (keyof BoardViewFilters)[]).every((key) => (a[key] ?? "") === (b[key] ?? ""));
}

/** The saved view the current filters exactly match, if any. */
export function matchingView(views: SavedBoardView[], filters: BoardViewFilters): SavedBoardView | undefined {
  return views.find((view) => sameFilters(view, filters));
}

/** Why a view cannot be saved under this name, or undefined when it can. */
export function savedViewNameError(name: string, views: SavedBoardView[], filters: BoardViewFilters): string | undefined {
  const trimmed = name.trim();
  if (!trimmed) return "Give the view a name.";
  if (trimmed.length > SAVED_VIEW_NAME_MAX) return `Keep the name to ${SAVED_VIEW_NAME_MAX} characters or fewer.`;
  if (filtersAreEmpty(filters)) return "Set at least one filter before saving a view.";
  if (views.some((view) => view.name.toLowerCase() === trimmed.toLowerCase())) return `A view named "${trimmed}" already exists.`;
  if (views.length >= MAX_SAVED_VIEWS) return `You can keep up to ${MAX_SAVED_VIEWS} saved views. Delete one first.`;
  return undefined;
}

/**
 * The filters to apply for a view. A person, competency, or project that no
 * longer exists is dropped, so a stale view widens rather than showing an
 * empty board with a filter the menus can no longer display.
 */
export function filtersForView(
  view: SavedBoardView,
  existing: { employees: ReadonlySet<string>; competencies: ReadonlySet<string>; projects: ReadonlySet<string> }
): BoardViewFilters {
  return {
    search: view.search,
    employee: existing.employees.has(view.employee) ? view.employee : "",
    competency: existing.competencies.has(view.competency) ? view.competency : "",
    project: existing.projects.has(view.project) ? view.project : "",
    priority: view.priority,
    summary: view.summary,
    workType: view.workType ?? ""
  };
}
