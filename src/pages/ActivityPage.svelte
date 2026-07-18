<script lang="ts">
  // Activity log viewer (plan 25): the full local audit trail, filterable by
  // type and action, with links back to records that still exist.
  import { app } from "../stores/app.svelte";
  import { ui } from "../stores/ui.svelte";
  import { router } from "../app/router.svelte";
  import EmptyState from "../components/common/EmptyState.svelte";
  import type { ActivityEntry } from "../domain/models";
  import { formatTimestamp } from "../utils/dates";

  const SHOW_STEP = 100;

  let search = $state("");
  let filterEntity = $state("");
  let filterAction = $state("");
  let limit = $state(SHOW_STEP);

  const ENTITY_LABELS: Record<string, string> = {
    tasks: "Task",
    taskNotes: "Task note",
    checklistItems: "Checklist item",
    employees: "Employee",
    employeeNotes: "Employee note",
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
        const needle = search.trim().toLowerCase();
        if (!needle) return true;
        return entry.summary.toLowerCase().includes(needle);
      })
      .sort((a, b) => (a.timestamp < b.timestamp ? 1 : a.timestamp > b.timestamp ? -1 : 0))
  );

  let shown = $derived(filtered.slice(0, limit));

  $effect(() => {
    void search;
    void filterEntity;
    void filterAction;
    limit = SHOW_STEP;
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
  </div>

  {#if filtered.length === 0}
    <EmptyState
      message="No activity entries match."
      hint="Every create, update, archive, and delete is recorded here as you work."
    />
  {:else}
    <div class="table-wrap">
      <table class="data activity-table">
        <thead>
          <tr><th>When</th><th>Type</th><th>Action</th><th>Summary</th><th></th></tr>
        </thead>
        <tbody>
          {#each shown as entry (entry.id)}
            {@const open = openTarget(entry)}
            <tr>
              <td class="when-cell">{formatTimestamp(entry.timestamp)}</td>
              <td><span class="badge">{entityLabel(entry.entityType)}</span></td>
              <td class="action-cell">{actionLabel(entry.actionType)}</td>
              <td>{entry.summary}</td>
              <td class="open-cell">
                {#if open}
                  <button type="button" onclick={open}>Open</button>
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    {#if filtered.length > limit}
      <button type="button" class="show-more" onclick={() => (limit += SHOW_STEP)}>
        Show {Math.min(SHOW_STEP, filtered.length - limit)} more of {filtered.length - limit} older entries
      </button>
    {/if}
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
  .activity-toolbar { position: sticky; top: 0; z-index: 3; padding: .5rem 0; background: var(--bg); }
  .activity-toolbar input[type="search"] { min-width: 15rem; flex: 1; }
  .table-wrap { overflow-x: auto; }
  .when-cell { white-space: nowrap; color: var(--text-muted); font-size: .82rem; }
  .action-cell { white-space: nowrap; color: var(--text-muted); }
  .open-cell { text-align: right; }
  .open-cell button { font-size: .78rem; padding: .15rem .5rem; }
  .show-more { margin-top: .6rem; font-size: .8rem; }
  .retention-note { margin-top: .8rem; }
</style>
