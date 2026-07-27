import { describe, expect, it } from "vitest";
import { serializeRichTextDom, type DomNodeLike } from "../../src/utils/richTextDom";
import { parseRichText, richTextToPlainText } from "../../src/utils/richText";

// Plain-object fakes matching the structural DomNodeLike interface, so these
// tests run in the node environment without a DOM implementation.
function text(value: string): DomNodeLike {
  return { nodeType: 3, nodeName: "#text", nodeValue: value, childNodes: [] };
}
function el(name: string, children: DomNodeLike[] = [], attrs: Record<string, string> = {}): DomNodeLike {
  return {
    nodeType: 1,
    nodeName: name.toUpperCase(),
    nodeValue: null,
    childNodes: children,
    getAttribute: (n: string) => attrs[n] ?? null
  };
}
const marker = (checked: boolean) =>
  el("span", [text(checked ? "☑" : "☐")], { "data-checked": String(checked), class: "check" });
const root = (...children: DomNodeLike[]) => el("root", children);

describe("serializeRichTextDom", () => {
  it("serializes divs as separate paragraphs", () => {
    const out = serializeRichTextDom(root(el("div", [text("Hello")]), el("div", [text("World")])));
    expect(out).toBe("Hello\n\nWorld");
  });

  it("collects bare inline nodes at the root into a paragraph", () => {
    const out = serializeRichTextDom(root(text("First line"), el("div", [text("Second")])));
    expect(out).toBe("First line\n\nSecond");
  });

  it("serializes bold and italic, including b/strong and i/em variants", () => {
    const out = serializeRichTextDom(
      root(
        el("div", [text("a "), el("b", [text("bold")]), text(" and "), el("em", [text("italic")])]),
        el("div", [el("strong", [el("i", [text("both")])])])
      )
    );
    expect(out).toBe("a **bold** and *italic*\n\n***both***");
    const blocks = parseRichText(out);
    expect(blocks[0]).toMatchObject({ kind: "paragraph" });
    expect(blocks[1]).toMatchObject({ kind: "paragraph", content: [{ kind: "strong" }] });
  });

  it("serializes underline alone and combined with bold and italic", () => {
    const out = serializeRichTextDom(
      root(el("div", [el("u", [text("underlined")]), text(" and "), el("u", [el("strong", [el("em", [text("all")])])])]))
    );
    expect(out).toBe("++underlined++ and ++***all***++");
    expect(richTextToPlainText(out)).toBe("underlined and all");
  });

  it("does not wrap whitespace-only formatting elements", () => {
    const out = serializeRichTextDom(root(el("div", [text("a"), el("b", [text(" ")]), text("b")])));
    expect(out).toBe("a b");
  });

  it("maps heading tags to prefixes", () => {
    const out = serializeRichTextDom(
      root(el("h3", [text("One")]), el("h4", [text("Two")]), el("h5", [text("Three")]))
    );
    expect(out).toBe("# One\n\n## Two\n\n### Three");
    expect(parseRichText(out).map((b) => b.kind)).toEqual(["heading", "heading", "heading"]);
  });

  it("serializes unordered and ordered lists", () => {
    const out = serializeRichTextDom(
      root(
        el("ul", [el("li", [text("a")]), el("li", [text("b")])]),
        el("ol", [el("li", [text("x")]), el("li", [text("y")])])
      )
    );
    expect(out).toBe("- a\n- b\n\n1. x\n2. y");
  });

  it("serializes checklists with marker state and excludes marker glyphs", () => {
    const out = serializeRichTextDom(
      root(
        el("ul", [el("li", [marker(true), text("Done")]), el("li", [marker(false), text("Todo")])], {
          class: "checklist"
        })
      )
    );
    expect(out).toBe("- [x] Done\n- [ ] Todo");
    expect(out).not.toContain("☑");
  });

  it("treats a list as a checklist when items carry markers even without the class", () => {
    const out = serializeRichTextDom(root(el("ul", [el("li", [marker(false), text("Item")])])));
    expect(out).toBe("- [ ] Item");
  });

  it("skips empty checklist items", () => {
    const out = serializeRichTextDom(
      root(el("ul", [el("li", [marker(false), text("Kept")]), el("li", [marker(false)])], { class: "checklist" }))
    );
    expect(out).toBe("- [ ] Kept");
  });

  it("escapes formatting markers and backslashes so literal text round-trips", () => {
    const out = serializeRichTextDom(root(el("div", [text("2*3=6, C++ and C:\\dir")])));
    expect(out).toBe("2\\*3=6, C\\+\\+ and C:\\\\dir");
    expect(richTextToPlainText(out)).toBe("2*3=6, C++ and C:\\dir");
  });

  it("keeps br as a line break within a paragraph and trims trailing breaks", () => {
    const out = serializeRichTextDom(root(el("div", [text("a"), el("br"), text("b"), el("br")])));
    expect(out).toBe("a\nb");
  });

  it("collapses unknown elements to their text content", () => {
    const out = serializeRichTextDom(
      root(el("div", [el("span", [text("kept ")]), el("mark", [text("also kept")])]))
    );
    expect(out).toBe("kept also kept");
  });

  it("skips empty wrapper divs without emitting blank blocks", () => {
    const out = serializeRichTextDom(
      root(el("div", [text("a")]), el("div", [el("br")]), el("div", [text("b")]))
    );
    expect(out).toBe("a\n\nb");
  });

  it("keeps a word boundary when flattening a nested list", () => {
    // The editor never builds nested lists, but a browser command can. They
    // flatten by design; running the words together is the part that is wrong.
    const out = serializeRichTextDom(
      root(
        el("ul", [
          el("li", [text("Parent"), el("ul", [el("li", [text("Child A")]), el("li", [text("Child B")])])])
        ])
      )
    );
    expect(out).toBe("- Parent Child A Child B");
    expect(richTextToPlainText(out)).toBe("• Parent Child A Child B");
  });

  it("guards paragraph text that would otherwise reparse as a block", () => {
    // Prose can start the way a block does. Without the guard the marker is
    // eaten on the way back in: "1985." would come back as "1.".
    const cases: [string, string][] = [
      ["1985. A good year.", "\\1985. A good year."],
      ["3) See the note above", "\\3) See the note above"],
      ["- not a list, just a dash", "\\- not a list, just a dash"],
      ["# 1 priority for the week", "\\# 1 priority for the week"],
      ["- [ ] pasted from somewhere else", "\\- [ ] pasted from somewhere else"]
    ];
    for (const [typed, stored] of cases) {
      const out = serializeRichTextDom(root(el("div", [text(typed)])));
      expect(out).toBe(stored);
      expect(parseRichText(out).map((b) => b.kind)).toEqual(["paragraph"]);
      expect(richTextToPlainText(out)).toBe(typed);
    }
  });

  it("guards every line of a multi-line paragraph, not just the first", () => {
    const out = serializeRichTextDom(
      root(el("div", [text("Years covered:"), el("br"), text("1985. The first one")]))
    );
    expect(parseRichText(out).map((b) => b.kind)).toEqual(["paragraph"]);
    expect(richTextToPlainText(out)).toBe("Years covered:\n1985. The first one");
  });

  it("leaves real blocks unguarded and does not guard literal backslashes", () => {
    const list = serializeRichTextDom(root(el("ul", [el("li", [text("Alpha")])])));
    expect(list).toBe("- Alpha");
    expect(parseRichText(list).map((b) => b.kind)).toEqual(["unordered-list"]);

    // A user-typed backslash is escaped by the inline escaper, so it must not
    // be mistaken for a guard on the way back.
    const literal = serializeRichTextDom(root(el("div", [text("\\- typed backslash")])));
    expect(richTextToPlainText(literal)).toBe("\\- typed backslash");
  });

  it("round-trips a mixed document through parseRichText", () => {
    const out = serializeRichTextDom(
      root(
        el("h4", [text("Agenda")]),
        el("div", [text("Notes with "), el("b", [text("emphasis")])]),
        el("ul", [el("li", [marker(false), text("Follow up")])], { class: "checklist" })
      )
    );
    const blocks = parseRichText(out);
    expect(blocks.map((b) => b.kind)).toEqual(["heading", "paragraph", "checklist"]);
    expect(richTextToPlainText(out)).toBe("Agenda\n\nNotes with emphasis\n\n☐ Follow up");
  });
});
