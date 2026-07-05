<script lang="ts">
  // Today / Attention dashboard (plan section 12.1). Every row states why it
  // appears and offers snooze plus a relevant quick action.
  import { app } from "../stores/app.svelte";
  import { ui } from "../stores/ui.svelte";
  import { router } from "../app/router.svelte";
  import EmptyState from "../components/common/EmptyState.svelte";
  import type { AttentionItem } from "../domain/rules/attention";
  import { performanceInputPrefillFromTask } from "../domain/rules/performanceImport";
  import { addDays, daysBetween, formatDate } from "../utils/dates";

  let overdueCount = $derived(app.attention.filter((i) => i.reasonCode === "overdue").length);
  let dueTodayCount = $derived(app.attention.filter((i) => i.reasonCode === "due_today").length);
  let dueSoonCount = $derived(app.attention.filter((i) => i.reasonCode === "due_soon").length);
  let waitingCount = $derived(app.attention.filter((i) => i.reasonCode === "waiting_too_long").length);
  let trainingCount = $derived(app.attention.filter((i) => i.reasonCode.startsWith("training")).length);

  let taskItems = $derived(app.attention.filter((i) => i.entityType === "task"));
  let peopleItems = $derived(app.attention.filter((i) => i.entityType === "employee"));
  let otherItems = $derived(app.attention.filter((i) => !["task", "employee"].includes(i.entityType)));

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
    for (const note of app.meetingNotes) {
      if (!note.isArchived && note.meetingDate >= app.today && note.meetingDate <= horizon) {
        events.push({ date: note.meetingDate, label: note.title, kind: "Meeting" });
      }
    }
    return events.sort((a, b) => (a.date < b.date ? -1 : 1)).slice(0, 20);
  });

  function open(item: AttentionItem) {
    if (item.entityType === "task") ui.openTaskDetail(item.entityId);
    else if (item.entityType === "employee") router.go("employees", item.entityId);
    else if (item.entityType === "training") router.go("training");
    else if (item.entityType === "leave") router.go("leave");
    else if (item.entityType === "telework") router.go("telework");
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
    <div class="stat" class:alert={overdueCount > 0}><div class="num">{overdueCount}</div><div class="lbl">Overdue</div></div>
    <div class="stat" class:warn={dueTodayCount > 0}><div class="num">{dueTodayCount}</div><div class="lbl">Due today</div></div>
    <div class="stat"><div class="num">{dueSoonCount}</div><div class="lbl">Due soon</div></div>
    <div class="stat"><div class="num">{waitingCount}</div><div class="lbl">Waiting too long</div></div>
    <div class="stat"><div class="num">{trainingCount}</div><div class="lbl">Training warnings</div></div>
  </div>

  <div class="toolbar">
    <button type="button" class="primary" onclick={() => ui.openNewTask()}>New Task</button>
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
  {:else}
    {#each [{ title: "Tasks", items: taskItems }, { title: "Employees", items: peopleItems }, { title: "Training, leave, telework, and system", items: otherItems }] as group (group.title)}
      {#if group.items.length}
        <h2 style="margin-top:1rem">{group.title}</h2>
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
            {#each group.items as item (item.entityType + item.entityId + item.reasonCode)}
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
