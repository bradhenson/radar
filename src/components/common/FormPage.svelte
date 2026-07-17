<script lang="ts">
  import type { Snippet } from "svelte";

  /**
   * Full-page form: rendered inside <main> in place of the routed page, so
   * opening a record swaps the whole content area to its editor and closing
   * restores the page underneath. Not an overlay — there is no backdrop and
   * no focus trap; Escape (with focus inside) or the ✕ button closes. Hosts
   * must not lose input on unmount (TaskDetail autosaves when destroyed),
   * because sidebar navigation dismisses the editor to reveal the new page.
   */
  let {
    title,
    onclose,
    unsavedGuard,
    children
  }: {
    title: string;
    onclose: () => void;
    /** Return true while the form holds unsaved changes; ✕/Escape then ask first. */
    unsavedGuard?: () => boolean;
    children: Snippet;
  } = $props();

  let pageEl: HTMLElement | undefined = $state();
  let confirmingDiscard = $state(false);

  // Restore focus to the control that opened the form when it closes (a
  // no-op if that control unmounted with the page it lived on).
  const opener =
    typeof document !== "undefined" && document.activeElement instanceof HTMLElement ? document.activeElement : null;

  $effect(() => {
    if (!pageEl) return;
    const first = pageEl.querySelector<HTMLElement>(
      '.body input:not([type="hidden"]):not(:disabled), .body select:not(:disabled), .body textarea:not(:disabled)'
    );
    (first ?? pageEl).focus();
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

<!-- Escape-to-close scoped to the region; the form is a page, not a modal,
     so this is an added keyboard affordance rather than a requirement. -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<section class="page form-page" aria-label={title} tabindex="-1" bind:this={pageEl} onkeydown={onKeydown}>
  <div class="page-header">
    <h1>{title}</h1>
    <span class="spacer"></span>
    <button type="button" class="close" aria-label="Close" title="Close" onclick={requestClose}>✕</button>
  </div>
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
</section>

<style>
  /* Focused programmatically as a landing point; controls inside keep their own outlines. */
  .form-page:focus { outline: none; }
  .form-page .page-header { max-width: 56rem; }
  .spacer { flex: 1; }
  .close {
    border: none;
    background: none;
    box-shadow: none;
    font-size: .95rem;
    color: var(--text-muted);
    width: 2.1rem;
    height: 2.1rem;
    min-height: 0;
    padding: 0;
    border-radius: 999px;
    display: grid;
    place-items: center;
    align-self: center;
  }
  .close:hover { background: var(--surface-2); color: var(--text); }
  .discard-bar {
    display: flex;
    align-items: center;
    gap: .5rem;
    flex-wrap: wrap;
    max-width: 56rem;
    margin: 0 0 .8rem;
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
  /* Form fields stretched across the full content width read poorly; keep
     the editing column at a comfortable line length. */
  .body { max-width: 56rem; }
</style>
