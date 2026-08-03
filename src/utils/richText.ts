// Reader for RADAR's pre-Tiptap notation. Nothing writes this format any more:
// its only job is to convert records saved before the editor changed, which
// `richTextDoc.ts` does on read and the backup ladder does on import. Checklists
// still parse here because old notes contain them — see `richTextFromLegacy`
// for where their state goes now.

export type RichTextInline =
  | { kind: "text"; text: string }
  | { kind: "strong" | "emphasis" | "underline"; children: RichTextInline[] };

export type RichTextListItem = {
  content: RichTextInline[];
  checked?: boolean;
};

export type RichTextBlock =
  | { kind: "paragraph"; content: RichTextInline[] }
  | { kind: "heading"; level: 1 | 2 | 3; content: RichTextInline[] }
  | { kind: "unordered-list" | "ordered-list" | "checklist"; items: RichTextListItem[] };

function appendText(nodes: RichTextInline[], text: string): void {
  if (!text) return;
  const last = nodes[nodes.length - 1];
  if (last?.kind === "text") last.text += text;
  else nodes.push({ kind: "text", text });
}

function findUnescaped(text: string, delimiter: string, from: number): number {
  let at = text.indexOf(delimiter, from);
  while (at >= 0) {
    let slashes = 0;
    for (let i = at - 1; i >= 0 && text[i] === "\\"; i--) slashes++;
    if (slashes % 2 === 0) return at;
    at = text.indexOf(delimiter, at + delimiter.length);
  }
  return -1;
}

/** Parse the deliberately small inline subset supported by RichTextEditor. */
export function parseRichTextInline(text: string): RichTextInline[] {
  const nodes: RichTextInline[] = [];
  let i = 0;
  while (i < text.length) {
    if (text[i] === "\\" && i + 1 < text.length && ["\\", "*", "+"].includes(text[i + 1]!)) {
      const escaped = text[i + 1]!;
      const paired = (escaped === "*" || escaped === "+") && text[i + 2] === escaped;
      appendText(nodes, paired ? escaped + escaped : escaped);
      i += paired ? 3 : 2;
      continue;
    }

    if (text.startsWith("++", i)) {
      const close = findUnescaped(text, "++", i + 2);
      if (close > i + 2) {
        nodes.push({ kind: "underline", children: parseRichTextInline(text.slice(i + 2, close)) });
        i = close + 2;
        continue;
      }
    }

    if (text.startsWith("***", i) && text[i + 3] !== "*") {
      const close = findUnescaped(text, "***", i + 3);
      if (close > i + 3) {
        nodes.push({
          kind: "strong",
          children: [{ kind: "emphasis", children: parseRichTextInline(text.slice(i + 3, close)) }]
        });
        i = close + 3;
        continue;
      }
    }

    if (text.startsWith("**", i)) {
      const close = findUnescaped(text, "**", i + 2);
      if (close > i + 2) {
        nodes.push({ kind: "strong", children: parseRichTextInline(text.slice(i + 2, close)) });
        i = close + 2;
        continue;
      }
    }

    if (text[i] === "*" && text[i + 1] !== "*") {
      const close = findUnescaped(text, "*", i + 1);
      if (close > i + 1 && text[close + 1] !== "*") {
        nodes.push({ kind: "emphasis", children: parseRichTextInline(text.slice(i + 1, close)) });
        i = close + 1;
        continue;
      }
    }

    appendText(nodes, text[i]!);
    i++;
  }
  return nodes;
}

type ParsedLine =
  | { kind: "heading"; level: 1 | 2 | 3; text: string }
  | { kind: "unordered-list" | "ordered-list"; text: string }
  | { kind: "checklist"; text: string; checked: boolean };

/**
 * Prose can legitimately begin the way a block does — "1985. A good year.",
 * "- not a list, just a dash", "# 1 priority". Without a guard the serializer
 * writes those lines verbatim and the parser reads them back as a list or a
 * heading, silently eating the marker ("1985." becomes "1."). Paragraph lines
 * that would reparse as a block are therefore stored with a leading backslash,
 * which `stripBlockGuard` removes on the way back in.
 */
export function guardParagraphLine(line: string): string {
	return parseBlockLine(line) ? `\\${line}` : line;
}

function stripBlockGuard(line: string): string {
	return line.startsWith('\\') && parseBlockLine(line.slice(1)) ? line.slice(1) : line;
}

function parseBlockLine(line: string): ParsedLine | undefined {
  const heading = /^(#{1,3})\s+(.+)$/.exec(line);
  if (heading) return { kind: "heading", level: heading[1]!.length as 1 | 2 | 3, text: heading[2]! };

  const checklist = /^\s*[-*]\s+\[([ xX])\]\s+(.+)$/.exec(line);
  if (checklist) return { kind: "checklist", checked: checklist[1]!.toLowerCase() === "x", text: checklist[2]! };

  const unordered = /^\s*[-*]\s+(.+)$/.exec(line);
  if (unordered) return { kind: "unordered-list", text: unordered[1]! };

  const ordered = /^\s*\d+[.)]\s+(.+)$/.exec(line);
  if (ordered) return { kind: "ordered-list", text: ordered[1]! };
  return undefined;
}

/**
 * Parse trusted syntax, not trusted content. Returned nodes contain only text
 * and known formatting kinds, so callers never need to inject user HTML.
 */
export function parseRichText(value: string | undefined): RichTextBlock[] {
  const lines = (value ?? "").replace(/\r\n?/g, "\n").split("\n");
  const blocks: RichTextBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim()) {
      i++;
      continue;
    }

    const parsed = parseBlockLine(line);
    if (parsed?.kind === "heading") {
      blocks.push({ kind: "heading", level: parsed.level, content: parseRichTextInline(parsed.text) });
      i++;
      continue;
    }

    if (parsed) {
      const kind = parsed.kind;
      const items: RichTextListItem[] = [];
      while (i < lines.length) {
        const item = parseBlockLine(lines[i]!);
        if (!item || item.kind !== kind) break;
        items.push({
          content: parseRichTextInline(item.text),
          ...(item.kind === "checklist" ? { checked: item.checked } : {})
        });
        i++;
      }
      blocks.push({ kind, items });
      continue;
    }

    // Guards are stripped from every line, not just the first: a guarded line
    // never matches parseBlockLine, so it is also how a paragraph continues.
    const paragraph: string[] = [stripBlockGuard(line)];
    i++;
    while (i < lines.length && lines[i]!.trim() && !parseBlockLine(lines[i]!)) {
      paragraph.push(stripBlockGuard(lines[i]!));
      i++;
    }
    blocks.push({ kind: "paragraph", content: parseRichTextInline(paragraph.join("\n")) });
  }
  return blocks;
}

