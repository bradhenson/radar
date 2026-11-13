<script lang="ts">
  // Reports (plan section 32): read-only summaries that can be printed or
  // exported. Each one is built by a pure function in domain/rules/reports.ts
  // and drawn by the same markup, so they look and export alike.
  import { app } from "../stores/app.svelte";
  import { ui } from "../stores/ui.svelte";
  import WorkspaceHeader from "../components/common/WorkspaceHeader.svelte";
  import EmptyState from "../components/common/EmptyState.svelte";
  import { cycleLabel, sortedCycles } from "../domain/rules/evaluationCycles";
  import {
    AVAILABILITY_WEEK_OPTIONS,
    availabilityReport,
    payPeriodChoices,
    performanceWriteUpReport,
    reportHasTable,
    reportToCsv,
    reportToText,
    teleworkPayPeriodReport,
    trainingComplianceReport,
    workloadReport,
    type Report
  } from "../domain/rules/reports";
  import { payPeriodFor, payPeriodLabel } from "../domain/rules/telework";
  import { employeeWorkload } from "../domain/rules/workload";
  import { formatDate } from "../utils/dates";
  import { backupFilename, downloadText } from "../utils/download";

  type ReportKind = "availability" | "telework" | "training" | "workload" | "writeup";
  const KINDS: { value: ReportKind; label: string; file: string }[] = [
    { value: "availability", label: "Availability by week", file: "RADAR_Availability" },
    { value: "telework", label: "Telework by pay period", file: "RADAR_TeleworkPayPeriod" },
    { value: "training", label: "Training compliance", file: "RADAR_TrainingCompliance" },
    { value: "workload", label: "Workload by employee", file: "RADAR_Workload" },
    { value: "writeup", label: "Performance write-up", file: "RADAR_PerformanceWriteUp" }
  ];

  // Another page can ask for a specific report (Performance → Write-up). The
  // request is read once, so coming back to Reports later starts where it was left.
  const request = ui.reportRequest;
  ui.reportRequest = undefined;

  let kind = $state<ReportKind>(request?.kind ?? ui.reportView.kind);
  let weeks = $state<number>(ui.reportView.weeks);
  let periodStart = $state(payPeriodFor(app.today, app.settings.payPeriodAnchorDate).start);
  let employeeId = $state(request?.employeeId ?? ui.reportView.employeeId);
  let cycleId = $state(request?.cycleId ?? ui.reportView.cycleId);

  $effect(() => {
    ui.reportView = { kind, weeks, employeeId, cycleId };
  });

  let cycles = $derived(sortedCycles(app.evaluationCycles));
  let periods = $derived(payPeriodChoices(payPeriodFor(app.today, app.settings.payPeriodAnchorDate)));
  let currentPeriodStart = $derived(payPeriodFor(app.today, app.settings.payPeriodAnchorDate).start);

  let report = $derived.by<Report | undefined>(() => {
    if (kind === "availability") {
      return availabilityReport({
        today: app.today,
        weeks,
        leaveRecords: app.leaveRecords,
        travelRecords: app.travelRecords,
        teleworkRecords: app.teleworkRecords,
        employeeName: (id) => app.employeeName(id)
      });
    }
    if (kind === "telework") {
      return teleworkPayPeriodReport({
        today: app.today,
        period: periods.find((p) => p.start === periodStart) ?? payPeriodFor(app.today, app.settings.payPeriodAnchorDate),
        limit: Math.max(1, app.settings.teleworkDaysPerPayPeriod),
        teleworkRecords: app.teleworkRecords,
        employeeName: (id) => app.employeeName(id)
      });
    }
    if (kind === "training") {
      return trainingComplianceReport(
        app.trainingStatusList.map((row) => ({
          requirementId: row.requirement.id,
          requirementName: row.requirement.name,
          employeeName: row.employee.displayName,
          state: row.status.state,
          dueDate: row.status.dueDate
        })),
        app.today
      );
    }
    if (kind === "workload") {
      const trainingActionCounts = new Map<string, number>();
      for (const row of app.trainingStatusList) {
        if (row.status.needsAction) trainingActionCounts.set(row.employee.id, (trainingActionCounts.get(row.employee.id) ?? 0) + 1);
      }
      return workloadReport(
        employeeWorkload({
          today: app.today,
          dueSoonDays: app.settings.dueSoonDays,
          employees: app.employees,
          tasks: app.tasks,
          performanceInputs: app.performanceInputs,
          interactions: app.employeeInteractions,
          trainingActionCounts
        }),
        app.today
      );
    }
    if (!employeeId || !app.employees.some((e) => e.id === employeeId)) return undefined;
    return performanceWriteUpReport({
      today: app.today,
      employeeName: app.employeeName(employeeId),
      cycle: cycles.find((c) => c.id === cycleId),
      inputs: app.performanceInputs.filter((p) => p.employeeId === employeeId),
      elements: app.performanceElements,
      projectName: (id) => (id ? app.projectName(id) : "")
    });
  });

  function fileBase(): string {
    return KINDS.find((k) => k.value === kind)?.file ?? "RADAR_Report";
  }

  async function exportCsv() {
    if (!report) return;
    try {
      await downloadText(backupFilename(fileBase(), "csv"), reportToCsv(report), "text/csv");
    } catch {
      app.toast("Report export failed", "error");
    }
  }

  async function exportText() {
    if (!report) return;
    try {
      await downloadText(backupFilename(fileBase(), "txt"), reportToText(report), "text/plain");
    } catch {
      app.toast("Report export failed", "error");
    }
  }

  async function copyText() {
    if (!report) return;
    try {
      await navigator.clipboard.writeText(reportToText(report));
      app.toast("Report copied", "success");
    } catch {
      app.toast("Copy is not available here. Use Export text instead.", "error");
    }
  }

  function printReport() {
    window.print();
  }
