<script lang="ts">
  // Trip progress: IPT → DTS → Trip → Voucher. Every state has its own mark
  // (check, dot, empty ring, exclamation, dash) as well as its own color, and
  // each step carries its words for screen readers and the tooltip. A step
  // that has a next move (`step.action`) is a button when `onadvance` is
  // given: one click or Enter moves it forward. Clicks stop here so a
  // clickable table row underneath does not also react.
  import Icon from "../common/Icon.svelte";
  import type { TravelStep } from "../../domain/rules/travel";

  let {
    steps,
    who = "",
    onadvance
  }: { steps: TravelStep[]; who?: string; onadvance?: (key: TravelStep["key"]) => void } = $props();
</script>

<ol class="steps" aria-label="Trip progress">
  {#each steps as step (step.key)}
    {#if step.action && onadvance}
      <li class="step {step.state}">
        <button
          type="button"
          class="step-button"
          title={`${step.detail}. Click to ${step.action.toLowerCase()}.`}
          aria-label={`${step.action}${who ? ` for ${who}` : ""} (${step.detail})`}
          onclick={(ev) => {
            ev.stopPropagation();
            onadvance(step.key);
          }}
        >
          {@render mark(step)}
        </button>
      </li>
    {:else}
      <li class="step {step.state}" title={step.detail}>
        {@render mark(step)}
        <span class="sr-only">{step.detail}</span>
      </li>
    {/if}
  {/each}
</ol>

{#snippet mark(step: TravelStep)}
  <span class="marker" aria-hidden="true">
    {#if step.state === "done"}<Icon name="check" size={10} />{:else if step.state === "late"}!{:else if step.state === "skipped"}–{/if}
  </span>
  <span class="label" aria-hidden="true">{step.label}</span>
{/snippet}

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
  /* A step with a next move: same drawing, plus a pointer, a hover ring on the
     marker, and an underlined label so it reads as clickable without color. */
  .step-button {
    all: unset;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: .2rem;
    width: 100%;
    cursor: pointer;
    border-radius: 6px;
  }
  .step-button .label {
    text-decoration: underline dotted;
    text-underline-offset: 2px;
  }
  .step-button:hover .marker {
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 30%, transparent);
  }
  .step-button:hover .label {
    color: var(--text);
    text-decoration-style: solid;
  }
  .step-button:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
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
