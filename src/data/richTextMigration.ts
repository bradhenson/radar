// One-time conversion of pre-Tiptap rich text into versioned documents.
//
// Both entry points share this code so a record converts identically whether it
// arrives through the backup ladder or is already sitting in the operational
// database. Conversion parses the old notation rather than wrapping it as
// literal text, so headings, lists, and emphasis survive the change of engine.

import {
  countLegacyChecklistItems,
  isRichTextValue,
  richTextFromLegacy,
  richTextFromPlainText
} from "../utils/richTextDoc";

/**
 * How a field's text is to be read while it is still a string.
 *
 * `legacy` parses RADAR's pre-Tiptap notation, so headings, lists, and emphasis
 * authored in it survive the change of engine. `plainText` takes the characters
 * literally, which is the only correct reading for a field that has always been
 * a plain textarea: a project description beginning "- " was typed as a dash,
 * not authored as a list, and must not silently become one.
 */
export type RichTextSource = "legacy" | "plainText";

/** Every field holding rich text, by collection. Kept beside the backup schema. */
export const RICH_TEXT_MIGRATION_FIELDS: Readonly<Record<string, Readonly<Record<string, RichTextSource>>>> = {
  tasks: { description: "legacy" },
  taskNotes: { body: "legacy" },
  quickNotes: { body: "legacy" },
  employeeNotes: { noteText: "legacy" },
  meetingNotes: { notes: "legacy", actionItems: "legacy" },
  performanceInputs: { situationOrContext: "legacy", actionOrAccomplishment: "legacy", result: "legacy" },
  projects: { description: "plainText" },
  awardRecords: { supportingNotes: "plainText" },
  employeeInteractions: { summary: "plainText" }
};

export interface RichTextMigrationReport {
  /** Field values converted from legacy notation to a document. */
  values: number;
  /** Records touched at least once. */
  records: number;
  /** Checklist items that became bullets carrying a ✓ / ○ marker. */
  checklistItems: number;
  /** Converted values per collection, for the summary the user reads. */
  byCollection: Record<string, number>;
}

export function emptyMigrationReport(): RichTextMigrationReport {
  return { values: 0, records: 0, checklistItems: 0, byCollection: {} };
}

export function migrationReportIsEmpty(report: RichTextMigrationReport): boolean {
  return report.values === 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * True when this value still needs converting. A document is already current,
 * and an absent field has nothing to convert; only a non-empty string is text
 * awaiting conversion.
 */
function isUnconvertedValue(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

/**
 * Convert one record's rich-text fields, or return `undefined` when it is
 * already current. Returning `undefined` rather than a copy is what keeps the
 * migration idempotent and lets callers write only what actually changed.
 */
export function migrateRecordRichText(
  collection: string,
  record: unknown
): { record: Record<string, unknown>; values: number; checklistItems: number } | undefined {
  const fields = RICH_TEXT_MIGRATION_FIELDS[collection];
  if (!fields || !isRecord(record)) return undefined;

  let values = 0;
  let checklistItems = 0;
  let next: Record<string, unknown> | undefined;

  for (const [field, source] of Object.entries(fields)) {
    const value = record[field];
    if (isRichTextValue(value)) continue;
    if (!isUnconvertedValue(value)) {
      // An empty string is not worth a document, but it must not stay a string
      // either, or the field would keep failing the current schema.
      if (typeof value === "string") {
        next ??= { ...record };
        delete next[field];
        values++;
      }
      continue;
    }
    next ??= { ...record };
    if (source === "legacy") {
      checklistItems += countLegacyChecklistItems(value);
      next[field] = richTextFromLegacy(value);
    } else {
      next[field] = richTextFromPlainText(value);
    }
    values++;
  }

  return next ? { record: next, values, checklistItems } : undefined;
}

/** Count what a migration would do, without changing anything. */
export function planRichTextMigration(collections: Record<string, readonly unknown[]>): RichTextMigrationReport {
  const report = emptyMigrationReport();
  for (const [name, records] of Object.entries(collections)) {
    if (!RICH_TEXT_MIGRATION_FIELDS[name] || !Array.isArray(records)) continue;
    for (const record of records) {
      const converted = migrateRecordRichText(name, record);
      if (!converted) continue;
      report.records++;
      report.values += converted.values;
      report.checklistItems += converted.checklistItems;
      report.byCollection[name] = (report.byCollection[name] ?? 0) + converted.values;
    }
  }
  return report;
}

/**
 * Convert every legacy value in place. Records that are already current are
 * left untouched, so running this twice is a no-op.
 */
export function migrateCollectionsRichText(collections: Record<string, unknown[]>): RichTextMigrationReport {
  const report = emptyMigrationReport();
  for (const [name, records] of Object.entries(collections)) {
    if (!RICH_TEXT_MIGRATION_FIELDS[name] || !Array.isArray(records)) continue;
    for (let i = 0; i < records.length; i++) {
      const converted = migrateRecordRichText(name, records[i]);
      if (!converted) continue;
      records[i] = converted.record;
      report.records++;
      report.values += converted.values;
      report.checklistItems += converted.checklistItems;
      report.byCollection[name] = (report.byCollection[name] ?? 0) + converted.values;
    }
  }
  return report;
}

/** One line describing what happened, for toasts and activity entries. */
export function describeMigrationReport(report: RichTextMigrationReport): string {
  if (migrationReportIsEmpty(report)) return "No note text needed converting.";
  const parts = [
    `Converted ${report.values} rich-text field${report.values === 1 ? "" : "s"} across ${report.records} record${
      report.records === 1 ? "" : "s"
    }`
  ];
  if (report.checklistItems > 0) {
    parts.push(
      `${report.checklistItems} checklist item${report.checklistItems === 1 ? "" : "s"} became bulleted items marked ✓ or ○`
    );
  }
  return `${parts.join("; ")}.`;
}
