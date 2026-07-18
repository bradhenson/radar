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
  let expanded = $state<Record<string, boolean>>({});

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

  function employeeNames(ids: string[]): string {
    return ids.map((id) => app.employeeName(id)).filter(Boolean).join("; ");
  }

  function toggleRow(id: string) {
    expanded[id] = !expanded[id];
  }

  function toggleFromRow(id: string) {
    // Don't hijack a click the user made to select and copy text.
    if (window.getSelection()?.toString()) return;
    toggleRow(id);
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

{#if createOpen}
  <MeetingNoteForm onclose={() => (createOpen = false)} />
{:else if editing}
  <MeetingNoteForm note={editing} onclose={() => (editing = undefined)} />
{:else}
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
    <div class="table-wrap">
      <table class="data meeting-table">
        <thead>
          <tr><th>Date</th><th>Type</th><th>Title</th><th>Project</th><th>Attendees</th><th>Action items</th></tr>
        </thead>
        <tbody>
          {#each notes as note (note.id)}
            {@const open = Boolean(expanded[note.id])}
            <!-- Row click toggles the inline detail; the chevron is the keyboard control. -->
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
            <tr class="row-clickable" class:row-open={open} onclick={() => toggleFromRow(note.id)}>
              <td class="date-cell">
                <button
                  type="button"
                  class="disclosure"
                  class:open
                  aria-expanded={open}
                  aria-label={open ? `Hide details for ${note.title}` : `Show details for ${note.title}`}
                  onclick={(ev) => {
                    ev.stopPropagation();
                    toggleRow(note.id);
                  }}><Icon name="chevron" size={13} /></button>
                {formatDate(note.meetingDate)}
              </td>
              <td><span class="badge">{note.meetingType}</span></td>
              <td class="title-cell"><strong>{note.title}</strong></td>
              <td>{#if note.projectId}{app.projectName(note.projectId)}{:else}<span class="muted">—</span>{/if}</td>
              <td class="attendees-cell">{#if note.attendeeEmployeeIds.length}{employeeNames(note.attendeeEmployeeIds)}{:else}<span class="muted">—</span>{/if}</td>
              <td>{#if note.actionItems}<span class="action-mark">Yes</span>{:else}<span class="muted">—</span>{/if}</td>
            </tr>
            {#if open}
              <tr class="detail-row">
                <td colspan="6">
                  <div class="detail" aria-label={`Meeting details for ${note.title}`}>
                    {#if note.attendeeEmployeeIds.length}
                      <div class="detail-attendees">
                        <span class="detail-label">Attendees</span>
                        <span>{employeeNames(note.attendeeEmployeeIds)}</span>
                      </div>
                    {/if}
                    <div class="meeting-sections">
                      <section>
                        <h3>Discussion</h3>
                        <RichTextView value={note.notes} emptyText="No discussion notes recorded." />
                      </section>
                      <section class="action-section">
                        <h3>Action Items</h3>
                        <RichTextView value={note.actionItems} emptyText="No action items recorded." />
                      </section>
                    </div>
                    <div class="detail-footer">
                      <button type="button" onclick={() => (editing = note)}>Edit</button>
                      <button type="button" class="icon-btn" aria-label="Archive meeting note" title="Archive" onclick={() => void archive(note)}><Icon name="archive" size={16} /></button>
                      <button type="button" class="icon-btn danger" aria-label="Delete meeting note" title="Delete" onclick={() => requestDelete(note)}><Icon name="trash" size={16} /></button>
                      <span class="spacer"></span>
                      {#if note.actionItems}
                        <button type="button" class="primary" onclick={() => createFollowUpTask(note)}>Create follow-up task</button>
                      {/if}
                    </div>
                  </div>
                </td>
              </tr>
            {/if}
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</div>
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
  .meeting-toolbar { position: sticky; top: 0; z-index: 3; padding: .5rem 0; background: var(--bg); }
  .table-wrap { overflow-x: auto; }
  .row-clickable { cursor: pointer; }
  .date-cell { white-space: nowrap; }
  .title-cell { min-width: 14rem; }
  .attendees-cell {
    max-width: 16rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .action-mark { color: var(--accent); font-size: .7rem; font-weight: 650; text-transform: uppercase; letter-spacing: .04em; }
  .disclosure {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    margin-right: .3rem;
    padding: .1rem;
    min-height: 0;
    border: none;
    background: none;
    box-shadow: none;
    color: var(--text-muted);
    vertical-align: -.1rem;
    transition: transform .16s var(--ease-out), color .14s ease;
  }
  .disclosure:hover { background: none; color: var(--accent); }
  .disclosure.open { transform: rotate(90deg); color: var(--accent); }
  /* Keep the accent tick pinned while a row is open and merge it visually with
     its detail row by hiding the border between them. */
  .meeting-table tbody tr.row-open td { border-bottom-color: transparent; }
  .meeting-table tbody tr.row-open td:first-child { box-shadow: inset 3px 0 0 var(--accent); }
  .meeting-table tbody .detail-row > td { padding: .95rem 1.1rem 1.05rem; background: var(--surface-2); }
  .meeting-table tbody .detail-row { cursor: default; }
  .meeting-table tbody .detail-row:hover td:first-child { box-shadow: none; }
  .detail { display: grid; gap: .85rem; }
  .detail-attendees { display: grid; gap: .2rem; }
  .detail-label { color: var(--text-muted); font-size: .72rem; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; }
  .meeting-sections {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(19rem, 1fr));
    gap: .8rem;
    white-space: pre-wrap;
  }
  .meeting-sections section { padding: .9rem; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); }
  .meeting-sections .action-section { border-left: 3px solid var(--accent); }
  .meeting-sections h3 {
    margin: 0 0 .15rem;
    font-size: .82rem;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: .04em;
  }
  .detail-footer { display: flex; align-items: center; gap: .45rem; }
  .detail-footer button { font-size: .78rem; }
</style>
