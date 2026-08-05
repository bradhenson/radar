<script lang="ts">
  // Activity log viewer (plan 25): the full local audit trail, filterable by
  // type and action, with links back to records that still exist.
  import { app } from "../stores/app.svelte";
  import { ui } from "../stores/ui.svelte";
  import { router } from "../app/router.svelte";
  import EmptyState from "../components/common/EmptyState.svelte";
  import type { ActivityEntry } from "../domain/models";
  import { groupActivityEntries } from "../domain/rules/activityGroups";
  import { formatTimestamp, timestampToLocalDate } from "../utils/dates";

  const SHOW_STEP = 100;

  let search = $state("");
  let filterEntity = $state("");
  let filterAction = $state("");
  let fromDate = $state("");
  let toDate = $state("");
  // Per-group disclosure state and how many rows each group has revealed.
  let expandedGroups = $state<Record<string, boolean>>({});
  let groupLimits = $state<Record<string, number>>({});

  const ENTITY_LABELS: Record<string, string> = {
    tasks: "Task",
    taskNotes: "Task note",
    checklistItems: "Checklist item",
    employees: "Employee",
    employeeNotes: "Employee note",
    quickNotes: "General note",
    employeeInteractions: "Check-in",
    projects: "Project",
    boardColumns: "Board column",
    competencies: "Competency",
    meetingNotes: "Meeting note",
    performanceInputs: "Performance input",
    trainingRequirements: "Training requirement",
    employeeTrainingRecords: "Training record",
    leaveRecords: "Leave",
    teleworkRecords: "Telework",
    travelRecords: "Travel",
    awardRecords: "Award",
    attentionSnoozes: "Snooze",
    settings: "Settings",
    system: "System",
    backup: "Backup"
  };

  function entityLabel(entityType: string): string {
    return (
      ENTITY_LABELS[entityType] ??
      entityType.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().replace(/^./, (c) => c.toUpperCase())
    );
  }

  function actionLabel(actionType: string): string {
    return actionType.replaceAll("_", " ");
  }

  let entityOptions = $derived(
    [...new Set(app.activityEntries.map((entry) => entry.entityType))]
      .map((value) => ({ value, label: entityLabel(value) }))
      .sort((a, b) => a.label.localeCompare(b.label))
  );

  let actionOptions = $derived(
    [...new Set(app.activityEntries.map((entry) => entry.actionType))].sort((a, b) => a.localeCompare(b))
  );

  let filtered = $derived(
    app.activityEntries
      .filter((entry) => {
        if (filterEntity && entry.entityType !== filterEntity) return false;
        if (filterAction && entry.actionType !== filterAction) return false;
        const day = timestampToLocalDate(entry.timestamp);
        if (fromDate && day < fromDate) return false;
        if (toDate && day > toDate) return false;
        const needle = search.trim().toLowerCase();
        if (!needle) return true;
        return entry.summary.toLowerCase().includes(needle);
      })
      .sort((a, b) => (a.timestamp < b.timestamp ? 1 : a.timestamp > b.timestamp ? -1 : 0))
  );

  let groups = $derived(groupActivityEntries(filtered, app.today));

  let hasFilters = $derived(Boolean(search.trim() || filterEntity || filterAction || fromDate || toDate));

  function clearFilters() {
    search = "";
    filterEntity = "";
    filterAction = "";
    fromDate = "";
    toDate = "";
  }

  // Only the newest group is open by default; a search or filter opens them
  // all, since the point of filtering is to see every match.
  function isExpanded(key: string, index: number): boolean {
    return expandedGroups[key] ?? (hasFilters || index === 0);
  }

  $effect(() => {
    void search;
    void filterEntity;
    void filterAction;
    void fromDate;
    void toDate;
    expandedGroups = {};
    groupLimits = {};
  });

  // Only entries whose record still exists can link back to it.
  function openTarget(entry: ActivityEntry): (() => void) | undefined {
    const id = entry.entityId;
    switch (entry.entityType) {
      case "tasks":
        return app.tasks.some((t) => t.id === id) ? () => ui.openTaskDetail(id) : undefined;
      case "employees":
        return app.employees.some((e) => e.id === id) ? () => router.go("employees", id) : undefined;
      case "projects":
        return app.projects.some((p) => p.id === id && !p.isArchived) ? () => router.go("projects", id) : undefined;
      case "meetingNotes":
        return app.meetingNotes.some((n) => n.id === id && !n.isArchived) ? () => router.go("meetings", id) : undefined;
      case "quickNotes":
        return app.quickNotes.some((n) => n.id === id && !n.isArchived) ? () => router.go("notes", id) : undefined;
      case "performanceInputs":
        return app.performanceInputs.some((p) => p.id === id && !p.isArchived) ? () => router.go("performance", id) : undefined;
      case "leaveRecords":
        return app.leaveRecords.some((l) => l.id === id) ? () => router.go("leave", id) : undefined;
      case "teleworkRecords":
        return app.teleworkRecords.some((t) => t.id === id) ? () => router.go("telework", id) : undefined;
      case "travelRecords":
        return app.travelRecords.some((t) => t.id === id && !t.isArchived) ? () => router.go("travel", id) : undefined;
      case "awardRecords":
        return app.awardRecords.some((a) => a.id === id) ? () => router.go("awards", id) : undefined;
      case "trainingRequirements":
      case "employeeTrainingRecords":
        return () => router.go("training");
      default:
        return undefined;
    }
  }
