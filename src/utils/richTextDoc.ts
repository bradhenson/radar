// Rich-text document model. The application — not Tiptap — owns the persisted
// contract, so extension changes stay an explicit, versioned decision rather
// than a silent change of stored shape. Mirrors Teacher Workbench ADR 0004.
import { parseRichText, type RichTextBlock, type RichTextInline } from "./richText";

export const RICH_TEXT_SCHEMA_VERSION = 1 as const;

export type RichTextMark = { type: "bold" | "italic" | "underline" };

export type RichTextNode = {
  type:
    | "doc"
    | "paragraph"
    | "heading"
    | "text"
    | "hardBreak"
    | "bulletList"
    | "orderedList"
    | "listItem";
  text?: string;
  marks?: RichTextMark[];
  attrs?: {
    level?: 3 | 4 | 5;
    start?: number;
    type?: "1" | "a" | "A" | "i" | "I" | null;
  };
  content?: RichTextNode[];
};

/**
 * Application-owned envelope around Tiptap's JSON document. Tiptap documents do
 * not carry a schema version, so the envelope gives future extension changes an
 * explicit migration boundary.
 */
export type RichTextValue = {
  schemaVersion: typeof RICH_TEXT_SCHEMA_VERSION;
  doc: RichTextNode;
};

export function emptyRichText(): RichTextValue {
  return {
    schemaVersion: RICH_TEXT_SCHEMA_VERSION,
    doc: { type: "doc", content: [{ type: "paragraph" }] }
  };
}

export function isRichTextValue(value: unknown): value is RichTextValue {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<RichTextValue>;
  return candidate.schemaVersion === RICH_TEXT_SCHEMA_VERSION && candidate.doc?.type === "doc";
}

// ---------------------------------------------------------------------------
// Legacy conversion
// ---------------------------------------------------------------------------

/** Legacy heading levels were 1-3; the Tiptap schema starts at 3 so note text
 *  never outranks the surrounding page headings. */
const HEADING_LEVEL: Record<1 | 2 | 3, 3 | 4 | 5> = { 1: 3, 2: 4, 3: 5 };

/**
 * Checklists left the schema when the editor did. Dropping the boxes silently
 * would also drop which items were done, so the state survives as a leading
 * marker: the information is kept, it is simply no longer interactive.
 */
const CHECKED_MARKER = "✓ ";
const UNCHECKED_MARKER = "○ ";

/** Flatten the legacy nested inline tree into Tiptap's flat mark arrays. */
function inlineToNodes(nodes: RichTextInline[], marks: RichTextMark["type"][] = []): RichTextNode[] {
  const out: RichTextNode[] = [];
  for (const node of nodes) {
    if (node.kind === "text") {
      // A paragraph's source lines are joined with newlines; Tiptap has no
      // newline inside a text node, so each one becomes a hard break.
      const segments = node.text.split("\n");
      segments.forEach((segment, index) => {
        if (index > 0) out.push({ type: "hardBreak" });
        if (segment) {
          out.push({
            type: "text",
            text: segment,
            ...(marks.length ? { marks: marks.map((type) => ({ type })) } : {})
          });
        }
      });
      continue;
    }
    const mark = node.kind === "strong" ? "bold" : node.kind === "emphasis" ? "italic" : "underline";
    out.push(...inlineToNodes(node.children, marks.includes(mark) ? marks : [...marks, mark]));
  }
  return out;
}

function paragraphNode(content: RichTextNode[]): RichTextNode {
  return { type: "paragraph", ...(content.length ? { content } : {}) };
}

function listItemNode(content: RichTextNode[]): RichTextNode {
  return { type: "listItem", content: [paragraphNode(content)] };
}

function blockToNode(block: RichTextBlock): RichTextNode {
  if (block.kind === "paragraph") return paragraphNode(inlineToNodes(block.content));

  if (block.kind === "heading") {
    return {
      type: "heading",
      attrs: { level: HEADING_LEVEL[block.level] },
      ...(block.content.length ? { content: inlineToNodes(block.content) } : {})
    };
  }

  const items = block.items.map((item) => {
    const content = inlineToNodes(item.content);
    if (block.kind !== "checklist") return listItemNode(content);
    const marker: RichTextNode = { type: "text", text: item.checked ? CHECKED_MARKER : UNCHECKED_MARKER };
    return listItemNode([marker, ...content]);
  });

  // Checklists become bullet lists; their state is carried by the markers above.
  return { type: block.kind === "ordered-list" ? "orderedList" : "bulletList", content: items };
}

/**
 * Convert a legacy notation string into a document.
 *
 * Deliberately parses the old syntax rather than wrapping it as literal text:
 * RADAR holds real notes, so headings, lists, and emphasis have to survive the
 * change of engine. Reuses `parseRichText` so conversion and the old renderer
 * agree on what the source ever meant.
 */
