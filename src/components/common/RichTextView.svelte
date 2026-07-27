<script lang="ts">
  import { parseRichText, richTextInlineToPlainText, type RichTextInline } from "../../utils/richText";

  let {
    value,
    emptyText,
    compact = false,
    onToggleItem
  }: {
    value?: string;
    emptyText?: string;
    compact?: boolean;
    /**
     * Supply this to make checklist items tickable here rather than only inside
     * the editor. The index counts checklist items in document order, matching
     * `toggleChecklistItemAt`. Left out, markers stay decorative — which is
     * right wherever there is nothing to save the change to.
     */
    onToggleItem?: (index: number) => void;
  } = $props();

  let blocks = $derived(parseRichText(value));

  /**
   * Document-order index for every checklist item, keyed by its position in the
   * block list. Precomputed because a running counter cannot be threaded
   * through two nested each blocks.
   */
  let itemIndex = $derived.by(() => {
    const map = new Map<string, number>();
    let next = 0;
    blocks.forEach((block, b) => {
      if (block.kind === "checklist") block.items.forEach((_, i) => map.set(`${b}:${i}`, next++));
    });
    return map;
  });
</script>

{#snippet inline(nodes: RichTextInline[])}
  {#each nodes as node}
    {#if node.kind === "text"}
      {node.text}
    {:else if node.kind === "strong"}
      <strong>{@render inline(node.children)}</strong>
    {:else if node.kind === "emphasis"}
      <em>{@render inline(node.children)}</em>
    {:else}
      <u>{@render inline(node.children)}</u>
    {/if}
  {/each}
{/snippet}

<div class="rich-text" class:compact class:empty={blocks.length === 0}>
  {#if blocks.length === 0}
    {#if emptyText}<span>{emptyText}</span>{/if}
  {:else}
    {#each blocks as block, b}
      {#if block.kind === "paragraph"}
        <p>{@render inline(block.content)}</p>
      {:else if block.kind === "heading"}
        {#if block.level === 1}
          <h3>{@render inline(block.content)}</h3>
        {:else if block.level === 2}
          <h4>{@render inline(block.content)}</h4>
        {:else}
          <h5>{@render inline(block.content)}</h5>
        {/if}
      {:else if block.kind === "ordered-list"}
        <ol>
          {#each block.items as item}<li>{@render inline(item.content)}</li>{/each}
        </ol>
      {:else if block.kind === "unordered-list"}
        <ul>
          {#each block.items as item}<li>{@render inline(item.content)}</li>{/each}
        </ul>
      {:else}
        <ul class="checklist">
          {#each block.items as item, i}
            <li>
              {#if onToggleItem}
                {@const index = itemIndex.get(`${b}:${i}`) ?? -1}
                <button
                  type="button"
                  class="check toggle"
                  role="checkbox"
                  aria-checked={item.checked === true}
                  aria-label={richTextInlineToPlainText(item.content) || "Checklist item"}
                  onclick={() => onToggleItem(index)}
                >{item.checked ? "☑" : "☐"}</button>
              {:else}
                <span class="check" aria-label={item.checked ? "Completed" : "Not completed"}>{item.checked ? "☑" : "☐"}</span>
              {/if}
              <span class:checked={item.checked}>{@render inline(item.content)}</span>
            </li>
          {/each}
        </ul>
      {/if}
    {/each}
  {/if}
</div>

<style>
  .rich-text {
    min-width: 0;
    overflow-wrap: anywhere;
    line-height: 1.5;
  }
  .rich-text.empty { color: var(--text-muted); }
  p { margin: 0 0 .65rem; white-space: pre-wrap; }
  p:last-child,
  ul:last-child,
  ol:last-child,
  h3:last-child,
  h4:last-child,
  h5:last-child { margin-bottom: 0; }
  h3, h4, h5 { margin: .85rem 0 .35rem; line-height: 1.25; }
  h3 { font-size: 1.05rem; }
  h4 { font-size: .98rem; }
  h5 { font-size: .92rem; }
  ul, ol { margin: 0 0 .65rem; padding-left: 1.35rem; }
  li + li { margin-top: .2rem; }
  .checklist { list-style: none; padding-left: 0; }
  .checklist li { display: flex; align-items: flex-start; gap: .45rem; }
  .check { flex: 0 0 auto; color: var(--accent); }
  /* The interactive marker is a real button, so it keeps keyboard activation
     and a focus ring; the glyph stays the same size as the static one. */
  .check.toggle {
    min-height: 0;
    padding: 0 .1rem;
    border: 0;
    border-radius: var(--radius);
    background: none;
    box-shadow: none;
    color: var(--accent);
    font: inherit;
    line-height: inherit;
    cursor: pointer;
  }
  .check.toggle:hover { background: var(--accent-soft); }
  .checked { color: var(--text-muted); text-decoration: line-through; }
  .compact { font-size: inherit; line-height: 1.4; }
  .compact p { margin-bottom: .35rem; }
  .compact h3, .compact h4, .compact h5 { margin: .45rem 0 .2rem; font-size: inherit; }
  .compact ul, .compact ol { margin-bottom: .35rem; }
</style>
