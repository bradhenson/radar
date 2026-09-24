<script lang="ts">
  // Trip progress: IPT → DTS → Trip → Voucher. Every state has its own mark
  // (check, dot, empty ring, exclamation, dash) as well as its own color, and
  // each step carries its words for screen readers and the tooltip.
  import Icon from "../common/Icon.svelte";
  import type { TravelStep } from "../../domain/rules/travel";

  let { steps }: { steps: TravelStep[] } = $props();
</script>

<ol class="steps" aria-label="Trip progress">
  {#each steps as step (step.key)}
    <li class="step {step.state}" title={step.detail}>
      <span class="marker" aria-hidden="true">
        {#if step.state === "done"}<Icon name="check" size={10} />{:else if step.state === "late"}!{:else if step.state === "skipped"}–{/if}
      </span>
      <span class="label" aria-hidden="true">{step.label}</span>
      <span class="sr-only">{step.detail}</span>
    </li>
  {/each}
</ol>

<style>
  .steps {
    display: flex;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .step {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: .2rem;
    width: 3.1rem;
  }
  /* Connector from the previous step's marker to this one. */
  .step + .step::before {
    content: "";
    position: absolute;
    top: .5rem;
    right: calc(50% + .6rem);
    width: calc(100% - 1.2rem);
    height: 2px;
    background: var(--border);
  }
  .marker {
    display: grid;
    place-items: center;
    width: 1rem;
    height: 1rem;
    border-radius: 50%;
    box-sizing: border-box;
    border: 2px solid var(--border-strong);
    background: var(--surface);
    color: var(--accent-text);
    font-size: .62rem;
    font-weight: 800;
    line-height: 1;
  }
  .label {
    font-size: .64rem;
    font-weight: 600;
    color: var(--text-muted);
    white-space: nowrap;
  }
  .done .marker {
    border-color: var(--success);
    background: var(--success);
    color: var(--bg);
  }
  .current .marker {
    border-color: var(--accent);
    background: radial-gradient(circle, var(--accent) 0 32%, var(--surface) 36%);
  }
  .current .label {
    color: var(--text);
  }
  .late .marker {
    border-color: var(--danger);
    background: var(--danger);
    color: var(--bg);
  }
  .late .label {
    color: var(--danger);
  }
  .skipped .marker {
    border-style: dashed;
    color: var(--text-muted);
  }
</style>
