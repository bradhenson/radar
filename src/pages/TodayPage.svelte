<script lang="ts">
  // Today / Attention dashboard (plan section 12.1). Every row states why it
  // appears and offers snooze plus a relevant quick action.
  import { app } from "../stores/app.svelte";
  import { ui } from "../stores/ui.svelte";
  import { router } from "../app/router.svelte";
  import EmptyState from "../components/common/EmptyState.svelte";
  import Icon from "../components/common/Icon.svelte";
  import type { AttentionItem } from "../domain/rules/attention";
  import { AWARD_FINAL_STATUSES } from "../domain/rules/calendar";
  import { isTripCancelled, isVoucherSettled } from "../domain/rules/travel";
  import { addDays, formatDate, formatLongDate } from "../utils/dates";
  import WorkspaceHeader from "../components/common/WorkspaceHeader.svelte";

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
      if (trip.isArchived || isTripCancelled(trip)) continue;
      if (trip.startDate >= app.today && trip.startDate <= horizon) {
        events.push({ date: trip.startDate, label: `${app.employeeName(trip.employeeId)} travel to ${trip.destination}`, kind: "Travel" });
      }
      if (trip.voucherDueDate && !isVoucherSettled(trip) && trip.voucherDueDate >= app.today && trip.voucherDueDate <= horizon) {
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
  <WorkspaceHeader title="Today" section="Work" description={`${formatLongDate(app.today)} · Everything that needs your attention, most urgent first.`}>
    {#snippet actions()}
      <button type="button" onclick={() => (ui.quickNoteOpen = true)}>Quick Note</button>
      <button type="button" class="primary" onclick={() => (ui.quickAddOpen = true)}>Quick Add</button>
    {/snippet}
  </WorkspaceHeader>

  <div class="summary-cards today-summary">
    <button type="button" class="stat" class:alert={overdueCount > 0} aria-pressed={reasonFilter === "overdue"} onclick={() => toggleReasonFilter("overdue")}>
      <div class="num">{overdueCount}</div><div class="lbl">Overdue</div>
    </button>
    <button type="button" class="stat" class:warn={dueTodayCount > 0} aria-pressed={reasonFilter === "due_today"} onclick={() => toggleReasonFilter("due_today")}>
      <div class="num">{dueTodayCount}</div><div class="lbl">Due today</div>
    </button>
    <button type="button" class="stat" aria-pressed={reasonFilter === "due_soon"} onclick={() => toggleReasonFilter("due_soon")}>
      <div class="num">{dueSoonCount}</div><div class="lbl">Due soon</div>
    </button>
    <button type="button" class="stat" aria-pressed={reasonFilter === "waiting_too_long"} onclick={() => toggleReasonFilter("waiting_too_long")}>
      <div class="num">{waitingCount}</div><div class="lbl">Waiting too long</div>
    </button>
    <button type="button" class="stat" aria-pressed={reasonFilter === "training"} onclick={() => toggleReasonFilter("training")}>
      <div class="num">{trainingCount}</div><div class="lbl">Training warnings</div>
    </button>
  </div>

  <div class="toolbar record-toolbar today-toolbar">
  <div class="severity-filter" role="group" aria-label="Filter by severity">
    <span class="filter-label">Severity</span>
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
      <button type="button" class="link small clear-filters" onclick={() => { severityFilter = ""; reasonFilter = ""; }}>Clear filters</button>
    {/if}
  </div>
  <span class="spacer"></span>
  <div class="shortcuts" role="group" aria-label="Shortcuts">
    <span class="filter-label">Go to</span>
    <button type="button" class="link" onclick={() => ui.openNewTask()}>New task</button>
    <button type="button" class="link" onclick={() => (ui.performanceFormPrefill = {})}>Performance input</button>
    <button type="button" class="link" onclick={() => router.go("training")}>Training</button>
    <button type="button" class="link" onclick={() => router.go("leave")}>Leave</button>
    <button type="button" class="link" onclick={() => router.go("telework")}>Telework</button>
    <button type="button" class="link" onclick={() => router.go("meetings")}>Meeting notes</button>
  </div>
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
            <span class="group-chevron" aria-hidden="true"><Icon name="chevron" size={14} /></span>
            {group.title}
            <span class="group-count">{group.items.length}</span>
          </button>
        </h2>
        {#if !collapsedGroups[group.key]}
          <div class="table-scroll">
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
                    <button type="button" class="link cell-link" onclick={() => open(item)}>{item.title}</button>
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
          </div>
          {#if !showAll}
            <button type="button" class="show-all" onclick={() => (expandedGroups[group.key] = true)}>
              Show all {group.items.length} items
            </button>
          {/if}
        {/if}
      {/if}
    {/each}
  {/if}

  <section class="upcoming">
    <h2 class="section-heading">Next 14 days</h2>
    <p class="section-hint">Due dates, leave, training, telework, and meetings coming up.</p>
    {#if upcoming.length === 0}
      <EmptyState compact message="Nothing scheduled in the next two weeks." />
    {:else}
      <table class="data upcoming-table">
        <tbody>
          {#each upcoming as ev, i (i)}
            <tr>
              <td class="date-cell upcoming-date">{formatDate(ev.date)}</td>
              <td class="upcoming-kind"><span class="badge">{ev.kind}</span></td>
              <td>{ev.label}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </section>
</div>

<style>
  .today-summary {
    display: grid;
    grid-template-columns: repeat(5, minmax(8.5rem, 1fr));
    align-items: stretch;
  }
  .today-summary .stat {
    min-width: 0;
  }
  .today-toolbar {
    row-gap: .6rem;
  }
  .severity-filter,
  .shortcuts {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: .35rem;
  }
  .shortcuts {
    gap: .1rem .2rem;
  }
  .shortcuts button.link {
    font-size: .82rem;
  }
  .filter-label {
    color: var(--text-muted);
    font-size: .72rem;
    font-weight: 650;
    text-transform: uppercase;
    letter-spacing: .06em;
    margin-right: .25rem;
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
  .group-heading:first-of-type {
    margin-top: 0;
  }
  .upcoming {
    margin-top: 1.75rem;
  }
  .upcoming-date {
    width: 8rem;
  }
  .upcoming-kind {
    width: 7rem;
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
  @media (max-width: 1000px) {
    .today-summary { grid-template-columns: repeat(3, minmax(8.5rem, 1fr)); }
  }
  @media (max-width: 760px) {
    .today-summary { grid-template-columns: repeat(2, minmax(8.5rem, 1fr)); }
    .attention-table .reason-col { width: 12rem; }
    .attention-table .actions-col { width: 12rem; }
  }
</style>
