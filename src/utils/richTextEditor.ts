import CharacterCount from "@tiptap/extension-character-count";
import Placeholder from "@tiptap/extension-placeholder";
import Underline from "@tiptap/extension-underline";
import StarterKit from "@tiptap/starter-kit";
import { safeLinkHref } from "./richTextDoc";

/**
 * The exact editing schema, kept deliberately smaller than Tiptap's capability
 * set. Images and embeds stay off: those load a remote resource to render, which
 * would make a note depend on the network and break the offline guarantee.
 *
 * Links are on, and they are a different case. A link is inert data — nothing is
 * fetched to display it, a note reads identically offline, and the address is
 * only opened when the reader clicks it, in their own browser. Supervisors work
 * from links to policy pages and shared documents, so storing them as text and
 * making the reader retype them was the wrong trade.
 *
 * The protocol allowlist lives in `safeLinkHref` and is applied here on input
 * and again in RichTextView on render. Adding a node or mark beyond this remains
 * a schema-version, validation, rendering, and export decision — not only a
 * toolbar change.
 */
export function richTextEditorExtensions(maxCharacters: number, placeholder = "") {
  return [
    StarterKit.configure({
      blockquote: false,
      code: false,
      codeBlock: false,
      heading: { levels: [3, 4, 5] },
      horizontalRule: false,
      link: {
        // A plain click inside the editor places the cursor — that is what a
        // click on editable text means. Ctrl+click follows the link instead,
        // handled in RichTextEditor.
        //
        // Word teaches that gesture with a per-link tooltip; this cannot. In
        // Tiptap `title` is a stored mark attribute defaulting to null, so a
        // title set here is overridden by the mark's own, and setting it on the
        // mark would write a UI hint into the saved document. The Link button's
        // tooltip carries it instead.
        openOnClick: false,
        autolink: true,
        linkOnPaste: true,
        protocols: ["http", "https", "mailto"],
        isAllowedUri: (url: string) => safeLinkHref(url) !== undefined,
        HTMLAttributes: { rel: "noopener noreferrer", target: "_blank" }
      },
      strike: false
    }),
    Underline,
    Placeholder.configure({ placeholder }),
    CharacterCount.configure({ limit: maxCharacters, mode: "textSize", autoTrim: false })
  ];
}
