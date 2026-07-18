<script lang="ts">
  // Reports (plan 32): interactive review views — supervisor/employee workload
  // and availability. Informational only; never an employee ranking.
  import { app } from "../stores/app.svelte";
  import { router } from "../app/router.svelte";
  import EmptyState from "../components/common/EmptyState.svelte";
  import {
    absenceEntries,
    absencesOn,
    availabilityByWeek,
    employeeWorkload,
    supervisorWorkload
  } from "../domain/rules/workload";
  import { daysBetween, formatDate } from "../utils/dates";
  import { toCsv } from "../utils/csv";
  import { backupFilename, downloadText } from "../utils/download";

  type Tab = "workload" | "availability";
  let tab = $state<Tab>("workload");

  const AVAILABILITY_WEEKS = 4;

  let summary = $derived(supervisorWorkload(app.tasks, app.today));

  let trainingActionCounts = $derived.by(() => {
    const counts = new Map<string, number>();
    for (const row of app.trainingStatusList) {
      if (!row.status.needsAction) continue;
      counts.set(row.employee.id, (counts.get(row.employee.id) ?? 0) + 1);
    }
    return counts;
  });

  let workloadRows = $derived(
    employeeWorkload({
      today: app.today,
      dueSoonDays: app.settings.dueSoonDays,
      employees: app.employees,
      tasks: app.tasks,
      performanceInputs: app.performanceInputs,
      interactions: app.employeeInteractions,
      trainingActionCounts
    })
  );

  let absences = $derived(absenceEntries(app.leaveRecords, app.travelRecords));
  let outToday = $derived(absencesOn(absences, app.today));
  let weeks = $derived(availabilityByWeek(absences, app.today, AVAILABILITY_WEEKS));

  function inputAge(date: string | undefined): number | undefined {
    return date ? daysBetween(date, app.today) : undefined;
  }

  async function exportWorkloadCsv() {
    const csv = toCsv(
      ["Employee", "Open tasks", "Overdue", "Waiting", `Due in ${app.settings.dueSoonDays} days`, "Projects", "Training actions", "Last performance input", "Last check-in"],
      workloadRows.map((row) => [
        row.employee.displayName,
        String(row.openCount),
        String(row.overdueCount),
        String(row.waitingCount),
        String(row.dueSoonCount),
        String(row.projectCount),
        String(row.trainingActionCount),
        row.lastInputDate ?? "",
        row.lastCheckInDate ?? ""
      ])
    );
    try {
      await downloadText(backupFilename("RADAR_Workload", "csv"), csv, "text/csv");
    } catch {
      app.toast("Workload export failed", "error");
    }
  }
</script>

