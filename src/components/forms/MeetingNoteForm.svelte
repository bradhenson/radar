<script lang="ts">
  import Dialog from "../common/Dialog.svelte";
  import { app } from "../../stores/app.svelte";
  import { MEETING_TYPES, type MeetingNote } from "../../domain/models";
  import { isValidIsoDate, nowTimestamp, todayIso } from "../../utils/dates";
  import { newId } from "../../utils/ids";

  let {
    note,
    prefill = {},
    onclose
  }: { note?: MeetingNote; prefill?: Partial<MeetingNote>; onclose: () => void } = $props();

  function initialSource(): Partial<MeetingNote> {
    return note ?? prefill;
  }

  let isEditing = $derived(note !== undefined);
  let title = $state(initialSource().title ?? "");
  let meetingDate = $state(initialSource().meetingDate ?? todayIso());
  let meetingType = $state(initialSource().meetingType ?? "Product team");
  let projectId = $state(initialSource().projectId ?? "");
  let attendeeEmployeeIds = $state<string[]>([...(initialSource().attendeeEmployeeIds ?? [])]);
  let notes = $state(initialSource().notes ?? "");
  let actionItems = $state(initialSource().actionItems ?? "");
  let error = $state("");
  let saving = $state(false);

  function toggleEmployee(id: string, checked: boolean) {
    attendeeEmployeeIds = checked
      ? [...new Set([...attendeeEmployeeIds, id])]
      : attendeeEmployeeIds.filter((employeeId) => employeeId !== id);
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
</script>

<Dialog title={isEditing ? "Meeting Note" : "New Meeting Note"} wide {onclose}>
  <form
    onsubmit={(e) => {
      e.preventDefault();
      void save();
    }}
  >
    <label for="mn-title">Title <span class="req">*</span></label>
    <input id="mn-title" type="text" bind:value={title} maxlength="200" style="width:100%" />
    {#if error}<div class="field-error">{error}</div>{/if}

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

    <div class="field-label">Linked employees</div>
    <div class="employee-grid">
      {#each app.activeEmployees as employee (employee.id)}
        <label class="check-inline">
          <input
            type="checkbox"
            checked={attendeeEmployeeIds.includes(employee.id)}
            onchange={(e) => toggleEmployee(employee.id, (e.currentTarget as HTMLInputElement).checked)}
          />
          {employee.displayName}
        </label>
      {/each}
    </div>

    <label for="mn-notes">Discussion notes</label>
    <textarea id="mn-notes" class="discussion-notes" bind:value={notes} rows="8" maxlength="20000"></textarea>

    <label for="mn-actions">Action items</label>
    <textarea id="mn-actions" bind:value={actionItems} rows="3" maxlength="10000" style="width:100%"></textarea>

    <div class="form-actions">
      <button type="button" onclick={onclose}>Cancel</button>
      <button type="submit" class="primary" disabled={saving}>{saving ? "Saving..." : "Save"}</button>
    </div>
  </form>
</Dialog>

<style>
  .grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 0 .8rem;
  }
  .employee-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(12rem, 1fr));
    gap: .15rem .8rem;
    margin: .2rem 0 .6rem;
  }
  .field-label {
    display: block;
    margin-top: .7rem;
    margin-bottom: .2rem;
    font-size: .83rem;
    font-weight: 700;
  }
  .check-inline {
    display: flex;
    align-items: center;
    gap: .45rem;
    font-weight: 400;
    margin: .1rem 0;
  }
  .form-actions {
    display: flex;
    gap: .5rem;
    justify-content: flex-end;
    margin-top: 1rem;
  }
  .discussion-notes {
    width: 100%;
    min-height: 12rem;
  }
  @media (max-width: 800px) {
    .grid { grid-template-columns: 1fr; }
  }
</style>
