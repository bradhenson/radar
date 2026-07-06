<script lang="ts">
  import { app } from "../stores/app.svelte";
  import { ui } from "../stores/ui.svelte";
  import ConfirmDialog from "../components/common/ConfirmDialog.svelte";
  import EmptyState from "../components/common/EmptyState.svelte";
  import MeetingNoteForm from "../components/forms/MeetingNoteForm.svelte";
  import { MEETING_TYPES, type MeetingNote } from "../domain/models";
  import { formatDate, nowTimestamp } from "../utils/dates";
  import { toCsv } from "../utils/csv";
  import { backupFilename, downloadText } from "../utils/download";

  let search = $state("");
  let filterType = $state("");
  let filterProject = $state("");
  let filterEmployee = $state("");
  let createOpen = $state(false);
  let editing = $state<MeetingNote | undefined>(undefined);
  let pendingDelete = $state<MeetingNote | undefined>(undefined);

  function includesText(value: string | undefined, needle: string): boolean {
    return Boolean(value?.toLowerCase().includes(needle));
  }

  let notes = $derived(
    app.meetingNotes
      .filter((note) => {
        if (note.isArchived) return false;
        if (filterType && note.meetingType !== filterType) return false;
        if (filterProject && note.projectId !== filterProject) return false;
        if (filterEmployee && !note.attendeeEmployeeIds.includes(filterEmployee)) return false;
        const needle = search.trim().toLowerCase();
        if (!needle) return true;
        return (
          includesText(note.title, needle) ||
          includesText(note.meetingType, needle) ||
          includesText(note.notes, needle) ||
          includesText(note.actionItems, needle) ||
          note.attendeeEmployeeIds.some((id) => app.employeeName(id).toLowerCase().includes(needle)) ||
          includesText(app.projectName(note.projectId), needle)
        );
      })
      .sort((a, b) => (a.meetingDate < b.meetingDate ? 1 : a.meetingDate > b.meetingDate ? -1 : a.title.localeCompare(b.title)))
  );

  let recentCount = $derived(app.meetingNotes.filter((note) => !note.isArchived && note.meetingDate >= app.today).length);

  function employeeNames(ids: string[]): string {
    return ids.map((id) => app.employeeName(id)).filter(Boolean).join("; ");
  }

  function exportCsv() {
    const csv = toCsv(
      [
        "Date",
        "Type",
        "Title",
        "Project",
        "Linked employees",
        "Discussion notes",
        "Action items"
      ],
      notes.map((note) => [
        note.meetingDate,
        note.meetingType,
        note.title,
        app.projectName(note.projectId),
        employeeNames(note.attendeeEmployeeIds),
        note.notes,
        note.actionItems
      ])
    );
    downloadText(backupFilename("RADAR_MeetingNotes", "csv"), csv, "text/csv");
  }

  async function archive(note: MeetingNote) {
    await app.putRecord(
      "meetingNotes",
      { ...note, isArchived: true, updatedAt: nowTimestamp() },
      { actionType: "archived", summary: `Archived meeting note "${note.title}"` }
    );
    app.toast("Meeting note archived", "success");
  }

  function requestDelete(note: MeetingNote) {
    pendingDelete = note;
  }

  async function deleteMeetingNote(note: MeetingNote) {
    await app.deleteRecord("meetingNotes", note.id, `Deleted meeting note "${note.title}"`);
    if (editing?.id === note.id) editing = undefined;
    pendingDelete = undefined;
    app.toast("Meeting note deleted", "success");
  }

  function createFollowUpTask(note: MeetingNote) {
    ui.openNewTask({
      title: `Follow up: ${note.title}`,
      description: note.actionItems || note.notes,
      projectId: note.projectId,
      employeeId: note.attendeeEmployeeIds[0]
    });
  }
</script>

