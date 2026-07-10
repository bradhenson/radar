<script lang="ts">
  import ConfirmDialog from "../common/ConfirmDialog.svelte";
  import Dialog from "../common/Dialog.svelte";
  import Icon from "../common/Icon.svelte";
  import { app } from "../../stores/app.svelte";
  import { MEETING_TYPES, type MeetingNote } from "../../domain/models";
  import { formatDate, isValidIsoDate, nowTimestamp, todayIso } from "../../utils/dates";
  import { newId } from "../../utils/ids";

  let {
    note,
    prefill = {},
    onclose
  }: { note?: MeetingNote; prefill?: Partial<MeetingNote>; onclose: () => void } = $props();

  let isEditing = $derived(note !== undefined);

  function initialSource(): Partial<MeetingNote> {
    return note ?? prefill;
  }

  // Snapshot of the values the form opened with. It seeds the fields and lets
  // us tell whether anything changed when the dialog is dismissed.
  const initial = {
    title: initialSource().title ?? "",
    meetingDate: initialSource().meetingDate ?? todayIso(),
    meetingType: initialSource().meetingType ?? "Product team",
    projectId: initialSource().projectId ?? "",
    attendeeEmployeeIds: [...(initialSource().attendeeEmployeeIds ?? [])],
    notes: initialSource().notes ?? "",
    actionItems: initialSource().actionItems ?? ""
  };

  let title = $state(initial.title);
  let meetingDate = $state(initial.meetingDate);
  let meetingType = $state(initial.meetingType);
  let projectId = $state(initial.projectId);
  let attendeeEmployeeIds = $state<string[]>([...initial.attendeeEmployeeIds]);
  let selectedEmployeeId = $state("");
  let notes = $state(initial.notes);
  let actionItems = $state(initial.actionItems);
  let error = $state("");
  let saving = $state(false);
  let confirmDelete = $state(false);

  // Has the user changed anything worth persisting?
  let isDirty = $derived(
    title !== initial.title ||
      meetingDate !== initial.meetingDate ||
      meetingType !== initial.meetingType ||
      projectId !== initial.projectId ||
      notes !== initial.notes ||
      actionItems !== initial.actionItems ||
      attendeeEmployeeIds.length !== initial.attendeeEmployeeIds.length ||
      attendeeEmployeeIds.some((id) => !initial.attendeeEmployeeIds.includes(id))
  );

  let linkedEmployees = $derived(
    attendeeEmployeeIds
      .map((id) => app.employees.find((employee) => employee.id === id))
      .filter((employee) => employee !== undefined)
      .sort((a, b) => a.displayName.localeCompare(b.displayName))
  );

  let employeePickerOptions = $derived(
    app.activeEmployees
      .filter((employee) => !attendeeEmployeeIds.includes(employee.id))
      .sort((a, b) => a.displayName.localeCompare(b.displayName))
  );

  function addEmployee(id: string) {
    if (!id) return;
    attendeeEmployeeIds = [...new Set([...attendeeEmployeeIds, id])];
    selectedEmployeeId = "";
  }

  function removeEmployee(id: string) {
    attendeeEmployeeIds = attendeeEmployeeIds.filter((employeeId) => employeeId !== id);
  }

  async function save() {
    if (saving) return;
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      error = "Title is required.";
      return;
    }
    if (!isValidIsoDate(meetingDate)) {
      error = "Date is not valid.";
      return;
    }

    const now = nowTimestamp();
    const record: MeetingNote = {
      id: note?.id ?? newId(),
      meetingDate,
      title: trimmedTitle,
      meetingType,
      projectId: projectId || undefined,
      attendeeEmployeeIds,
      notes: notes.trim() || undefined,
      actionItems: actionItems.trim() || undefined,
      createdAt: note?.createdAt ?? now,
      updatedAt: now,
      isArchived: note?.isArchived ?? false
    };

    saving = true;
    try {
      await app.putRecord("meetingNotes", record, {
        actionType: isEditing ? "updated" : "created",
        summary: `${isEditing ? "Updated" : "Recorded"} meeting note "${record.title}"`
      });
      app.toast(isEditing ? "Meeting note updated" : "Meeting note saved", "success");
      onclose();
    } catch (e) {
      error = `Save failed: ${e instanceof Error ? e.message : String(e)}`;
    } finally {
      saving = false;
    }
  }

  // Dismissing the dialog (backdrop click, Escape, or the ✕) saves in-progress
  // work instead of throwing it away. Cancel stays the explicit discard path.
  async function requestClose() {
    if (saving) return;
    if (!isDirty) {
      onclose();
      return;
    }
    // save() closes on success. If a required field is missing it surfaces the
    // error and keeps the dialog open, so the notes aren't silently lost.
    await save();
  }

  async function deleteNote() {
    if (!note || saving) return;
    saving = true;
    try {
      await app.deleteRecord("meetingNotes", note.id, `Deleted meeting note "${note.title}"`);
      app.toast("Meeting note deleted", "success");
      confirmDelete = false;
      onclose();
    } catch (e) {
      error = `Delete failed: ${e instanceof Error ? e.message : String(e)}`;
    } finally {
      saving = false;
    }
  }
</script>

