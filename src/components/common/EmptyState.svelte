<script lang="ts">
  let { message, hint }: { message: string; hint?: string } = $props();
</script>

<div class="empty-state">
  <p style="margin:.2rem 0"><strong>{message}</strong></p>
  {#if hint}<p class="small" style="margin:.2rem 0">{hint}</p>{/if}
</div>
