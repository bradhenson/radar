import { describe, expect, it } from "vitest";
import { sortTaskListRows, type TaskListRow } from "../../src/domain/rules/taskListSort";
import type { Task, TaskPriority, TaskStatus } from "../../src/domain/models";

let seq = 0;
function task(overrides: Partial<Task> = {}): Task {
  seq += 1;
  return {
    id: `t${seq}`,
    title: `Task ${seq}`,
    status: "open",
    priority: "normal",
    isArchived: false,
    performanceInputCreated: false,
    boardOrder: seq * 1000,
    tags: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides
  } as Task;
}

function row(overrides: Partial<Omit<TaskListRow, "task">> & { task?: Partial<Task> } = {}): TaskListRow {
  const { task: taskOverrides, ...rest } = overrides;
  return {
    task: task(taskOverrides),
    employeeName: "",
    projectName: "",
    columnLabel: "Inbox",
    columnIndex: 0,
    ...rest
  };
}

const titles = (rows: TaskListRow[]) => rows.map((r) => r.task.title);

describe("sortTaskListRows", () => {
  it("sorts by title in both directions", () => {
    const rows = [
      row({ task: { title: "Beta" } }),
      row({ task: { title: "alpha" } }),
      row({ task: { title: "Gamma" } })
    ];
    expect(titles(sortTaskListRows(rows, "title", "asc"))).toEqual(["alpha", "Beta", "Gamma"]);
    expect(titles(sortTaskListRows(rows, "title", "desc"))).toEqual(["Gamma", "Beta", "alpha"]);
  });

  it("does not mutate the rows it was given", () => {
    const rows = [row({ task: { title: "B" } }), row({ task: { title: "A" } })];
    sortTaskListRows(rows, "title", "asc");
    expect(titles(rows)).toEqual(["B", "A"]);
  });

  it("orders priority by rank rather than alphabetically", () => {
    const rows = (["normal", "critical", "low", "high"] as TaskPriority[]).map((priority) =>
      row({ task: { title: priority, priority } })
    );
    expect(titles(sortTaskListRows(rows, "priority", "desc"))).toEqual(["critical", "high", "normal", "low"]);
    expect(titles(sortTaskListRows(rows, "priority", "asc"))).toEqual(["low", "normal", "high", "critical"]);
  });

  it("orders status with open work ahead of finished work", () => {
    const rows = (["complete", "open", "waiting"] as TaskStatus[]).map((status) =>
      row({ task: { title: status, status } })
    );
    expect(titles(sortTaskListRows(rows, "status", "asc"))).toEqual(["open", "waiting", "complete"]);
  });

  it("orders the column by board position, not by label text", () => {
    const rows = [
      row({ columnLabel: "Done", columnIndex: 2, task: { title: "third" } }),
      row({ columnLabel: "Inbox", columnIndex: 0, task: { title: "first" } }),
      row({ columnLabel: "Active", columnIndex: 1, task: { title: "second" } })
    ];
    expect(titles(sortTaskListRows(rows, "column", "asc"))).toEqual(["first", "second", "third"]);
  });

  it("sorts due dates as calendar dates", () => {
    const rows = [
      row({ task: { title: "later", dueDate: "2026-09-02" } }),
      row({ task: { title: "sooner", dueDate: "2026-08-31" } })
    ];
    expect(titles(sortTaskListRows(rows, "due", "asc"))).toEqual(["sooner", "later"]);
  });

  // Reversing the sort is meant to flip the answers, not to promote the rows
  // that have no answer at all.
  it("keeps rows with no value at the bottom in both directions", () => {
    const rows = [
      row({ task: { title: "none" } }),
      row({ task: { title: "later", dueDate: "2026-09-02" } }),
      row({ task: { title: "sooner", dueDate: "2026-08-31" } })
    ];
    expect(titles(sortTaskListRows(rows, "due", "asc"))).toEqual(["sooner", "later", "none"]);
    expect(titles(sortTaskListRows(rows, "due", "desc"))).toEqual(["later", "sooner", "none"]);
  });

  it("keeps unassigned and unlinked rows at the bottom too", () => {
    const rows = [
      row({ employeeName: "", projectName: "", task: { title: "none" } }),
      row({ employeeName: "Kim Osei", projectName: "Harbor", task: { title: "assigned" } })
    ];
    expect(titles(sortTaskListRows(rows, "employee", "desc"))).toEqual(["assigned", "none"]);
    expect(titles(sortTaskListRows(rows, "project", "desc"))).toEqual(["assigned", "none"]);
  });

  // Sorting by column reproduces the board exactly, so switching views does not
  // reshuffle work the supervisor ordered by hand.
  it("breaks ties by board column and hand ordering", () => {
    const rows = [
      row({ columnIndex: 1, task: { title: "second column, later", boardOrder: 2000, priority: "high" } }),
      row({ columnIndex: 0, task: { title: "first column, later", boardOrder: 2000, priority: "high" } }),
      row({ columnIndex: 0, task: { title: "first column, first", boardOrder: 1000, priority: "high" } })
    ];
    expect(titles(sortTaskListRows(rows, "priority", "asc"))).toEqual([
      "first column, first",
      "first column, later",
      "second column, later"
    ]);
  });

  it("returns an empty list unchanged", () => {
    expect(sortTaskListRows([], "title", "asc")).toEqual([]);
  });
});