<Dialog title={isEditing ? "Meeting Note" : "New Meeting Note"} wide onclose={requestClose}>
  <form
    onsubmit={(e) => {
      e.preventDefault();
      void save();
    }}
  >
    <label for="mn-title">Title <span class="req">*</span></label>
    <input id="mn-title" type="text" bind:value={title} maxlength="200" style="width:100%" />
    {#if error}<div class="field-error" role="alert">{error}</div>{/if}

    <div class="grid">
      <div>
        <label for="mn-date">Date <span class="req">*</span></label>
        <input id="mn-date" type="date" bind:value={meetingDate} style="width:100%" />
      </div>
      <div>
        <label for="mn-type">Type</label>
        <select id="mn-type" bind:value={meetingType} style="width:100%">
          {#each MEETING_TYPES as type (type)}
            <option value={type}>{type}</option>
          {/each}
        </select>
      </div>
      <div>
        <label for="mn-project">Project</label>
        <select id="mn-project" bind:value={projectId} style="width:100%">
          <option value="">(none)</option>
          {#each app.activeProjects as project (project.id)}
            <option value={project.id}>{project.name}</option>
          {/each}
        </select>
      </div>
    </div>

    <div class="employee-field">
      <div class="field-label">Linked employees</div>
      <div class="employee-picker">
        <select
          bind:value={selectedEmployeeId}
          aria-label="Link employee"
          onchange={(e) => addEmployee((e.currentTarget as HTMLSelectElement).value)}
        >
          <option value="">Select employee</option>
          {#each employeePickerOptions as employee (employee.id)}
            <option value={employee.id}>{employee.displayName}</option>
          {/each}
        </select>
      </div>
      {#if linkedEmployees.length}
        <div class="linked-employees" aria-label="Linked employees">
          {#each linkedEmployees as employee (employee.id)}
            <span class="employee-chip">
              {employee.displayName}
              <button type="button" class="chip-remove" aria-label={`Remove ${employee.displayName}`} title="Remove" onclick={() => removeEmployee(employee.id)}><Icon name="close" size={13} /></button>
            </span>
          {/each}
        </div>
      {:else}
        <p class="muted small linked-empty">No linked employees</p>
      {/if}
    </div>

    <label for="mn-notes">Discussion notes</label>
    <textarea id="mn-notes" class="discussion-notes" bind:value={notes} rows="8" maxlength="20000"></textarea>

    <label for="mn-actions">Action items</label>
    <textarea id="mn-actions" bind:value={actionItems} rows="3" maxlength="10000" style="width:100%"></textarea>

    <div class="form-actions">
      {#if isEditing}
        <button type="button" class="icon-btn danger delete-action" disabled={saving} aria-label="Delete meeting note" title="Delete" onclick={() => (confirmDelete = true)}><Icon name="trash" size={17} /></button>
      {/if}
      <button type="button" onclick={onclose} title="Close without saving changes">Cancel</button>
      <button type="submit" class="primary" disabled={saving}>{saving ? "Saving..." : "Save"}</button>
    </div>
  </form>
</Dialog>

{#if confirmDelete && note}
  <ConfirmDialog
    title="Delete meeting note"
    message={`Permanently delete "${note.title}" from ${formatDate(note.meetingDate)}?`}
    confirmLabel="Delete note"
    danger
    onconfirm={() => void deleteNote()}
    oncancel={() => (confirmDelete = false)}
  />
{/if}

<style>
  .grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 0 .8rem;
  }
  .field-label {
    display: block;
    margin-top: .7rem;
    margin-bottom: .2rem;
    font-size: .83rem;
    font-weight: 700;
  }
  .employee-field {
    margin-bottom: .6rem;
  }
  .employee-picker {
    display: flex;
    gap: .5rem;
    align-items: end;
    flex-wrap: wrap;
  }
  .employee-picker select {
    flex: 1 1 16rem;
  }
  .linked-employees {
    display: flex;
    flex-wrap: wrap;
    gap: .35rem;
    margin-top: .5rem;
  }
  .employee-chip {
    display: inline-flex;
    align-items: center;
    gap: .35rem;
    max-width: 100%;
    padding: .18rem .35rem .18rem .55rem;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface-2);
    font-size: .82rem;
    font-weight: 600;
  }
  .employee-chip button.chip-remove {
    display: inline-grid;
    place-items: center;
    min-height: 1.45rem;
    width: 1.45rem;
    padding: 0;
    color: var(--text-muted);
    background: transparent;
    border-color: transparent;
    box-shadow: none;
  }
  .employee-chip button.chip-remove:hover {
    color: var(--danger);
    background: var(--overdue-bg);
    border-color: transparent;
  }
  .linked-empty {
    margin: .35rem 0 0;
  }
  .form-actions {
    display: flex;
    align-items: center;
    gap: .5rem;
    justify-content: flex-end;
    margin-top: 1rem;
  }
  .delete-action {
    margin-right: auto;
  }
  .discussion-notes {
    width: 100%;
    min-height: 12rem;
  }
  @media (max-width: 800px) {
    .grid { grid-template-columns: 1fr; }
    .employee-picker select {
      flex-basis: 100%;
      width: 100%;
    }
  }
</style>
