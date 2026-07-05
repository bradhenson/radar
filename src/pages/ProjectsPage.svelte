<script lang="ts">
  // Project directory (plan 12.5, 16) with inline add/edit dialog.
  import { app } from "../stores/app.svelte";
  import { ui } from "../stores/ui.svelte";
  import Dialog from "../components/common/Dialog.svelte";
  import EmptyState from "../components/common/EmptyState.svelte";
  import { compareDates, formatDate, isValidIsoDate, nowTimestamp } from "../utils/dates";
  import { newId } from "../utils/ids";
  import type { Project, ProjectStatus } from "../domain/models";

  let showClosed = $state(false);
  let formOpen = $state(false);
  let editing = $state<Project | undefined>(undefined);
  let expandedId = $state<string | undefined>(undefined);

  // form fields
  let fName = $state("");
  let fShort = $state("");
  let fDesc = $state("");
  let fStatus = $state<ProjectStatus>("active");
  let fStart = $state("");
  let fEnd = $state("");
  let fLead = $state("");
  let fError = $state("");

  function openForm(p?: Project) {
    editing = p;
    fName = p?.name ?? "";
    fShort = p?.shortName ?? "";
    fDesc = p?.description ?? "";
    fStatus = p?.status ?? "active";
    fStart = p?.startDate ?? "";
    fEnd = p?.targetEndDate ?? "";
    fLead = p?.leadEmployeeId ?? "";
    fError = "";
    formOpen = true;
  }

  async function save() {
    const name = fName.trim();
    if (!name) {
      fError = "Project name is required.";
      return;
    }
    if ((fStart && !isValidIsoDate(fStart)) || (fEnd && !isValidIsoDate(fEnd))) {
      fError = "Dates must be valid.";
      return;
    }
    if (fStart && fEnd && fEnd < fStart) {
      fError = "Target end date must be on or after the start date.";
      return;
    }
    const now = nowTimestamp();
    const record: Project = {
      id: editing?.id ?? newId(),
      name,
      shortName: fShort.trim() || undefined,
      description: fDesc.trim() || undefined,
      status: fStatus,
      startDate: fStart || undefined,
      targetEndDate: fEnd || undefined,
      leadEmployeeId: fLead || undefined,
      tags: editing?.tags ?? [],
      createdAt: editing?.createdAt ?? now,
      updatedAt: now,
      isArchived: editing?.isArchived ?? false
    };
    await app.putRecord("projects", record, {
      actionType: editing ? "updated" : "created",
      summary: `${editing ? "Updated" : "Created"} project ${name}`
    });
    formOpen = false;
  }

  let rows = $derived(
    app.projects
      .filter((p) => !p.isArchived && (showClosed || ["proposed", "active", "on_hold"].includes(p.status)))
      .map((p) => {
        const open = app.tasks.filter(
          (t) => t.projectId === p.id && !t.isArchived && t.status !== "complete" && t.status !== "cancelled"
        );
        const overdue = open.filter((t) => t.dueDate && compareDates(t.dueDate, app.today) < 0);
        return { p, openCount: open.length, overdueCount: overdue.length };
      })
      .sort((a, b) => a.p.name.localeCompare(b.p.name))
  );

  function projectTasks(projectId: string) {
    return app.tasks
      .filter((t) => t.projectId === projectId && !t.isArchived)
      .sort((a, b) => ((a.dueDate ?? "9999") < (b.dueDate ?? "9999") ? -1 : 1));
  }
</script>

