<script lang="ts">
  import { app } from "../stores/app.svelte";
  import { ui } from "../stores/ui.svelte";
  import ConfirmDialog from "../components/common/ConfirmDialog.svelte";
  import EmptyState from "../components/common/EmptyState.svelte";
  import Icon from "../components/common/Icon.svelte";
  import RichTextView from "../components/common/RichTextView.svelte";
  import MeetingNoteForm from "../components/forms/MeetingNoteForm.svelte";
  import { MEETING_TYPES, type MeetingNote } from "../domain/models";
  import { formatDate, nowTimestamp } from "../utils/dates";
  import { toCsv } from "../utils/csv";
  import { backupFilename, downloadText } from "../utils/download";
  import { richTextToPlainText } from "../utils/richText";

  let search = $state("");
  let filterType = $state("");
  let filterProject = $state("");
  let filterEmployee = $state("");
  let createOpen = $state(false);
  let editing = $state<MeetingNote | undefined>(undefined);
  let pendingDelete = $state<MeetingNote | undefined>(undefined);
  let selectedId = $state("");

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
          includesText(richTextToPlainText(note.notes), needle) ||
          includesText(richTextToPlainText(note.actionItems), needle) ||
          note.attendeeEmployeeIds.some((id) => app.employeeName(id).toLowerCase().includes(needle)) ||
          includesText(app.projectName(note.projectId), needle)
        );
      })
      .sort((a, b) => (a.meetingDate < b.meetingDate ? 1 : a.meetingDate > b.meetingDate ? -1 : a.title.localeCompare(b.title)))
  );

  let recentCount = $derived(app.meetingNotes.filter((note) => !note.isArchived && note.meetingDate >= app.today).length);
  let selectedNote = $derived(notes.find((note) => note.id === selectedId) ?? notes[0]);

  function employeeNames(ids: string[]): string {
    return ids.map((id) => app.employeeName(id)).filter(Boolean).join("; ");
  }

  async function exportCsv() {
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
        richTextToPlainText(note.notes),
        richTextToPlainText(note.actionItems)
      ])
    );
    try {
      await downloadText(backupFilename("RADAR_MeetingNotes", "csv"), csv, "text/csv");
    } catch {
      app.toast("Meeting export failed", "error");
    }
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
    if (selectedId === note.id) selectedId = "";
    pendingDelete = undefined;
    app.toast("Meeting note deleted", "success");
  }

  function createFollowUpTask(note: MeetingNote) {
    ui.openNewTask({
      title: `Follow up: ${note.title}`,
      description: richTextToPlainText(note.actionItems || note.notes),
      projectId: note.projectId,
      employeeId: note.attendeeEmployeeIds[0]
    });
  }
</script>

