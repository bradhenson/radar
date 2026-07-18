import { describe, expect, it } from "vitest";
import { buildSearchIndex, querySearchIndex, type SearchIndexSource } from "../../src/domain/rules/search";
import type { Employee, MeetingNote, PerformanceInput, Project, Task } from "../../src/domain/models";

const NOW = "2026-01-01T00:00:00.000Z";

function employee(partial: Partial<Employee> & { id: string; displayName: string }): Employee {
  return {
    activeStatus: "active",
    tags: [],
    createdAt: NOW,
    updatedAt: NOW,
    isArchived: false,
    ...partial
  };
}

function task(partial: Partial<Task> & { id: string; title: string }): Task {
  return {
    status: "open",
    priority: "normal",
    performanceInputCreated: false,
    tags: [],
    boardOrder: 1000,
    createdAt: NOW,
    updatedAt: NOW,
    isArchived: false,
    ...partial
  };
}

function project(partial: Partial<Project> & { id: string; name: string }): Project {
  return { status: "active", tags: [], createdAt: NOW, updatedAt: NOW, isArchived: false, ...partial };
}

function meetingNote(partial: Partial<MeetingNote> & { id: string; title: string }): MeetingNote {
  return {
    meetingDate: "2026-01-05",
    meetingType: "Staff",
    attendeeEmployeeIds: [],
    createdAt: NOW,
    updatedAt: NOW,
    isArchived: false,
    ...partial
  };
}

function performanceInput(partial: Partial<PerformanceInput> & { id: string; employeeId: string }): PerformanceInput {
  return {
    inputDate: "2026-01-05",
    actionOrAccomplishment: "Did notable work",
    inputStatus: "draft",
    recognitionPotential: false,
    tags: [],
    createdAt: NOW,
    updatedAt: NOW,
    isArchived: false,
    ...partial
  };
}

function source(overrides: Partial<SearchIndexSource> = {}): SearchIndexSource {
  return {
    tasks: [],
    employees: [],
    projects: [],
    meetingNotes: [],
    performanceInputs: [],
    pages: [{ page: "board", label: "Board" }],
    employeeName: (id) => (id === "e1" ? "Alex Sample" : ""),
    projectName: (id) => (id === "p1" ? "Falcon" : ""),
    formatDate: (d) => d ?? "",
    ...overrides
  };
}

describe("search index", () => {
  it("excludes archived and cancelled records", () => {
    const index = buildSearchIndex(
      source({
        tasks: [task({ id: "t1", title: "Live task" }), task({ id: "t2", title: "Gone", isArchived: true }), task({ id: "t3", title: "Nope", status: "cancelled" })],
        employees: [employee({ id: "e1", displayName: "Alex Sample" }), employee({ id: "e2", displayName: "Old Timer", isArchived: true })],
        meetingNotes: [meetingNote({ id: "m1", title: "Sync" }), meetingNote({ id: "m2", title: "Hidden", isArchived: true })],
        performanceInputs: [performanceInput({ id: "pi1", employeeId: "e1" }), performanceInput({ id: "pi2", employeeId: "e1", isArchived: true })]
      })
    );
    const ids = index.map((entry) => entry.id);
    expect(ids).toContain("t1");
    expect(ids).not.toContain("t2");
    expect(ids).not.toContain("t3");
    expect(ids).toContain("e1");
    expect(ids).not.toContain("e2");
    expect(ids).toContain("m1");
    expect(ids).not.toContain("m2");
    expect(ids).toContain("pi1");
    expect(ids).not.toContain("pi2");
  });

  it("flattens rich text bodies into the haystack", () => {
    const index = buildSearchIndex(
      source({
        meetingNotes: [meetingNote({ id: "m1", title: "Sync", notes: "Discussed **budget cuts** today" })]
      })
    );
    const note = index.find((entry) => entry.id === "m1")!;
    expect(note.haystack).toContain("budget cuts");
    expect(note.haystack).not.toContain("**");
  });

  it("requires every term to match and ranks title over body", () => {
    const index = buildSearchIndex(
      source({
        tasks: [
          task({ id: "t1", title: "Budget review" }),
          task({ id: "t2", title: "Other work", description: "mentions budget in passing" }),
          task({ id: "t3", title: "Unrelated" })
        ]
      })
    );
    const results = querySearchIndex(index, "budget");
    expect(results.map((r) => r.id)).toEqual(["t1", "t2"]);

    expect(querySearchIndex(index, "budget review").map((r) => r.id)).toEqual(["t1"]);
    expect(querySearchIndex(index, "budget zebra")).toEqual([]);
  });

  it("caps results per type", () => {
    const many = Array.from({ length: 10 }, (_, i) => task({ id: `t${i}`, title: `Widget ${i}` }));
    const index = buildSearchIndex(source({ tasks: many }));
    expect(querySearchIndex(index, "widget", { perTypeLimit: 5 })).toHaveLength(5);
  });

  it("returns nothing for an empty query", () => {
    const index = buildSearchIndex(source({ tasks: [task({ id: "t1", title: "Anything" })] }));
    expect(querySearchIndex(index, "   ")).toEqual([]);
  });

  it("uses employee name in the performance input title", () => {
    const index = buildSearchIndex(source({ performanceInputs: [performanceInput({ id: "pi1", employeeId: "e1" })] }));
    const entry = index.find((item) => item.id === "pi1")!;
    expect(entry.title).toContain("Alex Sample");
    expect(querySearchIndex(index, "alex").some((r) => r.id === "pi1")).toBe(true);
  });
});
