<script lang="ts">
  // compact: a slim one-line version for secondary sections (Archive groups,
  // "Next 14 days") where the full illustration would dominate the page.
  let { message, hint, compact = false }: { message: string; hint?: string; compact?: boolean } = $props();
</script>

<div class="empty-state" class:compact>
  {#if !compact}
    <!-- Decorative radar ping: expanding rings around a steady contact dot.
         Purely ornamental (aria-hidden); the message carries the meaning. -->
    <span class="ping" aria-hidden="true">
      <span class="ring"></span>
      <span class="ring r2"></span>
      <span class="ring r3"></span>
      <span class="core"></span>
    </span>
  {/if}
  <p class="empty-message"><strong>{message}</strong></p>
  {#if hint}<p class="small empty-hint">{hint}</p>{/if}
</div>

<style>
  .empty-message,
  .empty-hint {
    margin: .2rem 0;
  }
  .compact {
    padding: .9rem 1rem;
    text-align: left;
    border-width: 1px;
  }
  .compact .empty-message strong {
    font-weight: 600;
  }
  .ping {
    position: relative;
    display: inline-grid;
    place-items: center;
    width: 3.4rem;
    height: 3.4rem;
    margin-bottom: .55rem;
  }
  .core {
    width: .55rem;
    height: .55rem;
    border-radius: 50%;
    background: var(--accent);
    box-shadow: 0 0 10px color-mix(in srgb, var(--accent) 55%, transparent);
  }
  .ring {
    position: absolute;
    inset: 0;
    border: 1.5px solid color-mix(in srgb, var(--accent) 50%, transparent);
    border-radius: 50%;
    opacity: 0;
    animation: ping 3.2s cubic-bezier(.2, .6, .36, 1) infinite;
  }
  .r2 { animation-delay: 1.05s; }
  .r3 { animation-delay: 2.1s; }
  @keyframes ping {
    0% { transform: scale(.22); opacity: .85; }
    70% { opacity: .25; }
    100% { transform: scale(1.12); opacity: 0; }
  }
  /* The global reduced-motion gate collapses the animation; hide the ghost
     rings it would leave behind so only the contact dot remains. */
  @media (prefers-reduced-motion: reduce) {
    .ring { display: none; }
  }
</style>
