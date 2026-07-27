import { describe, expect, it } from "vitest";
import { parseRichText, parseRichTextInline, richTextToPlainText, toggleChecklistItemAt } from "../../src/utils/richText";

describe("parseRichTextInline", () => {
  it("parses bold and italic without treating unmatched markers as formatting", () => {
    expect(parseRichTextInline("Use **bold** and *italic* plus *literal")).toEqual([
      { kind: "text", text: "Use " },
      { kind: "strong", children: [{ kind: "text", text: "bold" }] },
      { kind: "text", text: " and " },
      { kind: "emphasis", children: [{ kind: "text", text: "italic" }] },
      { kind: "text", text: " plus *literal" }
    ]);
  });

  it("parses triple markers as bold italic", () => {
    expect(parseRichTextInline("***both*** and **bold *****mix***")).toEqual([
      { kind: "strong", children: [{ kind: "emphasis", children: [{ kind: "text", text: "both" }] }] },
      { kind: "text", text: " and " },
      { kind: "strong", children: [{ kind: "text", text: "bold " }] },
      { kind: "strong", children: [{ kind: "emphasis", children: [{ kind: "text", text: "mix" }] }] }
    ]);
  });

  it("supports escaped formatting markers", () => {
    expect(parseRichTextInline("\\*not italic\\* and \\**not bold\\** and \\++not underlined\\++")).toEqual([
      { kind: "text", text: "*not italic* and **not bold** and ++not underlined++" }
    ]);
  });

  it("parses underline alone and with nested formatting", () => {
    expect(parseRichTextInline("Use ++underline++ and ++**bold underline**++")).toEqual([
      { kind: "text", text: "Use " },
      { kind: "underline", children: [{ kind: "text", text: "underline" }] },
      { kind: "text", text: " and " },
      {
        kind: "underline",
        children: [{ kind: "strong", children: [{ kind: "text", text: "bold underline" }] }]
      }
    ]);
  });
});

describe("parseRichText", () => {
  it("parses headings, paragraphs, lists, and checklists into safe typed nodes", () => {
    expect(parseRichText("## Review\nLine one\nLine two\n\n- First\n- **Second**\n\n1. One\n2. Two\n\n- [ ] Follow up\n- [x] Sent")).toEqual([
      { kind: "heading", level: 2, content: [{ kind: "text", text: "Review" }] },
      { kind: "paragraph", content: [{ kind: "text", text: "Line one\nLine two" }] },
      {
        kind: "unordered-list",
        items: [
          { content: [{ kind: "text", text: "First" }] },
          { content: [{ kind: "strong", children: [{ kind: "text", text: "Second" }] }] }
        ]
      },
      {
        kind: "ordered-list",
        items: [
          { content: [{ kind: "text", text: "One" }] },
          { content: [{ kind: "text", text: "Two" }] }
        ]
      },
      {
        kind: "checklist",
        items: [
          { content: [{ kind: "text", text: "Follow up" }], checked: false },
          { content: [{ kind: "text", text: "Sent" }], checked: true }
        ]
      }
    ]);
  });

  it("keeps HTML-looking imported content as ordinary text", () => {
    expect(parseRichText("<img src=x onerror=alert(1)>"))
      .toEqual([{ kind: "paragraph", content: [{ kind: "text", text: "<img src=x onerror=alert(1)>" }] }]);
  });
});

describe("toggleChecklistItemAt", () => {
  const doc = "# Plan\n\n- [ ] Call the family\n- [x] Send the reading log\n\nNotes here\n\n- [ ] Book the room";

  it("counts items in document order across separate lists", () => {
    expect(toggleChecklistItemAt(doc, 0)).toContain("- [x] Call the family");
    expect(toggleChecklistItemAt(doc, 1)).toContain("- [ ] Send the reading log");
    expect(toggleChecklistItemAt(doc, 2)).toContain("- [x] Book the room");
  });

  it("changes one character and leaves everything else byte for byte", () => {
    const before = "##  Odd   spacing\n\n*   [ ]   loose item\n\n1) kept as authored";
    const after = toggleChecklistItemAt(before, 0);
    expect(after).toBe("##  Odd   spacing\n\n*   [x]   loose item\n\n1) kept as authored");
  });

  it("agrees with what parseRichText renders", () => {
    const items = (value: string) =>
      parseRichText(value).flatMap((block) => (block.kind === "checklist" ? block.items : []));
    expect(items(doc).map((item) => item.checked)).toEqual([false, true, false]);
    expect(items(toggleChecklistItemAt(doc, 1)).map((item) => item.checked)).toEqual([false, false, false]);
  });

  it("ignores guarded prose that only looks like a checklist", () => {
    const guarded = "\\- [ ] pasted from somewhere else\n\n- [ ] a real one";
    expect(toggleChecklistItemAt(guarded, 0)).toBe("\\- [ ] pasted from somewhere else\n\n- [x] a real one");
  });

  it("returns the value unchanged for an index that is not there", () => {
    expect(toggleChecklistItemAt(doc, 9)).toBe(doc);
    expect(toggleChecklistItemAt(doc, -1)).toBe(doc);
    expect(toggleChecklistItemAt(undefined, 0)).toBe("");
  });
});

describe("richTextToPlainText", () => {
  it("projects formatting into readable plain text for exports and derived records", () => {
    expect(richTextToPlainText("# Summary\n\n**Ready** to go\n\n- Alpha\n- Beta\n\n- [x] Contacted"))
      .toBe("Summary\n\nReady to go\n\n• Alpha\n• Beta\n\n☑ Contacted");
  });

  it("preserves legacy plain text", () => {
    expect(richTextToPlainText("Legacy note\nwith another line")).toBe("Legacy note\nwith another line");
  });
});
