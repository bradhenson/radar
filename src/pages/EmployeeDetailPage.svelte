<script lang="ts">
  // Employee 360 profile (plan 12.4): aggregates tasks, performance, training,
  // leave, telework, awards, and interactions for one employee.
  import { app } from "../stores/app.svelte";
  import { ui } from "../stores/ui.svelte";
  import { router } from "../app/router.svelte";
  import EmployeeForm from "../components/forms/EmployeeForm.svelte";
  import Dialog from "../components/common/Dialog.svelte";
  import EmptyState from "../components/common/EmptyState.svelte";
  import { INTERACTION_TYPES, statusLabel } from "../domain/models";
  import { compareDates, formatDate, formatTimestamp, nowTimestamp, todayIso } from "../utils/dates";
  import { newId } from "../utils/ids";

  let { employeeId }: { employeeId: string } = $props();

  let employee = $derived(app.employees.find((e) => e.id === employeeId));
  let tab = $state<"overview" | "tasks" | "performance" | "training" | "leave" | "telework" | "awards" | "activity">("overview");
  let editOpen = $state(false);
  let checkInOpen = $state(false);
  let checkInType = $state(INTERACTION_TYPES[1] ?? "Informal check-in");
  let checkInSummary = $state("");
  let checkInFollowUp = $state(false);

  let tasks = $derived(app.tasks.filter((t) => t.employeeId === employeeId && !t.isArchived));
  let openTasks = $derived(tasks.filter((t) => t.status !== "complete" && t.status !== "cancelled"));
  let overdueTasks = $derived(openTasks.filter((t) => t.dueDate && compareDates(t.dueDate, app.today) < 0));
  let inputs = $derived(
    app.performanceInputs.filter((p) => p.employeeId === employeeId && !p.isArchived).sort((a, b) => (a.inputDate < b.inputDate ? 1 : -1))
  );
  let training = $derived(app.employeeTrainingRecords.filter((r) => r.employeeId === employeeId));
  let leave = $derived(
    app.leaveRecords.filter((l) => l.employeeId === employeeId).sort((a, b) => (a.startDate < b.startDate ? 1 : -1))
  );
  let telework = $derived(app.teleworkRecords.filter((t) => t.employeeId === employeeId));
  let awards = $derived(app.awardRecords.filter((a) => a.employeeId === employeeId));
  let interactions = $derived(
    app.employeeInteractions.filter((i) => i.employeeId === employeeId).sort((a, b) => (a.interactionDate < b.interactionDate ? 1 : -1))
  );
  let activity = $derived(
    app.activityEntries
      .filter((a) => (a.entityType === "employees" && a.entityId === employeeId) || tasks.some((t) => t.id === a.entityId))
      .sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1))
      .slice(0, 30)
  );

  async function saveCheckIn() {
    if (!employee) return;
    const now = nowTimestamp();
    await app.putRecord(
      "employeeInteractions",
      {
        id: newId(),
        employeeId,
        interactionDate: todayIso(),
        interactionType: checkInType,
        summary: checkInSummary.trim() || undefined,
        followUpRequired: checkInFollowUp,
        createdAt: now,
        updatedAt: now
      },
      { actionType: "created", summary: `Recorded ${checkInType} with ${employee.displayName}` }
    );
    await app.putRecord("employees", { ...employee, lastCheckInDate: todayIso(), updatedAt: now });
    checkInOpen = false;
    checkInSummary = "";
    checkInFollowUp = false;
    app.toast("Check-in recorded", "success");
  }

  const TABS = [
    ["overview", "Overview"],
    ["tasks", "Tasks"],
    ["performance", "Performance"],
    ["training", "Training"],
    ["leave", "Leave"],
    ["telework", "Telework"],
    ["awards", "Awards"],
    ["activity", "Activity"]
  ] as const;
</script>

