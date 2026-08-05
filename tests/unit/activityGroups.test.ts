import { describe, expect, it } from "vitest";
import type { ActivityEntry } from "../../src/domain/models";
import { groupActivityEntries, monthLabel } from "../../src/domain/rules/activityGroups";

// Wednesday. The week starts Sunday, so this week began 2026-08-02.
const TODAY = "2026-08-05";

let seq = 0;
/** Local noon, so the entry lands on `day` regardless of the runner's zone. */
function entry(day: string): ActivityEntry {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return {
    id: `e${++seq}`,
    timestamp: new Date(y, m - 1, d, 12, 0, 0).toISOString(),
    entityType: "tasks",
    entityId: "t1",
    actionType: "updated",
    summary: `changed something on ${day}`
  } as ActivityEntry;
}

function group(days: string[]): { key: string; title: string; count: number }[] {
  return groupActivityEntries(days.map(entry), TODAY).map((g) => ({
    key: g.key,
    title: g.title,
    count: g.entries.length
  }));
}

describe("groupActivityEntries", () => {
  it("buckets the recent past by day, week, and last week", () => {
    expect(group(["2026-08-05", "2026-08-04", "2026-08-03", "2026-08-02", "2026-07-30"])).toEqual([
      { key: "today", title: "Today", count: 1 },
      { key: "yesterday", title: "Yesterday", count: 1 },
      { key: "this-week", title: "Earlier this week", count: 2 },
      { key: "last-week", title: "Last week", count: 1 }
    ]);
  });

  it("puts anything older into calendar months, newest month first", () => {
    expect(group(["2026-07-20", "2026-06-02", "2026-07-01"])).toEqual([
      { key: "2026-07", title: "July 2026", count: 2 },
      { key: "2026-06", title: "June 2026", count: 1 }
    ]);
  });

  it("drops empty groups", () => {
    expect(group(["2026-08-05"])).toEqual([{ key: "today", title: "Today", count: 1 }]);
    expect(group([])).toEqual([]);
  });

  it("keeps a future-dated entry with today rather than in a future month", () => {
    expect(group(["2026-09-09"])).toEqual([{ key: "today", title: "Today", count: 1 }]);
  });

  it("preserves the order entries arrive in within a group", () => {
    const entries = [entry("2026-07-20"), entry("2026-07-01"), entry("2026-07-15")];
    const [july] = groupActivityEntries(entries, TODAY);
    expect(july?.entries.map((e) => e.summary)).toEqual([
      "changed something on 2026-07-20",
      "changed something on 2026-07-01",
      "changed something on 2026-07-15"
    ]);
  });

  it("starts the week on Sunday", () => {
    // 2026-08-02 is a Sunday: it belongs to this week, 2026-08-01 to last week.
    expect(group(["2026-08-02"])).toEqual([{ key: "this-week", title: "Earlier this week", count: 1 }]);
    expect(group(["2026-08-01"])).toEqual([{ key: "last-week", title: "Last week", count: 1 }]);
  });

  it("treats a Sunday today as its own week", () => {
    const sunday = "2026-08-02";
    const grouped = groupActivityEntries([entry("2026-08-01"), entry("2026-07-26")], sunday);
    expect(grouped.map((g) => g.key)).toEqual(["yesterday", "last-week"]);
  });
});

describe("monthLabel", () => {
  it("spells out the month", () => {
    expect(monthLabel("2026-01")).toBe("January 2026");
    expect(monthLabel("2025-12")).toBe("December 2025");
  });
});