</script>

<div class="page">
  <div class="page-header">
    <h1>Activity</h1>
    <span class="muted">{filtered.length} entr{filtered.length === 1 ? "y" : "ies"}</span>
  </div>

  <div class="toolbar activity-toolbar">
    <input type="search" bind:value={search} placeholder="Search activity" aria-label="Search activity summaries" />
    <select bind:value={filterEntity} aria-label="Filter by record type">
      <option value="">All record types</option>
      {#each entityOptions as option (option.value)}
        <option value={option.value}>{option.label}</option>
      {/each}
    </select>
    <select bind:value={filterAction} aria-label="Filter by action">
      <option value="">All actions</option>
      {#each actionOptions as action (action)}
        <option value={action}>{actionLabel(action)}</option>
      {/each}
    </select>
    <label class="date-field">From <input type="date" bind:value={fromDate} max={toDate || undefined} /></label>
    <label class="date-field">To <input type="date" bind:value={toDate} min={fromDate || undefined} /></label>
    {#if hasFilters}
      <button type="button" onclick={clearFilters}>Clear</button>
    {/if}
  </div>

  {#if filtered.length === 0}
    <EmptyState
      message="No activity entries match."
      hint="Every create, update, archive, and delete is recorded here as you work."
    />
  {:else}
    {#each groups as group, index (group.key)}
      {@const open = isExpanded(group.key, index)}
      {@const limit = groupLimits[group.key] ?? SHOW_STEP}
      {@const shown = group.entries.slice(0, limit)}
      <h2 class="group-heading">
        <button
          type="button"
          class="group-toggle"
          aria-expanded={open}
          onclick={() => (expandedGroups[group.key] = !open)}
        >
          <span class="disclosure" aria-hidden="true">{open ? "▾" : "▸"}</span>
          {group.title}
          <span class="group-count">{group.entries.length}</span>
        </button>
      </h2>
      {#if open}
        <div class="table-wrap">
          <table class="data activity-table">
            <thead>
              <tr><th>When</th><th>Type</th><th>Action</th><th>Summary</th><th></th></tr>
            </thead>
            <tbody>
              {#each shown as entry (entry.id)}
                {@const openTargetFn = openTarget(entry)}
                <tr>
                  <td class="when-cell">{formatTimestamp(entry.timestamp)}</td>
                  <td><span class="badge">{entityLabel(entry.entityType)}</span></td>
                  <td class="action-cell">{actionLabel(entry.actionType)}</td>
                  <td>{entry.summary}</td>
                  <td class="open-cell">
                    {#if openTargetFn}
                      <button type="button" onclick={openTargetFn}>Open</button>
                    {/if}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
        {#if group.entries.length > limit}
          <button type="button" class="show-more" onclick={() => (groupLimits[group.key] = limit + SHOW_STEP)}>
            Show {Math.min(SHOW_STEP, group.entries.length - limit)} more of
            {group.entries.length - limit} older entries in {group.title}
          </button>
        {/if}
      {/if}
    {/each}
    <p class="small muted retention-note">
      {#if app.settings.activityRetentionDays > 0}
        Entries older than {app.settings.activityRetentionDays} days are pruned automatically at startup — adjust in
        <a href="#/settings">Settings</a>.
      {:else}
        Automatic pruning is off — every entry is kept. Adjust in <a href="#/settings">Settings</a>.
      {/if}
    </p>
  {/if}
</div>

<style>
  /* Not sticky: the filter row scrolls with the groups it filters, and a
     sticky row needs a fill, which paints a band over the Look's backdrop. */
  .activity-toolbar input[type="search"] { min-width: 15rem; flex: 1; }
  .date-field {
    display: inline-flex;
    align-items: center;
    gap: .35rem;
    margin: 0;
    font-size: .82rem;
    color: var(--text-muted);
    white-space: nowrap;
  }
  .group-heading { margin: 1rem 0 .35rem; }
  .group-toggle {
    display: inline-flex;
    align-items: center;
    gap: .45rem;
    border: none;
    background: none;
    box-shadow: none;
    padding: .1rem .2rem;
    font: inherit;
    font-weight: 700;
    color: var(--text);
  }
  .group-toggle:hover { background: none; color: var(--accent); }
  .group-toggle .disclosure { color: var(--text-muted); font-size: .8rem; }
  .group-count {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 999px;
    padding: .02rem .45rem;
    color: var(--text-muted);
    font-size: .74rem;
    font-weight: 700;
  }
  .table-wrap { overflow-x: auto; }
  .when-cell { white-space: nowrap; color: var(--text-muted); font-size: .82rem; }
  .action-cell { white-space: nowrap; color: var(--text-muted); }
  .open-cell { text-align: right; }
  .open-cell button { font-size: .78rem; padding: .15rem .5rem; }
  .show-more { margin-top: .6rem; font-size: .8rem; }
  .retention-note { margin-top: .8rem; }
</style>
