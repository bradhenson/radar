import { describe, expect, it } from "vitest";
import type { Task } from "../../src/domain/models";
import { matchesBoardSummaryFilter, type BoardSummaryFilter } from "../../src/domain/rules/boardFilters";
import { ANY_PROJECT, matchesProjectFilter, NO_PROJECT } from "../../src/domain/rules/boardFilters";

const TODAY = "2026-07-20";
const DUE_SOON_DAYS = 7;

function task(overrides: Partial<Pick<Task, "dueDate" | "status" | "priority">> = {}) {
  return {
    status: "open",
    priority: "normal",
    ...overrides
  } as Pick<Task, "dueDate" | "status" | "priority">;
}

function matches(candidate: ReturnType<typeof task>, filter: BoardSummaryFilter): boolean {
  return matchesBoardSummaryFilter(candidate, filter, TODAY, DUE_SOON_DAYS);
}

describe("board summary filters", () => {
  it("does not narrow tasks when no summary filter is selected", () => {
    expect(matches(task({ status: "complete", dueDate: "2026-07-01" }), "")).toBe(true);
  });

  it("matches only overdue incomplete tasks", () => {
    expect(matches(task({ dueDate: "2026-07-19" }), "overdue")).toBe(true);
    expect(matches(task({ dueDate: TODAY }), "overdue")).toBe(false);
    expect(matches(task({ status: "complete", dueDate: "2026-07-19" }), "overdue")).toBe(false);
  });

  it("includes due-today and due-soon tasks in the due-soon filter", () => {
    expect(matches(task({ dueDate: TODAY }), "due_soon")).toBe(true);
    expect(matches(task({ dueDate: "2026-07-27" }), "due_soon")).toBe(true);
    expect(matches(task({ dueDate: "2026-07-28" }), "due_soon")).toBe(false);
    expect(matches(task({ dueDate: "2026-07-19" }), "due_soon")).toBe(false);
  });

  it("matches waiting tasks independently of their due date", () => {
    expect(matches(task({ status: "waiting" }), "waiting")).toBe(true);
    expect(matches(task({ status: "open", dueDate: "2026-07-19" }), "waiting")).toBe(false);
  });

  it("matches high and critical priority tasks", () => {
    expect(matches(task({ priority: "high" }), "priority")).toBe(true);
    expect(matches(task({ priority: "critical" }), "priority")).toBe(true);
    expect(matches(task({ priority: "normal" }), "priority")).toBe(false);
  });
});

describe("matchesProjectFilter", () => {
  it("matches every task when no project filter is set", () => {
    expect(matchesProjectFilter({}, "")).toBe(true);
    expect(matchesProjectFilter({ projectId: "p1" }, "")).toBe(true);
  });

  it("keeps any task with a project for Any project", () => {
    expect(matchesProjectFilter({ projectId: "p1" }, ANY_PROJECT)).toBe(true);
    expect(matchesProjectFilter({}, ANY_PROJECT)).toBe(false);
  });

  it("keeps tasks without a project for No project", () => {
    expect(matchesProjectFilter({}, NO_PROJECT)).toBe(true);
    expect(matchesProjectFilter({ projectId: "" }, NO_PROJECT)).toBe(true);
    expect(matchesProjectFilter({ projectId: "p1" }, NO_PROJECT)).toBe(false);
  });

  it("matches one project by id", () => {
    expect(matchesProjectFilter({ projectId: "p1" }, "p1")).toBe(true);
    expect(matchesProjectFilter({ projectId: "p2" }, "p1")).toBe(false);
  });
});
