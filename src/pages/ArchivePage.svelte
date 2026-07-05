<script lang="ts">
  // Archive (plan 12.12): archived tasks and inactive employees remain
  // searchable and restorable. Archived tasks and meeting notes can also be permanently deleted.
  import { app } from "../stores/app.svelte";
  import ConfirmDialog from "../components/common/ConfirmDialog.svelte";
  import EmptyState from "../components/common/EmptyState.svelte";
  import type { MeetingNote } from "../domain/models";
  import { formatDate, nowTimestamp } from "../utils/dates";
  import { statusLabel } from "../domain/models";

  let search = $state("");
  let pendingDeleteMeetingNote = $state<MeetingNote | undefined>(undefined);

  let archivedTasks = $derived(
    app.tasks
      .filter((t) => t.isArchived && (!search || t.title.toLowerCase().includes(search.toLowerCase())))
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
  );
  let archivedMeetingNotes = $derived(
    app.meetingNotes
      .filter((note) => note.isArchived && (!search || note.title.toLowerCase().includes(search.toLowerCase())))
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
  );
  let inactiveEmployees = $derived(app.employees.filter((e) => e.activeStatus !== "active" || e.isArchived));

  async function restoreTask(id: string) {
    const t = app.tasks.find((x) => x.id === id);
    if (!t) return;
    await app.putRecord(
      "tasks",
      { ...t, isArchived: false, updatedAt: nowTimestamp() },
      { actionType: "restored", summary: `Restored "${t.title}" from archive` }
    );
    app.toast("Task restored", "success");
  }

  async function deleteTask(id: string) {
    const t = app.tasks.find((x) => x.id === id);
    if (!t) return;
    const confirmed = window.confirm(
      `Permanently delete "${t.title}"?\n\nThis removes the task, its notes, and its checklist items.`
    );
    if (!confirmed) return;
    await app.deleteTask(t);
  }

  async function restoreMeetingNote(id: string) {
    const note = app.meetingNotes.find((x) => x.id === id);
    if (!note) return;
    await app.putRecord(
      "meetingNotes",
      { ...note, isArchived: false, updatedAt: nowTimestamp() },
      { actionType: "restored", summary: `Restored meeting note "${note.title}" from archive` }
    );
    app.toast("Meeting note restored", "success");
  }

  async function deleteMeetingNote(note: MeetingNote) {
    await app.deleteRecord("meetingNotes", note.id, `Deleted meeting note "${note.title}"`);
    pendingDeleteMeetingNote = undefined;
    app.toast("Meeting note deleted", "success");
  }
</script>

<div class="page">
  <div class="page-header"><h1>Archive</h1></div>
  <div class="toolbar">
    <input type="search" placeholder="Search archived items" bind:value={search} aria-label="Search archive" />
  </div>

  <h2>Archived tasks</h2>
  {#if archivedTasks.length === 0}
    <EmptyState message="No archived tasks." hint="Completed tasks can be archived from the task detail view." />
  {:else}
    <table class="data" style="margin-bottom:1.2rem">
      <thead><tr><th>Title</th><th>Status</th><th>Employee</th><th>Completed</th><th></th></tr></thead>
      <tbody>
        {#each archivedTasks as t (t.id)}
          <tr>
            <td>{t.title}</td>
            <td>{statusLabel(t.status)}</td>
            <td>{app.employeeName(t.employeeId)}</td>
            <td>{formatDate(t.completedDate)}</td>
            <td>
              <div class="row-actions">
                <button type="button" onclick={() => void restoreTask(t.id)}>Restore</button>
                <button type="button" class="danger" onclick={() => void deleteTask(t.id)}>Delete</button>
              </div>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}

  <h2>Archived meeting notes</h2>
  {#if archivedMeetingNotes.length === 0}
    <p class="muted">No archived meeting notes.</p>
  {:else}
    <table class="data" style="margin-bottom:1.2rem">
      <thead><tr><th>Title</th><th>Date</th><th>Type</th><th>Project</th><th></th></tr></thead>
      <tbody>
        {#each archivedMeetingNotes as note (note.id)}
          <tr>
            <td>{note.title}</td>
            <td>{formatDate(note.meetingDate)}</td>
            <td>{note.meetingType}</td>
            <td>{app.projectName(note.projectId)}</td>
            <td>
              <div class="row-actions">
                <button type="button" onclick={() => void restoreMeetingNote(note.id)}>Restore</button>
                <button type="button" class="danger" onclick={() => (pendingDeleteMeetingNote = note)}>Delete</button>
              </div>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}

  <h2>Inactive employees</h2>
  {#if inactiveEmployees.length === 0}
    <p class="muted">No inactive employees.</p>
  {:else}
    <table class="data">
      <thead><tr><th>Name</th><th>Status</th><th>Competency</th></tr></thead>
      <tbody>
        {#each inactiveEmployees as e (e.id)}
          <tr>
            <td><a href={"#/employees/" + e.id}>{e.displayName}</a></td>
            <td>{e.activeStatus.replace("_", " ")}</td>
            <td>{app.competencyCode(e.competencyId)}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</div>

{#if pendingDeleteMeetingNote}
  <ConfirmDialog
    title="Delete meeting note"
    message={`Permanently delete "${pendingDeleteMeetingNote.title}" from ${formatDate(pendingDeleteMeetingNote.meetingDate)}?`}
    confirmLabel="Delete note"
    danger
    onconfirm={() => void deleteMeetingNote(pendingDeleteMeetingNote!)}
    oncancel={() => (pendingDeleteMeetingNote = undefined)}
  />
{/if}

<style>
  .row-actions {
    display: flex;
    justify-content: flex-end;
    gap: .4rem;
    flex-wrap: wrap;
  }
</style>
