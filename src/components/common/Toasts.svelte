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
    background: var(--surface);
    border: 1px solid var(--border);
    border-left: 4px solid var(--info);
    border-radius: var(--radius);
    box-shadow: var(--shadow);
    padding: .5rem .7rem;
    display: flex;
    align-items: center;
    gap: .5rem;
  }
  .toast.success { border-left-color: var(--success); }
  .toast.error { border-left-color: var(--danger); }
  .close { border: none; background: none; padding: 0 .2rem; }
</style>
