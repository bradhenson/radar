import { describe, expect, it } from "vitest";
import type { Task } from "../../src/domain/models";
import { projectProgress } from "../../src/domain/rules/projectProgress";

const t = (p: Partial<Task>) => ({ projectId: "p1", status: "open", isArchived: false, ...p }) as Task;

describe("projectProgress", () => {
  it("counts completed tasks as done even once archived, and leaves out cancelled and abandoned ones", () => {
    const result = projectProgress(
      [
        t({ status: "complete", isArchived: true }),
        t({ status: "complete" }),
        t({ dueDate: "2026-11-01" }),
        t({ dueDate: "2026-11-20" }),
        t({ dueDate: "2026-11-15", status: "waiting" }),
        t({}),
        t({ status: "cancelled" }),
        t({ isArchived: true }),
        t({ projectId: "p2" })
      ],
      "p1",
      "2026-11-13"
    );
    expect(result).toEqual({ total: 6, done: 2, open: 4, overdue: 1, nextDue: "2026-11-15" });
  });

  it("is empty for a project with no tasks", () => {
    expect(projectProgress([], "p1", "2026-11-13")).toEqual({ total: 0, done: 0, open: 0, overdue: 0, nextDue: undefined });
  });

  it("treats a task due today as next, not overdue", () => {
    expect(projectProgress([t({ dueDate: "2026-11-13" })], "p1", "2026-11-13")).toMatchObject({ overdue: 0, nextDue: "2026-11-13" });
  });
});
