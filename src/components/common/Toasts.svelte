<script lang="ts">
  import { app } from "../../stores/app.svelte";
</script>

<div class="toasts" role="status" aria-live="polite">
  {#each app.toasts as toast (toast.id)}
    <div class="toast {toast.kind}">
      <span>{toast.message}</span>
      {#if toast.undo}
        <button
          type="button"
          class="link"
          onclick={() => {
            toast.undo?.();
            app.dismissToast(toast.id);
          }}>Undo</button
        >
      {/if}
      <button type="button" class="close" aria-label="Dismiss" onclick={() => app.dismissToast(toast.id)}>✕</button>
    </div>
  {/each}
</div>

<style>
  .toasts {
    position: fixed;
    bottom: 2.4rem;
    right: 1rem;
    display: flex;
    flex-direction: column;
    gap: .5rem;
    z-index: 200;
    max-width: 24rem;
  }
  .toast {
    background: var(--surface-elevated);
    border: 1px solid var(--border);
    border-left: 4px solid var(--info);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-lg);
    padding: .6rem .85rem;
    display: flex;
    align-items: center;
    gap: .5rem;
    font-weight: 550;
    animation: toast-in .18s cubic-bezier(.16, 1, .3, 1);
  }
  .toast.success { border-left-color: var(--success); }
  .toast.error { border-left-color: var(--danger); }
  .close {
    border: none;
    background: none;
    box-shadow: none;
    padding: 0 .2rem;
    min-height: 0;
    color: var(--text-muted);
  }
  @keyframes toast-in {
    from { opacity: 0; transform: translateY(8px); }
    to { opacity: 1; transform: none; }
  }
  @media (prefers-reduced-motion: reduce) {
    .toast { animation: none; }
  }
</style>
