<script lang="ts">
  // Pay period telework usage as dots. Decorative: the "3 of 2" text beside it
  // carries the meaning. Each kind has its own shape so color is never the
  // only difference: filled (approved), ring (pending), dashed (unused), and
  // diamond (past the allowance).
  import type { AllowanceDot } from "../../domain/rules/telework";

  let { dots }: { dots: AllowanceDot[] } = $props();
</script>

{#if dots.length}
  <span class="dots" aria-hidden="true">
    {#each dots as dot, i (i)}
      <span class="dot {dot.kind}" class:over={dot.over}></span>
    {/each}
  </span>
{/if}

<style>
  .dots {
    display: inline-flex;
    align-items: center;
    gap: .2rem;
    vertical-align: middle;
    margin-right: .4rem;
  }
  .dot {
    width: .62rem;
    height: .62rem;
    border-radius: 50%;
    box-sizing: border-box;
    flex: none;
  }
  .used {
    background: var(--accent);
  }
  .pending {
    border: 2px solid var(--accent);
    background: transparent;
  }
  .open {
    border: 1.5px dashed var(--border-strong);
    background: transparent;
  }
  .over {
    border-radius: 2px;
    transform: rotate(45deg) scale(.9);
  }
  .used.over {
    background: var(--danger);
  }
  .pending.over {
    border-color: var(--danger);
  }
</style>
