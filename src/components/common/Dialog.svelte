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
    background: rgba(10, 14, 20, 0.45);
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding: 4vh 1rem;
    z-index: 100;
  }
  .dialog {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    box-shadow: 0 8px 30px rgba(0, 0, 0, 0.35);
    width: 100%;
    max-width: 34rem;
    max-height: 90vh;
    display: flex;
    flex-direction: column;
  }
  .dialog.wide { max-width: 52rem; }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: .7rem 1rem;
    border-bottom: 1px solid var(--border);
  }
  header h2 { margin: 0; font-size: 1.05rem; }
  header button { border: none; background: none; font-size: 1rem; }
  .body { padding: .8rem 1rem 1rem; overflow-y: auto; }
</style>