export function richTextFromLegacy(value: string | null | undefined): RichTextValue {
  const blocks = parseRichText(value ?? undefined);
  const content = blocks.map(blockToNode);
  return {
    schemaVersion: RICH_TEXT_SCHEMA_VERSION,
    doc: { type: "doc", content: content.length ? content : [{ type: "paragraph" }] }
  };
}

/** How many checklist items a legacy value would convert to plain bullets. */
export function countLegacyChecklistItems(value: string | null | undefined): number {
  return parseRichText(value ?? undefined).reduce(
    (total, block) => (block.kind === "checklist" ? total + block.items.length : total),
    0
  );
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

/**
 * Wrap plain text as a document without interpreting any notation. For text
 * that was never RADAR syntax — a task title, a value arriving from the MCP
 * server — so a stray "- " or "#" stays the characters the author typed.
 */
export function richTextFromPlainText(value: string | null | undefined): RichTextValue {
  const normalized = (value ?? "").replace(/\r\n?/g, "\n");
  if (!normalized) return emptyRichText();

  const paragraphs = normalized.split(/\n{2,}/).map((paragraph) => {
    const content: RichTextNode[] = [];
    paragraph.split("\n").forEach((line, index) => {
      if (index > 0) content.push({ type: "hardBreak" });
      if (line) content.push({ type: "text", text: line });
    });
    return paragraphNode(content);
  });

  return { schemaVersion: RICH_TEXT_SCHEMA_VERSION, doc: { type: "doc", content: paragraphs } };
}

/** A bulleted list of plain-text items, as its own document. */
export function richTextBulletList(items: readonly string[]): RichTextValue {
  const content = items.map((item) => listItemNode(item ? [{ type: "text", text: item }] : []));
  if (!content.length) return emptyRichText();
  return {
    schemaVersion: RICH_TEXT_SCHEMA_VERSION,
    doc: { type: "doc", content: [{ type: "bulletList", content }] }
  };
}

/**
 * Join documents end to end. Empty inputs contribute nothing, so callers can
 * pass optional fields without guarding each one.
 */
export function concatRichText(...values: (RichTextValue | string | null | undefined)[]): RichTextValue {
  const content: RichTextNode[] = [];
  for (const value of values) {
    if (isRichTextEmpty(value)) continue;
    content.push(...(normalizeRichText(value).doc.content ?? []));
  }
  return {
    schemaVersion: RICH_TEXT_SCHEMA_VERSION,
    doc: { type: "doc", content: content.length ? content : [{ type: "paragraph" }] }
  };
}

// ---------------------------------------------------------------------------
// Normalization and projections
// ---------------------------------------------------------------------------

/**
 * A stored document that arrived as text rather than as an object, or `null` if
 * this string is not one. Only accepted when it parses *and* is an envelope, so
 * a legacy note that merely happens to contain JSON stays legacy text.
 */
function parseStoredDocument(value: string): RichTextValue | null {
  const trimmed = value.trimStart();
  if (!trimmed.startsWith("{")) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return isRichTextValue(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Normalize trusted application values. Imported data is validated separately.
 *
 * A string reaching here is a record the migration has not converted yet, so it
 * is read as legacy notation. That keeps an unmigrated record rendering
 * correctly instead of displaying its own markup as literal text.
 */
export function normalizeRichText(value: RichTextValue | string | null | undefined): RichTextValue {
  if (isRichTextValue(value)) return value;
  if (typeof value === "string") return parseStoredDocument(value) ?? richTextFromLegacy(value);
  return emptyRichText();
}

export function serializeRichText(value: RichTextValue | string | null | undefined): string {
  return JSON.stringify(normalizeRichText(value));
}

function nodeText(node: RichTextNode): string {
  if (node.type === "text") return node.text ?? "";
  if (node.type === "hardBreak") return "\n";
  return (node.content ?? []).map(nodeText).join("");
}

export function richTextCharacterCount(value: RichTextValue | string | null | undefined): number {
  return nodeText(normalizeRichText(value).doc).length;
}

export function isRichTextEmpty(value: RichTextValue | string | null | undefined): boolean {
  return nodeText(normalizeRichText(value).doc).trim().length === 0;
}

function listItemPlainText(node: RichTextNode): string {
  return (node.content ?? []).map(blockPlainText).filter(Boolean).join("\n");
}

function blockPlainText(node: RichTextNode): string {
  if (node.type === "paragraph" || node.type === "heading") {
    return (node.content ?? []).map(nodeText).join("");
  }
  if (node.type === "bulletList") {
    return (node.content ?? []).map((item) => `• ${listItemPlainText(item)}`).join("\n");
  }
  if (node.type === "orderedList") {
    const start = node.attrs?.start ?? 1;
    return (node.content ?? [])
      .map((item, index) => `${start + index}. ${listItemPlainText(item)}`)
      .join("\n");
  }
  return nodeText(node);
}

/** Plain-text projection for search, CSV export, and derived records. */
export function richTextDocToPlainText(value: RichTextValue | string | null | undefined): string {
  return (normalizeRichText(value).doc.content ?? [])
    .map(blockPlainText)
    .filter(Boolean)
    .join("\n\n")
    .trim();
}
