<script lang="ts">
  import Dialog from "../common/Dialog.svelte";
  import RichTextEditor from "../common/RichTextEditor.svelte";
  import { app } from "../../stores/app.svelte";
  import { QUICK_NOTE_PURPOSES, type QuickNote, type QuickNotePurpose } from "../../domain/models";
  import { quickNotePurposeLabel, quickNoteTitle } from "../../domain/rules/quickNotes";
  import { nowTimestamp } from "../../utils/dates";
  import { newId } from "../../utils/ids";

  let {
    note,
    onclose
  }: { note?: QuickNote; onclose: () => void } = $props();

  function initialSource(): QuickNote | undefined {
    return note;
  }

  const source = initialSource();
  const initial = {
    body: source?.body ?? "",
    purpose: source?.purpose ?? "scratch" as QuickNotePurpose,
    employeeId: source?.employeeId ?? "",
    projectId: source?.projectId ?? "",
    taskId: source?.taskId ?? "",
    isPinned: source?.isPinned ?? false
  };

  let body = $state(initial.body);
  let purpose = $state<QuickNotePurpose>(initial.purpose);
  let employeeId = $state(initial.employeeId);
  let projectId = $state(initial.projectId);
  let taskId = $state(initial.taskId);
  let isPinned = $state(initial.isPinned);
  let saving = $state(false);
  let error = $state("");

  let isDirty = $derived(
    body !== initial.body ||
      purpose !== initial.purpose ||
      employeeId !== initial.employeeId ||
      projectId !== initial.projectId ||
      taskId !== initial.taskId ||
      isPinned !== initial.isPinned
  );

  async function save() {
    const trimmed = body.trim();
    if (!trimmed) {
      error = "Write something before saving the note.";
      return;
    }
    saving = true;
    error = "";
    const now = nowTimestamp();
    const record: QuickNote = {
      id: note?.id ?? newId(),
      body: trimmed,
      purpose,
      employeeId: employeeId || undefined,
      projectId: projectId || undefined,
      taskId: taskId || undefined,
      isPinned,
      reviewedAt: note?.reviewedAt,
      createdAt: note?.createdAt ?? now,
      updatedAt: now,
      isArchived: note?.isArchived ?? false
    };
    try {
      await app.putRecord("quickNotes", record, {
        actionType: note ? "updated" : "created",
        summary: `${note ? "Updated" : "Captured"} note "${quickNoteTitle(record.body, 60)}"`
      });
      app.toast(note ? "Note updated" : "Note captured", "success");
      onclose();
    } catch (e) {
      error = `Save failed: ${e instanceof Error ? e.message : String(e)}`;
    } finally {
      saving = false;
    }
  }

</script>

<Dialog title={note ? "Edit note" : "Quick note"} {onclose} wide unsavedGuard={() => isDirty}>
  <form onsubmit={(event) => { event.preventDefault(); void save(); }}>
    <label for="qn-body">Note <span class="req">*</span></label>
    <RichTextEditor
      id="qn-body"
      bind:value={body}
      rows={7}
      maxlength={10000}
      placeholder="Jot down a thought, decision, question, or follow-up…"
      ariaLabel="Note"
    />
    <div class="field-hint">Work-related, objective, and concise.</div>
    {#if error}<div class="field-error" role="alert">{error}</div>{/if}

    <div class="details-grid">
      <div>
        <label for="qn-purpose">Purpose</label>
        <select id="qn-purpose" bind:value={purpose}>
          {#each QUICK_NOTE_PURPOSES as value (value)}
            <option value={value}>{quickNotePurposeLabel(value)}</option>
          {/each}
        </select>
      </div>
      <div>
        <label for="qn-employee">Employee</label>
        <select id="qn-employee" bind:value={employeeId}>
          <option value="">(none)</option>
          {#each app.activeEmployees as employee (employee.id)}
            <option value={employee.id}>{employee.displayName}</option>
          {/each}
        </select>
      </div>
      <div>
        <label for="qn-project">Project</label>
        <select id="qn-project" bind:value={projectId}>
          <option value="">(none)</option>
          {#each app.projects.filter((project) => !project.isArchived) as project (project.id)}
            <option value={project.id}>{project.name}</option>
          {/each}
        </select>
      </div>
      <div>
        <label for="qn-task">Task</label>
        <select id="qn-task" bind:value={taskId}>
          <option value="">(none)</option>
          {#each app.tasks.filter((task) => !task.isArchived && task.status !== "cancelled") as task (task.id)}
            <option value={task.id}>{task.title}</option>
          {/each}
        </select>
      </div>
    </div>

    <label class="check-row"><input type="checkbox" bind:checked={isPinned} /> Keep on the reference shelf</label>

    <div class="actions">
      <button type="button" onclick={onclose}>Cancel</button>
      <button type="submit" class="primary" disabled={saving}>{saving ? "Saving…" : "Save note"}</button>
    </div>
  </form>
</Dialog>

<style>
  .details-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: .75rem; }
  .details-grid select { width: 100%; }
  .check-row { display: flex; align-items: center; gap: .5rem; margin-top: .9rem; }
  .actions { display: flex; justify-content: flex-end; gap: .5rem; margin-top: 1rem; }
  @media (max-width: 700px) { .details-grid { grid-template-columns: 1fr; } }
</style>