{#if !employee}
  <div class="page">
    <EmptyState message="Employee not found." />
    <button type="button" onclick={() => router.go("employees")}>Back to directory</button>
  </div>
{:else}
  <div class="page">
    <div class="page-header">
      <h1>{employee.displayName}</h1>
      <span class="badge">{app.competencyCode(employee.competencyId)}</span>
      {#if employee.positionTitle}<span class="muted">{employee.positionTitle}</span>{/if}
      {#if employee.activeStatus !== "active"}<span class="badge warning">{employee.activeStatus.replace("_", " ")}</span>{/if}
      <span class="spacer" style="flex:1"></span>
      <button type="button" onclick={() => (checkInOpen = true)}>Record check-in</button>
      <button type="button" onclick={() => ui.openNewTask({ employeeId, competencyId: employee.competencyId })}>Add task</button>
      <button type="button" onclick={() => (ui.performanceFormPrefill = { employeeId })}>Add performance input</button>
      <button type="button" onclick={() => (editOpen = true)}>Edit</button>
    </div>

    <div class="summary-cards">
      <div class="stat"><div class="num">{openTasks.length}</div><div class="lbl">Open tasks</div></div>
      <div class="stat" class:alert={overdueTasks.length > 0}><div class="num">{overdueTasks.length}</div><div class="lbl">Overdue</div></div>
      <div class="stat"><div class="num">{inputs.length}</div><div class="lbl">Perf. inputs</div></div>
      <div class="stat"><div class="num">{formatDate(employee.lastCheckInDate) || "—"}</div><div class="lbl">Last check-in</div></div>
    </div>

    <nav class="tabs" aria-label="Employee sections">
      {#each TABS as [value, label] (value)}
        <button type="button" class:active={tab === value} onclick={() => (tab = value)}>{label}</button>
      {/each}
    </nav>

    {#if tab === "overview"}
      <h2>Open work</h2>
      {#if openTasks.length === 0}
        <p class="muted">No open tasks.</p>
      {:else}
        <table class="data">
          <tbody>
            {#each openTasks.sort((a, b) => (a.dueDate ?? "9999") < (b.dueDate ?? "9999") ? -1 : 1) as t (t.id)}
              <tr>
                <td><button type="button" class="link" onclick={() => ui.openTaskDetail(t.id)}>{t.title}</button></td>
                <td>{statusLabel(t.status)}</td>
                <td>{formatDate(t.dueDate)}</td>
                <td>{app.projectName(t.projectId)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
      <h2 style="margin-top:1rem">Recent accomplishments</h2>
      {#if inputs.length === 0}
        <p class="muted">No performance inputs recorded yet.</p>
      {:else}
        {#each inputs.slice(0, 3) as p (p.id)}
          <div class="card" style="margin-bottom:.5rem">
            <div class="small muted">{formatDate(p.inputDate)}</div>
            <div>{p.actionOrAccomplishment}</div>
            {#if p.impact}<div class="small muted">Impact: {p.impact}</div>{/if}
          </div>
        {/each}
      {/if}
      <h2 style="margin-top:1rem">Recent check-ins</h2>
      {#if interactions.length === 0}
        <p class="muted">No interactions recorded.</p>
      {:else}
        <ul>
          {#each interactions.slice(0, 5) as i (i.id)}
            <li><strong>{formatDate(i.interactionDate)}</strong> — {i.interactionType}{i.summary ? `: ${i.summary}` : ""}</li>
          {/each}
        </ul>
      {/if}
    {:else if tab === "tasks"}
      {#if tasks.length === 0}
        <EmptyState message="No tasks for this employee." hint="Use Add task above." />
      {:else}
        <table class="data">
          <thead><tr><th>Task</th><th>Status</th><th>Priority</th><th>Due</th><th>Project</th></tr></thead>
          <tbody>
            {#each tasks as t (t.id)}
              <tr>
                <td><button type="button" class="link" onclick={() => ui.openTaskDetail(t.id)}>{t.title}</button></td>
                <td>{statusLabel(t.status)}</td>
                <td>{t.priority}</td>
                <td>{formatDate(t.dueDate)}</td>
                <td>{app.projectName(t.projectId)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
    {:else if tab === "performance"}
      {#if inputs.length === 0}
        <EmptyState message="No performance inputs." hint="Capture accomplishments as they happen so evaluations do not depend on memory." />
      {:else}
        {#each inputs as p (p.id)}
          <div class="card" style="margin-bottom:.6rem">
            <div class="small muted">
              {formatDate(p.inputDate)} · {p.inputStatus}
              {#if p.projectId}· {app.projectName(p.projectId)}{/if}
              {#if p.recognitionPotential}· <span class="badge success">Recognition potential</span>{/if}
            </div>
            {#if p.situationOrContext}<div><strong>Context:</strong> {p.situationOrContext}</div>{/if}
            <div><strong>Action:</strong> {p.actionOrAccomplishment}</div>
            {#if p.result}<div><strong>Result:</strong> {p.result}</div>{/if}
            {#if p.impact}<div><strong>Impact:</strong> {p.impact}</div>{/if}
          </div>
        {/each}
      {/if}
    {:else if tab === "training"}
      {#if training.length === 0}
        <EmptyState message="No training records." hint="Assign requirements from the Training page." />
      {:else}
        <table class="data">
          <thead><tr><th>Requirement</th><th>Status</th><th>Due</th><th>Completed</th><th>Expires</th><th>Verified</th></tr></thead>
          <tbody>
            {#each training as r (r.id)}
              <tr>
                <td>{app.trainingRequirements.find((q) => q.id === r.trainingRequirementId)?.name ?? "(unknown)"}</td>
                <td>{r.status}</td>
                <td>{formatDate(r.dueDate)}</td>
                <td>{formatDate(r.completedDate)}</td>
                <td>{formatDate(r.expirationDate)}</td>
                <td>{formatDate(r.lastVerifiedDate)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
    {:else if tab === "leave"}
      {#if leave.length === 0}
        <EmptyState message="No leave records." />
      {:else}
        <table class="data">
          <thead><tr><th>Start</th><th>End</th><th>Type</th><th>Status</th><th>Note</th></tr></thead>
          <tbody>
            {#each leave as l (l.id)}
              <tr>
                <td>{formatDate(l.startDate)}</td><td>{formatDate(l.endDate)}</td>
                <td>{l.leaveType ?? ""}</td><td>{l.status}</td><td>{l.workloadImpactNote ?? ""}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
    {:else if tab === "telework"}
      {#if telework.length === 0}
        <EmptyState message="No telework records." />
      {:else}
        <table class="data">
          <thead><tr><th>Type</th><th>Status</th><th>Effective</th><th>Expires</th><th>Schedule</th></tr></thead>
          <tbody>
            {#each telework as t (t.id)}
              <tr>
                <td>{t.recordType}</td><td>{t.status.replace(/_/g, " ")}</td>
                <td>{formatDate(t.effectiveDate)}</td><td>{formatDate(t.expirationDate)}</td>
                <td>{t.scheduleSummary ?? ""}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
    {:else if tab === "awards"}
      {#if awards.length === 0}
        <EmptyState message="No award records." hint="Track nominations from the Awards page." />
      {:else}
        <table class="data">
          <thead><tr><th>Title</th><th>Status</th><th>Nomination due</th><th>Submitted</th></tr></thead>
          <tbody>
            {#each awards as a (a.id)}
              <tr><td>{a.title}</td><td>{a.status}</td><td>{formatDate(a.nominationDueDate)}</td><td>{formatDate(a.submittedDate)}</td></tr>
            {/each}
          </tbody>
        </table>
      {/if}
    {:else if tab === "activity"}
      {#if activity.length === 0}
        <EmptyState message="No recorded activity yet." />
      {:else}
        <ul class="activity-list">
          {#each activity as a (a.id)}
            <li><span class="muted small">{formatTimestamp(a.timestamp)}</span> — {a.summary}</li>
          {/each}
        </ul>
      {/if}
    {/if}
  </div>

  {#if editOpen}
    <EmployeeForm {employee} onclose={() => (editOpen = false)} />
  {/if}
  {#if checkInOpen}
    <Dialog title="Record check-in" onclose={() => (checkInOpen = false)}>
      <label for="ci-type">Interaction type</label>
      <select id="ci-type" bind:value={checkInType} style="width:100%">
        {#each INTERACTION_TYPES as t (t)}<option value={t}>{t}</option>{/each}
      </select>
      <label for="ci-summary">Summary <span class="field-hint">objective, work-related</span></label>
      <textarea id="ci-summary" bind:value={checkInSummary} rows="3" maxlength="10000" style="width:100%"></textarea>
      <label style="display:flex; align-items:center; gap:.4rem; font-weight:400">
        <input type="checkbox" bind:checked={checkInFollowUp} /> Follow-up required
      </label>
      <div style="display:flex; gap:.5rem; justify-content:flex-end; margin-top:1rem;">
        <button type="button" onclick={() => (checkInOpen = false)}>Cancel</button>
        <button type="button" class="primary" onclick={() => void saveCheckIn()}>Save</button>
      </div>
    </Dialog>
  {/if}
{/if}

<style>
  .tabs { display: flex; gap: .25rem; flex-wrap: wrap; margin-bottom: 1rem; border-bottom: 1px solid var(--border); }
  .tabs button { border: none; background: none; border-bottom: 2px solid transparent; border-radius: 0; padding: .4rem .7rem; }
  .tabs button.active { border-bottom-color: var(--accent); font-weight: 700; color: var(--accent); }
  .activity-list { list-style: none; padding: 0; }
  .activity-list li { padding: .2rem 0; border-bottom: 1px solid var(--border); }
</style>
