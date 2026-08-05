<script lang="ts">
  import { app } from "../stores/app.svelte";
  import { ui } from "../stores/ui.svelte";
  import { router } from "../app/router.svelte";
  import ConfirmDialog from "../components/common/ConfirmDialog.svelte";
  import EmptyState from "../components/common/EmptyState.svelte";
  import Icon from "../components/common/Icon.svelte";
  import RichTextView from "../components/common/RichTextView.svelte";
  import MeetingNoteForm from "../components/forms/MeetingNoteForm.svelte";
  import { MEETING_TYPES, type MeetingNote } from "../domain/models";
  import {
    DATE_RANGE_OPTIONS,
    isWithinDateRange,
    resolveDateRange,
    type DateRangePreset
  } from "../domain/rules/dateRange";
  import { formatDate, nowTimestamp } from "../utils/dates";
  import { toCsv } from "../utils/csv";
  import { backupFilename, downloadText } from "../utils/download";
  import { isRichTextEmpty, normalizeRichText, richTextDocToPlainText } from "../utils/richTextDoc";

  let search = $state("");
  let filterType = $state("");
  let filterProject = $state("");
  let filterEmployee = $state("");
  // Meeting notes accumulate forever, so the list opens on a recent window
  // rather than the whole history. The header count says how much is hidden.
  let filterRange = $state<DateRangePreset>("last90");
  let customFrom = $state("");
  let customTo = $state("");
  let createOpen = $state(false);
  let editing = $state<MeetingNote | undefined>(undefined);
  let pendingDelete = $state<MeetingNote | undefined>(undefined);
  let expanded = $state<Record<string, boolean>>({});

  function includesText(value: string | undefined, needle: string): boolean {
    return Boolean(value?.toLowerCase().includes(needle));
  }

  let activeCount = $derived(app.meetingNotes.filter((note) => !note.isArchived).length);

  let dateRange = $derived(resolveDateRange(filterRange, app.today, { from: customFrom, to: customTo }));

  let notes = $derived(
    app.meetingNotes
      .filter((note) => {
        if (note.isArchived) return false;
        if (!isWithinDateRange(note.meetingDate, dateRange)) return false;
        if (filterType && note.meetingType !== filterType) return false;
        if (filterProject && note.projectId !== filterProject) return false;
        if (filterEmployee && !note.attendeeEmployeeIds.includes(filterEmployee)) return false;
        const needle = search.trim().toLowerCase();
        if (!needle) return true;
        return (
          includesText(note.title, needle) ||
          includesText(note.meetingType, needle) ||
          includesText(richTextDocToPlainText(note.notes), needle) ||
          includesText(richTextDocToPlainText(note.actionItems), needle) ||
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

  // Deep link (global search, Today page): #/meetings/<id> clears the filters,
  // expands that note, and scrolls to it. One-shot — the param is consumed.
  $effect(() => {
    const id = router.current.param;
    if (!id || !app.meetingNotes.some((note) => note.id === id && !note.isArchived)) return;
    search = "";
    filterType = "";
    filterProject = "";
    filterEmployee = "";
    filterRange = "all";
    expanded[id] = true;
    router.go("meetings");
    requestAnimationFrame(() => {
      document.getElementById(`meeting-row-${id}`)?.scrollIntoView({ block: "center" });
    });
  });

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
        richTextDocToPlainText(note.notes),
        richTextDocToPlainText(note.actionItems)
      ])
    );
    try {
      await downloadText(backupFilename("RADAR_MeetingNotes", "csv"), csv, "text/csv");
    } catch {
      app.toast("Meeting export failed", "error");
    }
  }

  async function archive(note: MeetingNote) {
    const before = $state.snapshot(note) as MeetingNote;
    await app.putRecord(
      "meetingNotes",
      { ...note, isArchived: true, updatedAt: nowTimestamp() },
      { actionType: "archived", summary: `Archived meeting note "${note.title}"` }
    );
    app.toast(`Moved "${note.title}" to Archive`, "success", () => {
      void app.putRecord(
        "meetingNotes",
        { ...before, isArchived: false, updatedAt: nowTimestamp() },
        { actionType: "restored", summary: `Restored meeting note "${before.title}" from archive` }
      );
    });
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
      description: normalizeRichText(isRichTextEmpty(note.actionItems) ? note.notes : note.actionItems),
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
    <span class="muted">{notes.length === activeCount ? `${notes.length} shown` : `${notes.length} of ${activeCount} shown`}</span>
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
    <select bind:value={filterRange} aria-label="Filter by meeting date">
      {#each DATE_RANGE_OPTIONS as option (option.value)}
        <option value={option.value}>{option.label}</option>
      {/each}
    </select>
    {#if filterRange === "custom"}
      <span class="date-range">
        <label for="mn-range-from">From</label>
        <input id="mn-range-from" type="date" bind:value={customFrom} />
        <label for="mn-range-to">To</label>
        <input id="mn-range-to" type="date" bind:value={customTo} />
      </span>
    {/if}
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
    <EmptyState
      message="No meeting notes match."
      hint={filterRange !== "all" && activeCount > 0
        ? "Widen the date range to see older notes."
        : "Capture product team discussion notes and action items as they happen."}
    />
  {:else}
    <div class="table-wrap">
      <table class="data meeting-table">
        <thead>
          <tr><th>Date</th><th>Type</th><th>Title</th><th>Project</th><th>Attendees</th><th>Action items</th><th></th></tr>
        </thead>
        <tbody>
          {#each notes as note (note.id)}
            {@const open = Boolean(expanded[note.id])}
            <!-- Row click toggles the inline detail; the chevron is the keyboard control. -->
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
            <tr class="row-clickable" class:row-open={open} id={"meeting-row-" + note.id} onclick={() => toggleFromRow(note.id)}>
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
              <td class="actions-cell">
                <div class="row-actions">
                  <button
                    type="button"
                    class="icon-btn"
                    aria-label={`Archive meeting note ${note.title}`}
                    title="Archive"
                    onclick={(ev) => {
                      ev.stopPropagation();
                      void archive(note);
                    }}><Icon name="archive" size={16} /></button>
                  <button
                    type="button"
                    class="icon-btn danger"
                    aria-label={`Delete meeting note ${note.title}`}
                    title="Delete"
                    onclick={(ev) => {
                      ev.stopPropagation();
                      requestDelete(note);
                    }}><Icon name="trash" size={16} /></button>
                </div>
              </td>
            </tr>
            {#if open}
              <tr class="detail-row">
                <td colspan="7">
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
  .meeting-toolbar { position: sticky; top: 0; z-index: 3; padding: .5rem 0; background: transparent; }
  .date-range {
    display: inline-flex;
    align-items: center;
    gap: .35rem;
  }
  .date-range label {
    font-size: .78rem;
    font-weight: 700;
    color: var(--text-muted);
  }
  .title-cell { min-width: 14rem; }
  .actions-cell { width: 1%; white-space: nowrap; }
  .row-actions {
    display: flex;
    align-items: center;
    gap: .25rem;
    justify-content: flex-end;
  }
  .attendees-cell {
    max-width: 16rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .action-mark { color: var(--accent); font-size: .7rem; font-weight: 650; text-transform: uppercase; letter-spacing: .04em; }
  .detail-attendees { display: grid; gap: .2rem; }
  .detail-label { color: var(--text-muted); font-size: .72rem; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; }
  .meeting-sections {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
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
</style>
