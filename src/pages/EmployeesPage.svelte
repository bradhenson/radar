<script lang="ts">
  // Employee directory (plan 12.3).
  import { app } from "../stores/app.svelte";
  import { router } from "../app/router.svelte";
  import EmployeeForm from "../components/forms/EmployeeForm.svelte";
  import EmptyState from "../components/common/EmptyState.svelte";
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
        const upcomingLeave = app.leaveRecords.find(
          (l) => l.employeeId === e.id && !["cancelled", "complete"].includes(l.status) && compareDates(l.endDate, app.today) >= 0
        );
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

  function exportCsv() {
    const csv = toCsv(
      [
        "Employee",
        "Competency",
        "Title",
        "Active status",
        "Integrated Product Team",
        "IPT Lead",
        "Project",
        "Project Lead",
        "Building",
        "Cube",
        "Work email",
        "Work phone",
        "Work cell phone",
        "Personal cell phone",
        "EDIPI",
        "PERNR",
        "Series",
        "Computer asset",
        "Gov phone",
        "CSWF code",
        "CSWF level",
        "Financial statement required",
        "Drug test required",
        "Telework agreement valid through",
        "Clearance",
        "Open tasks",
        "Overdue tasks",
        "Training due",
        "Last performance input",
        "Last check-in"
      ],
      sorted.map((r) => [
        r.e.displayName,
        app.competencyCode(r.e.competencyId),
        r.e.positionTitle,
        r.e.activeStatus,
        r.e.team,
        r.e.iptLead,
        r.e.employeeProject,
        r.e.employeeProjectLead,
        r.e.locationBuilding,
        r.e.locationCube,
        r.e.workEmail,
        r.e.workPhone,
        r.e.workCellPhone,
        r.e.personalPhone,
        r.e.edipi,
        r.e.pernr,
        r.e.series,
        optionLabel(COMPUTER_ASSET_OPTIONS, r.e.computerAsset),
        yesNo(r.e.govPhone),
        r.e.cswfCode,
        r.e.cswfLevel,
        yesNo(r.e.financialStatementRequired),
        yesNo(r.e.drugTestRequired),
        r.e.teleworkAgreementValidThrough,
        optionLabel(CLEARANCE_OPTIONS, r.e.clearance),
        r.openCount,
        r.overdueCount,
        r.trainingDueCount,
        r.lastInput,
        r.e.lastCheckInDate
      ])
    );
    downloadText(backupFilename("RADAR_Employees", "csv"), csv, "text/csv");
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
    <button type="button" onclick={exportCsv}>Export CSV</button>
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
    <table class="data">
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
                onclick={(ev) => {
                  ev.stopPropagation();
                  editing = r.e;
                  formOpen = true;
                }}>Edit</button
              >
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</div>

{#if formOpen}
  <EmployeeForm employee={editing} onclose={() => (formOpen = false)} />
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
</style>
