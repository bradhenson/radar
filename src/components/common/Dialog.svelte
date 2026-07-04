<script lang="ts">
  import type { Snippet } from "svelte";

  let {
    title,
    onclose,
    wide = false,
    children
  }: { title: string; onclose: () => void; wide?: boolean; children: Snippet } = $props();

  let dialogEl: HTMLDivElement | undefined = $state();

  $effect(() => {
    // Focus trap entry point.
    dialogEl?.focus();
  });

  function onKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.stopPropagation();
      onclose();
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

<div class="overlay" role="presentation" onclick={(e) => { if (e.target === e.currentTarget) onclose(); }}>
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
      <button type="button" aria-label="Close" onclick={onclose}>✕</button>
    </header>
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
