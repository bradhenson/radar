<script lang="ts">
  // Small per-month bars for recent activity. A month with nothing recorded is
  // a flat stub, so a gap reads by height rather than color. The summary in
  // aria-label is what assistive technology announces.
  import type { MonthCount } from "../../domain/rules/performance";

  let { months, noun = "input" }: { months: MonthCount[]; noun?: string } = $props();

  function describe(m: MonthCount): string {
    return `${m.label}: ${m.count} ${noun}${m.count === 1 ? "" : "s"}`;
  }
  let summary = $derived(`Last ${months.length} months. ${months.map(describe).join(", ")}`);
</script>

<span class="strip" role="img" aria-label={summary}>
  {#each months as m (m.month)}
    <span class="month" title={describe(m)}>
      <span class="bar" class:empty={m.count === 0} style:height={m.count === 0 ? "2px" : `${7 + Math.min(m.count, 3) * 3}px`}></span>
      <span class="letter">{m.label.charAt(0)}</span>
    </span>
  {/each}
</span>

<style>
  .strip {
    display: inline-flex;
    align-items: flex-end;
    gap: .25rem;
    vertical-align: middle;
  }
  .month {
    display: inline-flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-end;
    gap: .15rem;
    height: 1.75rem;
  }
  .bar {
    display: block;
    width: .7rem;
    border-radius: 2px;
    background: var(--accent);
  }
  .bar.empty {
    background: var(--border-strong);
  }
  .letter {
    font-size: .58rem;
    line-height: 1;
    color: var(--text-muted);
  }
</style>
