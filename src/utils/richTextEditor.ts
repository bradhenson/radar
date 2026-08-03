import CharacterCount from "@tiptap/extension-character-count";
import Placeholder from "@tiptap/extension-placeholder";
import Underline from "@tiptap/extension-underline";
import StarterKit from "@tiptap/starter-kit";

/**
 * The exact editing schema, kept deliberately smaller than Tiptap's capability
 * set. Everything switched off here is off for a reason: links, images, and
 * embeds are the routes by which an editor starts making network requests, and
 * RADAR must never make one. Adding a node or mark is a schema-version,
 * validation, rendering, and export decision — not only a toolbar change.
 */
export function richTextEditorExtensions(maxCharacters: number, placeholder = "") {
  return [
    StarterKit.configure({
      blockquote: false,
      code: false,
      codeBlock: false,
      heading: { levels: [3, 4, 5] },
      horizontalRule: false,
      link: false,
      strike: false
    }),
    Underline,
    Placeholder.configure({ placeholder }),
    CharacterCount.configure({ limit: maxCharacters, mode: "textSize", autoTrim: false })
  ];
}
