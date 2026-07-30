import { describe, expect, it } from "vitest";
import type { Employee } from "../../src/domain/models";
import { activeEmployeesByDisplayName } from "../../src/domain/rules/employees";

const NOW = "2026-07-30T12:00:00.000Z";

function employee(id: string, displayName: string, partial: Partial<Employee> = {}): Employee {
  return {
    id,
    displayName,
    activeStatus: "active",
    tags: [],
    createdAt: NOW,
    updatedAt: NOW,
    isArchived: false,
    ...partial
  };
}

describe("employee picker order", () => {
  it("returns active employees alphabetically by displayed name without mutating the source", () => {
    const source = [
      employee("z", "Zoe Example"),
      employee("a10", "Alex 10"),
      employee("a2", "Alex 2"),
      employee("inactive", "Aaron Inactive", { activeStatus: "departed" }),
      employee("archived", "Abby Archived", { isArchived: true })
    ];

    expect(activeEmployeesByDisplayName(source).map((item) => item.displayName)).toEqual([
      "Alex 2",
      "Alex 10",
      "Zoe Example"
    ]);
    expect(source.map((item) => item.displayName)).toEqual([
      "Zoe Example",
      "Alex 10",
      "Alex 2",
      "Aaron Inactive",
      "Abby Archived"
    ]);
  });
});
