<script lang="ts">
  import type { Snippet } from "svelte";

  let { title, description, section = "Workspace", actions }: {
    title: string;
    description: string;
    section?: string;
    actions?: Snippet;
  } = $props();
</script>

<header class="workspace-header">
  <div class="workspace-heading">
    <span class="workspace-eyebrow">{section}</span>
    <h1>{title}</h1>
    <p>{description}</p>
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
  h1 { font-size: 1.7rem; letter-spacing: -.035em; margin: 0; font-weight: 650; }
  p { margin: .35rem 0 0; color: var(--text-muted); font-size: .82rem; }
  .workspace-actions { display: flex; align-items: center; flex-wrap: wrap; gap: .5rem; }
  @media (max-width: 760px) {
    .workspace-header { margin-bottom: 1rem; }
    h1 { font-size: 1.45rem; }
  }
</style>
