import { describe, expect, it } from "vitest";
import type { RecurringTask } from "../../src/domain/models";
import {
  dueOccurrences,
  nextOccurrenceAfter,
  occurrencesBetween,
  planRecurringTasks,
  recurrenceInstanceKey,
  recurrencePresetKey,
  recurrenceSummary,
  recurringTaskError,
  resumeFrom,
  RECURRENCE_PRESETS,
  type RecurrenceSchedule
} from "../../src/domain/rules/recurrence";

// 2026-07-20 is a Monday.
const TODAY = "2026-07-20";

function recurring(overrides: Partial<RecurringTask> = {}): RecurringTask {
  return {
    id: "r1",
    title: "Certify timecards",
    priority: "normal",
    tags: [],
    unit: "weeks",
    interval: 1,
    firstDueDate: "2026-07-24",
    advanceCreateDays: 4,
    active: true,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    ...overrides
  };
}

const schedule = (overrides: Partial<RecurrenceSchedule>): RecurrenceSchedule => ({
  unit: "weeks",
  interval: 1,
  firstDueDate: "2026-07-24",
  ...overrides
});

describe("occurrencesBetween", () => {
  it("steps weekly from the first due date and includes both ends of the range correctly", () => {
    const weekly = schedule({});
    expect(occurrencesBetween(weekly, undefined, "2026-08-14")).toEqual(["2026-07-24", "2026-07-31", "2026-08-07", "2026-08-14"]);
    // `after` is exclusive, `through` is inclusive.
    expect(occurrencesBetween(weekly, "2026-07-24", "2026-08-07")).toEqual(["2026-07-31", "2026-08-07"]);
  });

  it("has nothing before the first due date", () => {
    expect(occurrencesBetween(schedule({}), undefined, "2026-07-23")).toEqual([]);
  });

  it("steps every two weeks for a pay period schedule", () => {
    expect(occurrencesBetween(schedule({ interval: 2, firstDueDate: "2026-07-12" }), undefined, "2026-08-10")).toEqual([
      "2026-07-12",
      "2026-07-26",
      "2026-08-09"
    ]);
  });

  it("keeps a month-end schedule on the last day instead of drifting to the 28th", () => {
    expect(occurrencesBetween(schedule({ unit: "months", firstDueDate: "2026-01-31" }), undefined, "2026-05-31")).toEqual([
      "2026-01-31",
      "2026-02-28",
      "2026-03-31",
      "2026-04-30",
      "2026-05-31"
    ]);
  });

  it("crosses a year boundary on a quarterly schedule", () => {
    expect(occurrencesBetween(schedule({ unit: "months", interval: 3, firstDueDate: "2026-10-15" }), undefined, "2027-04-30")).toEqual([
      "2026-10-15",
      "2027-01-15",
      "2027-04-15"
    ]);
  });

  it("drops weekends from a weekdays-only daily schedule and keeps them otherwise", () => {
    const daily = schedule({ unit: "days", firstDueDate: "2026-07-23" });
    expect(occurrencesBetween({ ...daily, weekdaysOnly: true }, undefined, "2026-07-28")).toEqual([
      "2026-07-23",
      "2026-07-24",
      "2026-07-27",
      "2026-07-28"
    ]);
    expect(occurrencesBetween(daily, undefined, "2026-07-26")).toEqual(["2026-07-23", "2026-07-24", "2026-07-25", "2026-07-26"]);
  });

  it("finds occurrences far from the start without walking the whole history wrong", () => {
    const daily = schedule({ unit: "days", firstDueDate: "2020-01-01" });
    expect(occurrencesBetween(daily, "2026-07-18", "2026-07-20")).toEqual(["2026-07-19", "2026-07-20"]);
    const monthly = schedule({ unit: "months", firstDueDate: "2015-03-31" });
    expect(occurrencesBetween(monthly, "2026-05-31", "2026-08-31")).toEqual(["2026-06-30", "2026-07-31", "2026-08-31"]);
  });

  it("treats a missing or invalid interval as 1 and an invalid date as no schedule", () => {
    expect(occurrencesBetween(schedule({ interval: 0 }), undefined, "2026-07-31")).toEqual(["2026-07-24", "2026-07-31"]);
    expect(occurrencesBetween(schedule({ firstDueDate: "" }), undefined, "2026-07-31")).toEqual([]);
  });
});