<div class="page">
  <div class="page-header">
    <h1>Meeting Notes</h1>
    <span class="muted">{notes.length} shown</span>
    <span class="spacer"></span>
    <button type="button" onclick={exportCsv} disabled={notes.length === 0}>Export CSV</button>
    <button type="button" class="primary" onclick={() => (createOpen = true)}>New Meeting Note</button>
  </div>

  <div class="summary-cards">
    <div class="stat"><div class="num">{app.meetingNotes.filter((note) => !note.isArchived).length}</div><div class="lbl">Active notes</div></div>
    <div class="stat"><div class="num">{recentCount}</div><div class="lbl">Today or later</div></div>
    <div class="stat"><div class="num">{app.meetingNotes.filter((note) => !note.isArchived && note.actionItems).length}</div><div class="lbl">With actions</div></div>
  </div>

  <div class="toolbar meeting-toolbar">
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
    <div class="meeting-workspace">
      <section class="card meeting-list-panel" aria-label="Meeting note list">
        <div class="panel-heading">
          <h2>Notes</h2>
          <span class="small muted">Newest first</span>
        </div>
        <div class="meeting-list">
          {#each notes as note (note.id)}
            <button
              type="button"
              class:active={selectedNote?.id === note.id}
              class="meeting-list-item"
              aria-pressed={selectedNote?.id === note.id}
              onclick={() => (selectedId = note.id)}
            >
              <span class="list-row-meta">
                <span>{formatDate(note.meetingDate)}</span>
                <span class="badge">{note.meetingType}</span>
                {#if note.actionItems}<span class="action-mark">Action</span>{/if}
              </span>
              <strong>{note.title}</strong>
              <span class="list-context">
                {app.projectName(note.projectId) || employeeNames(note.attendeeEmployeeIds) || "No linked context"}
              </span>
            </button>
          {/each}
        </div>
      </section>

      {#if selectedNote}
        <article class="card meeting-detail" aria-label={`Meeting details for ${selectedNote.title}`}>
          <div class="detail-actions">
            <button type="button" onclick={() => (editing = selectedNote)}>Edit</button>
            <button type="button" class="icon-btn" aria-label="Archive meeting note" title="Archive" onclick={() => void archive(selectedNote)}><Icon name="archive" size={16} /></button>
            <button type="button" class="icon-btn danger" aria-label="Delete meeting note" title="Delete" onclick={() => requestDelete(selectedNote)}><Icon name="trash" size={16} /></button>
          </div>
          <div class="detail-kicker">
            <span>{formatDate(selectedNote.meetingDate)}</span>
            <span class="badge">{selectedNote.meetingType}</span>
            {#if selectedNote.projectId}<span>{app.projectName(selectedNote.projectId)}</span>{/if}
          </div>
          <h2 class="detail-title">{selectedNote.title}</h2>
          {#if selectedNote.attendeeEmployeeIds.length}
            <div class="detail-attendees">
              <span class="detail-label">Attendees</span>
              <span>{employeeNames(selectedNote.attendeeEmployeeIds)}</span>
            </div>
          {/if}
          <div class="meeting-sections">
            <section>
              <h3>Discussion</h3>
              <RichTextView value={selectedNote.notes} emptyText="No discussion notes recorded." />
            </section>
            <section class="action-section">
              <h3>Action Items</h3>
              <RichTextView value={selectedNote.actionItems} emptyText="No action items recorded." />
            </section>
          </div>
          {#if selectedNote.actionItems}
            <div class="meeting-footer">
              <span class="spacer"></span>
              <button type="button" class="primary" onclick={() => createFollowUpTask(selectedNote)}>Create follow-up task</button>
            </div>
          {/if}
        </article>
      {/if}
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
  .meeting-workspace {
    display: grid;
    grid-template-columns: minmax(18rem, 25rem) minmax(0, 1fr);
    gap: 1rem;
    align-items: start;
  }
  .meeting-toolbar { position: sticky; top: 0; z-index: 3; padding: .5rem 0; background: var(--bg); }
  .meeting-list-panel { padding: 0; overflow: hidden; }
  .panel-heading {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 1rem;
    padding: .85rem 1rem;
    border-bottom: 1px solid var(--border);
  }
  .panel-heading h2 { margin: 0; }
  .meeting-list {
    display: grid;
    max-height: calc(100vh - 20rem);
    min-height: 24rem;
    overflow: auto;
  }
  .meeting-list-item {
    display: grid;
    gap: .25rem;
    width: 100%;
    min-height: 0;
    padding: .75rem 1rem;
    text-align: left;
    border: 0;
    border-bottom: 1px solid var(--border);
    border-radius: 0;
    background: transparent;
  }
  .meeting-list-item:hover { background: color-mix(in srgb, var(--accent-soft) 38%, transparent); }
  .meeting-list-item.active {
    background: var(--accent-soft);
    box-shadow: inset 3px 0 0 var(--accent);
  }
  .list-row-meta { display: flex; align-items: center; gap: .4rem; color: var(--text-muted); font-size: .76rem; }
  .list-context { color: var(--text-muted); font-size: .78rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .action-mark { margin-left: auto; color: var(--accent); font-size: .7rem; text-transform: uppercase; letter-spacing: .04em; }
  .meeting-detail { position: sticky; top: 1rem; display: grid; gap: .85rem; min-height: 28rem; }
  .detail-actions { display: flex; justify-content: flex-end; gap: .4rem; }
  .detail-actions button { font-size: .78rem; }
  .detail-kicker { display: flex; flex-wrap: wrap; align-items: center; gap: .5rem; color: var(--text-muted); font-size: .82rem; }
  .detail-title { margin: -.2rem 0 0; font-size: 1.35rem; }
  .detail-attendees { display: grid; gap: .2rem; padding-bottom: .8rem; border-bottom: 1px solid var(--border); }
  .detail-label { color: var(--text-muted); font-size: .72rem; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; }
  .meeting-footer {
    display: flex;
    align-items: center;
    gap: .45rem;
    margin-top: auto;
    padding-top: .5rem;
  }
  .meeting-footer button { font-size: .78rem; }
  .meeting-footer button { padding: .2rem .55rem; }
  .meeting-sections {
    display: grid;
    gap: 1rem;
    white-space: pre-wrap;
  }
  .meeting-sections section { padding: .9rem; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface-2); }
  .meeting-sections .action-section { border-left: 3px solid var(--accent); }
  .meeting-sections h3 {
    margin: 0 0 .15rem;
    font-size: .82rem;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: .04em;
  }
  @media (max-width: 900px) {
    .meeting-workspace { grid-template-columns: 1fr; }
    .meeting-list { max-height: 20rem; min-height: 0; }
    .meeting-detail { position: static; min-height: 0; }
  }
</style>
