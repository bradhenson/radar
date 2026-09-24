<script lang="ts">
  // Completion bar: done share, then overdue share, then the rest. Decorative:
  // the "27/40 complete" and "13 overdue" text beside it carries the meaning.
  let { done, overdue = 0, total }: { done: number; overdue?: number; total: number } = $props();

  function share(n: number): number {
    return total > 0 ? Math.min(100, Math.max(0, (n / total) * 100)) : 0;
  }
  let donePct = $derived(share(done));
  let overduePct = $derived(Math.min(100 - donePct, share(overdue)));
</script>

<span class="bar" aria-hidden="true">
  <span class="done" style:width={`${donePct}%`}></span>
  <span class="overdue" style:width={`${overduePct}%`}></span>
</span>

<style>
  .bar {
    display: flex;
    width: 100%;
    max-width: 11rem;
    height: .4rem;
    margin-top: .35rem;
    border-radius: 99px;
    overflow: hidden;
    background: var(--surface-2);
    box-shadow: inset 0 0 0 1px var(--border);
  }
  .done {
    background: var(--success);
  }
  /* Striped so the overdue share differs by pattern as well as color. */
  .overdue {
    background: repeating-linear-gradient(
      -45deg,
      var(--danger) 0 3px,
      color-mix(in srgb, var(--danger) 65%, var(--surface)) 3px 6px
    );
  }
</style>