</script>

<div class="page reports-page">
  <div class="no-print">
    <WorkspaceHeader title="Reports" section="System">
      {#snippet actions()}
        <button type="button" onclick={() => void copyText()} disabled={!report}>Copy text</button>
        <button type="button" onclick={() => void exportText()} disabled={!report}>Export text</button>
        <button type="button" onclick={() => void exportCsv()} disabled={!report || !reportHasTable(report)}>Export CSV</button>
        <button type="button" class="primary" onclick={printReport} disabled={!report}>Print</button>
      {/snippet}
    </WorkspaceHeader>
  </div>

  <div class="toolbar record-toolbar">
    <select bind:value={kind} aria-label="Report">
      {#each KINDS as k (k.value)}<option value={k.value}>{k.label}</option>{/each}
    </select>
    {#if kind === "availability"}
      <select bind:value={weeks} aria-label="Weeks to show">
        {#each AVAILABILITY_WEEK_OPTIONS as n (n)}<option value={n}>{n} weeks</option>{/each}
      </select>
    {:else if kind === "telework"}
      <select bind:value={periodStart} aria-label="Pay period">
        {#each periods as p (p.start)}
          <option value={p.start}>{payPeriodLabel(p)}{p.start === currentPeriodStart ? " (this pay period)" : ""}</option>
        {/each}
      </select>
    {:else if kind === "writeup"}
      <select bind:value={employeeId} aria-label="Employee">
        <option value="">(choose an employee)</option>
        {#each app.activeEmployees as e (e.id)}<option value={e.id}>{e.displayName}</option>{/each}
      </select>
      <select bind:value={cycleId} aria-label="Evaluation cycle">
        <option value="">All dates</option>
        {#each cycles as c (c.id)}<option value={c.id}>{cycleLabel(c)}</option>{/each}
      </select>
    {/if}
  </div>

  {#if !report}
    <EmptyState message="Choose an employee." hint="The write-up gathers one person's performance inputs for a cycle, grouped by performance element." />
  {:else}
    <article class="report" aria-label={report.title}>
      <header class="report-head">
        <h2>{report.title}</h2>
        <p class="report-subtitle">{report.subtitle}</p>
        <p class="report-generated">Generated {formatDate(report.generated)}</p>
      </header>
      {#each report.sections as section, i (i)}
        <section class="report-section">
          {#if section.heading}<h3>{section.heading}</h3>{/if}
          {#if section.note}<p class="report-note">{section.note}</p>{/if}
          {#each section.paragraphs ?? [] as paragraph, j (j)}
            <div class="report-paragraph">
              {#if paragraph.label}<div class="report-label">{paragraph.label}</div>{/if}
              <p>{paragraph.text}</p>
            </div>
          {/each}
          {#if section.table}
            {#if section.table.rows.length === 0}
              <p class="report-empty">{section.table.emptyText}</p>
            {:else}
              <!-- Keyboard focus lets the arrow keys scroll wide tables. -->
              <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
              <div class="table-scroll" role="region" aria-label={section.heading ?? report.title} tabindex="0">
                <table class="data report-table">
                  <thead>
                    <tr>
                      {#each section.table.columns as column (column.key)}
                        <th class:numeric={column.numeric} scope="col">{column.label}</th>
                      {/each}
                    </tr>
                  </thead>
                  <tbody>
                    {#each section.table.rows as row, r (r)}
                      <tr>
                        {#each section.table.columns as column (column.key)}
                          <td class:numeric={column.numeric}>{row[column.key] === "" || row[column.key] === undefined ? "—" : row[column.key]}</td>
                        {/each}
                      </tr>
                    {/each}
                  </tbody>
                </table>
              </div>
            {/if}
          {/if}
        </section>
      {/each}
    </article>
  {/if}
</div>

<style>
  .report-head h2 {
    margin: 0;
    font-size: 1.25rem;
  }
  .report-subtitle {
    margin: .2rem 0 0;
    font-weight: 600;
  }
  .report-generated {
    margin: .15rem 0 0;
    color: var(--text-muted);
    font-size: .82rem;
  }
  .report-section {
    margin-top: 1.1rem;
  }
  .report-section h3 {
    margin: 0 0 .4rem;
    font-size: 1rem;
  }
  .report-note {
    margin: 0 0 .5rem;
    color: var(--text-muted);
    font-size: .82rem;
  }
  .report-empty {
    color: var(--text-muted);
  }
  .report-paragraph {
    margin: 0 0 .8rem;
    max-width: 62rem;
  }
  .report-paragraph p {
    margin: 0;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .report-label {
    font-weight: 700;
    font-size: .85rem;
    margin-bottom: .15rem;
  }
  .report-table td {
    vertical-align: top;
  }
  .report-table th.numeric,
  .report-table td.numeric {
    text-align: right;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  @media print {
    .reports-page {
      padding: 0;
      max-width: none;
    }
    .report-section {
      break-inside: auto;
    }
    .report-paragraph,
    .report-table tr {
      break-inside: avoid;
    }
    .report-table {
      font-size: 9.5pt;
    }
    /* Paper has no need of touch-sized rows. */
    .report-table th,
    .report-table td {
      padding: .2rem .45rem;
    }
  }
</style>
