<script lang="ts">
  // Employee directory (plan 12.3).
  import { app } from "../stores/app.svelte";
  import { router } from "../app/router.svelte";
  import EmployeeForm from "../components/forms/EmployeeForm.svelte";
  import Dialog from "../components/common/Dialog.svelte";
  import EmptyState from "../components/common/EmptyState.svelte";
  import Icon from "../components/common/Icon.svelte";
  import { compareDates, daysBetween, formatDate } from "../utils/dates";
  import { toCsv } from "../utils/csv";
  import { downloadText, backupFilename } from "../utils/download";
  import { CLEARANCE_OPTIONS, COMPUTER_ASSET_OPTIONS, type Employee } from "../domain/models";

  const NO_COMPETENCY_FILTER = "__none";
  const STALE_INPUT_DAYS = 30;

  type SortKey = "name" | "competency" | "open" | "overdue" | "training" | "lastInput";

  let search = $state("");
  let filterCompetency = $state("");
  let showInactive = $state(false);
  let formOpen = $state(false);
  let editing = $state<Employee | undefined>(undefined);
  let sortKey = $state<SortKey>("name");
  let sortAsc = $state(true);

  let rows = $derived(
    app.employees
      .filter((e) => {
        if (!showInactive && (e.activeStatus !== "active" || e.isArchived)) return false;
        if (filterCompetency === NO_COMPETENCY_FILTER && e.competencyId) return false;
        if (filterCompetency && filterCompetency !== NO_COMPETENCY_FILTER && e.competencyId !== filterCompetency) return false;
        if (search && !e.displayName.toLowerCase().includes(search.toLowerCase())) return false;
        return true;
      })
      .map((e) => {
        const open = app.tasks.filter(
          (t) => t.employeeId === e.id && !t.isArchived && t.status !== "complete" && t.status !== "cancelled"
        );
        const overdue = open.filter((t) => t.dueDate && compareDates(t.dueDate, app.today) < 0);
        const trainingDue = app.employeeTrainingRecords.filter((r) => {
          if (r.employeeId !== e.id || r.status === "not_applicable" || r.status === "waived") return false;
          const d = r.status === "complete" ? r.expirationDate : r.dueDate;
          return Boolean(d && compareDates(d, app.today) <= 0);
        });
        const inputs = app.performanceInputs.filter((p) => p.employeeId === e.id && !p.isArchived);
        const lastInput = inputs.map((p) => p.inputDate).sort().at(-1);
        // Prefer leave happening now; otherwise select the nearest future
        // absence. Array insertion order is not a scheduling rule.
        const upcomingLeave = app.leaveRecords
          .filter((l) => l.employeeId === e.id && !["cancelled", "complete"].includes(l.status) && compareDates(l.endDate, app.today) >= 0)
          .sort((a, b) => {
            const aNow = compareDates(a.startDate, app.today) <= 0;
            const bNow = compareDates(b.startDate, app.today) <= 0;
            if (aNow !== bNow) return aNow ? -1 : 1;
            return compareDates(a.startDate, b.startDate) || compareDates(a.endDate, b.endDate);
          })[0];
        const onLeaveNow = Boolean(upcomingLeave && compareDates(upcomingLeave.startDate, app.today) <= 0);
        const staleInput = !lastInput || daysBetween(lastInput, app.today) > STALE_INPUT_DAYS;
        return {
          e,
          openCount: open.length,
          overdueCount: overdue.length,
          trainingDueCount: trainingDue.length,
          lastInput,
          upcomingLeave,
          onLeaveNow,
          staleInput
        };
      })
  );

  let stats = $derived({
    overdue: rows.reduce((n, r) => n + r.overdueCount, 0),
    trainingDue: rows.reduce((n, r) => n + r.trainingDueCount, 0),
    staleInput: rows.filter((r) => r.staleInput).length,
    onLeave: rows.filter((r) => r.onLeaveNow).length
  });

  let sorted = $derived.by(() => {
    const dir = sortAsc ? 1 : -1;
    const cmp = (a: (typeof rows)[number], b: (typeof rows)[number]): number => {
      switch (sortKey) {
        case "competency":
          return app.competencyCode(a.e.competencyId).localeCompare(app.competencyCode(b.e.competencyId));
        case "open":
          return a.openCount - b.openCount;
        case "overdue":
          return a.overdueCount - b.overdueCount;
        case "training":
          return a.trainingDueCount - b.trainingDueCount;
        case "lastInput":
          return (a.lastInput ?? "").localeCompare(b.lastInput ?? "");
        default:
          return a.e.displayName.localeCompare(b.e.displayName);
      }
    };
    return [...rows].sort((a, b) => cmp(a, b) * dir || a.e.displayName.localeCompare(b.e.displayName));
  });

  function setSort(key: SortKey) {
    if (sortKey === key) {
      sortAsc = !sortAsc;
    } else {
      sortKey = key;
      // Numeric columns start with the biggest problems on top.
      sortAsc = key === "name" || key === "competency";
    }
  }

  function ariaSort(key: SortKey): "ascending" | "descending" | undefined {
    return sortKey === key ? (sortAsc ? "ascending" : "descending") : undefined;
  }

  function statusLabel(status: Employee["activeStatus"]): string {
    const text = status.replace(/_/g, " ");
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  function optionLabel(options: { value: string; label: string }[], value: string | undefined): string {
    if (!value) return "";
    return options.find((option) => option.value === value)?.label ?? value;
  }

  function yesNo(value: boolean | undefined): string {
    return value === undefined ? "" : value ? "Yes" : "No";
  }

  // CSV export with explicit column selection. The default is a minimal
  // operational dataset; administrative and sensitive personal fields must be
  // opted into per export and are never remembered.
  type ExportRow = (typeof rows)[number];
  interface ExportColumn {
    id: string;
    header: string;
    value: (r: ExportRow) => string | number | undefined;
  }
  interface ExportGroup {
    id: string;
    label: string;
    sensitive?: boolean;
    defaultOn: boolean;
    columns: ExportColumn[];
  }

  const EXPORT_GROUPS: ExportGroup[] = [
    {
      id: "operational",
      label: "Operational",
      defaultOn: true,
      columns: [
        { id: "name", header: "Employee", value: (r) => r.e.displayName },
        { id: "competency", header: "Competency", value: (r) => app.competencyCode(r.e.competencyId) },
        { id: "title", header: "Title", value: (r) => r.e.positionTitle },
        { id: "status", header: "Active status", value: (r) => r.e.activeStatus },
        { id: "ipt", header: "Integrated Product Team", value: (r) => r.e.team },
        { id: "open", header: "Open tasks", value: (r) => r.openCount },
        { id: "overdue", header: "Overdue tasks", value: (r) => r.overdueCount },
        { id: "training", header: "Training due", value: (r) => r.trainingDueCount },
        { id: "lastInput", header: "Last performance input", value: (r) => r.lastInput },
        { id: "lastCheckIn", header: "Last check-in", value: (r) => r.e.lastCheckInDate }
      ]
    },
    {
      id: "contact",
      label: "Contact and location",
      defaultOn: true,
      columns: [
        { id: "workEmail", header: "Work email", value: (r) => r.e.workEmail },
        { id: "workPhone", header: "Work phone", value: (r) => r.e.workPhone },
        { id: "workCell", header: "Work cell phone", value: (r) => r.e.workCellPhone },
        { id: "building", header: "Building", value: (r) => r.e.locationBuilding },
        { id: "cube", header: "Cube", value: (r) => r.e.locationCube },
        { id: "iptLead", header: "IPT Lead", value: (r) => r.e.iptLead },
        { id: "project", header: "Project", value: (r) => r.e.employeeProject },
        { id: "projectLead", header: "Project Lead", value: (r) => r.e.employeeProjectLead }
      ]
    },
    {
      id: "admin",
      label: "Administrative",
      defaultOn: false,
      columns: [
        { id: "series", header: "Series", value: (r) => r.e.series },
        { id: "asset", header: "Computer asset", value: (r) => optionLabel(COMPUTER_ASSET_OPTIONS, r.e.computerAsset) },
        { id: "govPhone", header: "Gov phone", value: (r) => yesNo(r.e.govPhone) },
        { id: "cswfCode", header: "CSWF code", value: (r) => r.e.cswfCode },
        { id: "cswfLevel", header: "CSWF level", value: (r) => r.e.cswfLevel },
        { id: "twAgreement", header: "Telework agreement valid through", value: (r) => r.e.teleworkAgreementValidThrough }
      ]
    },
    {
      id: "sensitive",
      label: "Sensitive personal information",
      sensitive: true,
      defaultOn: false,
      columns: [
        { id: "edipi", header: "EDIPI", value: (r) => r.e.edipi },
        { id: "pernr", header: "PERNR", value: (r) => r.e.pernr },
        { id: "personalPhone", header: "Personal cell phone", value: (r) => r.e.personalPhone },
        { id: "clearance", header: "Clearance", value: (r) => optionLabel(CLEARANCE_OPTIONS, r.e.clearance) },
        { id: "finStatement", header: "Financial statement required", value: (r) => yesNo(r.e.financialStatementRequired) },
        { id: "drugTest", header: "Drug test required", value: (r) => yesNo(r.e.drugTestRequired) }
      ]
    }
  ];

  let exportOpen = $state(false);
  let exportSelected = $state<Record<string, boolean>>({});

  function openExportDialog() {
    const selection: Record<string, boolean> = {};
    for (const group of EXPORT_GROUPS) {
      for (const col of group.columns) selection[col.id] = group.defaultOn;
    }
    exportSelected = selection;
    exportOpen = true;
  }

  function setGroup(group: ExportGroup, on: boolean) {
    for (const col of group.columns) exportSelected[col.id] = on;
  }

  function groupState(group: ExportGroup): "all" | "some" | "none" {
    const on = group.columns.filter((c) => exportSelected[c.id]).length;
    return on === group.columns.length ? "all" : on === 0 ? "none" : "some";
  }

  let selectedColumns = $derived(EXPORT_GROUPS.flatMap((g) => g.columns).filter((c) => exportSelected[c.id]));
  let sensitiveSelected = $derived(
    EXPORT_GROUPS.filter((g) => g.sensitive).some((g) => g.columns.some((c) => exportSelected[c.id]))
  );

  function exportCsv() {
    if (selectedColumns.length === 0) return;
    const csv = toCsv(
      selectedColumns.map((c) => c.header),
      sorted.map((r) => selectedColumns.map((c) => c.value(r)))
    );
    downloadText(backupFilename("RADAR_Employees", "csv"), csv, "text/csv");
    exportOpen = false;
  }
</script>

{#snippet sortHeader(key: SortKey, label: string)}
  <button type="button" class="th-sort" onclick={() => setSort(key)}>
    {label}<span class="sort-arrow" aria-hidden="true">{sortKey === key ? (sortAsc ? "▲" : "▼") : ""}</span>
  </button>
{/snippet}

{#snippet textOrDash(value: string | undefined)}
  {#if value}{value}{:else}<span class="muted">—</span>{/if}
{/snippet}

<div class="page">
  <div class="page-header">
    <h1>Employees</h1>
    <span class="muted">{rows.length} shown</span>
  </div>

  <div class="summary-cards">
    <div class="stat" class:alert={stats.overdue > 0}>
      <div class="num">{stats.overdue}</div>
      <div class="lbl">Overdue tasks</div>
    </div>
    <div class="stat" class:warn={stats.trainingDue > 0}>
      <div class="num">{stats.trainingDue}</div>
      <div class="lbl">Training due</div>
    </div>
    <div class="stat" class:warn={stats.staleInput > 0}>
      <div class="num">{stats.staleInput}</div>
      <div class="lbl">No input {STALE_INPUT_DAYS}+ days</div>
    </div>
    <div class="stat">
      <div class="num">{stats.onLeave}</div>
      <div class="lbl">On leave now</div>
    </div>
  </div>

  <div class="toolbar">
    <input type="search" placeholder="Search employees" bind:value={search} aria-label="Search employees" />
    <select bind:value={filterCompetency} aria-label="Filter by competency">
      <option value="">All competencies</option>
      <option value={NO_COMPETENCY_FILTER}>No competency</option>
      {#each app.competencyList as c (c.id)}<option value={c.id}>{c.code}</option>{/each}
    </select>
    <label style="display:flex; align-items:center; gap:.35rem; font-weight:400; margin:0">
      <input type="checkbox" bind:checked={showInactive} /> Show inactive
    </label>
    <span class="spacer"></span>
    <button type="button" onclick={openExportDialog}>Export CSV…</button>
    <button
      type="button"
      class="primary"
      onclick={() => {
        editing = undefined;
        formOpen = true;
      }}>Add Employee</button
    >
  </div>

  {#if rows.length === 0}
    <EmptyState message="No employees match." hint="Add an employee, or load sample data from Settings." />
  {:else}
    <!-- Wide table scrolls inside this container; the Name column and the
         header row stay pinned so rows remain identifiable. -->
    <div class="table-scroll">
    <table class="data employee-table">
      <thead>
        <tr>
          <th aria-sort={ariaSort("name")}>{@render sortHeader("name", "Name")}</th>
          <th aria-sort={ariaSort("competency")}>{@render sortHeader("competency", "Competency")}</th>
          <th>Title</th>
          <th>IPT</th>
          <th>Status</th>
          <th class="num" aria-sort={ariaSort("open")}>{@render sortHeader("open", "Open")}</th>
          <th class="num" aria-sort={ariaSort("overdue")}>{@render sortHeader("overdue", "Overdue")}</th>
          <th class="num" aria-sort={ariaSort("training")}>{@render sortHeader("training", "Training due")}</th>
          <th>Upcoming leave</th>
          <th aria-sort={ariaSort("lastInput")}>{@render sortHeader("lastInput", "Last input")}</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {#each sorted as r (r.e.id)}
          <!-- Row click is a mouse convenience; the name link is the keyboard path. -->
          <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_noninteractive_element_interactions -->
          <tr onclick={() => router.go("employees", r.e.id)}>
            <td>
              <button
                type="button"
                class="link cell-link"
                onclick={(ev) => {
                  ev.stopPropagation();
                  router.go("employees", r.e.id);
                }}>{r.e.displayName}</button
              >
            </td>
            <td>{@render textOrDash(app.competencyCode(r.e.competencyId))}</td>
            <td>{@render textOrDash(r.e.positionTitle)}</td>
            <td>{@render textOrDash(r.e.team)}</td>
            <td>
              <span class="badge" class:success={r.e.activeStatus === "active"}>{statusLabel(r.e.activeStatus)}</span>
            </td>
            <td class="num" class:muted={r.openCount === 0}>{r.openCount}</td>
            <td class="num" class:muted={r.overdueCount === 0}>
              {#if r.overdueCount}<span class="badge overdue">{r.overdueCount}</span>{:else}0{/if}
            </td>
            <td class="num" class:muted={r.trainingDueCount === 0}>
              {#if r.trainingDueCount}<span class="badge warning">{r.trainingDueCount}</span>{:else}0{/if}
            </td>
            <td>
              {#if r.upcomingLeave}
                {#if r.onLeaveNow}
                  <span class="badge warning">On leave</span>
                  <span class="small muted">until {formatDate(r.upcomingLeave.endDate)}</span>
                {:else}
                  {formatDate(r.upcomingLeave.startDate)} – {formatDate(r.upcomingLeave.endDate)}
                {/if}
              {:else}
                <span class="muted">—</span>
              {/if}
            </td>
            <td>
              {#if !r.lastInput}
                <span class="badge warning">None</span>
              {:else if r.staleInput}
                <span class="badge warning">{formatDate(r.lastInput)}</span>
              {:else}
                {formatDate(r.lastInput)}
              {/if}
            </td>
            <td>
              <button
                type="button"
                class="icon-btn"
                aria-label="Edit employee"
                title="Edit"
                onclick={(ev) => {
                  ev.stopPropagation();
                  editing = r.e;
                  formOpen = true;
                }}><Icon name="edit" size={16} /></button
              >
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
    </div>
  {/if}
</div>

{#if formOpen}
  <EmployeeForm employee={editing} onclose={() => (formOpen = false)} />
{/if}

{#if exportOpen}
  <Dialog title="Export employees (CSV)" onclose={() => (exportOpen = false)}>
    <p class="small muted" style="margin-top:0">
      Choose which columns to include. The export covers the {sorted.length} employee(s) currently shown.
      Sensitive fields are off by default and must be selected for each export.
    </p>
    {#each EXPORT_GROUPS as group (group.id)}
      <fieldset class="export-group" class:sensitive={group.sensitive}>
        <legend>
          <label class="group-toggle">
            <input
              type="checkbox"
              checked={groupState(group) === "all"}
              indeterminate={groupState(group) === "some"}
              onchange={(e) => setGroup(group, (e.currentTarget as HTMLInputElement).checked)}
            />
            {group.label}
          </label>
        </legend>
        <div class="export-columns">
          {#each group.columns as col (col.id)}
            <label class="col-toggle">
              <input type="checkbox" bind:checked={exportSelected[col.id]} />
              {col.header}
            </label>
          {/each}
        </div>
      </fieldset>
    {/each}
    {#if sensitiveSelected}
      <p class="field-error" role="alert">
        This export will include sensitive personal information (PII). Only export it when required, store the
        file in an approved location, and delete it when no longer needed.
      </p>
    {/if}
    <div style="display:flex; gap:.5rem; justify-content:flex-end; margin-top:1rem">
      <button type="button" onclick={() => (exportOpen = false)}>Cancel</button>
      <button type="button" class="primary" onclick={exportCsv} disabled={selectedColumns.length === 0}>
        Export {selectedColumns.length} column{selectedColumns.length === 1 ? "" : "s"}
      </button>
    </div>
  </Dialog>
{/if}

<style>
  th .th-sort {
    font: inherit;
    font-weight: inherit;
    letter-spacing: inherit;
    text-transform: inherit;
    color: inherit;
    background: none;
    border: none;
    box-shadow: none;
    padding: 0;
    min-height: 0;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
  }
  th .th-sort:hover {
    background: none;
    color: var(--text);
  }
  .sort-arrow {
    font-size: 0.55rem;
    min-width: 0.7rem;
  }
  th.num,
  td.num {
    text-align: right;
  }
  td.num {
    font-variant-numeric: tabular-nums;
  }
  tbody tr {
    cursor: pointer;
  }
  .table-scroll {
    overflow-x: auto;
    max-width: 100%;
  }
  .employee-table {
    min-width: 56rem;
  }
  .employee-table thead th {
    position: sticky;
    top: 0;
    background: var(--surface);
    z-index: 2;
  }
  .employee-table th:first-child,
  .employee-table td:first-child {
    position: sticky;
    left: 0;
    background: var(--surface);
    z-index: 1;
    box-shadow: 1px 0 0 var(--border);
  }
  .employee-table thead th:first-child {
    z-index: 3;
  }
  .export-group {
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: .4rem .7rem .6rem;
    margin: 0 0 .6rem;
  }
  .export-group.sensitive {
    border-color: color-mix(in srgb, var(--danger) 45%, var(--border));
  }
  .export-group legend {
    padding: 0 .3rem;
  }
  .group-toggle,
  .col-toggle {
    display: inline-flex;
    align-items: center;
    gap: .4rem;
    font-weight: 400;
    margin: 0;
  }
  .group-toggle {
    font-weight: 700;
  }
  .export-columns {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(13rem, 1fr));
    gap: .2rem .8rem;
  }
</style>
