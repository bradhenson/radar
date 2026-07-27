<script lang="ts">
  import { parseRichText, type RichTextBlock, type RichTextInline } from "../../utils/richText";
  import { serializeRichTextDom } from "../../utils/richTextDom";

  let {
    id,
    value = $bindable(),
    rows = 5,
    maxlength = 10000,
    placeholder = "",
    ariaLabel
  }: {
    id: string;
    value?: string;
    rows?: number;
    maxlength?: number;
    placeholder?: string;
    ariaLabel: string;
  } = $props();

  let editor: HTMLDivElement | undefined = $state();
  // Last value this editor emitted; only external changes re-render the DOM,
  // so the caret is never disturbed while typing.
  let lastEmitted = "";
  /**
   * Serialized length of the current content. Cached because the limit check
   * runs on every keystroke and serializing is a full tree walk — counting
   * characters should not cost a second one.
   */
  let length = $state(0);
  /** Transient message for the two things that would otherwise fail in silence:
   *  reaching the character limit, and a paste being trimmed to fit. */
  let notice = $state("");
  let noticeTimer: ReturnType<typeof setTimeout> | undefined;
  /** Which formats apply at the caret, so the toolbar can show what is on. */
  let active = $state({ bold: false, italic: false, underline: false, heading: false, ul: false, ol: false, checklist: false });
  /** True between compositionstart and compositionend — see `emit`. */
  let composing = false;
  /** Roving tabindex: the toolbar is one tab stop, arrow keys move within it. */
  let toolbarIndex = $state(0);
  let toolbar: HTMLDivElement | undefined = $state();

  let remaining = $derived(maxlength - length);
  /** Counting up to the limit all the time is noise; near it, it is the answer. */
  let showCount = $derived(remaining <= Math.max(200, Math.round(maxlength * 0.1)));

  $effect(() => {
    const next = value ?? "";
    if (!editor) return;
    if (next !== lastEmitted) {
      renderValue(next);
      lastEmitted = next;
      length = next.length;
    }
    editor.classList.toggle("is-empty", next === "");
  });

  // The caret moves without the content changing, so toolbar state has to
  // follow selection rather than input.
  $effect(() => {
    const onSelectionChange = () => refreshActive();
    document.addEventListener("selectionchange", onSelectionChange);
    return () => {
      document.removeEventListener("selectionchange", onSelectionChange);
      clearTimeout(noticeTimer);
    };
  });

  function showNotice(message: string) {
    notice = message;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => (notice = ""), 5000);
  }

  function refreshActive() {
    if (!editor || document.activeElement !== editor) return;
    const blocks = currentBlocks();
    const all = (test: (b: HTMLElement) => boolean) => blocks.length > 0 && blocks.every(test);
    let bold = false, italic = false, underline = false;
    try {
      bold = document.queryCommandState("bold");
      italic = document.queryCommandState("italic");
      underline = document.queryCommandState("underline");
    } catch {
      // queryCommandState throws in some engines when the selection is detached;
      // an unlit toolbar button is a better outcome than a broken editor.
    }
    active = {
      bold, italic, underline,
      heading: all((b) => /^H[1-6]$/.test(b.nodeName)),
      ul: all((b) => b.nodeName === "UL" && !b.classList.contains("checklist")),
      ol: all((b) => b.nodeName === "OL"),
      checklist: all((b) => b.matches("ul.checklist"))
    };
  }

  function makeMarker(checked: boolean): HTMLSpanElement {
    const span = document.createElement("span");
    span.className = "check";
    span.contentEditable = "false";
    span.dataset.checked = String(checked);
    span.setAttribute("role", "checkbox");
    span.setAttribute("aria-checked", String(checked));
    span.setAttribute("aria-label", "Toggle item");
    span.tabIndex = 0;
    span.textContent = checked ? "☑" : "☐";
    return span;
  }

  function inlineToDom(nodes: RichTextInline[], parent: Node) {
    for (const node of nodes) {
      if (node.kind === "text") {
        parent.appendChild(document.createTextNode(node.text));
      } else {
        const el = document.createElement(node.kind === "strong" ? "b" : node.kind === "emphasis" ? "i" : "u");
        inlineToDom(node.children, el);
        parent.appendChild(el);
      }
    }
  }

  /** Build editable DOM from parsed blocks — text nodes and known tags only. */
  function appendBlocks(target: Node, blocks: RichTextBlock[]) {
    for (const block of blocks) {
      if (block.kind === "heading") {
        const el = document.createElement(block.level === 1 ? "h3" : block.level === 2 ? "h4" : "h5");
        inlineToDom(block.content, el);
        target.appendChild(el);
      } else if (block.kind === "paragraph") {
        const div = document.createElement("div");
        inlineToDom(block.content, div);
        if (!div.hasChildNodes()) div.appendChild(document.createElement("br"));
        target.appendChild(div);
      } else {
        const list = document.createElement(block.kind === "ordered-list" ? "ol" : "ul");
        if (block.kind === "checklist") list.className = "checklist";
        for (const item of block.items) {
          const li = document.createElement("li");
          if (block.kind === "checklist") li.appendChild(makeMarker(item.checked === true));
          inlineToDom(item.content, li);
          list.appendChild(li);
        }
        target.appendChild(list);
      }
    }
  }

  function renderValue(v: string) {
    if (!editor) return;
    editor.textContent = "";
    appendBlocks(editor, parseRichText(v));
  }

  /**
   * Editing can leave lists in degenerate states: Enter splits a checklist li
   * without its marker, Backspace can merge a marker mid-line or delete the
   * last li leaving <ul><br></ul>, and commands can produce an empty li that
   * cannot host the caret. Repair all of it after every change.
   */
  function normalizeLists() {
    if (!editor) return;
    // Markers belong only at the head of a checklist item.
    for (const m of Array.from(editor.querySelectorAll("[data-checked]"))) {
      const li = m.parentElement;
      const valid = li?.nodeName === "LI" && li.parentElement?.matches("ul.checklist") && li.firstChild === m;
      if (!valid) m.remove();
    }
    for (const li of editor.querySelectorAll("ul.checklist > li")) {
      if (!li.querySelector(":scope > [data-checked]")) li.insertBefore(makeMarker(false), li.firstChild);
    }
    // Every list item must be able to host the caret.
    for (const li of Array.from(editor.querySelectorAll("li"))) {
      const hasContent = Array.from(li.childNodes).some(
        (c) => !(c instanceof HTMLElement && c.dataset.checked != null)
      );
      if (!hasContent) li.appendChild(document.createElement("br"));
    }
    // Lists hold only list items; a list left with none goes away entirely.
    for (const list of Array.from(editor.querySelectorAll("ul, ol"))) {
      for (const child of Array.from(list.childNodes)) {
        if (!(child instanceof HTMLElement && child.nodeName === "LI")) child.remove();
      }
      if (!list.firstChild) list.remove();
    }
  }

  /**
   * A brand-new empty contenteditable holds typed characters in a bare text
   * node with no block wrapper, so first-line autoformat ("- ", "## ", …)
   * can't find a block to convert. Seed one empty block on focus so the very
   * first line behaves like every later line. The is-empty class (not :empty)
   * drives the placeholder, so the seeded block stays invisible until typed in.
   */
  function seedEmptyBlock() {
    if (!editor) return;
    const div = document.createElement("div");
    div.appendChild(document.createElement("br"));
    editor.replaceChildren(div);
    const range = document.createRange();
    range.setStart(div, 0);
    range.collapse(true);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }

  function onCompositionStart() {
    composing = true;
  }

  function onCompositionEnd() {
    composing = false;
    // Run the repair pass that was skipped for the duration of the composition.
    emit();
  }

  function onEditorFocus() {
    // Only seed when the DOM is truly empty; a list/heading in progress can
    // serialize to "" yet must not be replaced.
    if (editor && !editor.firstChild) seedEmptyBlock();
  }

  function emit() {
    if (!editor) return;
    // Rewriting the DOM underneath an active composition cancels it, which is
    // how accented input, mobile autocorrect, and IME candidate windows break.
    // The repair pass is not urgent — it waits for compositionend.
    if (!composing) {
      normalizeLists();
      // Normalization can remove the last block entirely; re-seed while focused
      // so typing (and first-line autoformat) still has a block to land in.
      if (!editor.firstChild && document.activeElement === editor) seedEmptyBlock();
    }
    const next = serializeRichTextDom(editor);
    // Placeholder shows only when there is no text and no block structure
    // (an empty list item the user is filling in is not "empty").
    const structural = editor.querySelector("ul, ol, h3, h4, h5") !== null;
    editor.classList.toggle("is-empty", next === "" && !structural);
    lastEmitted = next;
    length = next.length;
    value = next;
    refreshActive();
  }

  /**
   * Formatting grows the serialized text — bold adds four characters, a
   * checklist six per item — but commands do not go through beforeinput, so
   * they were the one way to push a note past the limit and have the save
   * rejected later. Run the command, and if it overflows, put the content back.
   */
  function withinLimit(apply: () => void) {
    if (!editor) return;
    const snapshot = Array.from(editor.childNodes).map((node) => node.cloneNode(true));
    apply();
    normalizeLists();
    if (serializeRichTextDom(editor).length > maxlength) {
      editor.replaceChildren(...snapshot);
      // execCommand already fired input, so emit() has recorded the over-limit
      // length. Emit again from the restored content to put it back.
      emit();
      showNotice("That formatting would push this past the character limit.");
      return;
    }
    emit();
  }

  /**
   * execCommand merges adjacent same-tag lists, so a bullet list created next
   * to a checklist is absorbed into it. Pull marker-less items back out into
   * a plain list. Only called right after a command — mid-typing an item may
   * legitimately lack its marker until normalizeChecklists restores it.
   */
  function repairChecklistMerges() {
    if (!editor) return;
    for (const list of Array.from(editor.querySelectorAll("ul.checklist"))) {
      const items = Array.from(list.querySelectorAll(":scope > li"));
      const strays = items.filter((li) => !li.querySelector(":scope > [data-checked]"));
      if (strays.length === 0 || strays.length === items.length) continue;
      const plain = document.createElement("ul");
      for (const li of strays) plain.appendChild(li);
      list.parentNode?.insertBefore(plain, list.nextSibling);
    }
  }

  function exec(command: string, arg?: string) {
    editor?.focus();
    withinLimit(() => {
      document.execCommand(command, false, arg);
      repairChecklistMerges();
    });
  }

  /**
   * Bullet / numbered list commands. execCommand on a checklist strips both
   * the markers and the items' <br>, leaving caret-less empty items — so
   * checklist selections are converted manually, preserving item content.
   */
  function execList(kind: "ul" | "ol") {
    if (!editor) return;
    editor.focus();
    const blocks = currentBlocks();
    const checklists = blocks.filter((b) => b.matches("ul.checklist"));
    if (checklists.length > 0 && checklists.length === blocks.length) {
      withinLimit(() => {
        let firstItem: HTMLElement | null = null;
        for (const listEl of checklists) {
          const list = document.createElement(kind);
          for (const li of Array.from(listEl.querySelectorAll(":scope > li"))) {
            const item = document.createElement("li");
            contentWithoutMarker(Array.from(li.childNodes), item);
            if (!item.hasChildNodes()) item.appendChild(document.createElement("br"));
            list.appendChild(item);
            firstItem ??= item;
          }
          listEl.replaceWith(list);
        }
        if (firstItem) placeCaretAtEnd(firstItem);
      });
      return;
    }
    exec(kind === "ul" ? "insertUnorderedList" : "insertOrderedList");
  }

  function currentBlocks(): HTMLElement[] {
    if (!editor) return [];
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return [];
    const range = sel.getRangeAt(0);
    if (!editor.contains(range.commonAncestorContainer)) return [];
    return Array.from(editor.children).filter((el) => range.intersectsNode(el)) as HTMLElement[];
  }

  function toggleHeading() {
    editor?.focus();
    const blocks = currentBlocks();
    const isHeading = blocks.length > 0 && blocks.every((b) => /^H[1-6]$/.test(b.nodeName));
    withinLimit(() => document.execCommand("formatBlock", false, isHeading ? "div" : "h4"));
  }

  function placeCaretAtEnd(el: HTMLElement) {
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }

  function contentWithoutMarker(source: ChildNode[], target: HTMLElement) {
    for (const child of source) {
      if (child instanceof HTMLElement && child.dataset.checked != null) continue;
      target.appendChild(child);
    }
  }

  function toggleChecklist() {
    if (!editor) return;
    const root = editor;
    root.focus();
    const blocks = currentBlocks();
    withinLimit(() => {
      if (blocks.length === 0) {
        const list = document.createElement("ul");
        list.className = "checklist";
        const li = document.createElement("li");
        li.appendChild(makeMarker(false));
        li.appendChild(document.createElement("br"));
        list.appendChild(li);
        root.appendChild(list);
        placeCaretAtEnd(li);
        return;
      }
      const allChecklist = blocks.every((b) => b.matches("ul.checklist"));
      if (allChecklist) {
        let firstOut: HTMLElement | undefined;
        for (const listEl of blocks) {
          for (const li of Array.from(listEl.querySelectorAll(":scope > li"))) {
            const div = document.createElement("div");
            contentWithoutMarker(Array.from(li.childNodes), div);
            if (!div.hasChildNodes()) div.appendChild(document.createElement("br"));
            root.insertBefore(div, listEl);
            firstOut ??= div;
          }
          listEl.remove();
        }
        if (firstOut) placeCaretAtEnd(firstOut);
      } else {
        const list = document.createElement("ul");
        list.className = "checklist";
        const addItem = (source: ChildNode[]) => {
          const li = document.createElement("li");
          li.appendChild(makeMarker(false));
          contentWithoutMarker(source, li);
          if (li.childNodes.length === 1) li.appendChild(document.createElement("br"));
          list.appendChild(li);
        };
        root.insertBefore(list, blocks[0]!);
        for (const block of blocks) {
          if (block.nodeName === "UL" || block.nodeName === "OL") {
            for (const li of Array.from(block.querySelectorAll(":scope > li"))) addItem(Array.from(li.childNodes));
          } else {
            addItem(Array.from(block.childNodes));
          }
          block.remove();
        }
        const first = list.querySelector("li");
        if (first) placeCaretAtEnd(first);
      }
    });
  }

  function toggleMarker(target: HTMLElement) {
    const checked = target.dataset.checked !== "true";
    target.dataset.checked = String(checked);
    target.setAttribute("aria-checked", String(checked));
    target.textContent = checked ? "☑" : "☐";
    emit();
  }

  function onEditorClick(e: MouseEvent) {
    if (e.target instanceof HTMLElement && e.target.dataset.checked != null) toggleMarker(e.target);
  }

  /** Turn a typed line prefix ("- ", "1. ", "## ", "[] ") into live formatting. */
  function maybeAutoformat(e: KeyboardEvent) {
    if (!editor) return;
    const sel = window.getSelection();
    if (!sel || !sel.isCollapsed || sel.rangeCount === 0) return;
    const anchor = sel.anchorNode;
    if (!anchor || anchor.nodeType !== Node.TEXT_NODE) return;
    let block: Node | null = anchor;
    while (block && block.parentNode !== editor) block = block.parentNode;
    if (!(block instanceof HTMLElement) || !/^(DIV|P)$/.test(block.nodeName)) return;
    const range = document.createRange();
    range.setStart(block, 0);
    range.setEnd(anchor, sel.anchorOffset);
    const prefix = range.toString();
    const target = block;
    let action: (() => void) | undefined;
    if (prefix === "-" || prefix === "*") {
      action = () => convertBlockToListItem(target, "ul");
    } else if (/^\d+[.)]$/.test(prefix)) {
      action = () => convertBlockToListItem(target, "ol");
    } else if (/^#{1,3}$/.test(prefix)) {
      const tag = prefix.length === 1 ? "h3" : prefix.length === 2 ? "h4" : "h5";
      action = () => document.execCommand("formatBlock", false, tag);
    } else if (prefix === "[]" || prefix === "[ ]") {
      action = () => convertBlockToChecklistItem(target);
    }
    if (!action) return;
    e.preventDefault();
    // Delete the prefix directly rather than via execCommand: deleting the
    // only content of a block with execCommand can merge/detach that block,
    // which would leave the conversion operating on a node no longer in the
    // tree. deleteContents keeps the block element intact.
    range.deleteContents();
    const caret = document.createRange();
    caret.setStart(block, 0);
    caret.collapse(true);
    sel.removeAllRanges();
    sel.addRange(caret);
    action();
    emit();
  }

  /** Manual conversion merges into a compatible neighbouring list but never a checklist. */
  function convertBlockToListItem(block: HTMLElement, kind: "ul" | "ol") {
    const li = document.createElement("li");
    contentWithoutMarker(Array.from(block.childNodes), li);
    if (!li.hasChildNodes()) li.appendChild(document.createElement("br"));
    const prev = block.previousElementSibling;
    if (prev && prev.nodeName === kind.toUpperCase() && !prev.classList.contains("checklist")) {
      prev.appendChild(li);
      block.remove();
    } else {
      const list = document.createElement(kind);
      list.appendChild(li);
      block.replaceWith(list);
    }
    placeCaretAtEnd(li);
  }

  function convertBlockToChecklistItem(block: HTMLElement) {
    if (!editor) return;
    const li = document.createElement("li");
    li.appendChild(makeMarker(false));
    contentWithoutMarker(Array.from(block.childNodes), li);
    if (li.childNodes.length === 1) li.appendChild(document.createElement("br"));
    const prev = block.previousElementSibling;
    if (prev?.matches("ul.checklist")) {
      prev.appendChild(li);
      block.remove();
    } else {
      const list = document.createElement("ul");
      list.className = "checklist";
      list.appendChild(li);
      block.replaceWith(list);
    }
    placeCaretAtEnd(li);
  }

  function checklistItemOf(node: Node | null): HTMLLIElement | null {
    while (node && node !== editor) {
      if (node instanceof HTMLLIElement && node.parentElement?.matches("ul.checklist")) return node;
      node = node.parentNode;
    }
    return null;
  }

  function placeCaretAtStartOfItem(li: HTMLElement) {
    const range = document.createRange();
    const marker = li.querySelector(":scope > [data-checked]");
    if (marker) range.setStartAfter(marker);
    else range.setStart(li, 0);
    range.collapse(true);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }

  /**
   * Backspace on an empty checklist item. The browser cannot do this cleanly:
   * it deletes the non-editable marker (which normalization would resurrect)
   * and can leave a list with no items. Remove the item ourselves and put the
   * caret somewhere sensible.
   */
  function removeChecklistItem(li: HTMLLIElement) {
    if (!editor) return;
    const list = li.parentElement!;
    const prevItem = li.previousElementSibling as HTMLElement | null;
    const nextItem = li.nextElementSibling as HTMLElement | null;
    li.remove();
    if (prevItem) {
      placeCaretAtEnd(prevItem);
    } else if (nextItem) {
      placeCaretAtStartOfItem(nextItem);
    } else {
      const prevBlock = list.previousElementSibling as HTMLElement | null;
      const nextBlock = list.nextElementSibling as HTMLElement | null;
      list.remove();
      if (prevBlock) placeCaretAtEnd(prevBlock);
      else if (nextBlock) placeCaretAtStartOfItem(nextBlock);
      else seedEmptyBlock();
    }
    emit();
  }

  function itemIsEmpty(li: HTMLLIElement): boolean {
    let text = "";
    for (const child of Array.from(li.childNodes)) {
      if (child instanceof HTMLElement && child.dataset.checked != null) continue;
      text += child.textContent ?? "";
    }
    return text.trim() === "";
  }

  /**
   * The non-editable marker keeps the browser from treating an empty checklist
   * item as empty, so Enter would never leave the list. Exit it ourselves.
   */
  function exitChecklistItem(li: HTMLLIElement) {
    if (!editor) return;
    const list = li.parentElement!;
    let sib: Element | null = li.nextElementSibling;
    if (sib) {
      const tail = list.cloneNode(false) as HTMLElement;
      while (sib) {
        const after: Element | null = sib.nextElementSibling;
        tail.appendChild(sib);
        sib = after;
      }
      list.parentNode!.insertBefore(tail, list.nextSibling);
    }
    const div = document.createElement("div");
    div.appendChild(document.createElement("br"));
    list.parentNode!.insertBefore(div, list.nextSibling);
    li.remove();
    if (!list.querySelector(":scope > li")) list.remove();
    const range = document.createRange();
    range.setStart(div, 0);
    range.collapse(true);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    emit();
  }

  function onEditorKeydown(e: KeyboardEvent) {
    // While an IME is composing, keys belong to the candidate window, not to
    // us: a space is selecting a candidate, not ending a line for autoformat.
    if (composing || e.isComposing) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "b") {
      e.preventDefault();
      exec("bold");
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "i") {
      e.preventDefault();
      exec("italic");
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "u") {
      e.preventDefault();
      exec("underline");
      return;
    }
    if (e.target instanceof HTMLElement && e.target.dataset.checked != null) {
      // Keyboard focus is on a checklist marker (it has tabindex): toggle on
      // Enter/Space, remove the item on Backspace/Delete. Without this the
      // keys hit a non-editable element and silently do nothing.
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        toggleMarker(e.target);
        return;
      }
      if (e.key === "Backspace" || e.key === "Delete") {
        const li = e.target.closest("li");
        if (li instanceof HTMLLIElement) {
          e.preventDefault();
          removeChecklistItem(li);
          return;
        }
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      const sel = window.getSelection();
      const li = sel?.isCollapsed ? checklistItemOf(sel.anchorNode) : null;
      if (li && itemIsEmpty(li)) {
        e.preventDefault();
        exitChecklistItem(li);
        return;
      }
    }
    if (e.key === "Backspace") {
      const sel = window.getSelection();
      const li = sel?.isCollapsed ? checklistItemOf(sel.anchorNode) : null;
      if (li && itemIsEmpty(li)) {
        e.preventDefault();
        removeChecklistItem(li);
        return;
      }
    }
    if (e.key === " ") maybeAutoformat(e);
  }

  function onBeforeInput(e: InputEvent) {
    if (!editor || !e.inputType.startsWith("insert")) return;
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) return; // replacing a selection can shrink content
    if (length >= maxlength) {
      e.preventDefault();
      // Typing that simply stops working reads as a broken editor, so say why.
      showNotice(`This field is limited to ${maxlength.toLocaleString()} characters.`);
    }
  }

  type Tool = { key: keyof typeof active; label: string; title: string; glyph: string; cls: string; run: () => void };
  const tools: Tool[] = [
    { key: "bold", label: "Bold", title: "Bold (Ctrl+B)", glyph: "B", cls: "strong", run: () => exec("bold") },
    { key: "italic", label: "Italic", title: "Italic (Ctrl+I)", glyph: "I", cls: "emphasis", run: () => exec("italic") },
    { key: "underline", label: "Underline", title: "Underline (Ctrl+U)", glyph: "U", cls: "underline", run: () => exec("underline") },
    { key: "heading", label: "Heading", title: "Heading", glyph: "H", cls: "", run: toggleHeading },
    { key: "ul", label: "Bulleted list", title: "Bulleted list", glyph: "•", cls: "", run: () => execList("ul") },
    { key: "ol", label: "Numbered list", title: "Numbered list", glyph: "1.", cls: "", run: () => execList("ol") },
    { key: "checklist", label: "Checklist", title: "Checklist", glyph: "☐", cls: "", run: toggleChecklist }
  ];
  /** Index the separator sits before, so the markup stays in step with `tools`. */
  const SEPARATOR_BEFORE = 3;

  /**
   * A toolbar is one tab stop with arrow keys inside it, not seven stops in the
   * middle of a text field — tabbing out of a note should reach the next
   * control, not walk the formatting buttons.
   */
  function onToolbarKeydown(e: KeyboardEvent) {
    const last = tools.length - 1;
    let next: number;
    if (e.key === "ArrowRight") next = toolbarIndex === last ? 0 : toolbarIndex + 1;
    else if (e.key === "ArrowLeft") next = toolbarIndex === 0 ? last : toolbarIndex - 1;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = last;
    else return;
    e.preventDefault();
    toolbarIndex = next;
    toolbar?.querySelectorAll<HTMLButtonElement>("button.format")[next]?.focus();
  }

  /**
   * Numeric prefixes are the ambiguous ones: "1985. A good year." and "3) See
   * above" are ordinary prose far more often than they are list items, so they
   * are guarded and pasted as text. Dashes, asterisks, box markers, and hashes
   * are only ever written deliberately, so a pasted list stays a list.
   */
  const AMBIGUOUS_PREFIX = /^\s*\d+[.)]\s+\S/;
  function interpretPaste(text: string): RichTextBlock[] {
    return parseRichText(
      text.split("\n").map((line) => (AMBIGUOUS_PREFIX.test(line) ? `\\${line}` : line)).join("\n")
    );
  }

  /**
   * Where a structured paste may land: the whole editor when it is empty, or
   * the top-level block holding the caret when that block has no text of its
   * own. `null` means the caret is inside existing text, where replacing the
   * block would destroy what is already there.
   */
  function pasteLanding(): HTMLElement | "all" | null {
    if (!editor) return null;
    if ((editor.textContent ?? "").trim() === "") return "all";
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || !editor.contains(sel.anchorNode)) return null;
    let node: Node | null = sel.anchorNode;
    if (node === editor) return null;
    while (node && node.parentNode !== editor) node = node.parentNode;
    if (!(node instanceof HTMLElement)) return null;
    return (node.textContent ?? "").trim() === "" ? node : null;
  }

  function onPaste(e: ClipboardEvent) {
    e.preventDefault();
    if (!editor) return;
    const text = e.clipboardData?.getData("text/plain") ?? "";
    if (!text) return;
    const room = maxlength - length;
    if (room <= 0) {
      showNotice(`This field is full, so nothing was pasted. The limit is ${maxlength.toLocaleString()} characters.`);
      return;
    }
    const clipped = text.slice(0, room);
    const blocks = interpretPaste(clipped);
    const structured = blocks.length > 1 || blocks.some((block) => block.kind !== "paragraph");
    const landing = pasteLanding();
    if (structured && landing) {
      // Pasting a list onto a blank line replaces that line with real
      // structure. Anywhere else the caret is mid-sentence, where silently
      // rewriting the surrounding block would be the bigger surprise, so the
      // text goes in as text and the guard keeps it readable.
      const fragment = document.createDocumentFragment();
      appendBlocks(fragment, blocks);
      const last = fragment.lastChild;
      if (landing === "all") editor.replaceChildren(fragment);
      else landing.replaceWith(fragment);
      if (last instanceof HTMLElement) placeCaretAtEnd(last);
      emit();
    } else {
      document.execCommand("insertText", false, clipped);
      emit();
    }
    if (text.length > room) {
      showNotice(`Pasted text was trimmed to fit — ${(text.length - room).toLocaleString()} characters were left out.`);
    }
  }