<div class="page">
  <div class="page-header">
    <h1>Reports</h1>
    <span class="spacer"></span>
    {#if tab === "workload"}
      <button type="button" class="no-print" onclick={exportWorkloadCsv} disabled={workloadRows.length === 0}>Export CSV</button>
    {/if}
    <button type="button" class="no-print" onclick={() => window.print()}>Print</button>
  </div>

  <div class="view-tabs no-print" aria-label="Report">
    <button type="button" class:active={tab === "workload"} aria-pressed={tab === "workload"} onclick={() => (tab = "workload")}>Workload</button>
    <button type="button" class:active={tab === "availability"} aria-pressed={tab === "availability"} onclick={() => (tab = "availability")}>Availability</button>
  </div>

  {#if tab === "workload"}
    <div class="summary-cards">
      <div class="stat"><div class="num">{summary.open}</div><div class="lbl">Open tasks</div></div>
      <div class="stat" class:alert={summary.overdue > 0}><div class="num">{summary.overdue}</div><div class="lbl">Overdue</div></div>
      <div class="stat"><div class="num">{summary.waiting}</div><div class="lbl">Waiting</div></div>
      <div class="stat"><div class="num">{summary.dueIn7}</div><div class="lbl">Due in 7 days</div></div>
      <div class="stat"><div class="num">{summary.dueIn30}</div><div class="lbl">Due in 30 days</div></div>
      <div class="stat"><div class="num">{summary.unassigned}</div><div class="lbl">Unassigned</div></div>
    </div>

    {#if workloadRows.length === 0}
      <EmptyState message="No active employees." hint="Add employees to see per-person workload." />
    {:else}
      <div class="table-wrap">
        <table class="data workload-table">
          <thead>
            <tr>
              <th>Employee</th><th>Open</th><th>Overdue</th><th>Waiting</th><th>Due {app.settings.dueSoonDays}d</th>
              <th>Projects</th><th>Training actions</th><th>Last input</th><th>Last check-in</th>
            </tr>
          </thead>
          <tbody>
            {#each workloadRows as row (row.employee.id)}
              {@const age = inputAge(row.lastInputDate)}
              <tr>
                <td>
                  <button type="button" class="link cell-link" onclick={() => router.go("employees", row.employee.id)}>
                    {row.employee.displayName}
                  </button>
                </td>
                <td>{row.openCount}</td>
                <td>{#if row.overdueCount}<span class="badge overdue">{row.overdueCount}</span>{:else}0{/if}</td>
                <td>{row.waitingCount}</td>
                <td>{row.dueSoonCount}</td>
                <td>{row.projectCount}</td>
                <td>{#if row.trainingActionCount}<span class="badge warning">{row.trainingActionCount}</span>{:else}0{/if}</td>
                <td class="date-cell">
                  {#if row.lastInputDate}
                    {formatDate(row.lastInputDate)}
                    {#if age !== undefined && age >= app.settings.performanceInputReminderDays}
                      <span class="badge warning">{age}d</span>
                    {/if}
                  {:else}<span class="badge warning">none</span>{/if}
                </td>
                <td class="date-cell">{#if row.lastCheckInDate}{formatDate(row.lastCheckInDate)}{:else}<span class="badge warning">none</span>{/if}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      <p class="small muted">Workload counts describe assignments and coverage, not employee performance.</p>
    {/if}
  {:else}
    <section class="out-today">
      <h2>Out today</h2>
      {#if outToday.length === 0}
        <p class="muted">Everyone is available today.</p>
      {:else}
        <ul class="out-list">
          {#each outToday as entry (entry.kind + entry.employeeId + entry.startDate)}
            <li>
              <span class="badge" class:travel-badge={entry.kind === "travel"}>{entry.kind === "travel" ? "Travel" : "Leave"}</span>
              <strong>{app.employeeName(entry.employeeId)}</strong>
              <span class="muted">
                {formatDate(entry.startDate)} – {formatDate(entry.endDate)}{entry.detail ? ` · ${entry.detail}` : ""}
              </span>
            </li>
          {/each}
        </ul>
      {/if}
    </section>

    {#each weeks as week (week.weekStart)}
      <section class="week-section">
        <h2>Week of {formatDate(week.weekStart)}</h2>
        {#if week.entries.length === 0}
          <p class="muted">No leave or travel.</p>
        {:else}
          <div class="table-wrap">
            <table class="data">
              <thead><tr><th>Employee</th><th>Type</th><th>Dates</th><th>Detail</th></tr></thead>
              <tbody>
                {#each week.entries as entry (entry.kind + entry.employeeId + entry.startDate + entry.endDate)}
                  <tr>
                    <td>{app.employeeName(entry.employeeId)}</td>
                    <td><span class="badge" class:travel-badge={entry.kind === "travel"}>{entry.kind === "travel" ? "Travel" : "Leave"}</span></td>
                    <td class="date-cell">{formatDate(entry.startDate)} – {formatDate(entry.endDate)}</td>
                    <td>{entry.detail ?? ""}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/if}
      </section>
    {/each}
  {/if}
</div>

<style>
  .view-tabs { display: inline-flex; gap: .25rem; padding: .25rem; margin-bottom: .8rem; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); }
  .view-tabs button { min-height: 1.9rem; border: 0; background: transparent; color: var(--text-muted); }
  .view-tabs button.active { background: var(--accent-soft); color: var(--accent); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 35%, transparent); }
  .table-wrap { overflow-x: auto; }
  .date-cell { white-space: nowrap; }
  .workload-table th { white-space: nowrap; }
  .out-today { margin-bottom: 1.2rem; }
  .out-list { display: grid; gap: .35rem; margin: .4rem 0 0; padding: 0; list-style: none; }
  .out-list li { display: flex; align-items: baseline; gap: .5rem; }
  .travel-badge { background: var(--accent-soft); color: var(--accent); border-color: transparent; }
  .week-section { margin-bottom: 1.2rem; }
  .week-section h2 { margin-bottom: .4rem; }
</style>
