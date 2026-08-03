import { describe, expect, it } from "vitest";
import {
  countLegacyChecklistItems,
  emptyRichText,
  isRichTextEmpty,
  isRichTextValue,
  normalizeRichText,
  richTextCharacterCount,
  richTextDocToPlainText,
  richTextFromLegacy,
  type RichTextNode
} from "../../src/utils/richTextDoc";

/** Blocks of the converted document, so assertions read at document level. */
function blocks(value: string) {
  return richTextFromLegacy(value).doc.content ?? [];
}

function firstBlock(value: string): RichTextNode {
  return blocks(value)[0]!;
}

describe("richTextFromLegacy — blocks", () => {
  it("converts a plain paragraph", () => {
    expect(firstBlock("Just a note.")).toEqual({
      type: "paragraph",
      content: [{ type: "text", text: "Just a note." }]
    });
  });

  it("maps legacy heading levels 1-3 onto Tiptap levels 3-5", () => {
    expect(firstBlock("# One")).toMatchObject({ type: "heading", attrs: { level: 3 } });
    expect(firstBlock("## Two")).toMatchObject({ type: "heading", attrs: { level: 4 } });
    expect(firstBlock("### Three")).toMatchObject({ type: "heading", attrs: { level: 5 } });
  });

  it("converts bullet lists", () => {
    expect(firstBlock("- first\n- second")).toEqual({
      type: "bulletList",
      content: [
        { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "first" }] }] },
        { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "second" }] }] }
      ]
    });
  });

  it("converts numbered lists", () => {
    expect(firstBlock("1. first\n2. second")).toMatchObject({ type: "orderedList" });
    expect(firstBlock("1. first\n2. second").content).toHaveLength(2);
  });

  it("keeps consecutive lists of different kinds as separate blocks", () => {
    const converted = blocks("- bullet\n1. numbered");
    expect(converted.map((b) => b.type)).toEqual(["bulletList", "orderedList"]);
  });

  it("turns a paragraph's joined lines into hard breaks", () => {
    expect(firstBlock("line one\nline two")).toEqual({
      type: "paragraph",
      content: [
        { type: "text", text: "line one" },
        { type: "hardBreak" },
        { type: "text", text: "line two" }
      ]
    });
  });

  it("keeps a guarded line as literal text rather than a block", () => {
    expect(firstBlock("\\- not a bullet")).toEqual({
      type: "paragraph",
      content: [{ type: "text", text: "- not a bullet" }]
    });
  });

  it("produces a single empty paragraph for empty input", () => {
    for (const value of ["", "   ", undefined, null]) {
      expect(richTextFromLegacy(value)).toEqual(emptyRichText());
    }
  });
});

describe("richTextFromLegacy — inline marks", () => {
  it("flattens nested emphasis into a flat mark array", () => {
    expect(firstBlock("***both***").content).toEqual([
      { type: "text", text: "both", marks: [{ type: "bold" }, { type: "italic" }] }
    ]);
  });

  it("converts each legacy mark to its Tiptap name", () => {
    expect(firstBlock("**b** *i* ++u++").content).toEqual([
      { type: "text", text: "b", marks: [{ type: "bold" }] },
      { type: "text", text: " " },
      { type: "text", text: "i", marks: [{ type: "italic" }] },
      { type: "text", text: " " },
      { type: "text", text: "u", marks: [{ type: "underline" }] }
    ]);
  });

  it("does not duplicate a mark nested inside itself", () => {
    expect(firstBlock("**outer **inner** end**").content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ marks: [{ type: "bold" }] })
      ])
    );
    for (const node of firstBlock("**outer **inner** end**").content ?? []) {
      const names = (node.marks ?? []).map((m) => m.type);
      expect(new Set(names).size).toBe(names.length);
    }
  });

  it("carries marks into list items", () => {
    const item = firstBlock("- **bold** item").content?.[0];
    expect(item?.content?.[0]?.content?.[0]).toEqual({
      type: "text",
      text: "bold",
      marks: [{ type: "bold" }]
    });
  });

  it("keeps escaped markers as literal characters", () => {
    expect(firstBlock("\\*not italic\\*").content).toEqual([{ type: "text", text: "*not italic*" }]);
  });
});

