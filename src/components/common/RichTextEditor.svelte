<script lang="ts">
  // Tiptap owns editing; the application owns the persisted document contract.
  // The toolbar is ours because Tiptap is headless, so accessibility — roving
  // tabindex, pressed state, Alt+F10 to reach it — stays hand-written.
  import { onMount } from "svelte";
  import { Editor, type JSONContent } from "@tiptap/core";
  import { richTextEditorExtensions } from "../../utils/richTextEditor";
  import {
    emptyRichText,
    normalizeRichText,
    serializeRichText,
    RICH_TEXT_SCHEMA_VERSION,
    type RichTextNode,
    type RichTextValue
  } from "../../utils/richTextDoc";

  let {
    id,
    value = $bindable(emptyRichText()),
    rows = 5,
    maxlength = 10_000,
    placeholder = "",
    ariaLabel,
    onSaveShortcut
  }: {
    id: string;
    value?: RichTextValue;
    rows?: number;
    maxlength?: number;
    placeholder?: string;
    ariaLabel: string;
    /** Ctrl+Enter, for composers that save without leaving the keyboard. */
    onSaveShortcut?: () => void;
  } = $props();

  let element = $state<HTMLDivElement>();
  let editor = $state<Editor>();
  let toolbar = $state<HTMLDivElement>();
  let toolbarIndex = $state(0);
  let editorVersion = $state(0);
  let length = $state(0);
  let lastEmitted = serializeRichText(value);
  let remaining = $derived(maxlength - length);
  let showCount = $derived(remaining <= Math.max(200, Math.round(maxlength * 0.1)));

  type Tool = {
    id: string;
    label: string;
    title: string;
    glyph: string;
    className?: string;
    run: (editor: Editor) => void;
    active: (editor: Editor) => boolean;
  };

  const tools: Tool[] = [
    { id: "bold", label: "Bold", title: "Bold (Ctrl+B)", glyph: "B", className: "strong", run: (e) => e.chain().focus().toggleBold().run(), active: (e) => e.isActive("bold") },
    { id: "italic", label: "Italic", title: "Italic (Ctrl+I)", glyph: "I", className: "emphasis", run: (e) => e.chain().focus().toggleItalic().run(), active: (e) => e.isActive("italic") },
    { id: "underline", label: "Underline", title: "Underline (Ctrl+U)", glyph: "U", className: "underline", run: (e) => e.chain().focus().toggleUnderline().run(), active: (e) => e.isActive("underline") },
    { id: "heading", label: "Heading", title: "Heading", glyph: "H", run: (e) => e.chain().focus().toggleHeading({ level: 4 }).run(), active: (e) => e.isActive("heading") },
    { id: "bulletList", label: "Bulleted list", title: "Bulleted list", glyph: "•", run: (e) => e.chain().focus().toggleBulletList().run(), active: (e) => e.isActive("bulletList") },
    { id: "orderedList", label: "Numbered list", title: "Numbered list", glyph: "1.", run: (e) => e.chain().focus().toggleOrderedList().run(), active: (e) => e.isActive("orderedList") }
  ];

  /** Reading `editorVersion` is what re-runs this after every transaction. */
  function active(tool: Tool): boolean {
    editorVersion;
    return editor ? tool.active(editor) : false;
  }

  function run(tool: Tool) {
    if (editor) tool.run(editor);
  }

  function onToolbarKeydown(event: KeyboardEvent) {
    const last = tools.length - 1;
    let next: number;
    if (event.key === "ArrowRight") next = toolbarIndex === last ? 0 : toolbarIndex + 1;
    else if (event.key === "ArrowLeft") next = toolbarIndex === 0 ? last : toolbarIndex - 1;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = last;
    else if (event.key === "Escape") {
      event.preventDefault();
      editor?.commands.focus();
      return;
    } else return;
    event.preventDefault();
    toolbarIndex = next;
    toolbar?.querySelectorAll<HTMLButtonElement>("button.format")[next]?.focus();
  }

  onMount(() => {
    if (!element) return;
    // Tearing the editor down fires transactions on the way out. Writing `value`
    // or `length` from those would be a state mutation during teardown, which
    // Svelte rejects, so callbacks go quiet once disposal starts.
    let disposed = false;
    const instance = new Editor({
      element,
      content: normalizeRichText(value).doc as JSONContent,
      extensions: richTextEditorExtensions(maxlength, placeholder),
      editorProps: {
        attributes: {
          id,
          class: "tiptap-editor",
          role: "textbox",
          "aria-label": ariaLabel,
          "aria-multiline": "true",
          spellcheck: "true"
        },
        handleKeyDown: (_view, event) => {
          if (onSaveShortcut && event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            onSaveShortcut();
            return true;
          }
          if (event.altKey && event.key === "F10") {
            toolbar?.querySelectorAll<HTMLButtonElement>("button.format")[toolbarIndex]?.focus();
            return true;
          }
          return false;
        }
      },
      onUpdate: ({ editor: current }) => {
        if (disposed) return;
        const next: RichTextValue = {
          schemaVersion: RICH_TEXT_SCHEMA_VERSION,
          doc: current.getJSON() as RichTextNode
        };
        lastEmitted = serializeRichText(next);
        value = next;
        length = current.storage.characterCount.characters();
      },
      onTransaction: ({ editor: current }) => {
        if (disposed) return;
        // Tiptap dispatches transactions from DOM events, including the blur
        // that fires while Svelte is removing this element. Writing state from
        // inside that render pass is forbidden, so the toolbar state settles on
        // the next microtask instead — after the pass, before the next paint.
        queueMicrotask(() => {
          if (disposed) return;
          editorVersion += 1;
          length = current.storage.characterCount.characters();
        });
      }
    });
    editor = instance;
    length = instance.storage.characterCount.characters();
    return () => {
      disposed = true;
      instance.destroy();
    };
  });

  /**
   * Adopt changes made to `value` from outside — loading a note for editing, or
   * a composer clearing itself after a save. Comparing against `lastEmitted`
   * keeps the editor's own updates from looping back through here.
   */
  $effect(() => {
    const next = serializeRichText(value);
    if (!editor || next === lastEmitted) return;
    editor.commands.setContent(normalizeRichText(value).doc as JSONContent, { emitUpdate: false });
    lastEmitted = next;
    length = editor.storage.characterCount.characters();
  });
