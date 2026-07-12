<script lang="ts">
  import RichTextView from "./RichTextView.svelte";

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

  let textarea: HTMLTextAreaElement | undefined = $state();
  let preview = $state(false);

  function replaceSelection(before: string, after: string, fallback: string) {
    if (!textarea) return;
    const current = value ?? "";
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = current.slice(start, end) || fallback;
    const next = `${current.slice(0, start)}${before}${selected}${after}${current.slice(end)}`;
    if (next.length > maxlength) return;
    value = next;
    requestAnimationFrame(() => {
      textarea?.focus();
      const selectionStart = start + before.length;
      textarea?.setSelectionRange(selectionStart, selectionStart + selected.length);
    });
  }

  function formatLines(kind: "heading" | "unordered" | "ordered" | "checklist") {
    if (!textarea) return;
    const current = value ?? "";
    const selectionStart = textarea.selectionStart;
    const selectionEnd = textarea.selectionEnd;
    const lineStart = current.lastIndexOf("\n", Math.max(0, selectionStart - 1)) + 1;
    const followingBreak = current.indexOf("\n", selectionEnd);
    const lineEnd = followingBreak < 0 ? current.length : followingBreak;
    const lines = current.slice(lineStart, lineEnd).split("\n");
    const allFormatted = lines.every((line) => {
      if (kind === "heading") return /^#{1,3}\s/.test(line);
      if (kind === "unordered") return /^\s*[-*]\s+(?!\[[ xX]\])/.test(line);
      if (kind === "ordered") return /^\s*\d+[.)]\s+/.test(line);
      return /^\s*[-*]\s+\[[ xX]\]\s+/.test(line);
    });

    const formatted = lines.map((line, index) => {
      if (allFormatted) {
        if (kind === "heading") return line.replace(/^#{1,3}\s/, "");
        if (kind === "ordered") return line.replace(/^\s*\d+[.)]\s+/, "");
        if (kind === "checklist") return line.replace(/^\s*[-*]\s+\[[ xX]\]\s+/, "");
        return line.replace(/^\s*[-*]\s+/, "");
      }
      if (kind === "heading") return `## ${line}`;
      if (kind === "ordered") return `${index + 1}. ${line}`;
      if (kind === "checklist") return `- [ ] ${line}`;
      return `- ${line}`;
    }).join("\n");

    const next = `${current.slice(0, lineStart)}${formatted}${current.slice(lineEnd)}`;
    if (next.length > maxlength) return;
    value = next;
    requestAnimationFrame(() => {
      textarea?.focus();
      textarea?.setSelectionRange(lineStart, lineStart + formatted.length);
    });
  }

  function onEditorKeydown(e: KeyboardEvent) {
    if (!(e.ctrlKey || e.metaKey)) return;
    if (e.key.toLowerCase() === "b") {
      e.preventDefault();
      replaceSelection("**", "**", "bold text");
    } else if (e.key.toLowerCase() === "i") {
      e.preventDefault();
      replaceSelection("*", "*", "italic text");
    }
  }
</script>

<div class="rich-editor">
  <div class="toolbar" role="toolbar" aria-label={`${ariaLabel} formatting`}>
    <button type="button" class="format strong" aria-label="Bold" title="Bold (Ctrl+B)" onmousedown={(e) => e.preventDefault()} onclick={() => replaceSelection("**", "**", "bold text")}>B</button>
    <button type="button" class="format emphasis" aria-label="Italic" title="Italic (Ctrl+I)" onmousedown={(e) => e.preventDefault()} onclick={() => replaceSelection("*", "*", "italic text")}>I</button>
    <span class="separator" aria-hidden="true"></span>
    <button type="button" class="format" aria-label="Heading" title="Heading" onmousedown={(e) => e.preventDefault()} onclick={() => formatLines("heading")}>H</button>
    <button type="button" class="format" aria-label="Bulleted list" title="Bulleted list" onmousedown={(e) => e.preventDefault()} onclick={() => formatLines("unordered")}>•</button>
    <button type="button" class="format" aria-label="Numbered list" title="Numbered list" onmousedown={(e) => e.preventDefault()} onclick={() => formatLines("ordered")}>1.</button>
    <button type="button" class="format" aria-label="Checklist" title="Checklist" onmousedown={(e) => e.preventDefault()} onclick={() => formatLines("checklist")}>☐</button>
    <span class="spacer"></span>
    <button type="button" class="mode" class:active={!preview} aria-pressed={!preview} onclick={() => (preview = false)}>Write</button>
    <button type="button" class="mode" class:active={preview} aria-pressed={preview} onclick={() => (preview = true)}>Preview</button>
  </div>
  {#if preview}
    <div class="preview" aria-label={`${ariaLabel} preview`}>
      <RichTextView {value} emptyText="Nothing to preview." />
    </div>
  {:else}
    <textarea
      {id}
      bind:this={textarea}
      bind:value
      {rows}
      {maxlength}
      {placeholder}
      aria-label={ariaLabel}
      onkeydown={onEditorKeydown}
    ></textarea>
  {/if}
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
    border-color: var(--accent);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 20%, transparent);
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
  button {
    min-height: 1.65rem;
    padding: .12rem .42rem;
    border-color: transparent;
    background: transparent;
    box-shadow: none;
    color: var(--text-muted);
    font-size: .78rem;
  }
  button:hover,
  button:focus-visible,
  button.active { background: var(--surface); color: var(--text); border-color: var(--border); }
  .format { min-width: 1.75rem; font-size: .9rem; }
  .strong { font-weight: 800; }
  .emphasis { font-style: italic; }
  .separator { width: 1px; height: 1.2rem; margin: 0 .18rem; background: var(--border); }
  .mode { padding-inline: .5rem; }
  textarea {
    display: block;
    width: 100%;
    min-height: 5.5rem;
    padding: .65rem .7rem;
    border: 0;
    border-radius: 0;
    background: var(--surface);
    box-shadow: none;
    resize: vertical;
    font: inherit;
    line-height: 1.45;
  }
  textarea:focus { outline: 0; box-shadow: none; }
  .preview {
    min-height: 5.5rem;
    padding: .65rem .7rem;
    background: var(--surface);
  }
</style>