describe("nextOccurrenceAfter", () => {
  it("is strictly after the given date", () => {
    expect(nextOccurrenceAfter(schedule({}), "2026-07-23")).toBe("2026-07-24");
    expect(nextOccurrenceAfter(schedule({}), "2026-07-24")).toBe("2026-07-31");
  });

  it("skips the weekend on a weekdays-only schedule", () => {
    expect(nextOccurrenceAfter(schedule({ unit: "days", firstDueDate: "2026-07-20", weekdaysOnly: true }), "2026-07-24")).toBe("2026-07-27");
  });
});

describe("dueOccurrences", () => {
  it("creates a card once its due date is inside the create-ahead window", () => {
    // Due Friday the 24th, created 4 days ahead: Monday the 20th is the first day.
    expect(dueOccurrences(recurring(), "2026-07-19")).toEqual([]);
    expect(dueOccurrences(recurring(), TODAY)).toEqual(["2026-07-24"]);
  });

  it("creates on the due date itself when the lead time is zero", () => {
    const sameDay = recurring({ advanceCreateDays: 0 });
    expect(dueOccurrences(sameDay, "2026-07-23")).toEqual([]);
    expect(dueOccurrences(sameDay, "2026-07-24")).toEqual(["2026-07-24"]);
  });

  it("never revisits an occurrence that was already handled", () => {
    expect(dueOccurrences(recurring({ lastGeneratedDueDate: "2026-07-24" }), TODAY)).toEqual([]);
    expect(dueOccurrences(recurring({ lastGeneratedDueDate: "2026-07-24" }), "2026-07-27")).toEqual(["2026-07-31"]);
  });

  it("after time away creates only the latest missed occurrence plus what is coming up", () => {
    // Six weekly occurrences were missed; only the most recent of them is created.
    const stale = recurring({ firstDueDate: "2026-05-01", lastGeneratedDueDate: "2026-06-05" });
    expect(dueOccurrences(stale, TODAY)).toEqual(["2026-07-17", "2026-07-24"]);
  });

  it("creates nothing while paused", () => {
    expect(dueOccurrences(recurring({ active: false }), TODAY)).toEqual([]);
  });
});

describe("resumeFrom", () => {
  it("starts from today, so a past first due date or a long pause creates no overdue card", () => {
    expect(resumeFrom(undefined, TODAY)).toBe("2026-07-19");
    expect(resumeFrom("2026-05-01", TODAY)).toBe("2026-07-19");
    const fresh = recurring({ firstDueDate: "2026-06-05", lastGeneratedDueDate: resumeFrom(undefined, TODAY) });
    expect(dueOccurrences(fresh, TODAY)).toEqual(["2026-07-24"]);
  });

  it("keeps a later mark", () => {
    expect(resumeFrom("2026-07-24", TODAY)).toBe("2026-07-24");
  });

  it("still creates a card due today", () => {
    const dueToday = recurring({ firstDueDate: TODAY, advanceCreateDays: 0, lastGeneratedDueDate: resumeFrom(undefined, TODAY) });
    expect(dueOccurrences(dueToday, TODAY)).toEqual([TODAY]);
  });
});

describe("planRecurringTasks", () => {
  it("plans only the schedules with something due and records how far each got", () => {
    const plan = planRecurringTasks(
      [recurring(), recurring({ id: "r2", firstDueDate: "2026-09-01" }), recurring({ id: "r3", active: false })],
      new Set(),
      TODAY
    );
    expect(plan.map((p) => [p.recurringTask.id, p.dueDates, p.generatedThrough])).toEqual([["r1", ["2026-07-24"], "2026-07-24"]]);
  });

  it("does not recreate an instance that already exists, but still moves the mark forward", () => {
    const plan = planRecurringTasks([recurring()], new Set([recurrenceInstanceKey("r1", "2026-07-24")]), TODAY);
    expect(plan).toHaveLength(1);
    expect(plan[0]!.dueDates).toEqual([]);
    expect(plan[0]!.generatedThrough).toBe("2026-07-24");
  });
});