</script>

<div class="rich-editor">
  <div
    class="toolbar"
    role="toolbar"
    aria-label={`${ariaLabel} formatting (Alt+F10)`}
    aria-orientation="horizontal"
    tabindex="-1"
    bind:this={toolbar}
    onkeydown={onToolbarKeydown}
  >
    {#each tools as tool, index (tool.id)}
      {#if index === 3}<span class="separator" aria-hidden="true"></span>{/if}
      <button
        type="button"
        class="format {tool.className ?? ''}"
        class:on={active(tool)}
        aria-label={tool.label}
        aria-pressed={active(tool)}
        title={tool.title}
        tabindex={index === toolbarIndex ? 0 : -1}
        disabled={!editor}
        onfocus={() => (toolbarIndex = index)}
        onclick={() => run(tool)}
      >{tool.glyph}</button>
    {/each}
  </div>
  <div bind:this={element} class="editor-host" style:min-height={`calc(${rows} * 1.45em + 1.3rem)`}></div>
  {#if showCount}
    <div class="status">
      <span class="count" class:full={remaining <= 0}>{remaining.toLocaleString()} characters left</span>
    </div>
  {/if}
</div>

<style>
  .rich-editor { width: 100%; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); overflow: hidden; }
  .rich-editor:focus-within { border-color: color-mix(in srgb, var(--accent) 45%, var(--border)); box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 9%, transparent); }
  .toolbar { display: flex; align-items: center; gap: .18rem; min-height: 2.15rem; padding: .22rem .3rem; border-bottom: 1px solid var(--border); background: var(--surface-2); }
  .toolbar button { min-height: 1.65rem; padding: .12rem .42rem; border-color: transparent; background: transparent; box-shadow: none; color: var(--text-muted); font-size: .78rem; }
  .toolbar button:hover, .toolbar button:focus-visible { background: var(--surface); color: var(--text); border-color: var(--border); }
  .toolbar button.on { background: var(--accent-soft); border-color: var(--accent); color: var(--text); font-weight: 800; }
  .format { min-width: 1.75rem; font-size: .9rem; }
  .strong { font-weight: 800; }
  .emphasis { font-style: italic; }
  .underline { text-decoration: underline; text-underline-offset: .12em; }
  .separator { width: 1px; height: 1.2rem; margin: 0 .18rem; background: var(--border); }
  .editor-host { background: var(--surface); overflow-y: auto; resize: vertical; }
  .editor-host :global(.tiptap-editor) { min-height: inherit; padding: .65rem .7rem; line-height: 1.45; overflow-wrap: anywhere; outline: 0; white-space: pre-wrap; }
  .editor-host :global(.tiptap-editor:focus), .editor-host :global(.tiptap-editor:focus-visible) { outline: none; }
  .editor-host :global(p) { margin: 0 0 .65rem; }
  .editor-host :global(p:last-child) { margin-bottom: 0; }
  .editor-host :global(p.is-editor-empty:first-child::before) { content: attr(data-placeholder); float: left; height: 0; color: var(--text-muted); pointer-events: none; }
  .editor-host :global(h3), .editor-host :global(h4), .editor-host :global(h5) { margin: .85rem 0 .35rem; line-height: 1.25; }
  .editor-host :global(h3:first-child), .editor-host :global(h4:first-child), .editor-host :global(h5:first-child) { margin-top: 0; }
  .editor-host :global(h3) { font-size: 1.05rem; }
  .editor-host :global(h4) { font-size: .98rem; }
  .editor-host :global(h5) { font-size: .92rem; }
  .editor-host :global(ul), .editor-host :global(ol) { margin: 0 0 .65rem; padding-left: 1.35rem; }
  .status { display: flex; justify-content: flex-end; padding: .1rem .7rem .35rem; font-size: .74rem; color: var(--text-muted); }
  .count { font-variant-numeric: tabular-nums; }
  .count.full { color: var(--danger); font-weight: 700; }
</style>
