<script lang="ts">
  // Today / Attention dashboard (plan section 12.1). Every row states why it
  // appears and offers snooze plus a relevant quick action.
  import { app } from "../stores/app.svelte";
  import { ui } from "../stores/ui.svelte";
  import { router } from "../app/router.svelte";
  import EmptyState from "../components/common/EmptyState.svelte";
  import type { AttentionItem } from "../domain/rules/attention";
  import { AWARD_FINAL_STATUSES } from "../domain/rules/calendar";
  import { performanceInputPrefillFromTask } from "../domain/rules/performanceImport";
  import { addDays, daysBetween, formatDate } from "../utils/dates";

  let overdueCount = $derived(app.attention.filter((i) => i.reasonCode === "overdue").length);
  let dueTodayCount = $derived(app.attention.filter((i) => i.reasonCode === "due_today").length);
  let dueSoonCount = $derived(app.attention.filter((i) => i.reasonCode === "due_soon").length);
  let waitingCount = $derived(app.attention.filter((i) => i.reasonCode === "waiting_too_long").length);
  let trainingCount = $derived(app.attention.filter((i) => i.reasonCode.startsWith("training")).length);

  // Filters: severity chips plus reason filters from the summary cards.
  type SeverityFilter = "" | "critical" | "high" | "medium" | "low" | "info";
  type ReasonFilter = "" | "overdue" | "due_today" | "due_soon" | "waiting_too_long" | "training";
  const SEVERITY_FILTERS: { value: SeverityFilter; label: string }[] = [
    { value: "", label: "All" },
    { value: "critical", label: "Critical" },
    { value: "high", label: "High" },
    { value: "medium", label: "Medium" },
    { value: "low", label: "Low" },
    { value: "info", label: "Info" }
  ];
  let severityFilter = $state<SeverityFilter>("");
  let reasonFilter = $state<ReasonFilter>("");

  function severityCount(value: SeverityFilter): number {
    return value === "" ? app.attention.length : app.attention.filter((i) => i.severity === value).length;
  }

  function toggleReasonFilter(value: ReasonFilter) {
    reasonFilter = reasonFilter === value ? "" : value;
  }

  function matchesFilters(i: AttentionItem): boolean {
    if (severityFilter && i.severity !== severityFilter) return false;
    if (reasonFilter === "training") return i.reasonCode.startsWith("training");
    if (reasonFilter) return i.reasonCode === reasonFilter;
    return true;
  }

  let filteredAttention = $derived(app.attention.filter(matchesFilters));
  let anyAttentionFilter = $derived(Boolean(severityFilter || reasonFilter));

  let taskItems = $derived(filteredAttention.filter((i) => i.entityType === "task"));
  let peopleItems = $derived(filteredAttention.filter((i) => i.entityType === "employee"));
  let otherItems = $derived(filteredAttention.filter((i) => !["task", "employee"].includes(i.entityType)));

  // Collapsible groups with a top-N cut so one noisy category can't bury the rest.
  const GROUP_LIMIT = 8;
  let collapsedGroups = $state<Record<string, boolean>>({});
  let expandedGroups = $state<Record<string, boolean>>({});
  let groups = $derived([
    { key: "tasks", title: "Tasks", items: taskItems },
    { key: "people", title: "Employees", items: peopleItems },
    { key: "other", title: "Training, availability, travel, awards, and system", items: otherItems }
  ]);

  let recentlyCompleted = $derived(
    app.tasks
      .filter((t) => t.status === "complete" && !t.isArchived && t.completedDate && daysBetween(t.completedDate, app.today) <= app.settings.completedVisibleDays)
      .sort((a, b) => (a.completedDate! < b.completedDate! ? 1 : -1))
      .slice(0, 8)
  );

  // Next-14-day strip: due dates, leave, training expirations, telework dates, meetings.
  let upcoming = $derived.by(() => {
    const events: { date: string; label: string; kind: string }[] = [];
    const horizon = addDays(app.today, 14);
    for (const t of app.tasks) {
      if (t.isArchived || t.status === "complete" || t.status === "cancelled" || !t.dueDate) continue;
      if (t.dueDate >= app.today && t.dueDate <= horizon) events.push({ date: t.dueDate, label: t.title, kind: "Task due" });
    }
    for (const l of app.leaveRecords) {
      if (["cancelled", "complete"].includes(l.status)) continue;
      if (l.startDate >= app.today && l.startDate <= horizon)
        events.push({ date: l.startDate, label: `${app.employeeName(l.employeeId)} leave begins`, kind: "Leave" });
    }
    for (const r of app.trainingStatusList) {
      if (["not_applicable", "waived", "complete"].includes(r.status.state)) continue;
      const d = r.status.dueDate;
      if (d && d >= app.today && d <= horizon) {
        events.push({ date: d, label: `${r.requirement.name} — ${r.employee.displayName}`, kind: "Training" });
      }
    }
    for (const tw of app.teleworkRecords) {
      if (tw.recordType === "Situational request") {
        if (
          tw.effectiveDate &&
          !["denied", "cancelled", "expired"].includes(tw.status) &&
          tw.effectiveDate >= app.today &&
          tw.effectiveDate <= horizon
        ) {
          events.push({ date: tw.effectiveDate, label: `${app.employeeName(tw.employeeId)} situational telework`, kind: "Telework" });
        }
      } else if (tw.expirationDate && tw.expirationDate >= app.today && tw.expirationDate <= horizon) {
        events.push({ date: tw.expirationDate, label: `Telework agreement expires — ${app.employeeName(tw.employeeId)}`, kind: "Telework" });
      }
    }
    for (const trip of app.travelRecords) {
      if (trip.isArchived) continue;
      if (trip.startDate >= app.today && trip.startDate <= horizon) {
        events.push({ date: trip.startDate, label: `${app.employeeName(trip.employeeId)} travel to ${trip.destination}`, kind: "Travel" });
      }
      if (trip.voucherDueDate && trip.voucherDueDate >= app.today && trip.voucherDueDate <= horizon) {
        events.push({ date: trip.voucherDueDate, label: `Voucher due — ${app.employeeName(trip.employeeId)} (${trip.destination})`, kind: "Travel" });
      }
    }
    for (const award of app.awardRecords) {
      if (AWARD_FINAL_STATUSES.has(award.status)) continue;
      if (award.nominationDueDate && award.nominationDueDate >= app.today && award.nominationDueDate <= horizon) {
        events.push({ date: award.nominationDueDate, label: `Award nomination due — ${award.title}`, kind: "Award" });
      }
    }
    for (const note of app.meetingNotes) {
      if (!note.isArchived && note.meetingDate >= app.today && note.meetingDate <= horizon) {
        events.push({ date: note.meetingDate, label: note.title, kind: "Meeting" });
      }
    }
    return events.sort((a, b) => (a.date < b.date ? -1 : 1)).slice(0, 20);
  });

  // Deep-link straight to the record: list pages open the matching edit
  // dialog when given an id parameter.
  function open(item: AttentionItem) {
    if (item.entityType === "task") ui.openTaskDetail(item.entityId);
    else if (item.entityType === "employee") router.go("employees", item.entityId);
    else if (item.entityType === "training") router.go("training");
    else if (item.entityType === "leave") router.go("leave", item.entityId);
    else if (item.entityType === "telework") router.go("telework", item.entityId);
    else if (item.entityType === "travel") router.go("travel", item.entityId);
    else if (item.entityType === "award") router.go("awards", item.entityId);
    else if (item.entityType === "system") router.go("settings");
  }

  async function snooze(item: AttentionItem, days: number) {
    await app.snoozeAttention(item, addDays(app.today, days));
    app.toast(`Snoozed until ${formatDate(addDays(app.today, days))}`);
  }

  const SEVERITY_LABEL: Record<string, string> = {
    critical: "Critical",
    high: "High",
    medium: "Medium",
    low: "Low",
    info: "Info"
  };