describe("recurrenceSummary", () => {
  it("describes each kind of schedule in words", () => {
    expect(recurrenceSummary(schedule({ unit: "days", weekdaysOnly: true }))).toBe("Every weekday");
    expect(recurrenceSummary(schedule({ unit: "days" }))).toBe("Daily");
    expect(recurrenceSummary(schedule({ unit: "days", interval: 3 }))).toBe("Every 3 days");
    expect(recurrenceSummary(schedule({}))).toBe("Weekly on Friday");
    expect(recurrenceSummary(schedule({ interval: 2, firstDueDate: "2026-07-12" }))).toBe("Every 2 weeks on Sunday");
    expect(recurrenceSummary(schedule({ unit: "months", firstDueDate: "2026-07-01" }))).toBe("Monthly on the 1st");
    expect(recurrenceSummary(schedule({ unit: "months", firstDueDate: "2026-07-22" }))).toBe("Monthly on the 22nd");
    expect(recurrenceSummary(schedule({ unit: "months", firstDueDate: "2026-07-13" }))).toBe("Monthly on the 13th");
    expect(recurrenceSummary(schedule({ unit: "months", interval: 3, firstDueDate: "2026-07-03" }))).toBe("Quarterly on the 3rd");
    expect(recurrenceSummary(schedule({ unit: "months", interval: 2, firstDueDate: "2026-07-15" }))).toBe("Every 2 months on the 15th");
    expect(recurrenceSummary(schedule({ unit: "months", interval: 12, firstDueDate: "2026-03-03" }))).toBe("Yearly on Mar 3");
    expect(recurrenceSummary(schedule({ firstDueDate: "" }))).toBe("No schedule");
  });
});

describe("recurrencePresetKey", () => {
  it("round-trips every named schedule and calls anything else custom", () => {
    for (const preset of RECURRENCE_PRESETS) {
      expect(recurrencePresetKey({ ...preset, firstDueDate: "2026-07-24" })).toBe(preset.key);
    }
    expect(recurrencePresetKey(schedule({ interval: 3 }))).toBe("custom");
    expect(recurrencePresetKey(schedule({ unit: "days" }))).toBe("custom");
  });
});

describe("recurringTaskError", () => {
  const valid = { title: "Certify timecards", unit: "weeks" as const, interval: 1, firstDueDate: "2026-07-24", advanceCreateDays: 4 };

  it("accepts a complete schedule", () => {
    expect(recurringTaskError(valid)).toBeUndefined();
  });

  it("requires a title and a real first due date", () => {
    expect(recurringTaskError({ ...valid, title: "   " })).toMatch(/Title/);
    expect(recurringTaskError({ ...valid, firstDueDate: "" })).toMatch(/First due date/);
    expect(recurringTaskError({ ...valid, firstDueDate: "2026-02-30" })).toMatch(/First due date/);
  });

  it("rejects intervals and lead times that are not sensible whole numbers", () => {
    expect(recurringTaskError({ ...valid, interval: 0 })).toMatch(/interval/);
    expect(recurringTaskError({ ...valid, interval: 1.5 })).toMatch(/interval/);
    expect(recurringTaskError({ ...valid, interval: Number.NaN })).toMatch(/interval/);
    expect(recurringTaskError({ ...valid, advanceCreateDays: -1 })).toMatch(/before due/);
    expect(recurringTaskError({ ...valid, advanceCreateDays: 400 })).toMatch(/before due/);
  });

  it("will not start a weekdays-only schedule on a weekend", () => {
    expect(recurringTaskError({ ...valid, unit: "days", weekdaysOnly: true, firstDueDate: "2026-07-25" })).toMatch(/weekend/);
    expect(recurringTaskError({ ...valid, unit: "days", weekdaysOnly: true, firstDueDate: "2026-07-24" })).toBeUndefined();
  });
});
