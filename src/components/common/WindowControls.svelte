<script lang="ts">
  import {
    closeDesktopWindow,
    minimiseDesktopWindow,
    toggleMaximiseDesktopWindow
  } from "../../data/wailsBridge";
</script>

<div class="window-controls" aria-label="Window controls">
  <button type="button" aria-label="Minimize window" title="Minimize" onclick={minimiseDesktopWindow}>
    <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2 8.5h8" /></svg>
  </button>
  <button type="button" aria-label="Maximize or restore window" title="Maximize or restore" onclick={toggleMaximiseDesktopWindow}>
    <svg viewBox="0 0 12 12" aria-hidden="true"><rect x="2.25" y="2.25" width="7.5" height="7.5" /></svg>
  </button>
  <button type="button" class="close" aria-label="Close window" title="Close" onclick={closeDesktopWindow}>
    <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 2.5l7 7m0-7l-7 7" /></svg>
  </button>
</div>

<style>
  .window-controls {
    display: flex;
    align-self: stretch;
    margin: -.2rem -1.1rem -.2rem .2rem;
    --wails-draggable: no-drag;
  }
  button {
    display: grid;
    place-items: center;
    width: 2.9rem;
    min-height: 0;
    padding: 0;
    border: 0;
    border-radius: 0;
    background: transparent;
    box-shadow: none;
    color: var(--text-muted);
  }
  button:hover { background: var(--surface-2); color: var(--text); }
  button.close:hover { background: #c42b1c; color: #fff; }
  svg { width: .75rem; height: .75rem; fill: none; stroke: currentColor; stroke-width: 1.15; }
</style>