</script>

<div class="page">
  <div class="page-header">
    <h1>Today</h1>
    <span class="muted">{formatDate(app.today)}</span>
  </div>

  <div class="summary-cards today-summary">
    <button type="button" class="stat" class:alert={overdueCount > 0} class:selected={reasonFilter === "overdue"} aria-pressed={reasonFilter === "overdue"} onclick={() => toggleReasonFilter("overdue")}>
      <div class="num">{overdueCount}</div><div class="lbl">Overdue</div>
    </button>
    <button type="button" class="stat" class:warn={dueTodayCount > 0} class:selected={reasonFilter === "due_today"} aria-pressed={reasonFilter === "due_today"} onclick={() => toggleReasonFilter("due_today")}>
      <div class="num">{dueTodayCount}</div><div class="lbl">Due today</div>
    </button>
    <button type="button" class="stat" class:selected={reasonFilter === "due_soon"} aria-pressed={reasonFilter === "due_soon"} onclick={() => toggleReasonFilter("due_soon")}>
      <div class="num">{dueSoonCount}</div><div class="lbl">Due soon</div>
    </button>
    <button type="button" class="stat" class:selected={reasonFilter === "waiting_too_long"} aria-pressed={reasonFilter === "waiting_too_long"} onclick={() => toggleReasonFilter("waiting_too_long")}>
      <div class="num">{waitingCount}</div><div class="lbl">Waiting too long</div>
    </button>
    <button type="button" class="stat" class:selected={reasonFilter === "training"} aria-pressed={reasonFilter === "training"} onclick={() => toggleReasonFilter("training")}>
      <div class="num">{trainingCount}</div><div class="lbl">Training warnings</div>
    </button>
  </div>

  <div class="severity-filter" role="group" aria-label="Filter by severity">
    {#each SEVERITY_FILTERS as f (f.value)}
      <button
        type="button"
        class="severity-chip"
        class:active={severityFilter === f.value}
        aria-pressed={severityFilter === f.value}
        onclick={() => (severityFilter = f.value)}
      >
        {f.label} <span class="chip-count">{severityCount(f.value)}</span>
      </button>
    {/each}
    {#if anyAttentionFilter}
      <button type="button" class="link small" onclick={() => { severityFilter = ""; reasonFilter = ""; }}>Clear filters</button>
    {/if}
  </div>

  <div class="toolbar">
    <button type="button" class="primary" onclick={() => (ui.quickAddOpen = true)}>Quick Add</button>
    <button type="button" onclick={() => ui.openNewTask()}>New Task</button>
    <button type="button" onclick={() => (ui.performanceFormPrefill = {})}>New Performance Input</button>
    <button type="button" onclick={() => router.go("training")}>Record Training</button>
    <button type="button" onclick={() => router.go("leave")}>Add Leave</button>
    <button type="button" onclick={() => router.go("telework")}>Add Telework Item</button>
    <button type="button" onclick={() => router.go("meetings")}>Meeting Notes</button>
  </div>

  {#if app.attention.length === 0}
    <EmptyState
      message="Nothing needs attention right now."
      hint={app.tasks.length === 0 ? "Create tasks on the Board, or load sample data from Settings to explore." : "Enjoy the quiet. Review the Board for planned work."}
    />
  {:else if filteredAttention.length === 0}
    <EmptyState message="No attention items match the current filters." hint="Clear the severity or summary-card filter to see everything." />
  {:else}
    {#each groups as group (group.key)}
      {#if group.items.length}
        {@const showAll = expandedGroups[group.key] || group.items.length <= GROUP_LIMIT}
        {@const shown = showAll ? group.items : group.items.slice(0, GROUP_LIMIT)}
        <h2 class="group-heading">
          <button
            type="button"
            class="group-toggle"
            aria-expanded={!collapsedGroups[group.key]}
            onclick={() => (collapsedGroups[group.key] = !collapsedGroups[group.key])}
          >
            <span class="disclosure" aria-hidden="true">{collapsedGroups[group.key] ? "▸" : "▾"}</span>
            {group.title}
            <span class="group-count">{group.items.length}</span>
          </button>
        </h2>
        {#if !collapsedGroups[group.key]}
          <table class="data attention-table">
            <colgroup>
              <col class="reason-col" />
              <col />
              <col class="severity-col" />
              <col class="actions-col" />
            </colgroup>
            <thead>
              <tr><th>Reason</th><th>Item</th><th>Severity</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {#each shown as item (item.entityType + item.entityId + item.reasonCode)}
                <tr>
                  <td class="reason-cell"><span class="badge {item.severity === 'critical' || item.severity === 'high' ? 'overdue' : item.severity === 'medium' ? 'warning' : ''}">{item.reasonText}</span></td>
                  <td class="item-cell">
                    <button type="button" class="link" onclick={() => open(item)}>{item.title}</button>
                    {#if item.employeeId && item.entityType === "task"}
                      <span class="muted small">· {app.employeeName(item.employeeId)}</span>
                    {/if}
                    <div class="muted small">{item.suggestedAction}</div>
                  </td>
                  <td>{SEVERITY_LABEL[item.severity]}</td>
                  <td>
                    <div class="actions">
                      <button type="button" onclick={() => open(item)}>Open</button>
                      <button type="button" onclick={() => void snooze(item, 1)}>Snooze 1d</button>
                      <button type="button" onclick={() => void snooze(item, 7)}>1w</button>
                    </div>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
          {#if !showAll}
            <button type="button" class="show-all" onclick={() => (expandedGroups[group.key] = true)}>
              Show all {group.items.length} items
            </button>
          {/if}
        {/if}
      {/if}
    {/each}
  {/if}

  <div class="two-col">
    <section>
      <h2 style="margin-top:1.2rem">Next 14 days</h2>
      {#if upcoming.length === 0}
        <p class="muted">No dated items in the next two weeks.</p>
      {:else}
        <table class="data">
          <tbody>
            {#each upcoming as ev, i (i)}
              <tr>
                <td style="width:7rem; white-space:nowrap">{formatDate(ev.date)}</td>
                <td><span class="badge">{ev.kind}</span> {ev.label}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
    </section>

    <section>
      <h2 style="margin-top:1.2rem">Recently completed</h2>
      {#if recentlyCompleted.length === 0}
        <p class="muted">No recently completed tasks.</p>
      {:else}
        <table class="data">
          <tbody>
            {#each recentlyCompleted as t (t.id)}
              <tr>
                <td style="width:7rem; white-space:nowrap">{formatDate(t.completedDate)}</td>
                <td><button type="button" class="link" onclick={() => ui.openTaskDetail(t.id)}>{t.title}</button></td>
                <td style="width:12rem">
                  {#if t.employeeId && !t.performanceInputCreated}
                    <button
                      type="button"
                      onclick={() => (ui.performanceFormPrefill = performanceInputPrefillFromTask(t, {
                        today: app.today,
                        notes: app.taskNotes,
                        checklistItems: app.checklistItems
                      }))}>→ Performance input</button
                    >
                  {:else if t.performanceInputCreated}
                    <span class="badge success">Input created</span>
                  {/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
    </section>
  </div>
</div>

<style>
  .today-summary {
    display: grid;
    grid-template-columns: repeat(5, minmax(8.5rem, 1fr));
    align-items: stretch;
  }
  .today-summary .stat {
    min-width: 0;
    cursor: pointer;
    text-align: left;
    font: inherit;
  }
  .today-summary .stat.selected {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }
  .severity-filter {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: .35rem;
    margin: .6rem 0 .2rem;
  }
  .severity-chip {
    display: inline-flex;
    align-items: center;
    gap: .35rem;
    min-height: 1.9rem;
    padding: .2rem .65rem;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--surface);
    color: var(--text-muted);
    font-size: .8rem;
    font-weight: 600;
  }
  .severity-chip.active {
    border-color: color-mix(in srgb, var(--accent) 55%, var(--border));
    background: var(--accent-soft);
    color: var(--accent);
  }
  .chip-count {
    font-size: .72rem;
    opacity: .8;
  }
  .group-heading {
    margin: 1rem 0 .35rem;
  }
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
  .group-toggle:hover {
    background: none;
    color: var(--accent);
  }
  .group-toggle .disclosure {
    color: var(--text-muted);
    font-size: .8rem;
  }
  .group-count {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 999px;
    padding: .02rem .45rem;
    color: var(--text-muted);
    font-size: .74rem;
    font-weight: 700;
  }
  .show-all {
    margin-top: .35rem;
    font-size: .8rem;
  }
  .attention-table {
    table-layout: fixed;
  }
  .attention-table .reason-col {
    width: 15.5rem;
  }
  .attention-table .severity-col {
    width: 6rem;
  }
  .attention-table .actions-col {
    width: 16rem;
  }
  .reason-cell .badge {
    max-width: 100%;
    white-space: normal;
    text-align: left;
  }
  .item-cell {
    min-width: 0;
  }
  .actions { display: flex; gap: .3rem; flex-wrap: wrap; }
  .actions button { font-size: .78rem; padding: .15rem .5rem; }
  .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
  @media (max-width: 1000px) {
    .today-summary { grid-template-columns: repeat(3, minmax(8.5rem, 1fr)); }
    .two-col { grid-template-columns: 1fr; }
  }
  @media (max-width: 760px) {
    .today-summary { grid-template-columns: repeat(2, minmax(8.5rem, 1fr)); }
    .attention-table .reason-col { width: 12rem; }
    .attention-table .actions-col { width: 12rem; }
  }
</style>
