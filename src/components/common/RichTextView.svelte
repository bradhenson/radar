<script lang="ts">
  // Saved documents render through known Svelte elements. User content is never
  // injected as HTML, so a stored document can only ever produce the nodes
  // enumerated below. A legacy string is converted on the way in, which keeps
  // records the migration has not reached rendering correctly.
  import {
    isRichTextEmpty,
    normalizeRichText,
    type RichTextNode,
    type RichTextValue
  } from "../../utils/richTextDoc";

  let {
    value,
    emptyText,
    compact = false
  }: {
    value?: RichTextValue | string | null;
    emptyText?: string;
    compact?: boolean;
  } = $props();

  let document = $derived(normalizeRichText(value).doc);
  let empty = $derived(isRichTextEmpty(value));

  const marked = (node: RichTextNode, type: "bold" | "italic" | "underline") =>
    node.marks?.some((mark) => mark.type === type) === true;
</script>

{#snippet text(node: RichTextNode)}
  {@const bold = marked(node, "bold")}
  {@const italic = marked(node, "italic")}
  {@const underline = marked(node, "underline")}
  {#if underline}
    <u>{#if bold}<strong>{#if italic}<em>{node.text}</em>{:else}{node.text}{/if}</strong>{:else if italic}<em>{node.text}</em>{:else}{node.text}{/if}</u>
  {:else if bold}
    <strong>{#if italic}<em>{node.text}</em>{:else}{node.text}{/if}</strong>
  {:else if italic}
    <em>{node.text}</em>
  {:else}
    {node.text}
  {/if}
{/snippet}

{#snippet inline(nodes: RichTextNode[] | undefined)}
  {#each nodes ?? [] as child}
    {#if child.type === "text"}{@render text(child)}{:else if child.type === "hardBreak"}<br />{/if}
  {/each}
{/snippet}

{#snippet block(node: RichTextNode)}
  {#if node.type === "paragraph"}
    <p>{@render inline(node.content)}</p>
  {:else if node.type === "heading"}
    {#if node.attrs?.level === 3}
      <h3>{@render inline(node.content)}</h3>
    {:else if node.attrs?.level === 5}
      <h5>{@render inline(node.content)}</h5>
    {:else}
      <h4>{@render inline(node.content)}</h4>
    {/if}
  {:else if node.type === "bulletList"}
    <ul>
      {#each node.content ?? [] as item}<li>{#each item.content ?? [] as child}{@render block(child)}{/each}</li>{/each}
    </ul>
  {:else if node.type === "orderedList"}
    <ol start={node.attrs?.start ?? 1}>
      {#each node.content ?? [] as item}<li>{#each item.content ?? [] as child}{@render block(child)}{/each}</li>{/each}
    </ol>
  {/if}
{/snippet}

<div class="rich-text" class:compact class:empty>
  {#if empty}
    {#if emptyText}<span>{emptyText}</span>{/if}
  {:else}
    {#each document.content ?? [] as node}{@render block(node)}{/each}
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
  li > :global(p:last-child) { margin-bottom: 0; }
  .compact { font-size: inherit; line-height: 1.4; }
  .compact p { margin-bottom: .35rem; }
  .compact h3, .compact h4, .compact h5 { margin: .45rem 0 .2rem; font-size: inherit; }
  .compact ul, .compact ol { margin-bottom: .35rem; }
</style>
