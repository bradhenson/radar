<script lang="ts">
  import type { Snippet } from "svelte";

  /**
   * Slide-over pane anchored to the right edge. Same contract and keyboard
   * behavior as Dialog (focus trap, Escape, unsaved-changes guard) but keeps
   * the page visible behind a light backdrop so the user retains context
   * while entering data. The backdrop still blocks background interaction:
   * navigating away mid-edit would unmount the form and lose input, so panes
   * stay modal in behavior even though they read as a side panel.
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
    /**
     * Return true while the pane holds unsaved changes. Dismissal (backdrop
     * click, Escape, the ✕ button) then asks before discarding, so a stray
     * click can never silently throw away form input. Explicit Cancel/Save
     * buttons inside the pane bypass this by calling onclose directly.
     */
    unsavedGuard?: () => boolean;
    children: Snippet;
  } = $props();

  let paneEl: HTMLDivElement | undefined = $state();
  let confirmingDiscard = $state(false);

  // Restore focus to the control that opened the pane when it closes.
  const opener =
    typeof document !== "undefined" && document.activeElement instanceof HTMLElement ? document.activeElement : null;

  $effect(() => {
    if (!paneEl) return;
    const first = paneEl.querySelector<HTMLElement>(
      '.body input:not([type="hidden"]):not(:disabled), .body select:not(:disabled), .body textarea:not(:disabled)'
    );
    (first ?? paneEl).focus();
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
    } else if (e.key === "Tab" && paneEl) {
      const focusables = paneEl.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (focusables.length === 0) return;
      const first = focusables[0]!;
      const last = focusables[focusables.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }
</script>

<div class="overlay" role="presentation" onclick={(e) => { if (e.target === e.currentTarget) requestClose(); }}>
  <div
    class="pane"
    class:wide
    role="dialog"
    aria-modal="true"
    aria-label={title}
    tabindex="-1"
    bind:this={paneEl}
    onkeydown={onKeydown}
  >
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
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    /* Lighter than the dialog backdrop: the point of a pane is that the page
       behind stays readable for reference while typing. */
    background: color-mix(in srgb, #0a0e14 28%, transparent);
    display: flex;
    justify-content: flex-end;
    z-index: 100;
    animation: overlay-in .14s ease-out;
  }
  .pane {
    background: var(--surface-elevated);
    border-left: 1px solid var(--border);
    box-shadow: var(--shadow-lg);
    width: min(32rem, 94vw);
    height: 100%;
    display: flex;
    flex-direction: column;
    animation: pane-in .2s cubic-bezier(.16, 1, .3, 1);
    position: relative;
    overflow: hidden;
  }
  /* Accent hairline along the pane's leading edge, matching the brand mark. */
  .pane::before {
    content: "";
    position: absolute;
    top: 0;
    bottom: 0;
    left: 0;
    width: 2.5px;
    background: linear-gradient(180deg, var(--accent), color-mix(in srgb, var(--accent) 45%, #7c3aed));
    pointer-events: none;
  }
  .pane.wide { width: min(48rem, 94vw); }
  /* The container is focused programmatically as the focus-trap entry point;
     its outline isn't a useful signal (controls inside keep their own). */
  .pane:focus { outline: none; }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: .95rem 1.25rem .6rem;
  }
  header h2 { margin: 0; font-size: 1.08rem; letter-spacing: -0.012em; }
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
    margin: 0 1.25rem .5rem;
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
  .body { padding: .3rem 1.25rem 1.25rem; overflow-y: auto; flex: 1; }

  @keyframes overlay-in {
    from { opacity: 0; }
    to { opacity: 1; }
  }
  @keyframes pane-in {
    from { opacity: 0; transform: translateX(24px); }
    to { opacity: 1; transform: none; }
  }
  @media (prefers-reduced-motion: reduce) {
    .overlay, .pane { animation: none; }
  }
</style>
