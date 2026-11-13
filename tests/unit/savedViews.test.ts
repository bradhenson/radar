import { describe, expect, it } from "vitest";
import type { SavedBoardView } from "../../src/domain/models";
import { DEFAULT_SETTINGS, normalizeAppSettings } from "../../src/domain/models";
import { createBackupPackage, parseAndValidateBackup, backupChecksum } from "../../src/data/backup";
import { createSampleSnapshot } from "../../src/data/seed";
import {
  EMPTY_BOARD_FILTERS,
  filtersAreEmpty,
  filtersForView,
  matchingView,
  MAX_SAVED_VIEWS,
  normalizeSavedBoardViews,
  sameFilters,
  savedViewNameError
} from "../../src/domain/rules/savedViews";

const view = (overrides: Partial<SavedBoardView> = {}): SavedBoardView => ({
  id: "v1",
  name: "Avery overdue",
  ...EMPTY_BOARD_FILTERS,
  employee: "e1",
  summary: "overdue",
  ...overrides
});

describe("normalizeSavedBoardViews", () => {
  it("keeps well-formed views unchanged", () => {
    expect(normalizeSavedBoardViews([view()])).toEqual([view()]);
  });

  it("returns an empty list for anything that is not a list", () => {
    for (const raw of [undefined, null, "views", 7, { id: "v1" }]) expect(normalizeSavedBoardViews(raw)).toEqual([]);
  });

  it("drops entries without an id or a name, and duplicates of either", () => {
    const result = normalizeSavedBoardViews([
      view(),
      view({ id: "v2", name: "  avery OVERDUE " }),
      view({ id: "v1", name: "Same id" }),
      view({ id: "", name: "No id" }),
      view({ id: "v3", name: "   " }),
      "not an object",
      null,
      ["array"],
      view({ id: "v4", name: "Kept" })
    ]);
    expect(result.map((v) => v.id)).toEqual(["v1", "v4"]);
  });

  it("clears filter values that are not valid and non-string fields", () => {
    const [result] = normalizeSavedBoardViews([
      { id: "v1", name: "Odd", search: 42, employee: null, priority: "urgent", summary: "everything", project: "p1" }
    ]);
    expect(result).toEqual({ id: "v1", name: "Odd", search: "", employee: "", competency: "", project: "p1", priority: "", summary: "" });
  });

  it("trims over-long text and caps the number of views", () => {
    const [long] = normalizeSavedBoardViews([view({ name: "n".repeat(200), search: "s".repeat(500) })]);
    expect(long!.name).toHaveLength(60);
    expect(long!.search).toHaveLength(200);
    const many = Array.from({ length: MAX_SAVED_VIEWS + 10 }, (_, i) => view({ id: `v${i}`, name: `View ${i}` }));
    expect(normalizeSavedBoardViews(many)).toHaveLength(MAX_SAVED_VIEWS);
  });
});

describe("matching and comparing", () => {
  const filters = { ...EMPTY_BOARD_FILTERS, employee: "e1", summary: "overdue" as const };

  it("recognizes the view the current filters match exactly", () => {
    expect(matchingView([view({ id: "other", name: "Other", employee: "e2" }), view()], filters)?.id).toBe("v1");
    expect(matchingView([view()], { ...filters, search: "report" })).toBeUndefined();
    expect(matchingView([], filters)).toBeUndefined();
  });

  it("compares every filter field", () => {
    expect(sameFilters(filters, { ...filters })).toBe(true);
    expect(sameFilters(filters, { ...filters, priority: "high" })).toBe(false);
    expect(filtersAreEmpty(EMPTY_BOARD_FILTERS)).toBe(true);
    expect(filtersAreEmpty(filters)).toBe(false);
  });
});

describe("savedViewNameError", () => {
  const filters = { ...EMPTY_BOARD_FILTERS, search: "report" };

  it("accepts a new name with at least one filter set", () => {
    expect(savedViewNameError("Reports", [view()], filters)).toBeUndefined();
  });

  it("needs a name, a filter, and a name not already in use", () => {
    expect(savedViewNameError("   ", [], filters)).toMatch(/name/);
    expect(savedViewNameError("Everything", [], EMPTY_BOARD_FILTERS)).toMatch(/at least one filter/);
    expect(savedViewNameError("avery overdue", [view()], filters)).toMatch(/already exists/);
    expect(savedViewNameError("n".repeat(61), [], filters)).toMatch(/60 characters/);
  });

  it("stops at the limit", () => {
    const full = Array.from({ length: MAX_SAVED_VIEWS }, (_, i) => view({ id: `v${i}`, name: `View ${i}` }));
    expect(savedViewNameError("One more", full, filters)).toMatch(/up to 30/);
  });
});

describe("filtersForView", () => {
  const existing = { employees: new Set(["e1"]), competencies: new Set(["c1"]), projects: new Set(["p1"]) };

  it("applies a view as saved when everything it names still exists", () => {
    const saved = view({ competency: "c1", project: "p1", search: "audit", priority: "high" });
    expect(filtersForView(saved, existing)).toEqual({ search: "audit", employee: "e1", competency: "c1", project: "p1", priority: "high", summary: "overdue" });
  });

  it("drops a person, competency, or project that is gone, so the board widens instead of emptying", () => {
    const stale = view({ employee: "gone", competency: "gone", project: "gone", search: "audit" });
    expect(filtersForView(stale, existing)).toEqual({ ...EMPTY_BOARD_FILTERS, search: "audit", summary: "overdue" });
  });
});

describe("saved views in settings and backups", () => {
  it("defaults to none and survives settings normalization", () => {
    expect(DEFAULT_SETTINGS.savedBoardViews).toEqual([]);
    expect(normalizeAppSettings({}).savedBoardViews).toEqual([]);
    expect(normalizeAppSettings({ savedBoardViews: [view(), { junk: true }] }).savedBoardViews).toEqual([view()]);
    // Each normalized settings object gets its own list, never the shared default.
    expect(normalizeAppSettings({}).savedBoardViews).not.toBe(DEFAULT_SETTINGS.savedBoardViews);
  });

  it("round-trips through a backup and rejects a value that is not a list", () => {
    const snapshot = createSampleSnapshot();
    snapshot.settings = { ...snapshot.settings, savedBoardViews: [view()] };
    const pkg = createBackupPackage(snapshot);
    const ok = parseAndValidateBackup(JSON.stringify(pkg));
    expect(ok.valid).toBe(true);
    expect(ok.package!.data.settings.savedBoardViews).toEqual([view()]);

    (pkg.data.settings as unknown as Record<string, unknown>).savedBoardViews = "nope";
    pkg.integrity.checksum = backupChecksum(JSON.stringify(pkg.data));
    const bad = parseAndValidateBackup(JSON.stringify(pkg));
    expect(bad.valid).toBe(false);
    expect(bad.errors.some((e) => e.includes("savedBoardViews"))).toBe(true);
  });
});
