<script lang="ts">
  // Employee 360 profile (plan 12.4): aggregates tasks, performance, training,
  // leave, telework, awards, and interactions for one employee.
  import { app } from "../stores/app.svelte";
  import { ui } from "../stores/ui.svelte";
  import { router } from "../app/router.svelte";
  import EmployeeForm from "../components/forms/EmployeeForm.svelte";
  import EmployeeProfileForm from "../components/forms/EmployeeProfileForm.svelte";
  import MeetingNoteForm from "../components/forms/MeetingNoteForm.svelte";
  import Dialog from "../components/common/Dialog.svelte";
  import ConfirmDialog from "../components/common/ConfirmDialog.svelte";
  import EmptyState from "../components/common/EmptyState.svelte";
  import Icon from "../components/common/Icon.svelte";
  import RichTextView from "../components/common/RichTextView.svelte";
  import { CLEARANCE_OPTIONS, COMPUTER_ASSET_OPTIONS, INTERACTION_TYPES, statusLabel, type EmployeeNote, type MeetingNote } from "../domain/models";
  import { TRAINING_STATE_LABELS, trainingStatus } from "../domain/rules/training";
  import { compareDates, daysBetween, formatDate, formatTimestamp, nowTimestamp, todayIso } from "../utils/dates";
  import { newId } from "../utils/ids";

  let { employeeId }: { employeeId: string } = $props();

  let employee = $derived(app.employees.find((e) => e.id === employeeId));
  let tab = $state<"overview" | "profile" | "tasks" | "performance" | "meetings" | "training" | "leave" | "telework" | "travel" | "awards" | "activity">("overview");
  let editOpen = $state(false);
  let confirmDeleteOpen = $state(false);
  let profileOpen = $state(false);
  let checkInOpen = $state(false);
  let meetingNoteOpen = $state(false);
  let editingMeetingNote = $state<MeetingNote | undefined>(undefined);
  let checkInType = $state(INTERACTION_TYPES[1] ?? "Informal check-in");
  let checkInSummary = $state("");
  let checkInFollowUp = $state(false);
  let noteFormOpen = $state(false);
  let noteDraft = $state("");
  let editingNoteId = $state<string | undefined>(undefined);
  let editNoteDraft = $state("");

  let tasks = $derived(app.tasks.filter((t) => t.employeeId === employeeId && !t.isArchived));
  let openTasks = $derived(tasks.filter((t) => t.status !== "complete" && t.status !== "cancelled"));
  let overdueTasks = $derived(openTasks.filter((t) => t.dueDate && compareDates(t.dueDate, app.today) < 0));
  let inputs = $derived(
    app.performanceInputs.filter((p) => p.employeeId === employeeId && !p.isArchived).sort((a, b) => (a.inputDate < b.inputDate ? 1 : -1))
  );
  // Roster rows cover applicable requirements; records for retired requirements
  // or departed employees are still shown, with the same derived status.
  let training = $derived.by(() => {
    const emp = employee;
    if (!emp) return [];
    const rows = app.trainingStatusList.filter((r) => r.employee.id === employeeId);
    const seen = new Set(rows.map((r) => r.requirement.id));
    for (const rec of app.employeeTrainingRecords) {
      if (rec.employeeId !== employeeId || seen.has(rec.trainingRequirementId)) continue;
      const req = app.trainingRequirements.find((q) => q.id === rec.trainingRequirementId);
      if (!req) continue;
      rows.push({ requirement: req, employee: emp, record: rec, status: trainingStatus(req, rec, app.today, app.settings.trainingWarningDays) });
    }
    return rows;
  });
  let leave = $derived(
    app.leaveRecords.filter((l) => l.employeeId === employeeId).sort((a, b) => (a.startDate < b.startDate ? 1 : -1))
  );
  let telework = $derived(app.teleworkRecords.filter((t) => t.employeeId === employeeId));
  let travel = $derived(
    app.travelRecords
      .filter((t) => t.employeeId === employeeId && !t.isArchived)
      .sort((a, b) => (a.startDate < b.startDate ? 1 : -1))
  );
  let awards = $derived(app.awardRecords.filter((a) => a.employeeId === employeeId));
  let interactions = $derived(
    app.employeeInteractions.filter((i) => i.employeeId === employeeId).sort((a, b) => (a.interactionDate < b.interactionDate ? 1 : -1))
  );
  let meetingNotes = $derived(
    app.meetingNotes
      .filter((note) => !note.isArchived && note.attendeeEmployeeIds.includes(employeeId))
      .sort((a, b) => (a.meetingDate < b.meetingDate ? 1 : -1))
  );
  let employeeNotes = $derived(
    app.employeeNotes
      .filter((note) => note.employeeId === employeeId && !note.isArchived)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  );
  let activity = $derived(
    app.activityEntries
      .filter(
        (a) =>
          (a.entityType === "employees" && a.entityId === employeeId) ||
          tasks.some((t) => t.id === a.entityId) ||
          (a.entityType === "meetingNotes" && meetingNotes.some((note) => note.id === a.entityId)) ||
          (a.entityType === "employeeNotes" && app.employeeNotes.some((note) => note.employeeId === employeeId && note.id === a.entityId))
      )
      .sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1))
      .slice(0, 30)
  );

  function teleworkRange(t: { effectiveDate?: string; expirationDate?: string }): string {
    const end = t.expirationDate || t.effectiveDate;
    if (!t.effectiveDate && !end) return "";
    if (t.effectiveDate && end && t.effectiveDate !== end) return `${formatDate(t.effectiveDate)} - ${formatDate(end)}`;
    return formatDate(t.effectiveDate ?? end);
  }

  function optionLabel(options: { value: string; label: string }[], value: string | undefined): string {
    if (!value) return "";
    return options.find((option) => option.value === value)?.label ?? value;
  }

  function profileValue(value: string | undefined): string {
    return value?.trim() || "";
  }

  // A telework agreement is flagged as expired (past) or expiring soon (within
  // 30 days) so a lapsing agreement stands out instead of reading as plain text.
  function teleworkExpiry(iso: string | undefined): { text: string; cls: string } | null {
    if (!iso) return null;
    const label = formatDate(iso);
    const days = daysBetween(app.today, iso);
    if (days < 0) return { text: `Expired ${label}`, cls: "overdue" };
    if (days <= 30) return { text: `Expires ${label}`, cls: "warning" };
    return { text: label, cls: "" };
  }

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

  async function addEmployeeNote() {
    const noteText = noteDraft.trim();
    if (!employee || !noteText) return;
    const now = nowTimestamp();
    await app.putRecord(
      "employeeNotes",
      { id: newId(), employeeId, noteText, createdAt: now, updatedAt: now, isArchived: false },
      { actionType: "created", summary: `Added note for ${employee.displayName}` }
    );
    noteDraft = "";
    noteFormOpen = false;
  }

  function startNoteEdit(note: EmployeeNote) {
    editingNoteId = note.id;
    editNoteDraft = note.noteText;
  }

  async function saveNoteEdit(note: EmployeeNote) {
    const noteText = editNoteDraft.trim();
    if (!employee || !noteText) return;
    await app.putRecord(
      "employeeNotes",
      { ...note, noteText, updatedAt: nowTimestamp() },
      { actionType: "updated", summary: `Updated note for ${employee.displayName}` }
    );
    editingNoteId = undefined;
  }

  // Notes are archived, never deleted (working rule 7); the toast offers Undo.
  async function removeEmployeeNote(note: EmployeeNote) {
    if (!employee) return;
    const name = employee.displayName;
    await app.putRecord(
      "employeeNotes",
      { ...note, isArchived: true, updatedAt: nowTimestamp() },
      { actionType: "archived", summary: `Removed note for ${name}` }
    );
    app.toast("Note removed", "success", () => {
      void app.putRecord(
        "employeeNotes",
        { ...note, isArchived: false, updatedAt: nowTimestamp() },
        { actionType: "restored", summary: `Restored note for ${name}` }
      );
    });
  }

  function deleteEmployeeMessage(name: string): string {
    const counts = app.employeeLinkedRecordCounts(employeeId);
    const owned: [number, string][] = [
      [counts.performanceInputs, "performance inputs"],
      [counts.trainingRecords, "training records"],
      [counts.leaveRecords, "leave records"],
      [counts.teleworkRecords, "telework records"],
      [counts.travelRecords, "travel records"],
      [counts.awardRecords, "awards"],
      [counts.interactions, "check-ins"],
      [counts.notes, "notes"]
    ];
    const parts = owned.filter(([n]) => n > 0).map(([n, label]) => `${n} ${label}`);
    let message = `Permanently delete ${name}?`;
    if (parts.length) message += ` This also permanently deletes their ${parts.join(", ")}.`;
    if (counts.linkedTasks > 0) {
      message += ` ${counts.linkedTasks} task(s) will be kept but no longer linked to an employee.`;
    }
    const unlinked: [number, string][] = [
      [counts.meetingAttendances, "meeting attendee link(s)"],
      [counts.projectLeads, "project lead assignment(s)"],
      [counts.trainingAssignments, "training assignment(s)"]
    ];
    const unlinkedParts = unlinked.filter(([n]) => n > 0).map(([n, label]) => `${n} ${label}`);
    if (unlinkedParts.length) message += ` The following will be kept but unlinked: ${unlinkedParts.join(", ")}.`;
    message += " This cannot be undone. Consider marking the employee inactive instead if you may need this history.";
    return message;
  }

  async function deleteEmployeeNow() {
    confirmDeleteOpen = false;
    await app.deleteEmployee(employeeId);
    router.go("employees");
  }

  // Roving-tabindex keyboard support for the tab list (WAI-ARIA tabs pattern).
  function onTabKeydown(e: KeyboardEvent, index: number) {
    if (!["ArrowRight", "ArrowLeft", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    let next = index;
    if (e.key === "ArrowRight") next = (index + 1) % TABS.length;
    else if (e.key === "ArrowLeft") next = (index - 1 + TABS.length) % TABS.length;
    else if (e.key === "Home") next = 0;
    else next = TABS.length - 1;
    tab = TABS[next]![0];
    document.getElementById(`emp-tab-${TABS[next]![0]}`)?.focus();
  }

  const TABS = [
    ["overview", "Overview"],
    ["profile", "Profile"],
    ["tasks", "Tasks"],
    ["performance", "Performance"],
    ["meetings", "Meetings"],
    ["training", "Training"],
    ["leave", "Leave"],
    ["telework", "Telework"],
    ["travel", "Travel"],
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
      {#if employee.competencyId}<span class="badge">{app.competencyCode(employee.competencyId)}</span>{/if}
      {#if employee.positionTitle}<span class="muted">{employee.positionTitle}</span>{/if}
      {#if employee.team}<span class="muted">{employee.team}</span>{/if}
      {#if employee.activeStatus !== "active"}<span class="badge warning">{employee.activeStatus.replace("_", " ")}</span>{/if}
      <span class="spacer"></span>
      <button type="button" onclick={() => (checkInOpen = true)}>Record check-in</button>
      <button type="button" onclick={() => ui.openNewTask({ employeeId, competencyId: employee.competencyId })}>Add task</button>
      <button type="button" onclick={() => (ui.performanceFormPrefill = { employeeId })}>Add performance input</button>
      <button type="button" onclick={() => (meetingNoteOpen = true)}>Add meeting note</button>
      <button type="button" class="icon-btn" aria-label="Edit employee" title="Edit" onclick={() => (editOpen = true)}><Icon name="edit" size={17} /></button>
      <button type="button" class="icon-btn danger" aria-label="Delete employee" title="Delete" onclick={() => (confirmDeleteOpen = true)}><Icon name="trash" size={17} /></button>
    </div>

    <div class="summary-cards">
      <div class="stat"><div class="num">{openTasks.length}</div><div class="lbl">Open tasks</div></div>
      <div class="stat" class:alert={overdueTasks.length > 0}><div class="num">{overdueTasks.length}</div><div class="lbl">Overdue</div></div>
      <div class="stat"><div class="num">{inputs.length}</div><div class="lbl">Perf. inputs</div></div>
      <div class="stat"><div class="num">{formatDate(employee.lastCheckInDate) || "—"}</div><div class="lbl">Last check-in</div></div>
    </div>

    <div class="tabs" role="tablist" aria-label="Employee sections">
      {#each TABS as [value, label], i (value)}
        <button
          type="button"
          role="tab"
          id={`emp-tab-${value}`}
          aria-selected={tab === value}
          aria-controls="emp-tabpanel"
          tabindex={tab === value ? 0 : -1}
          class:active={tab === value}
          onclick={() => (tab = value)}
          onkeydown={(e) => onTabKeydown(e, i)}
        >{label}</button>
      {/each}
    </div>

    <div id="emp-tabpanel" role="tabpanel" aria-labelledby={`emp-tab-${tab}`}>
    {#if tab === "overview"}
      <div class="notes-header">
        <h2>Notes</h2>
        {#if !noteFormOpen}
          <button type="button" onclick={() => (noteFormOpen = true)}>Add note</button>
        {/if}
      </div>
      {#if employeeNotes.length === 0 && !noteFormOpen}
        <p class="muted">Nothing captured yet. Use notes for things to remember about {employee.displayName} — preferences, goals, constraints.</p>
      {/if}
      {#each employeeNotes as note (note.id)}
        <div class="card" style="margin-bottom:.5rem">
          {#if editingNoteId === note.id}
            <textarea bind:value={editNoteDraft} rows="3" maxlength="10000" style="width:100%" aria-label="Edit note"></textarea>
            <div style="display:flex; gap:.5rem; justify-content:flex-end; margin-top:.4rem">
              <button type="button" onclick={() => (editingNoteId = undefined)}>Cancel</button>
              <button type="button" class="primary" disabled={!editNoteDraft.trim()} onclick={() => void saveNoteEdit(note)}>Save</button>
            </div>
          {:else}
            <div style="display:flex; gap:.5rem; align-items:flex-start">
              <div style="flex:1; min-width:0">
                <div style="white-space:pre-wrap">{note.noteText}</div>
                <div class="small muted">Added {formatTimestamp(note.createdAt)}{note.updatedAt !== note.createdAt ? " · edited" : ""}</div>
              </div>
              <button type="button" class="icon-btn" aria-label="Edit note" title="Edit" onclick={() => startNoteEdit(note)}><Icon name="edit" size={16} /></button>
              <button type="button" class="icon-btn danger" aria-label="Remove note" title="Remove" onclick={() => void removeEmployeeNote(note)}><Icon name="trash" size={16} /></button>
            </div>
          {/if}
        </div>
      {/each}
      {#if noteFormOpen}
        <div class="card" style="margin-bottom:.5rem">
          <textarea bind:value={noteDraft} rows="3" maxlength="10000" style="width:100%" aria-label="New note" placeholder="Something to remember about {employee.displayName}"></textarea>
          <div style="display:flex; gap:.5rem; justify-content:flex-end; margin-top:.4rem">
            <button type="button" onclick={() => { noteFormOpen = false; noteDraft = ""; }}>Cancel</button>
            <button type="button" class="primary" disabled={!noteDraft.trim()} onclick={() => void addEmployeeNote()}>Add note</button>
          </div>
        </div>
      {/if}
      <h2 style="margin-top:1rem">Open work</h2>
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
            {#if p.result}<div class="small muted">Result / Impact: {p.result}</div>{/if}
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
      <h2 style="margin-top:1rem">Recent meeting notes</h2>
      {#if meetingNotes.length === 0}
        <p class="muted">No linked meeting notes.</p>
      {:else}
        {#each meetingNotes.slice(0, 3) as note (note.id)}
          <div class="card" style="margin-bottom:.5rem">
            <div class="small muted">{formatDate(note.meetingDate)} · {note.meetingType}{#if note.projectId} · {app.projectName(note.projectId)}{/if}</div>
            <div>{note.title}</div>
            {#if note.actionItems}<div class="small muted"><strong>Actions:</strong><RichTextView value={note.actionItems} compact /></div>{/if}
          </div>
        {/each}
      {/if}
    {:else if tab === "profile"}
      <div class="tab-title-row">
        <h2>Profile details</h2>
        <button type="button" class="icon-btn" aria-label="Edit profile" title="Edit profile" onclick={() => (profileOpen = true)}><Icon name="edit" size={17} /></button>
      </div>
      {#snippet field(label: string, value: string)}
        <div>
          <dt>{label}</dt>
          {#if value}<dd>{value}</dd>{:else}<dd class="empty">—</dd>{/if}
        </div>
      {/snippet}
      {#snippet linkField(label: string, value: string, href: string)}
        <div>
          <dt>{label}</dt>
          {#if value}<dd><a {href}>{value}</a></dd>{:else}<dd class="empty">—</dd>{/if}
        </div>
      {/snippet}
      {#snippet flagField(label: string, value: boolean | undefined)}
        <div>
          <dt>{label}</dt>
          <dd>
            {#if value === undefined}<span class="empty">—</span>
            {:else if value}<span class="badge flag-yes">Yes</span>
            {:else}<span class="badge">No</span>{/if}
          </dd>
        </div>
      {/snippet}
      {#snippet badgeField(label: string, value: string)}
        <div>
          <dt>{label}</dt>
          {#if value}<dd><span class="badge">{value}</span></dd>{:else}<dd class="empty">—</dd>{/if}
        </div>
      {/snippet}
      {#snippet expiryField(label: string, status: { text: string; cls: string } | null)}
        <div>
          <dt>{label}</dt>
          {#if status}<dd><span class="badge {status.cls}">{status.text}</span></dd>{:else}<dd class="empty">—</dd>{/if}
        </div>
      {/snippet}

      <div class="profile-detail-grid">
        <section class="profile-group">
          <h3>Identity</h3>
          <dl>
            {@render field("Title", profileValue(employee.positionTitle))}
            {@render field("Series", profileValue(employee.series))}
            {@render field("EDIPI", profileValue(employee.edipi))}
            {@render field("PERNR", profileValue(employee.pernr))}
            {@render badgeField("Competency", app.competencyCode(employee.competencyId))}
          </dl>
        </section>

        <section class="profile-group">
          <h3>Location and contact</h3>
          <dl>
            {@render field("Building", profileValue(employee.locationBuilding))}
            {@render field("Cube", profileValue(employee.locationCube))}
            {@render linkField("Work email", profileValue(employee.workEmail), `mailto:${employee.workEmail}`)}
            {@render linkField("Work phone", profileValue(employee.workPhone), `tel:${employee.workPhone}`)}
            {@render linkField("Work cell phone", profileValue(employee.workCellPhone), `tel:${employee.workCellPhone}`)}
            {@render linkField("Personal cell phone", profileValue(employee.personalPhone), `tel:${employee.personalPhone}`)}
            {@render flagField("Government phone", employee.govPhone)}
          </dl>
        </section>

        <section class="profile-group">
          <h3>Organization and project</h3>
          <dl>
            {@render field("Integrated Product Team", profileValue(employee.team))}
            {@render field("IPT Lead", profileValue(employee.iptLead))}
            {@render field("Project", profileValue(employee.employeeProject))}
            {@render field("Project Lead", profileValue(employee.employeeProjectLead))}
          </dl>
        </section>

        <section class="profile-group">
          <h3>Assets and requirements</h3>
          <dl>
            {@render badgeField("Computer Asset", optionLabel(COMPUTER_ASSET_OPTIONS, employee.computerAsset))}
            {@render badgeField("Clearance", optionLabel(CLEARANCE_OPTIONS, employee.clearance))}
            {@render field("CSWF Code", profileValue(employee.cswfCode))}
            {@render field("CSWF Level", profileValue(employee.cswfLevel))}
            {@render flagField("Financial Statement Required", employee.financialStatementRequired)}
            {@render flagField("Drug Test Required", employee.drugTestRequired)}
            {@render expiryField("Telework Agreement Valid Through", teleworkExpiry(employee.teleworkAgreementValidThrough))}
          </dl>
        </section>
      </div>
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
            {#if p.result}<div><strong>Result / Impact:</strong> {p.result}</div>{/if}
          </div>
        {/each}
      {/if}
    {:else if tab === "meetings"}
      {#if meetingNotes.length === 0}
        <EmptyState message="No linked meeting notes." hint="Link this employee in a meeting note to show product-team context here." />
      {:else}
        {#each meetingNotes as note (note.id)}
          <div class="card" style="margin-bottom:.6rem">
            <div class="small muted">
              {formatDate(note.meetingDate)} · {note.meetingType}
              {#if note.projectId} · {app.projectName(note.projectId)}{/if}
            </div>
            <div style="display:flex; gap:.5rem; align-items:center; flex-wrap:wrap">
              <strong>{note.title}</strong>
              <span class="spacer"></span>
              <button type="button" class="icon-btn" aria-label="Edit meeting note" title="Edit" onclick={() => (editingMeetingNote = note)}><Icon name="edit" size={16} /></button>
            </div>
            {#if note.notes}<div><strong>Discussion:</strong><RichTextView value={note.notes} compact /></div>{/if}
            {#if note.actionItems}<div><strong>Action items:</strong><RichTextView value={note.actionItems} compact /></div>{/if}
          </div>
        {/each}
      {/if}
    {:else if tab === "training"}
      {#if training.length === 0}
        <EmptyState message="No training requirements apply." hint="Requirements are managed from the Training page." />
      {:else}
        <table class="data">
          <thead><tr><th>Requirement</th><th>Status</th><th>Due / Expires</th><th>Completed</th><th>Verified</th></tr></thead>
          <tbody>
            {#each training as r (r.requirement.id)}
              <tr>
                <td>{r.requirement.name}</td>
                <td>{TRAINING_STATE_LABELS[r.status.state]}</td>
                <td>{formatDate(r.status.dueDate)}</td>
                <td>{formatDate(r.status.completedDate ?? r.record?.completedDate)}</td>
                <td>{formatDate(r.record?.lastVerifiedDate)}</td>
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
          <thead><tr><th>Type</th><th>Status</th><th>Requested</th><th>Telework date</th><th>Schedule</th><th>Email record</th></tr></thead>
          <tbody>
            {#each telework as t (t.id)}
              <tr>
                <td>{t.recordType}</td><td>{t.status.replace(/_/g, " ")}</td>
                <td>{formatDate(t.requestDate)}</td><td>{teleworkRange(t)}</td>
                <td>{t.scheduleSummary ?? ""}</td><td>{t.sourceReference ?? ""}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
    {:else if tab === "travel"}
      {#if travel.length === 0}
        <EmptyState message="No travel records." hint="Track trips and DTS paperwork from the Travel page." />
      {:else}
        <table class="data">
          <thead><tr><th>Destination</th><th>Start</th><th>End</th><th>IPT</th><th>DTS authorization</th><th>Voucher due</th></tr></thead>
          <tbody>
            {#each travel as t (t.id)}
              <tr>
                <td><button type="button" class="link" onclick={() => router.go("travel", t.id)}>{t.destination}</button></td>
                <td>{formatDate(t.startDate)}</td>
                <td>{formatDate(t.endDate)}</td>
                <td>{t.iptConcurrence.replace(/_/g, " ")}</td>
                <td>{t.dtsAuthorizationStatus.replace(/_/g, " ")}</td>
                <td>
                  {#if t.voucherDueDate && compareDates(t.voucherDueDate, app.today) < 0}
                    <span class="badge overdue">{formatDate(t.voucherDueDate)}</span>
                  {:else}
                    {formatDate(t.voucherDueDate)}
                  {/if}
                </td>
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
  </div>

  {#if editOpen}
    <EmployeeForm {employee} onclose={() => (editOpen = false)} />
  {/if}
  {#if profileOpen}
    <EmployeeProfileForm {employee} onclose={() => (profileOpen = false)} />
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
  {#if meetingNoteOpen}
    <MeetingNoteForm prefill={{ attendeeEmployeeIds: [employeeId], meetingType: "Product team" }} onclose={() => (meetingNoteOpen = false)} />
  {/if}
  {#if editingMeetingNote}
    <MeetingNoteForm note={editingMeetingNote} onclose={() => (editingMeetingNote = undefined)} />
  {/if}
  {#if confirmDeleteOpen}
    <ConfirmDialog
      title="Delete employee"
      message={deleteEmployeeMessage(employee.displayName)}
      confirmLabel="Delete employee"
      danger
      onconfirm={() => void deleteEmployeeNow()}
      oncancel={() => (confirmDeleteOpen = false)}
    />
  {/if}
{/if}

<style>
  .tabs { display: flex; gap: .25rem; flex-wrap: wrap; margin-bottom: 1rem; border-bottom: 1px solid var(--border); }
  .tabs button { border: none; background: none; border-bottom: 2px solid transparent; border-radius: 0; padding: .4rem .7rem; }
  .tabs button.active { border-bottom-color: var(--accent); font-weight: 700; color: var(--accent); }
  .tab-title-row { display: flex; align-items: center; gap: .75rem; margin-bottom: .8rem; }
  .notes-header { display: flex; align-items: center; gap: .75rem; margin-bottom: .5rem; }
  .notes-header h2 { margin: 0 auto 0 0; }
  .tab-title-row h2 { margin: 0; }
  .tab-title-row button { margin-left: auto; }
  .profile-detail-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: .9rem 1rem;
  }
  .profile-group {
    border-top: 1px solid var(--border);
    padding-top: .75rem;
  }
  /* Uppercase eyebrow for the section header; row labels stay quiet below it. */
  .profile-group h3 {
    font-size: .72rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: .07em;
    color: var(--text-muted);
    margin: 0 0 .15rem;
  }
  .profile-group dl {
    display: grid;
    grid-template-columns: 1fr;
    gap: .4rem;
    margin: .35rem 0 0;
  }
  .profile-group dl > div {
    display: grid;
    grid-template-columns: minmax(9rem, 38%) minmax(0, 1fr);
    gap: .6rem;
    align-items: baseline;
  }
  .profile-group dt {
    color: var(--text-muted);
    font-size: .8rem;
    font-weight: 500;
  }
  .profile-group dd {
    margin: 0;
    min-height: 1.25rem;
    overflow-wrap: anywhere;
  }
  .profile-group .empty {
    color: var(--text-muted);
  }
  .profile-group .badge.flag-yes {
    background: var(--accent-soft);
    color: var(--accent);
    border-color: transparent;
  }
  .activity-list { list-style: none; padding: 0; }
  .activity-list li { padding: .2rem 0; border-bottom: 1px solid var(--border); }
  @media (max-width: 900px) {
    .profile-detail-grid { grid-template-columns: 1fr; }
  }
  @media (max-width: 560px) {
    .profile-group dl > div { grid-template-columns: 1fr; gap: .1rem; }
  }
</style>
