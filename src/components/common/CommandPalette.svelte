<script lang="ts">
  // Global search palette (plan 24.1): one input that searches tasks, people,
  // projects, meeting notes, and performance inputs, and doubles as page
  // navigation. Opened with Ctrl+K or the topbar search button.
  import { app } from "../../stores/app.svelte";
  import { ui } from "../../stores/ui.svelte";
  import { router } from "../../app/router.svelte";
  import Icon from "./Icon.svelte";
  import { buildSearchIndex, querySearchIndex, searchTypeLabel, type SearchEntry } from "../../domain/rules/search";
  import { formatDate } from "../../utils/dates";

  let { onclose }: { onclose: () => void } = $props();

  const PAGES: { page: string; label: string }[] = [
    { page: "board", label: "Board" },
    { page: "calendar", label: "Calendar" },
    { page: "today", label: "Today" },
    { page: "projects", label: "Projects" },
    { page: "meetings", label: "Meetings" },
    { page: "employees", label: "Employees" },
    { page: "performance", label: "Performance" },
    { page: "training", label: "Training" },
    { page: "leave", label: "Leave" },
    { page: "telework", label: "Telework" },
    { page: "travel", label: "Travel" },
    { page: "awards", label: "Awards" },
    { page: "reports", label: "Reports" },
    { page: "activity", label: "Activity" },
    { page: "archive", label: "Archive" },
    { page: "settings", label: "Settings" }
  ];

  let query = $state("");
  let selected = $state(0);
  let inputEl: HTMLInputElement | undefined = $state();
  let listEl: HTMLDivElement | undefined = $state();

  const opener =
    typeof document !== "undefined" && document.activeElement instanceof HTMLElement ? document.activeElement : null;

  // Rebuilt only when the underlying data changes, not per keystroke.
  let index = $derived(
    buildSearchIndex({
      tasks: app.tasks,
      employees: app.employees,
      projects: app.projects,
      meetingNotes: app.meetingNotes,
      performanceInputs: app.performanceInputs,
      pages: PAGES,
      employeeName: (id) => app.employeeName(id),
      projectName: (id) => app.projectName(id),
      formatDate
    })
  );

  let results = $derived(
    query.trim()
      ? querySearchIndex(index, query)
      : index.filter((item) => item.type === "page")
  );

  $effect(() => {
    void query;
    selected = 0;
  });

  $effect(() => {
    inputEl?.focus();
    return () => opener?.focus();
  });

  function open(item: SearchEntry) {
    onclose();
    switch (item.type) {
      case "task":
        ui.openTaskDetail(item.id);
        break;
      case "employee":
        router.go("employees", item.id);
        break;
      case "project":
        router.go("projects", item.id);
        break;
      case "meeting":
        router.go("meetings", item.id);
        break;
      case "performance":
        router.go("performance", item.id);
        break;
      case "page":
        router.go(item.id);
        break;
    }
  }

  function move(delta: number) {
    if (results.length === 0) return;
    selected = Math.min(Math.max(selected + delta, 0), results.length - 1);
    requestAnimationFrame(() => {
      listEl?.querySelector<HTMLElement>(`[data-index="${selected}"]`)?.scrollIntoView({ block: "nearest" });
    });
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.stopPropagation();
      onclose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      move(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      move(-1);
    } else if (e.key === "Enter") {
      const item = results[selected];
      if (item) {
        e.preventDefault();
        open(item);
      }
    }
  }
</script>

<div class="overlay" role="presentation" onclick={(e) => { if (e.target === e.currentTarget) onclose(); }}>
  <div class="palette" role="dialog" aria-modal="true" aria-label="Search" tabindex="-1" onkeydown={onKeydown}>
    <div class="input-row">
      <span class="search-icon" aria-hidden="true"><Icon name="search" size={16} /></span>
      <input
        type="text"
        bind:this={inputEl}
        bind:value={query}
        placeholder="Search tasks, people, projects, notes, inputs…"
        aria-label="Search everything"
        role="combobox"
        aria-expanded="true"
        aria-controls="palette-results"
        aria-activedescendant={results[selected] ? `palette-item-${selected}` : undefined}
        autocomplete="off"
        spellcheck="false"
      />
      <kbd>Esc</kbd>
    </div>
    <div class="results" id="palette-results" role="listbox" aria-label="Search results" bind:this={listEl}>
      {#if results.length === 0}
        <p class="no-results">No matches. Archived records are searchable on the Archive page.</p>
      {:else}
        {#each results as item, i (item.type + item.id)}
          <button
            type="button"
            id={"palette-item-" + i}
            data-index={i}
            role="option"
            aria-selected={i === selected}
            class="result"
            class:selected={i === selected}
            onclick={() => open(item)}
            onmousemove={() => (selected = i)}
          >
            <span class="result-type">{searchTypeLabel(item.type)}</span>
            <span class="result-main">
              <span class="result-title">{item.title}</span>
              {#if item.subtitle}<span class="result-subtitle">{item.subtitle}</span>{/if}
            </span>
          </button>
        {/each}
      {/if}
    </div>
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    background: color-mix(in srgb, #0a0e14 55%, transparent);
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding: 10vh 1rem 1rem;
    z-index: 100;
  }
  .palette {
    width: 100%;
    max-width: 36rem;
    max-height: 65vh;
    display: flex;
    flex-direction: column;
    background: var(--surface-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-lg);
    overflow: hidden;
  }
  .input-row {
    display: flex;
    align-items: center;
    gap: .55rem;
    padding: .55rem .8rem;
    border-bottom: 1px solid var(--border);
  }
  .search-icon { display: inline-grid; place-items: center; color: var(--text-muted); flex: 0 0 auto; }
  .input-row input {
    flex: 1;
    border: none;
    background: none;
    box-shadow: none;
    min-height: 2.2rem;
    font-size: .95rem;
    padding: 0;
  }
  .input-row input:focus { outline: none; box-shadow: none; border: none; }
  .input-row kbd {
    flex: 0 0 auto;
    padding: .1rem .4rem;
    border: 1px solid var(--border);
    border-radius: 5px;
    background: var(--surface-2);
    color: var(--text-muted);
    font-size: .68rem;
    font-family: inherit;
  }
  .results { overflow-y: auto; padding: .35rem; }
  .no-results { margin: .8rem .6rem 1rem; color: var(--text-muted); font-size: .85rem; }
  .result {
    display: flex;
    align-items: baseline;
    gap: .6rem;
    width: 100%;
    padding: .45rem .6rem;
    border: 0;
    border-radius: var(--radius);
    background: transparent;
    box-shadow: none;
    text-align: left;
    min-height: 0;
  }
  .result:hover { background: color-mix(in srgb, var(--accent-soft) 38%, transparent); }
  .result.selected { background: var(--accent-soft); }
  .result-type {
    flex: 0 0 7.2rem;
    color: var(--text-muted);
    font-size: .68rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: .05em;
  }
  .result.selected .result-type { color: var(--accent); }
  .result-main { display: grid; gap: .05rem; min-width: 0; }
  .result-title {
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .result-subtitle {
    color: var(--text-muted);
    font-size: .76rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
