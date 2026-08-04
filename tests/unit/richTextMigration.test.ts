import { describe, expect, it } from "vitest";
import {
  describeMigrationReport,
  migrateCollectionsRichText,
  migrateRecordRichText,
  migrationReportIsEmpty,
  planRichTextMigration,
  RICH_TEXT_MIGRATION_FIELDS
} from "../../src/data/richTextMigration";
import { isRichTextValue, richTextDocToPlainText, richTextFromLegacy } from "../../src/utils/richTextDoc";

describe("migrateRecordRichText", () => {
  it("converts a legacy string into a document", () => {
    const result = migrateRecordRichText("quickNotes", { id: "n1", body: "## Heading\n\n- one\n- two" });
    expect(result).toBeDefined();
    expect(result!.values).toBe(1);
    expect(isRichTextValue(result!.record.body)).toBe(true);
    expect(richTextDocToPlainText(result!.record.body as never)).toBe("Heading\n\n• one\n• two");
  });

  it("leaves a record that already holds a document untouched", () => {
    const record = { id: "n1", body: richTextFromLegacy("Already converted.") };
    expect(migrateRecordRichText("quickNotes", record)).toBeUndefined();
  });

  it("is idempotent — converting twice changes nothing the second time", () => {
    const first = migrateRecordRichText("quickNotes", { id: "n1", body: "text" });
    expect(first).toBeDefined();
    expect(migrateRecordRichText("quickNotes", first!.record)).toBeUndefined();
  });

  it("does not mutate the record it was given", () => {
    const original = { id: "n1", body: "text" };
    migrateRecordRichText("quickNotes", original);
    expect(original.body).toBe("text");
  });

  it("drops an empty legacy string rather than leaving a bare string behind", () => {
    const result = migrateRecordRichText("tasks", { id: "t1", description: "   " });
    expect(result).toBeDefined();
    expect("description" in result!.record).toBe(false);
  });

  it("counts checklist items that lose their boxes", () => {
    const result = migrateRecordRichText("quickNotes", { id: "n1", body: "- [x] done\n- [ ] open" });
    expect(result!.checklistItems).toBe(2);
    expect(richTextDocToPlainText(result!.record.body as never)).toBe("• ✓ done\n• ○ open");
  });

  it("converts every rich-text field of a record in one pass", () => {
    const result = migrateRecordRichText("performanceInputs", {
      id: "p1",
      situationOrContext: "context",
      actionOrAccomplishment: "action",
      result: "result"
    });
    expect(result!.values).toBe(3);
  });

  it("ignores collections and shapes that hold no rich text", () => {
    expect(migrateRecordRichText("employees", { id: "e1", displayName: "Someone" })).toBeUndefined();
    expect(migrateRecordRichText("quickNotes", null)).toBeUndefined();
    expect(migrateRecordRichText("quickNotes", "not a record")).toBeUndefined();
  });

  it("covers every collection the backup schema treats as rich text", () => {
    expect(Object.keys(RICH_TEXT_MIGRATION_FIELDS).sort()).toEqual([
      "awardRecords",
      "employeeInteractions",
      "employeeNotes",
      "meetingNotes",
      "performanceInputs",
      "projects",
      "quickNotes",
      "taskNotes",
      "tasks"
    ]);
  });

  // Fields that were always plain textareas never held RADAR notation, so the
  // characters the author typed have to survive as themselves.
  it("takes a plain-text field literally rather than parsing it as notation", () => {
    const result = migrateRecordRichText("projects", { id: "p1", description: "# Phase 1\n- not a list" });
    expect(richTextDocToPlainText(result!.record.description as never)).toBe("# Phase 1\n- not a list");
  });

  it("reads the same characters as notation in a field that was authored in it", () => {
    const result = migrateRecordRichText("tasks", { id: "t1", description: "# Phase 1\n- not a list" });
    expect(richTextDocToPlainText(result!.record.description as never)).toBe("Phase 1\n\n• not a list");
  });

  it("counts no checklist items for a plain-text field that merely looks like one", () => {
    const result = migrateRecordRichText("employeeInteractions", { id: "i1", summary: "- [x] done" });
    expect(result!.checklistItems).toBe(0);
    expect(richTextDocToPlainText(result!.record.summary as never)).toBe("- [x] done");
  });
});

describe("planRichTextMigration", () => {
  it("counts without changing anything", () => {
    const collections = {
      quickNotes: [{ id: "n1", body: "- [x] done" }],
      tasks: [{ id: "t1", description: "text" }]
    };
    const report = planRichTextMigration(collections);
    expect(report.values).toBe(2);
    expect(report.records).toBe(2);
    expect(report.checklistItems).toBe(1);
    expect(report.byCollection).toEqual({ quickNotes: 1, tasks: 1 });
    expect(collections.quickNotes[0]!.body).toBe("- [x] done");
  });

  it("reports nothing for an already-migrated database", () => {
    const report = planRichTextMigration({ quickNotes: [{ id: "n1", body: richTextFromLegacy("done") }] });
    expect(migrationReportIsEmpty(report)).toBe(true);
  });

  it("reports nothing for an empty database", () => {
    expect(migrationReportIsEmpty(planRichTextMigration({}))).toBe(true);
  });
});

describe("migrateCollectionsRichText", () => {
  it("converts in place and reports what it did", () => {
    const collections: Record<string, unknown[]> = {
      quickNotes: [{ id: "n1", body: "**bold**" }, { id: "n2", body: richTextFromLegacy("already") }],
      meetingNotes: [{ id: "m1", notes: "notes", actionItems: "actions" }],
      employees: [{ id: "e1", displayName: "Someone" }]
    };
    const report = migrateCollectionsRichText(collections);

    expect(report.values).toBe(3);
    expect(report.records).toBe(2);
    expect(isRichTextValue((collections.quickNotes![0] as Record<string, unknown>).body)).toBe(true);
    expect(isRichTextValue((collections.meetingNotes![0] as Record<string, unknown>).actionItems)).toBe(true);
    // Untouched collections keep their exact records.
    expect(collections.employees![0]).toEqual({ id: "e1", displayName: "Someone" });
  });

  it("running twice converts nothing the second time", () => {
    const collections: Record<string, unknown[]> = { quickNotes: [{ id: "n1", body: "text" }] };
    expect(migrateCollectionsRichText(collections).values).toBe(1);
    expect(migrationReportIsEmpty(migrateCollectionsRichText(collections))).toBe(true);
  });
});

describe("describeMigrationReport", () => {
  it("says plainly when there was nothing to do", () => {
    expect(describeMigrationReport(planRichTextMigration({}))).toBe("No note text needed converting.");
  });

  it("names the checklist items so their change is never silent", () => {
    const report = planRichTextMigration({ quickNotes: [{ id: "n1", body: "- [x] a\n- [ ] b" }] });
    const text = describeMigrationReport(report);
    expect(text).toContain("1 rich-text field");
    expect(text).toContain("2 checklist items");
  });
});
