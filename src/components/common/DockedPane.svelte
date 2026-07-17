<script lang="ts">
  import type { Snippet } from "svelte";

  /**
   * Docked editing pane: a persistent right-hand column inside the app shell,
   * not an overlay. The page beside it stays fully interactive, so unlike
   * Dialog/Pane there is no backdrop and no focus trap — only Escape-to-close
   * (when focus is inside the pane), initial focus on the first field, and
   * focus restoration to the opening control. Hosts are responsible for not
   * losing input on unmount (e.g. TaskDetail autosaves when it is destroyed
   * by a switch to another record).
   */
  let {
    title,
    onclose,
    wide = false,
    unsavedGuard,
    children
  }: {
    title: string;
    onclose: () => void;
    wide?: boolean;
    /** Return true while the pane holds unsaved changes; ✕/Escape then ask first. */
    unsavedGuard?: () => boolean;
    children: Snippet;
  } = $props();

  let dockEl: HTMLElement | undefined = $state();
  let confirmingDiscard = $state(false);

  // Restore focus to the control that opened the pane when it closes.
  const opener =
    typeof document !== "undefined" && document.activeElement instanceof HTMLElement ? document.activeElement : null;

  $effect(() => {
    if (!dockEl) return;
    const first = dockEl.querySelector<HTMLElement>(
      '.body input:not([type="hidden"]):not(:disabled), .body select:not(:disabled), .body textarea:not(:disabled)'
    );
    (first ?? dockEl).focus();
  });

  $effect(() => {
    return () => opener?.focus();
  });

  function requestClose() {
    if (unsavedGuard?.()) {
      confirmingDiscard = true;
      return;
    }
    onclose();
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.stopPropagation();
      if (confirmingDiscard) confirmingDiscard = false;
      else requestClose();
    }
  }
</script>

<!-- Escape-to-close scoped to the region; the pane is not modal, so this is
     an added keyboard affordance rather than an interaction requirement. -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<aside class="dock" class:wide aria-label={title} tabindex="-1" bind:this={dockEl} onkeydown={onKeydown}>
  <header>
    <h2>{title}</h2>
    <button type="button" aria-label="Close" onclick={requestClose}>✕</button>
  </header>
  {#if confirmingDiscard}
    <div class="discard-bar" role="alert">
      <span>You have unsaved changes.</span>
      <button type="button" onclick={() => (confirmingDiscard = false)}>Keep editing</button>
      <button
        type="button"
        class="danger"
        onclick={() => {
          confirmingDiscard = false;
          onclose();
        }}>Discard changes</button
      >
    </div>
  {/if}
  <div class="body">
    {@render children()}
  </div>
</aside>

<style>
  .dock {
    position: sticky;
    top: var(--topbar-h);
    height: calc(100vh - var(--topbar-h));
    align-self: flex-start;
    width: 30rem;
    flex-shrink: 0;
    background: var(--surface-elevated);
    border-left: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    animation: dock-in .18s cubic-bezier(.16, 1, .3, 1);
    z-index: 5;
  }
  .dock.wide { width: 36rem; }
  /* Accent hairline along the dock's leading edge, matching the brand mark. */
  .dock::before {
    content: "";
    position: absolute;
    top: 0;
    bottom: 0;
    left: 0;
    width: 2.5px;
    background: linear-gradient(180deg, var(--accent), color-mix(in srgb, var(--accent) 45%, #7c3aed));
    pointer-events: none;
  }
  /* Focused programmatically as a landing point; controls inside keep their own outlines. */
  .dock:focus { outline: none; }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: .85rem 1.15rem .5rem;
  }
  header h2 { margin: 0; font-size: 1.05rem; letter-spacing: -0.012em; }
  header button {
    border: none;
    background: none;
    box-shadow: none;
    font-size: .9rem;
    color: var(--text-muted);
    width: 1.9rem;
    height: 1.9rem;
    min-height: 0;
    padding: 0;
    border-radius: 999px;
    display: grid;
    place-items: center;
  }
  header button:hover { background: var(--surface-2); color: var(--text); }
  .discard-bar {
    display: flex;
    align-items: center;
    gap: .5rem;
    flex-wrap: wrap;
    margin: 0 1.15rem .5rem;
    padding: .5rem .7rem;
    border: 1px solid color-mix(in srgb, var(--warning) 55%, var(--border));
    border-radius: var(--radius);
    background: var(--duesoon-bg);
    font-size: .85rem;
    font-weight: 600;
  }
  .discard-bar span { margin-right: auto; }
  .discard-bar button {
    min-height: 1.8rem;
    padding: .15rem .6rem;
    font-size: .8rem;
  }
  .body { padding: .3rem 1.15rem 1.15rem; overflow-y: auto; flex: 1; }

  @keyframes dock-in {
    from { opacity: 0; transform: translateX(16px); }
    to { opacity: 1; transform: none; }
  }
  @media (prefers-reduced-motion: reduce) {
    .dock { animation: none; }
  }
  /* Narrow windows: no room for a side-by-side column, so the dock floats
     over the page instead (the page beneath is mostly covered anyway). */
  @media (max-width: 900px) {
    .dock {
      position: fixed;
      right: 0;
      width: min(32rem, 100vw);
      box-shadow: var(--shadow-lg);
    }
  }
</style>
