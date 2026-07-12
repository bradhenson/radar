const TEXT_NODE = 3;
const ELEMENT_NODE = 1;

/**
 * Structural view of the DOM nodes the serializer reads. Keeping this
 * interface minimal lets unit tests run in the node environment with plain
 * object fakes instead of a DOM implementation.
 */
export interface DomNodeLike {
  nodeType: number;
  nodeName: string;
  nodeValue: string | null;
  childNodes: ArrayLike<DomNodeLike>;
  getAttribute?(name: string): string | null;
}

const BLOCK_TAGS = new Set(["DIV", "P", "H1", "H2", "H3", "H4", "H5", "H6", "UL", "OL"]);

function isElement(node: DomNodeLike): boolean {
  return node.nodeType === ELEMENT_NODE;
}

/** Checklist toggle markers carry data-checked; they are chrome, not content. */
function isChecklistMarker(node: DomNodeLike): boolean {
  return isElement(node) && node.getAttribute?.("data-checked") != null;
}

function escapeInline(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\*/g, "\\*").replace(/\+/g, "\\+");
}

type InlineSegment = { text: string; bold: boolean; italic: boolean; underline: boolean };

/**
 * Flatten an inline subtree into formatted text runs. contenteditable trees
 * vary in shape (<b><i>x</i>y</b> vs <i><b>x</b></i>…), so serializing per
 * run keeps the output canonical regardless of nesting. Unknown elements
 * contribute only their text, so unexpected markup can never persist.
 */
function collectInline(
  node: DomNodeLike,
  bold: boolean,
  italic: boolean,
  underline: boolean,
  out: InlineSegment[]
): void {
  if (node.nodeType === TEXT_NODE) {
    out.push({ text: node.nodeValue ?? "", bold, italic, underline });
    return;
  }
  if (!isElement(node) || isChecklistMarker(node)) return;
  const name = node.nodeName;
  if (name === "BR") {
    out.push({ text: "\n", bold, italic, underline });
    return;
  }
  // Nested block containers inside inline context still break the line.
  if (name === "DIV" || name === "P") out.push({ text: "\n", bold: false, italic: false, underline: false });
  const nextBold = bold || name === "B" || name === "STRONG";
  const nextItalic = italic || name === "I" || name === "EM";
  const nextUnderline = underline || name === "U";
  for (const child of Array.from(node.childNodes)) collectInline(child, nextBold, nextItalic, nextUnderline, out);
}

function inlineOf(children: DomNodeLike[]): string {
  const segments: InlineSegment[] = [];
  for (const child of children) collectInline(child, false, false, false, segments);
  // Whitespace-only runs carry no visible formatting; dropping their flags
  // merges them with neighbours and avoids emitting markers around spaces.
  const merged: InlineSegment[] = [];
  for (const seg of segments) {
    if (!seg.text) continue;
    const flags = seg.text.trim() ? seg : { ...seg, bold: false, italic: false, underline: false };
    const last = merged[merged.length - 1];
    if (
      last &&
      last.bold === flags.bold &&
      last.italic === flags.italic &&
      last.underline === flags.underline
    ) last.text += flags.text;
    else merged.push({ ...flags });
  }
  return merged
    .map((seg) => {
      const text = escapeInline(seg.text);
      let formatted = text;
      if (seg.italic) formatted = `*${formatted}*`;
      if (seg.bold) formatted = `**${formatted}**`;
      if (seg.underline) formatted = `++${formatted}++`;
      return formatted;
    })
    .join("");
}

function inlineChildren(node: DomNodeLike): string {
  return inlineOf(Array.from(node.childNodes));
}

function headingPrefix(name: string): string {
  if (name === "H1" || name === "H3") return "#";
  if (name === "H2" || name === "H4") return "##";
  return "###";
}

function directItems(list: DomNodeLike): DomNodeLike[] {
  return Array.from(list.childNodes).filter((n) => isElement(n) && n.nodeName === "LI");
}

function isChecklist(list: DomNodeLike): boolean {
  const cls = list.getAttribute?.("class") ?? "";
  if (cls.split(/\s+/).includes("checklist")) return true;
  return directItems(list).some((li) => Array.from(li.childNodes).some(isChecklistMarker));
}

function itemChecked(li: DomNodeLike): boolean {
  const marker = Array.from(li.childNodes).find(isChecklistMarker);
  return marker?.getAttribute?.("data-checked") === "true";
}

/** Headings and list items are single lines in the source syntax. */
function singleLine(text: string): string {
  return text.replace(/\s*\n\s*/g, " ").trim();
}

function serializeList(list: DomNodeLike): string {
  const checklist = list.nodeName === "UL" && isChecklist(list);
  const lines: string[] = [];
  for (const li of directItems(list)) {
    const text = singleLine(inlineChildren(li));
    if (!text) continue;
    if (list.nodeName === "OL") lines.push(`${lines.length + 1}. ${text}`);
    else if (checklist) lines.push(`- [${itemChecked(li) ? "x" : " "}] ${text}`);
    else lines.push(`- ${text}`);
  }
  return lines.join("\n");
}

function serializeBlockElement(node: DomNodeLike): string {
  const name = node.nodeName;
  if (name === "UL" || name === "OL") return serializeList(node);
  if (/^H[1-6]$/.test(name)) {
    const text = singleLine(inlineChildren(node));
    return text ? `${headingPrefix(name)} ${text}` : "";
  }
  return inlineChildren(node).replace(/^\n+|\n+$/g, "");
}

/**
 * Serialize a contenteditable subtree back to the rich-text source syntax
 * understood by parseRichText. Only whitelisted structures survive — bold,
 * italic, underline, headings, and the three list kinds. Anything else collapses to its
 * plain text, so unexpected markup can never reach stored records.
 */
export function serializeRichTextDom(root: DomNodeLike): string {
  const blocks: string[] = [];
  let run: DomNodeLike[] = [];
  const flushRun = () => {
    if (run.length === 0) return;
    const text = inlineOf(run).replace(/^\n+|\n+$/g, "");
    run = [];
    if (text.trim()) blocks.push(text);
  };
  for (const child of Array.from(root.childNodes)) {
    if (isElement(child) && BLOCK_TAGS.has(child.nodeName)) {
      flushRun();
      const text = serializeBlockElement(child);
      if (text.trim()) blocks.push(text);
    } else {
      run.push(child);
    }
  }
  flushRun();
  return blocks.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
}
