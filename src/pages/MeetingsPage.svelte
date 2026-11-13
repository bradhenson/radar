<script lang="ts">
  import { app } from "../stores/app.svelte";
  import { ui } from "../stores/ui.svelte";
  import { router } from "../app/router.svelte";
  import ConfirmDialog from "../components/common/ConfirmDialog.svelte";
  import Dialog from "../components/common/Dialog.svelte";
  import { splitActionItems } from "../domain/rules/followUpTasks";
  import EmptyState from "../components/common/EmptyState.svelte";
  import Icon from "../components/common/Icon.svelte";
  import WorkspaceHeader from "../components/common/WorkspaceHeader.svelte";
  import RichTextView from "../components/common/RichTextView.svelte";
  import MeetingNoteForm from "../components/forms/MeetingNoteForm.svelte";
  import { MEETING_TYPES, type MeetingNote } from "../domain/models";
  import {
    DATE_RANGE_OPTIONS,
    isWithinDateRange,
    resolveDateRange,
    type DateRangePreset
  } from "../domain/rules/dateRange";
  import { formatDate, isValidIsoDate, nowTimestamp } from "../utils/dates";
  import { toCsv } from "../utils/csv";
  import { backupFilename, downloadText } from "../utils/download";
  import { isRichTextEmpty, normalizeRichText, richTextDocToPlainText, richTextFromPlainText } from "../utils/richTextDoc";

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

  // --- action items → tasks --------------------------------------------------
  // One action item keeps the single prefilled follow-up card. Several open a
  // preview with one row each; nothing is created until Create tasks.
  type ActionRow = { title: string; employeeId: string; dueDate: string; include: boolean };
  let actionNote = $state<MeetingNote | undefined>(undefined);
  let actionRows = $state<ActionRow[]>([]);
  let actionError = $state("");

  function startActionTasks(note: MeetingNote) {
    const items = splitActionItems(note.actionItems);
    if (items.length <= 1) {
      createFollowUpTask(note);
      return;
    }
    actionNote = note;
    actionRows = items.map((title) => ({ title, employeeId: "", dueDate: "", include: true }));
    actionError = "";
  }

  /** Attendees first, then everyone else, so the likely owners are at the top. */
  function ownerOptions(note: MeetingNote) {
    const attendees = note.attendeeEmployeeIds
      .map((id) => app.activeEmployees.find((e) => e.id === id))
      .filter((e): e is NonNullable<typeof e> => Boolean(e));
    const others = app.activeEmployees.filter((e) => !note.attendeeEmployeeIds.includes(e.id));
    return { attendees, others };
  }

  let includedCount = $derived(actionRows.filter((r) => r.include && r.title.trim()).length);

  async function createActionTasks() {
    const note = actionNote;
    if (!note) return;
    const rows = actionRows.filter((r) => r.include && r.title.trim());
    if (rows.some((r) => r.dueDate && !isValidIsoDate(r.dueDate))) {
      actionError = "One of the due dates is not valid.";
      return;
    }
    if (rows.length === 0) {
      actionError = "Include at least one action item.";
      return;
    }
    const origin = `From the meeting "${note.title}" on ${formatDate(note.meetingDate)}.`;
    await app.createTasks(
      rows.map((r) => ({
        title: r.title.trim(),
        employeeId: r.employeeId || undefined,
        dueDate: r.dueDate || undefined,
        projectId: note.projectId,
        description: richTextFromPlainText(origin)
      })),
      (task) => `Created task "${task.title}" from meeting "${note.title}"`
    );
    actionNote = undefined;
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
  <WorkspaceHeader title="Meeting Notes" section="Work">
    {#snippet filters()}
      <div class="header-metrics" aria-label="Meeting note totals">
        <span><strong>{app.meetingNotes.filter((note) => !note.isArchived).length}</strong> active notes</span>
        <span><strong>{recentCount}</strong> today or later</span>
        <span><strong>{app.meetingNotes.filter((note) => !note.isArchived && note.actionItems).length}</strong> with actions</span>
      </div>
    {/snippet}
    {#snippet actions()}
      <button type="button" class="primary" onclick={() => (createOpen = true)}>+ New Meeting Note</button>
    {/snippet}
  </WorkspaceHeader>

  <div class="toolbar record-toolbar meeting-toolbar">
    <input type="search" bind:value={search} placeholder="Search meeting notes…" aria-label="Search meeting notes" />
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
    <span class="spacer"></span>
    <button type="button" onclick={exportCsv} disabled={notes.length === 0}>Export CSV</button>
    <span class="result-count">{notes.length === activeCount ? `${notes.length} shown` : `${notes.length} of ${activeCount} shown`}</span>
  </div>

  {#if notes.length === 0}
    <EmptyState
      message="No meeting notes match."
      hint={filterRange !== "all" && activeCount > 0
        ? "Widen the date range to see older notes."
        : "Capture product team discussion notes and action items as they happen."}
    />
  {:else}
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <div class="table-scroll" role="region" aria-label="Meeting notes" tabindex="0">
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
              <td>{#if note.actionItems}<span class="muted action-mark"><Icon name="check" size={12} /> Yes</span>{:else}<span class="muted">—</span>{/if}</td>
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
                        {@const itemCount = splitActionItems(note.actionItems).length}
                        <button type="button" class="primary" onclick={() => startActionTasks(note)}>
                          {itemCount > 1 ? `Create tasks from ${itemCount} action items` : "Create follow-up task"}
                        </button>
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

{#if actionNote}
  {@const owners = ownerOptions(actionNote)}
  <Dialog title="Create tasks from action items" wide onclose={() => (actionNote = undefined)}>
    <p class="small muted" style="margin-top:0">
      One task per action item from "{actionNote.title}" ({formatDate(actionNote.meetingDate)}){actionNote.projectId ? `, linked to ${app.projectName(actionNote.projectId)}` : ""}. Untick any you do not want.
    </p>
    <ol class="action-rows">
      {#each actionRows as row, i (i)}
        <li class:excluded={!row.include}>
          <input type="checkbox" bind:checked={row.include} aria-label={`Create a task for action item ${i + 1}`} />
          <input type="text" bind:value={row.title} maxlength="200" aria-label={`Task title for action item ${i + 1}`} disabled={!row.include} />
          <select bind:value={row.employeeId} aria-label={`Owner for action item ${i + 1}`} disabled={!row.include}>
            <option value="">No owner</option>
            {#if owners.attendees.length}
              <optgroup label="Attendees">
                {#each owners.attendees as e (e.id)}<option value={e.id}>{e.displayName}</option>{/each}
              </optgroup>
            {/if}
            <optgroup label="Everyone else">
              {#each owners.others as e (e.id)}<option value={e.id}>{e.displayName}</option>{/each}
            </optgroup>
          </select>
          <input type="date" bind:value={row.dueDate} aria-label={`Due date for action item ${i + 1}`} disabled={!row.include} />
        </li>
      {/each}
    </ol>
    {#if actionError}<div class="field-error" role="alert">{actionError}</div>{/if}
    <div class="dialog-actions">
      <button type="button" onclick={() => (actionNote = undefined)}>Cancel</button>
      <button type="button" class="primary" disabled={includedCount === 0} onclick={() => void createActionTasks()}>
        Create {includedCount} task{includedCount === 1 ? "" : "s"}
      </button>
    </div>
  </Dialog>
{/if}

<style>
  .action-rows { list-style: none; margin: .4rem 0 .6rem; padding: 0; display: grid; gap: .4rem; }
  .action-rows li {
    display: grid;
    grid-template-columns: auto minmax(10rem, 1fr) minmax(8rem, 11rem) 9.5rem;
    gap: .4rem;
    align-items: center;
  }
  .action-rows li.excluded input[type="text"] { text-decoration: line-through; }
  .action-rows input[type="text"], .action-rows select, .action-rows input[type="date"] { width: 100%; min-width: 0; }
  @media (max-width: 640px) {
    .action-rows li { grid-template-columns: auto 1fr; }
    .action-rows select, .action-rows input[type="date"] { grid-column: 2; }
  }
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
  .action-mark { display: inline-flex; align-items: center; gap: .25rem; }
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
