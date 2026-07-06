<script lang="ts">
  // Employee directory (plan 12.3).
  import { app } from "../stores/app.svelte";
  import { router } from "../app/router.svelte";
  import EmployeeForm from "../components/forms/EmployeeForm.svelte";
  import EmptyState from "../components/common/EmptyState.svelte";
  import { compareDates, formatDate } from "../utils/dates";
  import { toCsv } from "../utils/csv";
  import { downloadText, backupFilename } from "../utils/download";
  import { CLEARANCE_OPTIONS, COMPUTER_ASSET_OPTIONS, type Employee } from "../domain/models";

  const NO_COMPETENCY_FILTER = "__none";

  let search = $state("");
  let filterCompetency = $state("");
  let showInactive = $state(false);
  let formOpen = $state(false);
  let editing = $state<Employee | undefined>(undefined);

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
        return { e, openCount: open.length, overdueCount: overdue.length, trainingDueCount: trainingDue.length, lastInput, upcomingLeave };
      })
      .sort((a, b) => a.e.displayName.localeCompare(b.e.displayName))
  );

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
      rows.map((r) => [
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

<div class="page">
  <div class="page-header">
    <h1>Employees</h1>
    <span class="muted">{rows.length} shown</span>
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
          <th>Name</th><th>Competency</th><th>Title</th><th>IPT</th><th>Status</th><th>Open</th><th>Overdue</th>
          <th>Training due</th><th>Upcoming leave</th><th>Last input</th><th></th>
        </tr>
      </thead>
      <tbody>
        {#each rows as r (r.e.id)}
          <tr>
            <td><button type="button" class="link" onclick={() => router.go("employees", r.e.id)}>{r.e.displayName}</button></td>
            <td>{app.competencyCode(r.e.competencyId)}</td>
            <td>{r.e.positionTitle ?? ""}</td>
            <td>{r.e.team ?? ""}</td>
            <td>{r.e.activeStatus === "active" ? "Active" : r.e.activeStatus.replace("_", " ")}</td>
            <td>{r.openCount}</td>
            <td>{#if r.overdueCount}<span class="badge overdue">{r.overdueCount}</span>{:else}0{/if}</td>
            <td>{#if r.trainingDueCount}<span class="badge warning">{r.trainingDueCount}</span>{:else}0{/if}</td>
            <td>{r.upcomingLeave ? `${formatDate(r.upcomingLeave.startDate)} – ${formatDate(r.upcomingLeave.endDate)}` : ""}</td>
            <td>{formatDate(r.lastInput)}</td>
            <td>
              <button
                type="button"
                onclick={() => {
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
