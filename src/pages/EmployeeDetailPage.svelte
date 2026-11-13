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
  import WorkspaceHeader from "../components/common/WorkspaceHeader.svelte";
  import { humanizeCode } from "../utils/labels";
  import RichTextEditor from "../components/common/RichTextEditor.svelte";
  import RichTextView from "../components/common/RichTextView.svelte";
  import { INTERACTION_TYPES, statusLabel, type EmployeeInteraction, type EmployeeNote, type EmployeeProfileField, type MeetingNote } from "../domain/models";
  import { activeProfileFields, activeProfileSections, formattedProfileValue, profileFieldHref } from "../domain/employeeProfile";
  import { TRAINING_STATE_LABELS, trainingStatus } from "../domain/rules/training";
  import { teleworkStatusLabel } from "../domain/rules/telework";
  import { employeeOverview, type OverviewAbsence } from "../domain/rules/employeeOverview";
  import { dueState, DUE_STATE_LABELS } from "../domain/rules/dueState";
  import { compareDates, daysBetween, formatDate, formatDateRange, formatTimestamp, isValidIsoDate, nowTimestamp, todayIso } from "../utils/dates";
  import { newId } from "../utils/ids";
  import { emptyRichText, isRichTextEmpty, normalizeRichText, richTextDocToPlainText } from "../utils/richTextDoc";

  let { employeeId }: { employeeId: string } = $props();

  let employee = $derived(app.employees.find((e) => e.id === employeeId));
  let tab = $state<"overview" | "profile" | "checkins" | "tasks" | "performance" | "meetings" | "training" | "leave" | "telework" | "travel" | "awards" | "activity">("overview");
  let editOpen = $state(false);
  let confirmDeleteOpen = $state(false);
  let profileOpen = $state(false);
  let checkInOpen = $state(false);
  let meetingNoteOpen = $state(false);
  let editingMeetingNote = $state<MeetingNote | undefined>(undefined);
  let checkInEditing = $state<EmployeeInteraction | undefined>(undefined);
  let checkInType = $state(INTERACTION_TYPES[1] ?? "Informal check-in");
  let checkInDate = $state(todayIso());
  let checkInSummary = $state(emptyRichText());
  let checkInFollowUp = $state(false);
  let checkInError = $state("");
  // A check-in recorded through the MCP server may carry a type this list does
  // not offer; keep it selectable so editing one cannot silently replace it.
  let checkInTypeOptions = $derived(
    INTERACTION_TYPES.includes(checkInType) ? [...INTERACTION_TYPES] : [checkInType, ...INTERACTION_TYPES]
  );
  let noteFormOpen = $state(false);
  let noteDraft = $state(emptyRichText());
  let editingNoteId = $state<string | undefined>(undefined);
  let editNoteDraft = $state(emptyRichText());

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
  let checkIns = $derived(
    app.employeeInteractions
      .filter((i) => i.employeeId === employeeId)
      .sort((a, b) => (a.interactionDate < b.interactionDate ? 1 : -1))
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
  let profileSections = $derived(activeProfileSections(app.settings));
  let profileFields = $derived(activeProfileFields(app.settings));
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

  // Overview: what is current, then what changed since the last check-in.
  let overview = $derived(
    employeeOverview({
      today: app.today,
      lookaheadDays: app.settings.leaveLookaheadDays,
      inputReminderDays: app.settings.performanceInputReminderDays,
      lastCheckInDate: employee?.lastCheckInDate,
      tasks: app.tasks.filter((t) => t.employeeId === employeeId),
      leave,
      telework,
      travel,
      training: training.map((r) => ({ requirementId: r.requirement.id, name: r.requirement.name, status: r.status })),
      awards,
      inputs,
      checkIns,
      meetings: meetingNotes,
      notes: employeeNotes
    })
  );
  let sinceCount = $derived(
    overview.since.tasksCompleted.length + overview.since.tasksAdded.length + overview.since.meetings.length +
      overview.since.notes.length + overview.since.inputs.length
  );

  function openAbsence(a: OverviewAbsence) {
    router.go(a.kind, a.id);
  }

  // Profile shows only the fields that hold something; the rest are counted.
  function filledFields(sectionId: string): EmployeeProfileField[] {
    return fieldsForProfileSection(sectionId).filter((field) => Boolean(employee && formattedProfileValue(employee, field)));
  }
  let emptyFieldCount = $derived(
    employee ? profileFields.filter((field) => !formattedProfileValue(employee!, field)).length : 0
  );

  function teleworkRange(t: { effectiveDate?: string; expirationDate?: string }): string {
    const end = t.expirationDate || t.effectiveDate;
    if (!t.effectiveDate && !end) return "";
    if (t.effectiveDate && end && t.effectiveDate !== end) return formatDateRange(t.effectiveDate, end);
    return formatDate(t.effectiveDate ?? end);
  }

  function fieldsForProfileSection(sectionId: string): EmployeeProfileField[] {
    return profileFields.filter((field) => field.sectionId === sectionId);
  }

  /** Opens the composer for a new check-in, or the same dialog over an existing one. */
  function openCheckIn(record?: EmployeeInteraction) {
    checkInEditing = record;
    checkInType = record?.interactionType ?? INTERACTION_TYPES[1] ?? "Informal check-in";
    checkInDate = record?.interactionDate ?? todayIso();
    checkInSummary = normalizeRichText(record?.summary);
    checkInFollowUp = record?.followUpRequired ?? false;
    checkInError = "";
    checkInOpen = true;
  }

  async function saveCheckIn() {
    if (!employee) return;
    if (!isValidIsoDate(checkInDate)) {
      checkInError = "Check-in date is not valid.";
      return;
    }
    const editing = checkInEditing;
    const now = nowTimestamp();
    await app.putRecord(
      "employeeInteractions",
      {
        ...editing,
        id: editing?.id ?? newId(),
        employeeId,
        interactionDate: checkInDate,
        interactionType: checkInType,
        summary: isRichTextEmpty(checkInSummary) ? undefined : checkInSummary,
        followUpRequired: checkInFollowUp,
        createdAt: editing?.createdAt ?? now,
        updatedAt: now
      },
      {
        actionType: editing ? "updated" : "created",
        summary: `${editing ? "Updated" : "Recorded"} ${checkInType} with ${employee.displayName}`
      }
    );
    // The roster's "last check-in" only moves forward. Now that the date is
    // editable, a backdated or corrected entry must not hide a later one.
    if (!employee.lastCheckInDate || compareDates(checkInDate, employee.lastCheckInDate) > 0) {
      await app.putRecord("employees", { ...employee, lastCheckInDate: checkInDate, updatedAt: now });
    }
    checkInOpen = false;
    app.toast(editing ? "Check-in updated" : "Check-in recorded", "success");
  }

  async function addEmployeeNote() {
    if (!employee || isRichTextEmpty(noteDraft)) return;
    const noteText = noteDraft;
    const now = nowTimestamp();
    await app.putRecord(
      "employeeNotes",
      { id: newId(), employeeId, noteText, createdAt: now, updatedAt: now, isArchived: false },
      { actionType: "created", summary: `Added note for ${employee.displayName}` }
    );
    noteDraft = emptyRichText();
    noteFormOpen = false;
  }

  function startNoteEdit(note: EmployeeNote) {
    editingNoteId = note.id;
    editNoteDraft = normalizeRichText(note.noteText);
  }

  async function saveNoteEdit(note: EmployeeNote) {
    if (!employee || isRichTextEmpty(editNoteDraft)) return;
    const noteText = editNoteDraft;
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
      [counts.trainingAssignments, "training assignment(s)"],
      [counts.recurringSchedules, "recurring task schedule(s)"]
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
    ["checkins", "Check-ins"],
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
{:else if meetingNoteOpen}
  <MeetingNoteForm prefill={{ attendeeEmployeeIds: [employeeId], meetingType: "Product team" }} onclose={() => (meetingNoteOpen = false)} />
{:else if editingMeetingNote}
  <MeetingNoteForm note={editingMeetingNote} onclose={() => (editingMeetingNote = undefined)} />
{:else}
  <div class="page">
    <WorkspaceHeader title={employee.displayName} section="Employees" sectionHref="#/employees">
      {#snippet meta()}
        {#if employee.competencyId}<span class="badge">{app.competencyCode(employee.competencyId)}</span>{/if}
        {#if employee.positionTitle}<span>{employee.positionTitle}</span>{/if}
        {#if employee.team}<span>{employee.team}</span>{/if}
        {#if employee.activeStatus !== "active"}<span class="badge warning">{humanizeCode(employee.activeStatus)}</span>{/if}
      {/snippet}
      {#snippet filters()}
        <div class="header-metrics" aria-label="Employee totals">
          <span><strong>{openTasks.length}</strong> open tasks</span>
          <span><strong>{overdueTasks.length}</strong> overdue</span>
          <span><strong>{inputs.length}</strong> performance inputs</span>
          <span><strong>{formatDate(employee.lastCheckInDate) || "—"}</strong> last check-in</span>
        </div>
      {/snippet}
      {#snippet actions()}
        <button type="button" class="icon-btn" aria-label="Edit employee" title="Edit" onclick={() => (editOpen = true)}><Icon name="edit" size={17} /></button>
        <button type="button" class="icon-btn danger" aria-label="Delete employee" title="Delete" onclick={() => (confirmDeleteOpen = true)}><Icon name="trash" size={17} /></button>
        <button type="button" onclick={() => ui.openNewTask({ employeeId, competencyId: employee.competencyId })}>Add Task</button>
        <button type="button" onclick={() => (ui.performanceFormPrefill = { employeeId })}>Add Performance Input</button>
        <button type="button" onclick={() => (meetingNoteOpen = true)}>Add Meeting Note</button>
        <button type="button" class="primary" onclick={() => openCheckIn()}>Record Check-in</button>
      {/snippet}
    </WorkspaceHeader>

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
      <div class="overview-grid">
        <section class="card overview-card" aria-labelledby="ov-tasks">
          <div class="overview-head">
            <h2 id="ov-tasks">Open tasks</h2>
            <span class="muted small">{overview.openTaskCount} open{#if overview.overdueTaskCount} · <span class="overdue-text">{overview.overdueTaskCount} overdue</span>{/if}</span>
          </div>
          {#if overview.openTasks.length === 0}
            <p class="muted small quiet">Nothing open.</p>
          {:else}
            <ul class="overview-list">
              {#each overview.openTasks as t (t.id)}
                {@const ds = dueState(t, app.today, app.settings.dueSoonDays)}
                <li>
                  <button type="button" class="link" onclick={() => ui.openTaskDetail(t.id)}>{t.title}</button>
                  {#if ds === "overdue" || ds === "due_today" || ds === "due_soon"}
                    <span class="badge {ds}">{DUE_STATE_LABELS[ds]} {formatDate(t.dueDate)}</span>
                  {:else if t.dueDate}
                    <span class="muted small">Due {formatDate(t.dueDate)}</span>
                  {/if}
                </li>
              {/each}
            </ul>
            {#if overview.openTaskCount > overview.openTasks.length}
              <button type="button" class="link more-link" onclick={() => (tab = "tasks")}>All {overview.openTaskCount} tasks</button>
            {/if}
          {/if}
        </section>

        <section class="card overview-card" aria-labelledby="ov-away">
          <div class="overview-head">
            <h2 id="ov-away">Away</h2>
            <span class="muted small">Next {app.settings.leaveLookaheadDays} days</span>
          </div>
          {#if overview.absences.length === 0}
            <p class="muted small quiet">No leave, telework, or travel coming up.</p>
          {:else}
            <ul class="overview-list">
              {#each overview.absences as a (a.kind + a.id)}
                <li>
                  <button type="button" class="link" onclick={() => openAbsence(a)}>{a.label}</button>
                  <span class="small">{formatDateRange(a.start, a.end)}</span>
                  {#if a.current}<span class="badge success">Now</span>{/if}
                  {#if a.pending}<span class="badge warning">Pending</span>{/if}
                </li>
              {/each}
            </ul>
          {/if}
        </section>

        <section class="card overview-card" aria-labelledby="ov-dev">
          <div class="overview-head"><h2 id="ov-dev">Development</h2></div>
          <dl class="overview-facts">
            <div>
              <dt>Last performance input</dt>
              <dd>
                {#if overview.lastInput}
                  {formatDate(overview.lastInput.input.inputDate)}
                  <span class="muted small">({overview.lastInput.daysAgo === 0 ? "today" : `${overview.lastInput.daysAgo} days ago`})</span>
                  {#if overview.lastInput.stale}<span class="badge warning">Due for one</span>{/if}
                {:else}
                  <span class="muted">None yet</span> <span class="badge warning">Due for one</span>
                {/if}
              </dd>
            </div>
            <div>
              <dt>Training needing action</dt>
              <dd>
                {#if overview.training.length === 0}
                  <span class="muted">None</span>
                {:else}
                  <ul class="overview-list tight">
                    {#each overview.training as r (r.requirementId)}
                      <li>
                        <button type="button" class="link" onclick={() => router.go("training", `${employeeId}~${r.requirementId}`)}>{r.name}</button>
                        <span class="badge" class:overdue={r.status.state === "overdue" || r.status.state === "expired"} class:warning={r.status.state === "due_soon" || r.status.state === "expiring"}>{TRAINING_STATE_LABELS[r.status.state]}{r.status.dueDate ? ` ${formatDate(r.status.dueDate)}` : ""}</span>
                      </li>
                    {/each}
                  </ul>
                {/if}
              </dd>
            </div>
            <div>
              <dt>Awards in progress</dt>
              <dd>
                {#if overview.awardsInProgress.length === 0}
                  <span class="muted">None</span>
                {:else}
                  <ul class="overview-list tight">
                    {#each overview.awardsInProgress as a (a.id)}
                      <li>
                        <button type="button" class="link" onclick={() => router.go("awards", a.id)}>{a.title}</button>
                        <span class="muted small">{a.status}{a.nominationDueDate ? ` · due ${formatDate(a.nominationDueDate)}` : ""}</span>
                      </li>
                    {/each}
                  </ul>
                {/if}
              </dd>
            </div>
          </dl>
        </section>

        <section class="card overview-card" aria-labelledby="ov-since">
          <div class="overview-head">
            <h2 id="ov-since">{overview.since.from ? `Since last check-in, ${formatDate(overview.since.from)}` : "No check-in recorded yet"}</h2>
            <button type="button" class="primary" onclick={() => openCheckIn()}>Record Check-in</button>
          </div>
          {#if overview.followUpOpen && overview.lastCheckIn}
            <div class="follow-up">
              <span class="badge warning">Follow-up from last check-in</span>
              {#if !isRichTextEmpty(overview.lastCheckIn.summary)}<RichTextView value={overview.lastCheckIn.summary} compact />{/if}
            </div>
          {/if}
          {#if sinceCount === 0}
            <p class="muted small quiet">{overview.since.from ? "Nothing new recorded since then." : "Nothing recorded for this person yet."}</p>
          {:else}
            <div class="since-groups">
              {#if overview.since.tasksCompleted.length}
                <div>
                  <h3>Tasks completed ({overview.since.tasksCompleted.length})</h3>
                  <ul class="overview-list tight">
                    {#each overview.since.tasksCompleted.slice(0, 5) as t (t.id)}
                      <li><button type="button" class="link" onclick={() => ui.openTaskDetail(t.id)}>{t.title}</button> <span class="muted small">{formatDate(t.completedDate)}</span></li>
                    {/each}
                  </ul>
                </div>
              {/if}
              {#if overview.since.tasksAdded.length}
                <div>
                  <h3>Tasks added ({overview.since.tasksAdded.length})</h3>
                  <ul class="overview-list tight">
                    {#each overview.since.tasksAdded.slice(0, 5) as t (t.id)}
                      <li><button type="button" class="link" onclick={() => ui.openTaskDetail(t.id)}>{t.title}</button></li>
                    {/each}
                  </ul>
                </div>
              {/if}
              {#if overview.since.inputs.length}
                <div>
                  <h3>Performance inputs ({overview.since.inputs.length})</h3>
                  <ul class="overview-list tight">
                    {#each overview.since.inputs.slice(0, 5) as p (p.id)}
                      <li><span class="small">{formatDate(p.inputDate)}</span> <span class="input-text">{richTextDocToPlainText(p.actionOrAccomplishment)}</span></li>
                    {/each}
                  </ul>
                </div>
              {/if}
              {#if overview.since.meetings.length}
                <div>
                  <h3>Meetings ({overview.since.meetings.length})</h3>
                  <ul class="overview-list tight">
                    {#each overview.since.meetings.slice(0, 5) as m (m.id)}
                      <li><button type="button" class="link" onclick={() => (editingMeetingNote = m)}>{m.title}</button> <span class="muted small">{formatDate(m.meetingDate)}</span></li>
                    {/each}
                  </ul>
                </div>
              {/if}
              {#if overview.since.notes.length}
                <div>
                  <h3>Notes ({overview.since.notes.length})</h3>
                  <ul class="overview-list tight">
                    {#each overview.since.notes.slice(0, 3) as n (n.id)}
                      <li class="note-line"><RichTextView value={n.noteText} compact /></li>
                    {/each}
                  </ul>
                </div>
              {/if}
            </div>
          {/if}
        </section>
      </div>
    {:else if tab === "profile"}
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
            <RichTextEditor id={`employee-note-edit-${note.id}`} bind:value={editNoteDraft} rows={3} maxlength={10000} ariaLabel="Edit note" />
            <div style="display:flex; gap:.5rem; justify-content:flex-end; margin-top:.4rem">
              <button type="button" onclick={() => (editingNoteId = undefined)}>Cancel</button>
              <button type="button" class="primary" disabled={isRichTextEmpty(editNoteDraft)} onclick={() => void saveNoteEdit(note)}>Save</button>
            </div>
          {:else}
            <div style="display:flex; gap:.5rem; align-items:flex-start">
              <div style="flex:1; min-width:0">
                <RichTextView value={note.noteText} compact />
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
          <RichTextEditor id="employee-note-new" bind:value={noteDraft} rows={3} maxlength={10000} ariaLabel="New note" placeholder={`Something to remember about ${employee.displayName}`} />
          <div style="display:flex; gap:.5rem; justify-content:flex-end; margin-top:.4rem">
            <button type="button" onclick={() => { noteFormOpen = false; noteDraft = emptyRichText(); }}>Cancel</button>
            <button type="button" class="primary" disabled={isRichTextEmpty(noteDraft)} onclick={() => void addEmployeeNote()}>Add note</button>
          </div>
        </div>
      {/if}
      <div class="tab-title-row">
        <h2>Profile details</h2>
        {#if employee.competencyId}<span class="badge">{app.competencyCode(employee.competencyId)}</span>{/if}
        <button type="button" class="icon-btn" aria-label="Edit profile" title="Edit profile" onclick={() => (profileOpen = true)}><Icon name="edit" size={17} /></button>
      </div>

      {#if emptyFieldCount > 0}
        <p class="muted small empty-fields-line">
          {emptyFieldCount} {emptyFieldCount === 1 ? "field is" : "fields are"} not filled in and hidden here.
          <button type="button" class="link" onclick={() => (profileOpen = true)}>Edit profile</button>
        </p>
      {/if}
      <div class="profile-detail-grid">
        {#each profileSections as section (section.id)}
          {@const sectionFields = filledFields(section.id)}
          {#if sectionFields.length}
            <section class="profile-group">
              <h3>{section.label}</h3>
              <dl>
                {#each sectionFields as field (field.id)}
                  {@const rawValue = formattedProfileValue(employee, field)}
                  {@const value = field.type === "date" ? formatDate(rawValue) : rawValue}
                  {@const href = profileFieldHref(field, rawValue)}
                  <div>
                    <dt>{field.label}</dt>
                    {#if !value}<dd class="empty">—</dd>
                    {:else if href}<dd><a {href}>{value}</a></dd>
                    {:else if field.type === "boolean" || field.type === "choice" || field.type === "multi_choice"}<dd><span class="badge">{value}</span></dd>
                    {:else}<dd class:multiline-value={field.type === "multiline"}>{value}</dd>{/if}
                  </div>
                {/each}
              </dl>
            </section>
          {/if}
        {/each}
      </div>
    {:else if tab === "checkins"}
      {#if checkIns.length === 0}
        <EmptyState message="No check-ins recorded." hint="Use Record check-in above to capture what was discussed." />
      {:else}
        {#each checkIns as c (c.id)}
          <div class="card" style="margin-bottom:.6rem">
            <div style="display:flex; gap:.5rem; align-items:center; flex-wrap:wrap">
              <button type="button" class="link" onclick={() => openCheckIn(c)}>{formatDate(c.interactionDate)}</button>
              <span class="muted small">{c.interactionType}</span>
              {#if c.followUpRequired}<span class="badge warning">Follow-up required</span>{/if}
              <span class="spacer"></span>
              <button type="button" class="icon-btn" aria-label={`Edit check-in from ${formatDate(c.interactionDate)}`} title="Edit" onclick={() => openCheckIn(c)}><Icon name="edit" size={16} /></button>
            </div>
            {#if isRichTextEmpty(c.summary)}
              <p class="muted small" style="margin:.2rem 0 0">No summary recorded.</p>
            {:else}
              <RichTextView value={c.summary} compact />
            {/if}
          </div>
        {/each}
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
            <div style="display:flex; gap:.5rem; align-items:center">
              <div class="small muted">
                {formatDate(p.inputDate)} · {p.inputStatus}
                {#if p.projectId}· {app.projectName(p.projectId)}{/if}
                {#if p.recognitionPotential}· <span class="badge success">Recognition potential</span>{/if}
              </div>
              <span class="spacer"></span>
              <button type="button" class="icon-btn" aria-label={`Edit performance input from ${formatDate(p.inputDate)}`} title="Edit" onclick={() => (ui.performanceFormInput = p)}><Icon name="edit" size={16} /></button>
            </div>
            {#if p.situationOrContext}<div><strong>Context:</strong><RichTextView value={p.situationOrContext} compact /></div>{/if}
            <div><strong>Action:</strong><RichTextView value={p.actionOrAccomplishment} compact /></div>
            {#if p.result}<div><strong>Result / Impact:</strong><RichTextView value={p.result} compact /></div>{/if}
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
                <td><button type="button" class="link" onclick={() => router.go("training", `${employeeId}~${r.requirement.id}`)}>{r.requirement.name}</button></td>
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
          <thead><tr><th>Start</th><th>End</th><th>Type</th><th>Hours</th><th>Status</th><th>Note</th></tr></thead>
          <tbody>
            {#each leave as l (l.id)}
              <tr>
                <td><button type="button" class="link" aria-label={`Edit leave starting ${formatDate(l.startDate)}`} onclick={() => router.go("leave", l.id)}>{formatDate(l.startDate)}</button></td><td>{formatDate(l.endDate)}</td>
                <td>{l.leaveType ?? ""}</td><td>{l.hours ?? ""}</td><td>{l.status}</td><td>{l.workloadImpactNote ?? ""}</td>
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
                <td><button type="button" class="link" onclick={() => router.go("telework", t.id)}>{t.recordType}</button></td><td>{teleworkStatusLabel(t.status)}</td>
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
                <td>{humanizeCode(t.iptConcurrence)}</td>
                <td>{humanizeCode(t.dtsAuthorizationStatus)}</td>
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
              <tr><td><button type="button" class="link" onclick={() => router.go("awards", a.id)}>{a.title}</button></td><td>{a.status}</td><td>{formatDate(a.nominationDueDate)}</td><td>{formatDate(a.submittedDate)}</td></tr>
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
    <Dialog title={checkInEditing ? "Edit check-in" : "Record check-in"} onclose={() => (checkInOpen = false)}>
      <div class="form-grid">
        <div>
          <label for="ci-date">Date</label>
          <input id="ci-date" type="date" bind:value={checkInDate} style="width:100%" />
        </div>
        <div>
          <label for="ci-type">Interaction type</label>
          <select id="ci-type" bind:value={checkInType} style="width:100%">
            {#each checkInTypeOptions as t (t)}<option value={t}>{t}</option>{/each}
          </select>
        </div>
      </div>
      {#if checkInError}<div class="field-error" role="alert">{checkInError}</div>{/if}
      <label for="ci-summary">Summary <span class="field-hint">objective, work-related</span></label>
      <RichTextEditor id="ci-summary" bind:value={checkInSummary} rows={3} maxlength={10000} ariaLabel="Check-in summary" />
      <label style="display:flex; align-items:center; gap:.4rem; font-weight:400">
        <input type="checkbox" bind:checked={checkInFollowUp} /> Follow-up required
      </label>
      <div class="dialog-actions">
        <button type="button" onclick={() => (checkInOpen = false)}>Cancel</button>
        <button type="button" class="primary" onclick={() => void saveCheckIn()}>Save</button>
      </div>
    </Dialog>
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
  :global(:root[data-density="compact"]) .tabs { margin-bottom: .6rem; }
  :global(:root[data-density="compact"]) .tabs button { padding: .25rem .6rem; }
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
  .multiline-value { white-space: pre-wrap; }
  .empty-fields-line { margin: -.3rem 0 .8rem; }
  .overview-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: .9rem;
    align-items: start;
  }
  .overview-card { min-width: 0; }
  .since-card { grid-column: 1 / -1; }
  .overview-head {
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    gap: .35rem .75rem;
    margin-bottom: .55rem;
  }
  .overview-head h2 { margin: 0 auto 0 0; font-size: .98rem; }
  .overview-head button { align-self: center; }
  .overview-list { list-style: none; margin: 0; padding: 0; display: grid; gap: .35rem; }
  .overview-list li { display: flex; flex-wrap: wrap; align-items: baseline; gap: .2rem .5rem; min-width: 0; }
  .overview-list.tight { gap: .2rem; }
  .overview-list .link { text-align: left; padding: 0; overflow-wrap: anywhere; }
  .more-link { margin-top: .5rem; padding: 0; }
  .quiet { margin: 0; }
  .overdue-text { color: var(--overdue-fg); font-weight: 600; }
  .overview-facts { margin: 0; display: grid; gap: .6rem; }
  .overview-facts dt { color: var(--text-muted); font-size: .78rem; font-weight: 500; margin-bottom: .1rem; }
  .overview-facts dd { margin: 0; display: flex; flex-wrap: wrap; align-items: baseline; gap: .3rem .5rem; }
  .overview-facts dd > ul { flex: 1 1 100%; }
  .follow-up { display: grid; gap: .3rem; padding: .55rem .7rem; margin-bottom: .7rem; border-left: 3px solid var(--duesoon-fg); background: var(--duesoon-bg); border-radius: var(--radius); }
  .since-groups { display: grid; grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr)); gap: .8rem 1.2rem; }
  .since-groups h3 { font-size: .78rem; font-weight: 600; color: var(--text-muted); margin: 0 0 .3rem; }
  .note-line { display: block; }
  .input-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1 1 10rem; }
  .activity-list { list-style: none; padding: 0; }
  .activity-list li { padding: .2rem 0; border-bottom: 1px solid var(--border); }
  @media (max-width: 900px) {
    .profile-detail-grid { grid-template-columns: 1fr; }
    .overview-grid { grid-template-columns: 1fr; }
  }
  @media (max-width: 560px) {
    .profile-group dl > div { grid-template-columns: 1fr; gap: .1rem; }
  }
</style>