describe("richTextFromLegacy — checklists", () => {
  it("converts a checklist to a bullet list", () => {
    expect(firstBlock("- [ ] open\n- [x] done").type).toBe("bulletList");
  });

  it("preserves checked state as a leading marker so nothing is silently lost", () => {
    const items = firstBlock("- [ ] open\n- [x] done").content ?? [];
    expect(items[0]?.content?.[0]?.content).toEqual([
      { type: "text", text: "○ " },
      { type: "text", text: "open" }
    ]);
    expect(items[1]?.content?.[0]?.content).toEqual([
      { type: "text", text: "✓ " },
      { type: "text", text: "done" }
    ]);
  });

  it("treats an uppercase X as checked", () => {
    const items = firstBlock("- [X] done").content ?? [];
    expect(items[0]?.content?.[0]?.content?.[0]).toEqual({ type: "text", text: "✓ " });
  });

  it("keeps the marker outside the item's own formatting", () => {
    const item = firstBlock("- [x] **done**").content?.[0];
    expect(item?.content?.[0]?.content).toEqual([
      { type: "text", text: "✓ " },
      { type: "text", text: "done", marks: [{ type: "bold" }] }
    ]);
  });

  it("counts checklist items so a migration can report what it converted", () => {
    expect(countLegacyChecklistItems("- [ ] a\n- [x] b")).toBe(2);
    expect(countLegacyChecklistItems("- plain\n- bullets")).toBe(0);
    expect(countLegacyChecklistItems("")).toBe(0);
  });
});

describe("normalizeRichText", () => {
  it("passes an existing document through untouched", () => {
    const doc = richTextFromLegacy("## Heading");
    expect(normalizeRichText(doc)).toBe(doc);
  });

  it("reads an unmigrated legacy string as notation, not as literal text", () => {
    expect(normalizeRichText("## Heading").doc.content?.[0]).toMatchObject({
      type: "heading",
      attrs: { level: 4 }
    });
  });

  it("parses a stored envelope that arrived as a JSON string", () => {
    const doc = richTextFromLegacy("Note body");
    expect(normalizeRichText(JSON.stringify(doc))).toEqual(doc);
  });

  it("keeps a legacy note that merely contains JSON as legacy text", () => {
    const value = '{"partNumber": "not a document"}';
    expect(richTextDocToPlainText(normalizeRichText(value))).toBe(value);
  });

  it("returns an empty document for null and undefined", () => {
    expect(normalizeRichText(null)).toEqual(emptyRichText());
    expect(normalizeRichText(undefined)).toEqual(emptyRichText());
  });

  it("rejects envelopes with the wrong version or shape", () => {
    expect(isRichTextValue({ schemaVersion: 2, doc: { type: "doc" } })).toBe(false);
    expect(isRichTextValue({ schemaVersion: 1, doc: { type: "paragraph" } })).toBe(false);
    expect(isRichTextValue(null)).toBe(false);
  });
});

describe("plain-text projection", () => {
  it("reads prose and headings back as the text the author saw", () => {
    expect(richTextDocToPlainText(richTextFromLegacy("Just a note."))).toBe("Just a note.");
    expect(richTextDocToPlainText(richTextFromLegacy("## Heading\n\nBody text."))).toBe("Heading\n\nBody text.");
    expect(richTextDocToPlainText(richTextFromLegacy("line one\nline two"))).toBe("line one\nline two");
  });

  it("renders bullets and numbers for lists", () => {
    expect(richTextDocToPlainText(richTextFromLegacy("- one\n- two"))).toBe("• one\n• two");
    expect(richTextDocToPlainText(richTextFromLegacy("1. one\n2. two"))).toBe("1. one\n2. two");
  });

  it("keeps converted checklist state visible in search text", () => {
    expect(richTextDocToPlainText(richTextFromLegacy("- [x] done"))).toBe("• ✓ done");
  });

  it("reports emptiness from visible characters only", () => {
    expect(isRichTextEmpty(emptyRichText())).toBe(true);
    expect(isRichTextEmpty(richTextFromLegacy("   "))).toBe(true);
    expect(isRichTextEmpty(richTextFromLegacy("text"))).toBe(false);
  });

  it("counts visible characters across blocks", () => {
    expect(richTextCharacterCount(richTextFromLegacy("abc"))).toBe(3);
    expect(richTextCharacterCount(richTextFromLegacy("**abc**"))).toBe(3);
  });
});
