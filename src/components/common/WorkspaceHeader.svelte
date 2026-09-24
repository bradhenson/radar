<script lang="ts">
  import type { Snippet } from "svelte";

  // Shared page header: eyebrow (the nav group, or a link back to the parent
  // list), title, one plain-language line about the page, and the page's
  // actions on the right with the primary action last.
  let { title, description, section = "Workspace", sectionHref, meta, actions }: {
    title: string;
    description?: string;
    section?: string;
    /** Makes the eyebrow a link back to a parent page (e.g. "#/employees"). */
    sectionHref?: string;
    /** Extra inline content under the title (badges, role, team). */
    meta?: Snippet;
    actions?: Snippet;
  } = $props();
</script>

<header class="workspace-header">
  <div class="workspace-heading">
    {#if sectionHref}
      <a class="workspace-eyebrow eyebrow-link" href={sectionHref}><span aria-hidden="true">‹</span> {section}</a>
    {:else}
      <span class="workspace-eyebrow">{section}</span>
    {/if}
    <h1>{title}</h1>
    {#if meta}<div class="workspace-meta">{@render meta()}</div>{/if}
    {#if description}<p>{description}</p>{/if}
  </div>
  {#if actions}<div class="workspace-actions">{@render actions()}</div>{/if}
</header>

<style>
  .workspace-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: .8rem 1.5rem;
    margin-bottom: 1.4rem;
    flex-shrink: 0;
  }
  .workspace-heading { min-width: 0; }
  .workspace-eyebrow {
    display: block;
    color: var(--text-muted);
    text-transform: uppercase;
    font-size: .65rem;
    font-weight: 650;
    letter-spacing: .13em;
    margin-bottom: .4rem;
  }
  .eyebrow-link { display: inline-block; }
  .eyebrow-link:hover { color: var(--accent); text-decoration: none; }
  h1 { font-size: 1.7rem; letter-spacing: -.035em; margin: 0; font-weight: 650; }
  p { margin: .35rem 0 0; color: var(--text-muted); font-size: .82rem; }
  .workspace-meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: .35rem .6rem;
    margin-top: .4rem;
    color: var(--text-muted);
    font-size: .85rem;
  }
  .workspace-actions { display: flex; align-items: center; flex-wrap: wrap; gap: .5rem; }
  @media (max-width: 760px) {
    .workspace-header { margin-bottom: 1rem; }
    h1 { font-size: 1.45rem; }
  }
</style>