</script>

<div class="rich-editor">
  <div
    class="toolbar"
    role="toolbar"
    aria-label={`${ariaLabel} formatting`}
    bind:this={toolbar}
    onkeydown={onToolbarKeydown}
    tabindex={-1}
  >
    {#each tools as tool, i (tool.key)}
      {#if i === SEPARATOR_BEFORE}<span class="separator" aria-hidden="true"></span>{/if}
      <button
        type="button"
        class="format {tool.cls}"
        class:on={active[tool.key]}
        aria-label={tool.label}
        aria-pressed={active[tool.key]}
        title={tool.title}
        tabindex={i === toolbarIndex ? 0 : -1}
        onfocus={() => (toolbarIndex = i)}
        onmousedown={(e) => e.preventDefault()}
        onclick={tool.run}>{tool.glyph}</button>
    {/each}
  </div>
  <div
    {id}
    class="editor"
    bind:this={editor}
    contenteditable="true"
    role="textbox"
    tabindex="0"
    aria-multiline="true"
    aria-label={ariaLabel}
    data-placeholder={placeholder}
    style:min-height={`calc(${rows} * 1.45em + 1.3rem)`}
    oninput={emit}
    onbeforeinput={onBeforeInput}
    oncompositionstart={onCompositionStart}
    oncompositionend={onCompositionEnd}
    onfocus={onEditorFocus}
    onkeydown={onEditorKeydown}
    onclick={onEditorClick}
    onpaste={onPaste}
  ></div>
  <!-- Always in the DOM so the live region is present before a notice arrives;
       it collapses to nothing while empty. -->
  <div class="status">
    <span class="notice" role="status">{notice}</span>
    {#if showCount}
      <span class="count" class:full={remaining <= 0}>{remaining.toLocaleString()} characters left</span>
    {/if}
  </div>
</div>

<style>
  .rich-editor {
    width: 100%;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
    overflow: hidden;
  }
  .rich-editor:focus-within {
    border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 9%, transparent);
  }
  .toolbar {
    display: flex;
    align-items: center;
    gap: .18rem;
    min-height: 2.15rem;
    padding: .22rem .3rem;
    border-bottom: 1px solid var(--border);
    background: var(--surface-2);
  }
  .toolbar button {
    min-height: 1.65rem;
    padding: .12rem .42rem;
    border-color: transparent;
    background: transparent;
    box-shadow: none;
    color: var(--text-muted);
    font-size: .78rem;
  }
  .toolbar button:hover,
  .toolbar button:focus-visible { background: var(--surface); color: var(--text); border-color: var(--border); }
  /* Which formats apply at the caret. Not colour alone: the button also gains a
     border and weight, and carries aria-pressed for assistive technology. */
  .toolbar button.on {
    background: var(--accent-soft);
    border-color: var(--accent);
    color: var(--text);
    font-weight: 800;
  }
  .format { min-width: 1.75rem; font-size: .9rem; }
  .strong { font-weight: 800; }
  .emphasis { font-style: italic; }
  .underline { text-decoration: underline; text-underline-offset: .12em; }
  .separator { width: 1px; height: 1.2rem; margin: 0 .18rem; background: var(--border); }
  .editor {
    position: relative;
    padding: .65rem .7rem;
    background: var(--surface);
    line-height: 1.45;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    overflow-y: auto;
    resize: vertical;
    outline: 0;
  }
  /* The global [tabindex]:focus-visible ring would outline the inner editable
     area, drawing a line under the toolbar. The container's :focus-within
     border + shadow is the single focus indicator for the whole control. */
  .editor:focus,
  .editor:focus-visible {
    outline: none;
  }
  /* Class-driven (not :empty) so the seeded empty block stays invisible.
     :global because the class is toggled in JS, not present in markup, so
     Svelte would otherwise prune this rule. Absolute so the seeded line
     doesn't push the placeholder down. */
  .editor:global(.is-empty)::before {
    content: attr(data-placeholder);
    position: absolute;
    color: var(--text-muted);
    pointer-events: none;
  }
  .status {
    display: flex;
    align-items: baseline;
    gap: .6rem;
    font-size: .74rem;
  }
  .notice:not(:empty) {
    padding: .1rem .7rem .45rem;
    color: var(--warning);
  }
  .count {
    margin-left: auto;
    padding: .1rem .7rem .45rem;
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
  }
  .count.full { color: var(--danger); font-weight: 700; }
  /* Children are built imperatively, so Svelte scoping never reaches them. */
  .editor :global(div) { margin: 0 0 .65rem; }
  .editor :global(div:last-child) { margin-bottom: 0; }
  .editor :global(h3),
  .editor :global(h4),
  .editor :global(h5) { margin: .85rem 0 .35rem; line-height: 1.25; }
  .editor :global(h3:first-child),
  .editor :global(h4:first-child),
  .editor :global(h5:first-child) { margin-top: 0; }
  .editor :global(h3) { font-size: 1.05rem; }
  .editor :global(h4) { font-size: .98rem; }
  .editor :global(h5) { font-size: .92rem; }
  .editor :global(ul),
  .editor :global(ol) { margin: 0 0 .65rem; padding-left: 1.35rem; }
  .editor :global(li + li) { margin-top: .2rem; }
  .editor :global(ul.checklist) { list-style: none; padding-left: .2rem; }
  .editor :global(.check) {
    display: inline-block;
    margin-right: .45rem;
    color: var(--accent);
    cursor: pointer;
    user-select: none;
    text-decoration: none;
  }
  .editor :global(li:has(> .check[data-checked="true"])) {
    color: var(--text-muted);
    text-decoration: line-through;
  }
</style>
