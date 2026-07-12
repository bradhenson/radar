<script lang="ts">
  import { parseRichText, type RichTextInline } from "../../utils/richText";
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

  $effect(() => {
    const next = value ?? "";
    if (!editor) return;
    if (next === lastEmitted) return;
    renderValue(next);
    lastEmitted = next;
  });

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
        const el = document.createElement(node.kind === "strong" ? "b" : "i");
        inlineToDom(node.children, el);
        parent.appendChild(el);
      }
    }
  }

  /** Build the editable DOM from parsed blocks — text nodes and known tags only. */
  function renderValue(v: string) {
    if (!editor) return;
    editor.textContent = "";
    for (const block of parseRichText(v)) {
      if (block.kind === "heading") {
        const el = document.createElement(block.level === 1 ? "h3" : block.level === 2 ? "h4" : "h5");
        inlineToDom(block.content, el);
        editor.appendChild(el);
      } else if (block.kind === "paragraph") {
        const div = document.createElement("div");
        inlineToDom(block.content, div);
        if (!div.hasChildNodes()) div.appendChild(document.createElement("br"));
        editor.appendChild(div);
      } else {
        const list = document.createElement(block.kind === "ordered-list" ? "ol" : "ul");
        if (block.kind === "checklist") list.className = "checklist";
        for (const item of block.items) {
          const li = document.createElement("li");
          if (block.kind === "checklist") li.appendChild(makeMarker(item.checked === true));
          inlineToDom(item.content, li);
          list.appendChild(li);
        }
        editor.appendChild(list);
      }
    }
  }

  /**
   * Editing can displace checklist markers: Enter splits an li without its
   * marker, Backspace can merge one into the middle of a line. Drop strays
   * and restore a leading marker on every checklist item.
   */
  function normalizeChecklists() {
    if (!editor) return;
    for (const m of Array.from(editor.querySelectorAll("[data-checked]"))) {
      const li = m.parentElement;
      const valid = li?.nodeName === "LI" && li.parentElement?.matches("ul.checklist") && li.firstChild === m;
      if (!valid) m.remove();
    }
    for (const li of editor.querySelectorAll("ul.checklist > li")) {
      if (!li.querySelector(":scope > [data-checked]")) li.insertBefore(makeMarker(false), li.firstChild);
    }
  }

  function emit() {
    if (!editor) return;
    normalizeChecklists();
    const next = serializeRichTextDom(editor);
    if (next === "" && editor.childNodes.length > 0 && editor.textContent === "") {
      // Clear leftover empty wrappers so the CSS :empty placeholder returns.
      editor.textContent = "";
    }
    lastEmitted = next;
    value = next;
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
    document.execCommand(command, false, arg);
    repairChecklistMerges();
    emit();
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
    document.execCommand("formatBlock", false, isHeading ? "div" : "h4");
    emit();
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
    editor.focus();
    const blocks = currentBlocks();
    if (blocks.length === 0) {
      const list = document.createElement("ul");
      list.className = "checklist";
      const li = document.createElement("li");
      li.appendChild(makeMarker(false));
      li.appendChild(document.createElement("br"));
      list.appendChild(li);
      editor.appendChild(list);
      placeCaretAtEnd(li);
      emit();
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
          editor.insertBefore(div, listEl);
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
      editor.insertBefore(list, blocks[0]!);
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
    emit();
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
    sel.removeAllRanges();
    sel.addRange(range);
    document.execCommand("delete");
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
    if ((e.key === "Enter" || e.key === " ") && e.target instanceof HTMLElement && e.target.dataset.checked != null) {
      e.preventDefault();
      toggleMarker(e.target);
      return;
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
    if (e.key === " ") maybeAutoformat(e);
  }

  function onBeforeInput(e: InputEvent) {
    if (!editor || !e.inputType.startsWith("insert")) return;
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) return; // replacing a selection can shrink content
    if (serializeRichTextDom(editor).length >= maxlength) e.preventDefault();
  }

  function onPaste(e: ClipboardEvent) {
    e.preventDefault();
    if (!editor) return;
    const text = e.clipboardData?.getData("text/plain") ?? "";
    if (!text) return;
    const remaining = maxlength - serializeRichTextDom(editor).length;
    if (remaining <= 0) return;
    document.execCommand("insertText", false, text.slice(0, remaining));
    emit();
  }
</script>

<div class="rich-editor">
  <div class="toolbar" role="toolbar" aria-label={`${ariaLabel} formatting`}>
    <button type="button" class="format strong" aria-label="Bold" title="Bold (Ctrl+B)" onmousedown={(e) => e.preventDefault()} onclick={() => exec("bold")}>B</button>
    <button type="button" class="format emphasis" aria-label="Italic" title="Italic (Ctrl+I)" onmousedown={(e) => e.preventDefault()} onclick={() => exec("italic")}>I</button>
    <span class="separator" aria-hidden="true"></span>
    <button type="button" class="format" aria-label="Heading" title="Heading" onmousedown={(e) => e.preventDefault()} onclick={toggleHeading}>H</button>
    <button type="button" class="format" aria-label="Bulleted list" title="Bulleted list" onmousedown={(e) => e.preventDefault()} onclick={() => exec("insertUnorderedList")}>•</button>
    <button type="button" class="format" aria-label="Numbered list" title="Numbered list" onmousedown={(e) => e.preventDefault()} onclick={() => exec("insertOrderedList")}>1.</button>
    <button type="button" class="format" aria-label="Checklist" title="Checklist" onmousedown={(e) => e.preventDefault()} onclick={toggleChecklist}>☐</button>
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
    onkeydown={onEditorKeydown}
    onclick={onEditorClick}
    onpaste={onPaste}
  ></div>
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
  .format { min-width: 1.75rem; font-size: .9rem; }
  .strong { font-weight: 800; }
  .emphasis { font-style: italic; }
  .separator { width: 1px; height: 1.2rem; margin: 0 .18rem; background: var(--border); }
  .editor {
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
  .editor:empty::before {
    content: attr(data-placeholder);
    color: var(--text-muted);
    pointer-events: none;
  }
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
