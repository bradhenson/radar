<script lang="ts">
  import type { Snippet } from "svelte";

  // Keep the title, quick filters, and actions in one compact, wrapping row.
  let { title, titleMinWidth, section = "Workspace", sectionHref, meta, filters, actions }: {
    title: string;
    /** Reserve space when the title changes between views. */
    titleMinWidth?: string;
    section?: string;
    /** Optional link back to a parent page (e.g. "#/employees"). */
    sectionHref?: string;
    /** Extra content beside the title (badges, role, team). */
    meta?: Snippet;
    filters?: Snippet;
    actions?: Snippet;
  } = $props();
</script>

<header class="workspace-header" class:detail-header={Boolean(sectionHref)}>
  <div class="workspace-heading">
    {#if sectionHref}
      <a class="workspace-back" href={sectionHref}><span aria-hidden="true">‹</span> {section}</a>
    {/if}
    <h1 style:min-width={titleMinWidth}>{title}</h1>
    {#if meta}<div class="workspace-meta">{@render meta()}</div>{/if}
  </div>
  {#if filters}<div class="workspace-filters">{@render filters()}</div>{/if}
  {#if actions}<div class="workspace-actions">{@render actions()}</div>{/if}
</header>

<style>
  .workspace-header {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: .55rem 1rem;
    margin-bottom: .8rem;
    flex-shrink: 0;
  }
  .workspace-heading { display: flex; align-items: center; flex-wrap: wrap; gap: .4rem .7rem; min-width: 0; }
  .workspace-back { color: var(--text-muted); font-size: .8rem; white-space: nowrap; }
  .workspace-back:hover { color: var(--accent); text-decoration: none; }
  h1 { font-size: 1.55rem; letter-spacing: -.035em; margin: 0; font-weight: 650; }
  .workspace-meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: .35rem .6rem;
    color: var(--text-muted);
    font-size: .85rem;
  }
  .workspace-filters { display: flex; align-items: center; min-width: 0; }
  .workspace-actions { grid-column: 3; display: flex; align-items: center; flex-wrap: wrap; justify-content: flex-end; gap: .5rem; }
  @media (min-width: 1201px) {
    .detail-header { grid-template-columns: minmax(0, 1fr) auto; }
    .detail-header .workspace-filters { grid-column: 1 / -1; grid-row: 2; }
    .detail-header .workspace-actions { grid-column: 2; grid-row: 1; }
  }
  @media (max-width: 1200px) {
    .workspace-header { grid-template-columns: minmax(0, 1fr) auto; }
    .workspace-filters { grid-column: 1 / -1; grid-row: 2; }
    .workspace-actions { grid-column: 2; grid-row: 1; }
  }
  @media (max-width: 760px) {
    .workspace-header { margin-bottom: .7rem; }
    h1 { font-size: 1.35rem; }
    .workspace-actions { grid-column: 1 / -1; grid-row: 2; justify-content: flex-start; }
    .workspace-filters { grid-row: 3; }
  }
</style>