<div class="page">
  <div class="page-header">
    <h1>Meeting Notes</h1>
    <span class="muted">{notes.length} shown</span>
    <span class="spacer" style="flex:1"></span>
    <button type="button" onclick={exportCsv} disabled={notes.length === 0}>Export CSV</button>
    <button type="button" class="primary" onclick={() => (createOpen = true)}>New Meeting Note</button>
  </div>

  <div class="summary-cards">
    <div class="stat"><div class="num">{app.meetingNotes.filter((note) => !note.isArchived).length}</div><div class="lbl">Active notes</div></div>
    <div class="stat"><div class="num">{recentCount}</div><div class="lbl">Today or later</div></div>
    <div class="stat"><div class="num">{app.meetingNotes.filter((note) => !note.isArchived && note.actionItems).length}</div><div class="lbl">With actions</div></div>
  </div>

  <div class="toolbar">
    <input type="search" bind:value={search} placeholder="Search notes" aria-label="Search meeting notes" />
    <select bind:value={filterType} aria-label="Filter by meeting type">
      <option value="">All types</option>
      {#each MEETING_TYPES as type (type)}
        <option value={type}>{type}</option>
      {/each}
    </select>
    <select bind:value={filterProject} aria-label="Filter by project">
      <option value="">All projects</option>
      {#each app.activeProjects as project (project.id)}
        <option value={project.id}>{project.name}</option>
      {/each}
    </select>
    <select bind:value={filterEmployee} aria-label="Filter by linked employee">
      <option value="">All employees</option>
      {#each app.activeEmployees as employee (employee.id)}
        <option value={employee.id}>{employee.displayName}</option>
      {/each}
    </select>
  </div>

  {#if notes.length === 0}
    <EmptyState message="No meeting notes match." hint="Capture product team discussion notes and action items as they happen." />
  {:else}
    <div class="note-list">
      {#each notes as note (note.id)}
        <article class="card meeting-card">
          <div class="meeting-meta">
            <span>{formatDate(note.meetingDate)}</span>
            <span class="badge">{note.meetingType}</span>
            {#if note.projectId}<span class="muted">{app.projectName(note.projectId)}</span>{/if}
            <span class="spacer" style="flex:1"></span>
            <button type="button" onclick={() => (editing = note)}>Edit</button>
            <button type="button" onclick={() => void archive(note)}>Archive</button>
            <button type="button" class="danger" onclick={() => requestDelete(note)}>Delete</button>
          </div>

          <h2 class="meeting-title">{note.title}</h2>

          {#if note.attendeeEmployeeIds.length}
            <div class="small muted">
              {employeeNames(note.attendeeEmployeeIds)}
            </div>
          {/if}

          <div class="meeting-sections">
            {#if note.notes}
              <section>
                <h3>Discussion</h3>
                <div>{note.notes}</div>
              </section>
            {/if}
            {#if note.actionItems}
              <section>
                <h3>Action Items</h3>
                <div>{note.actionItems}</div>
              </section>
            {/if}
          </div>

          <div class="meeting-footer">
            <span class="spacer" style="flex:1"></span>
            {#if note.actionItems}
              <button type="button" onclick={() => createFollowUpTask(note)}>Create follow-up task</button>
            {/if}
          </div>
        </article>
      {/each}
    </div>
  {/if}
</div>

{#if createOpen}
  <MeetingNoteForm onclose={() => (createOpen = false)} />
{/if}

{#if editing}
  <MeetingNoteForm note={editing} onclose={() => (editing = undefined)} />
{/if}

{#if pendingDelete}
  <ConfirmDialog
    title="Delete meeting note"
    message={`Permanently delete "${pendingDelete.title}" from ${formatDate(pendingDelete.meetingDate)}?`}
    confirmLabel="Delete note"
    danger
    onconfirm={() => void deleteMeetingNote(pendingDelete!)}
    oncancel={() => (pendingDelete = undefined)}
  />
{/if}

<style>
  .note-list {
    display: grid;
    gap: .75rem;
  }
  .meeting-card {
    display: grid;
    gap: .45rem;
  }
  .meeting-meta,
  .meeting-footer {
    display: flex;
    align-items: center;
    gap: .45rem;
    flex-wrap: wrap;
  }
  .meeting-meta button,
  .meeting-footer button {
    font-size: .78rem;
    padding: .2rem .55rem;
  }
  .meeting-title {
    margin: 0;
    font-size: 1.08rem;
  }
  .meeting-sections {
    display: grid;
    gap: .55rem;
    white-space: pre-wrap;
  }
  .meeting-sections h3 {
    margin: 0 0 .15rem;
    font-size: .82rem;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: .04em;
  }
</style>
