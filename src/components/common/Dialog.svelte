<script lang="ts">
  import type { Snippet } from "svelte";

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
     * Return true while the dialog holds unsaved changes. Dismissal (backdrop
     * click, Escape, the ✕ button) then asks before discarding, so a stray
     * click can never silently throw away form input. Explicit Cancel/Save
     * buttons inside the dialog bypass this by calling onclose directly.
     */
    unsavedGuard?: () => boolean;
    children: Snippet;
  } = $props();

  let dialogEl: HTMLDivElement | undefined = $state();
  let confirmingDiscard = $state(false);

  // Restore focus to the control that opened the dialog when it closes.
  const opener =
    typeof document !== "undefined" && document.activeElement instanceof HTMLElement ? document.activeElement : null;

  $effect(() => {
    if (!dialogEl) return;
    // Focus the first meaningful field; fall back to the container (which is
    // also the focus-trap entry point).
    const first = dialogEl.querySelector<HTMLElement>(
      '.body input:not([type="hidden"]):not(:disabled), .body select:not(:disabled), .body textarea:not(:disabled)'
    );
    (first ?? dialogEl).focus();
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
    } else if (e.key === "Tab" && dialogEl) {
      const focusables = dialogEl.querySelectorAll<HTMLElement>(
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
    class="dialog"
    class:wide
    role="dialog"
    aria-modal="true"
    aria-label={title}
    tabindex="-1"
    bind:this={dialogEl}
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
    background: color-mix(in srgb, #0a0e14 55%, transparent);
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding: 5vh 1rem;
    z-index: 100;
    animation: overlay-in .14s ease-out;
  }
  .dialog {
    background: var(--surface-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-lg);
    width: 100%;
    max-width: 34rem;
    max-height: 90vh;
    display: flex;
    flex-direction: column;
    animation: dialog-in .16s cubic-bezier(.16, 1, .3, 1);
  }
  .dialog.wide { max-width: 52rem; }
  /* The container is focused programmatically as the focus-trap entry point;
     its outline isn't a useful signal (controls inside keep their own). */
  .dialog:focus { outline: none; }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: .85rem 1.15rem .6rem;
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
  .body { padding: .3rem 1.15rem 1.15rem; overflow-y: auto; }

  @keyframes overlay-in {
    from { opacity: 0; }
    to { opacity: 1; }
  }
  @keyframes dialog-in {
    from { opacity: 0; transform: translateY(10px) scale(.985); }
    to { opacity: 1; transform: none; }
  }
  @media (prefers-reduced-motion: reduce) {
    .overlay, .dialog { animation: none; }
  }
</style>
