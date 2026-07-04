<script lang="ts">
  import Dialog from "./Dialog.svelte";

  let {
    title,
    message,
    confirmLabel = "Confirm",
    danger = false,
    typedPhrase,
    onconfirm,
    oncancel
  }: {
    title: string;
    message: string;
    confirmLabel?: string;
    danger?: boolean;
    /** When set, the user must type this phrase to enable confirmation. */
    typedPhrase?: string;
    onconfirm: () => void;
    oncancel: () => void;
  } = $props();

  let typed = $state("");
  let canConfirm = $derived(!typedPhrase || typed === typedPhrase);
</script>

<Dialog {title} onclose={oncancel}>
  <p>{message}</p>
  {#if typedPhrase}
    <label for="confirm-phrase">Type <strong>{typedPhrase}</strong> to confirm</label>
    <input id="confirm-phrase" type="text" bind:value={typed} autocomplete="off" />
  {/if}
  <div style="display:flex; gap:.5rem; justify-content:flex-end; margin-top:1rem;">
    <button type="button" onclick={oncancel}>Cancel</button>
    <button type="button" class={danger ? "danger" : "primary"} disabled={!canConfirm} onclick={onconfirm}>
      {confirmLabel}
    </button>
  </div>
</Dialog>