<div class="page">
  <div class="page-header">
    <h1>Projects</h1>
  </div>
  <div class="toolbar">
    <label style="display:flex; align-items:center; gap:.35rem; font-weight:400; margin:0">
      <input type="checkbox" bind:checked={showClosed} /> Show complete and cancelled
    </label>
    <span class="spacer"></span>
    <button type="button" class="primary" onclick={() => openForm()}>Add Project</button>
  </div>

  {#if rows.length === 0}
    <EmptyState message="No projects." hint="Add a project to group related work." />
  {:else}
    <table class="data">
      <thead>
        <tr><th>Project</th><th>Status</th><th>Start</th><th>Target end</th><th>Lead</th><th>Open</th><th>Overdue</th><th></th></tr>
      </thead>
      <tbody>
        {#each rows as r (r.p.id)}
          <tr>
            <td>
              <button type="button" class="link" onclick={() => (expandedId = expandedId === r.p.id ? undefined : r.p.id)}>
                {r.p.name}{r.p.shortName ? ` (${r.p.shortName})` : ""}
              </button>
            </td>
            <td>{r.p.status.replace("_", " ")}</td>
            <td>{formatDate(r.p.startDate)}</td>
            <td>{formatDate(r.p.targetEndDate)}</td>
            <td>{app.employeeName(r.p.leadEmployeeId)}</td>
            <td>{r.openCount}</td>
            <td>{#if r.overdueCount}<span class="badge overdue">{r.overdueCount}</span>{:else}0{/if}</td>
            <td style="white-space:nowrap">
              <button type="button" onclick={() => ui.openNewTask({ projectId: r.p.id, category: "project" })}>Add task</button>
              <button type="button" onclick={() => openForm(r.p)}>Edit</button>
            </td>
          </tr>
          {#if expandedId === r.p.id}
            <tr>
              <td colspan="8" style="background:var(--surface-2)">
                {#if r.p.description}<p>{r.p.description}</p>{/if}
                {#if projectTasks(r.p.id).length === 0}
                  <p class="muted">No tasks in this project.</p>
                {:else}
                  <ul style="margin:.3rem 0">
                    {#each projectTasks(r.p.id) as t (t.id)}
                      <li>
                        <button type="button" class="link" onclick={() => ui.openTaskDetail(t.id)}>{t.title}</button>
                        <span class="muted small">
                          {t.status.replace("_", " ")}{t.dueDate ? ` · due ${formatDate(t.dueDate)}` : ""}{t.employeeId ? ` · ${app.employeeName(t.employeeId)}` : ""}
                        </span>
                      </li>
                    {/each}
                  </ul>
                {/if}
              </td>
            </tr>
          {/if}
        {/each}
      </tbody>
    </table>
  {/if}
</div>

{#if formOpen}
  <Dialog title={editing ? "Edit Project" : "Add Project"} onclose={() => (formOpen = false)}>
    <form
      onsubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <label for="pf-name">Name <span class="req">*</span></label>
      <input id="pf-name" type="text" bind:value={fName} maxlength="200" style="width:100%" />
      {#if fError}<div class="field-error">{fError}</div>{/if}
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:0 .8rem;">
        <div>
          <label for="pf-short">Short name</label>
          <input id="pf-short" type="text" bind:value={fShort} maxlength="50" style="width:100%" />
        </div>
        <div>
          <label for="pf-status">Status</label>
          <select id="pf-status" bind:value={fStatus} style="width:100%">
            {#each ["proposed", "active", "on_hold", "complete", "cancelled"] as s (s)}
              <option value={s}>{s.replace("_", " ")}</option>
            {/each}
          </select>
        </div>
        <div>
          <label for="pf-start">Start date</label>
          <input id="pf-start" type="date" bind:value={fStart} style="width:100%" />
        </div>
        <div>
          <label for="pf-end">Target end</label>
          <input id="pf-end" type="date" bind:value={fEnd} style="width:100%" />
        </div>
      </div>
      <label for="pf-lead">Lead</label>
      <select id="pf-lead" bind:value={fLead} style="width:100%">
        <option value="">(none)</option>
        {#each app.activeEmployees as e (e.id)}<option value={e.id}>{e.displayName}</option>{/each}
      </select>
      <label for="pf-desc">Description</label>
      <textarea id="pf-desc" bind:value={fDesc} rows="3" maxlength="10000" style="width:100%"></textarea>
      <div style="display:flex; gap:.5rem; justify-content:flex-end; margin-top:1rem;">
        <button type="button" onclick={() => (formOpen = false)}>Cancel</button>
        <button type="submit" class="primary">Save</button>
      </div>
    </form>
  </Dialog>
{/if}
