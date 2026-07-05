<script lang="ts">
  // Full task editor with notes, checklist, and activity (plan 12.2, 14).
  import Dialog from "../common/Dialog.svelte";
  import { app } from "../../stores/app.svelte";
  import { ui } from "../../stores/ui.svelte";
  import {
    TASK_PRIORITIES,
    TASK_STATUSES,
    statusLabel,
    type Task
  } from "../../domain/models";
  import { formatTimestamp, isValidIsoDate, nowTimestamp } from "../../utils/dates";
  import { newId } from "../../utils/ids";
  import { orderForAppend } from "../../domain/rules/boardOrder";

  let {
    task,
    defaults = {},
    onclose
  }: { task?: Task; defaults?: Partial<Task>; onclose?: () => void } = $props();

  function getInitialTask(): Task {
    return task ?? app.createTask({ ...defaults, title: defaults.title ?? "" });
  }

  function hasExistingTask(): boolean {
    return task !== undefined;
  }

  const initialTask = getInitialTask();
  const isNewTask = !hasExistingTask();

  // Editable copy; persisted on Save.
  let draft = $state({ ...initialTask, tags: [...initialTask.tags] });
  let tagsText = $state(initialTask.tags.join(", "));
  let newNote = $state("");
  let newChecklistItem = $state("");
  let error = $state("");
  let saving = $state(false);

  let notes = $derived(
    isNewTask ? [] : app.taskNotes.filter((n) => n.taskId === initialTask.id).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  );
  let checklist = $derived(
    isNewTask ? [] : app.checklistItems.filter((c) => c.taskId === initialTask.id).sort((a, b) => a.order - b.order)
  );
  let activity = $derived(
    isNewTask
      ? []
      : app.activityEntries
          .filter((a) => a.entityType === "tasks" && a.entityId === initialTask.id)
          .sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1))
          .slice(0, 15)
  );

  type EditableTaskFields = ReturnType<typeof editableFieldsFromDraft>;
  type EditableTaskField = keyof EditableTaskFields;

  function close() {
    if (onclose) onclose();
    else ui.detailTaskId = undefined;
  }

  function normalizedTags(): string[] {
    return tagsText
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean)
      .slice(0, 20);
  }

  function editableFieldsFromDraft() {
    return {
      title: draft.title.trim(),
      description: draft.description?.trim() || undefined,
      status: draft.status,
      boardColumnId: draft.boardColumnId || app.defaultBoardColumnId(),
      priority: draft.priority,
      category: draft.category,
      employeeId: draft.employeeId || undefined,
      projectId: draft.projectId || undefined,
      dueDate: draft.dueDate || undefined,
      startDate: draft.startDate || undefined,
      reminderDate: draft.reminderDate || undefined,
      followUpDate: draft.followUpDate || undefined,
      waitingReason: draft.waitingReason?.trim() || undefined,
      waitingOn: draft.waitingOn?.trim() || undefined,
      showOnCard: draft.showOnCard,
      tags: normalizedTags()
    };
  }

  function editableFieldsFromTask(t: Task) {
    return {
      title: t.title.trim(),
      description: t.description?.trim() || undefined,
      status: t.status,
      boardColumnId: app.taskBoardColumnId(t),
      priority: t.priority,
      category: t.category,
      employeeId: t.employeeId || undefined,
      projectId: t.projectId || undefined,
      dueDate: t.dueDate || undefined,
      startDate: t.startDate || undefined,
      reminderDate: t.reminderDate || undefined,
      followUpDate: t.followUpDate || undefined,
      waitingReason: t.waitingReason?.trim() || undefined,
      waitingOn: t.waitingOn?.trim() || undefined,
      showOnCard: t.showOnCard,
      tags: [...t.tags]
    };
  }

  let hasUnsavedChanges = $derived(
    JSON.stringify(editableFieldsFromDraft()) !== JSON.stringify(editableFieldsFromTask(initialTask))
  );

  function validateDraft(fields: ReturnType<typeof editableFieldsFromDraft>): boolean {
    if (!fields.title) {
      error = "Title is required.";
      return false;
    }
    for (const [label, v] of [
      ["Due date", fields.dueDate],
      ["Start date", fields.startDate],
      ["Reminder date", fields.reminderDate],
      ["Follow-up date", fields.followUpDate]
    ] as const) {
      if (v && !isValidIsoDate(v)) {
        error = `${label} is not a valid date.`;
        return false;
      }
    }
    if (fields.startDate && fields.dueDate && fields.dueDate < fields.startDate) {
      error = "Due date must be on or after the start date.";
      return false;
    }
    error = "";
    return true;
  }

  function fieldChanged(a: EditableTaskFields[EditableTaskField], b: EditableTaskFields[EditableTaskField]): boolean {
    return Array.isArray(a) && Array.isArray(b) ? a.join("\u0000") !== b.join("\u0000") : a !== b;
  }

  const FIELD_LABELS: Record<EditableTaskField, string> = {
    title: "title",
    description: "description",
    status: "status",
    boardColumnId: "board column",
    priority: "priority",
    category: "category",
    employeeId: "employee",
    projectId: "project",
    dueDate: "due date",
    startDate: "start date",
    reminderDate: "reminder date",
    followUpDate: "follow-up date",
    waitingReason: "waiting reason",
    waitingOn: "waiting on",
    showOnCard: "show on card",
    tags: "tags"
  };

  function listFieldLabels(fields: EditableTaskField[]): string {
    const labels = fields.map((field) => FIELD_LABELS[field]);
    if (labels.length === 0) return "";
    if (labels.length === 1) return labels[0]!;
    if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
    return `${labels.slice(0, -1).join(", ")}, and ${labels[labels.length - 1]}`;
  }

  function changedFieldsSummary(fields: EditableTaskField[]): string {
    if (fields.length === 0) return "fields changed";
    if (fields.length <= 4) return `${listFieldLabels(fields)} changed`;
    const visibleFields = fields.slice(0, 3);
    const hiddenCount = fields.length - visibleFields.length;
    return `${fields.length} fields changed (${listFieldLabels(visibleFields)}, plus ${hiddenCount} more)`;
  }

  function updatedFieldsSummary(fields: EditableTaskField[]): string {
    if (fields.length === 0) return "fields";
    if (fields.length <= 4) return listFieldLabels(fields);
    const visibleFields = fields.slice(0, 3);
    const hiddenCount = fields.length - visibleFields.length;
    return `${fields.length} fields (${listFieldLabels(visibleFields)}, plus ${hiddenCount} more)`;
  }

  function taskChangeSummary(fields: EditableTaskFields, statusChanged: boolean): string {
    const beforeFields = editableFieldsFromTask(initialTask);
    const changedFields = (Object.keys(fields) as EditableTaskField[]).filter(
      (field) => fieldChanged(beforeFields[field], fields[field]) && !(statusChanged && field === "status")
    );
    if (statusChanged) {
      const base = `Changed status for "${fields.title}" from ${statusLabel(initialTask.status)} to ${statusLabel(fields.status)}`;
      return changedFields.length ? `${base}; also updated ${updatedFieldsSummary(changedFields)}` : base;
    }
    return `Updated task "${fields.title}": ${changedFieldsSummary(changedFields)}`;
  }

  async function save(closeAfter = true): Promise<boolean> {
    if (saving) return false;
    const fields = editableFieldsFromDraft();
    if (!validateDraft(fields)) return false;
    if (!hasUnsavedChanges) {
      if (closeAfter) close();
      return true;
    }

    const statusChanged = fields.status !== initialTask.status;
    const boardColumnChanged = fields.boardColumnId !== app.taskBoardColumnId(initialTask);
    const updated: Task = {
      ...initialTask,
      ...fields
    };
    if (isNewTask || boardColumnChanged) {
      updated.boardOrder = orderForAppend(
        app.tasks
          .filter((t) => app.taskBoardColumnId(t) === updated.boardColumnId && !t.isArchived && t.id !== initialTask.id)
          .map((t) => t.boardOrder)
      );
    }
    if (updated.status === "waiting" && (isNewTask || initialTask.status !== "waiting")) updated.waitingSince = nowTimestamp();
    if (updated.status === "complete" && (isNewTask || initialTask.status !== "complete")) updated.completedDate = app.today;
    if (updated.status !== "complete") updated.completedDate = undefined;
    saving = true;
    try {
      if (isNewTask) {
        await app.saveNewTask(updated);
      } else {
        await app.updateTask(
          updated,
          taskChangeSummary(fields, statusChanged),
          statusChanged ? "status_changed" : "updated"
        );
      }
      if (statusChanged && updated.status === "complete" && updated.employeeId && !updated.performanceInputCreated) {
        ui.performancePromptTask = updated;
      }
      if (closeAfter) close();
      return true;
    } catch (e) {
      error = `Save failed: ${e instanceof Error ? e.message : String(e)}`;
      return false;
    } finally {
      saving = false;
    }
  }

  async function autosaveAndClose() {
    if (saving) return;
    if (!hasUnsavedChanges) {
      close();
      return;
    }
    await save(true);
  }

  function discardAndClose() {
    close();
  }

  async function completeNow() {
    if (isNewTask) return;
    const updated = await app.completeTask(initialTask);
    if (updated.employeeId && !updated.performanceInputCreated) {
      ui.performancePromptTask = updated;
    }
    close();
  }

  async function archive() {
    if (isNewTask) return;
    await app.updateTask({ ...initialTask, isArchived: true }, `Archived "${initialTask.title}"`, "archived");
    close();
  }

  async function addNote() {
    const body = newNote.trim();
    if (!body) return;
    const now = nowTimestamp();
    await app.putRecord(
      "taskNotes",
      { id: newId(), taskId: initialTask.id, body, noteType: "general", createdAt: now, updatedAt: now },
      { actionType: "updated", summary: `Added note to "${initialTask.title}"`, entityType: "tasks" }
    );
    newNote = "";
  }

  async function addChecklistItem() {
    const title = newChecklistItem.trim();
    if (!title) return;
    await app.putRecord("checklistItems", {
      id: newId(),
      taskId: initialTask.id,
      title,
      isComplete: false,
      order: checklist.length + 1
    });
    newChecklistItem = "";
  }

  async function toggleChecklist(id: string) {
    const item = checklist.find((c) => c.id === id);
    if (!item) return;
    await app.putRecord("checklistItems", {
      ...item,
      isComplete: !item.isComplete,
      completedAt: !item.isComplete ? nowTimestamp() : undefined
    });
  }
</script>

<Dialog title={isNewTask ? "New Task" : "Task"} wide onclose={() => void autosaveAndClose()}>
  <form
    onsubmit={(e) => {
      e.preventDefault();
      void save();
    }}
  >
    <label for="td-title">Title <span class="req">*</span></label>
    <input id="td-title" type="text" bind:value={draft.title} maxlength="200" style="width:100%" />
    {#if error}<div class="field-error">{error}</div>{/if}

    <label for="td-desc">Description</label>
    <textarea id="td-desc" bind:value={draft.description} rows="3" maxlength="10000" style="width:100%"></textarea>
    <label class="show-on-card">
      <input
        type="checkbox"
        checked={draft.showOnCard === "description"}
        onchange={(e) => (draft.showOnCard = (e.currentTarget as HTMLInputElement).checked ? "description" : undefined)}
      />
      Show description on card
    </label>

    <div class="grid">
      <div>
        <label for="td-status">Status</label>
        <select id="td-status" bind:value={draft.status} style="width:100%">
          {#each TASK_STATUSES as s (s.value)}<option value={s.value}>{s.label}</option>{/each}
        </select>
      </div>
      <div>
        <label for="td-column">Board column</label>
        <select id="td-column" bind:value={draft.boardColumnId} style="width:100%">
          {#each app.boardColumnOptions(draft.boardColumnId) as c (c.id)}<option value={c.id}>{c.label}</option>{/each}
        </select>
      </div>
      <div>
        <label for="td-priority">Priority</label>
        <select id="td-priority" bind:value={draft.priority} style="width:100%">
          {#each TASK_PRIORITIES as p (p.value)}<option value={p.value}>{p.label}</option>{/each}
        </select>
      </div>
      <div>
        <label for="td-category">Category</label>
        <select id="td-category" bind:value={draft.category} style="width:100%">
          {#each app.taskCategoryOptions(draft.category) as c (c.id)}<option value={c.id}>{c.label}</option>{/each}
        </select>
      </div>
      <div>
        <label for="td-emp">Employee</label>
        <select id="td-emp" bind:value={draft.employeeId} style="width:100%">
          <option value={undefined}>(none)</option>
          {#each app.activeEmployees as e (e.id)}<option value={e.id}>{e.displayName}</option>{/each}
        </select>
      </div>
      <div>
        <label for="td-proj">Project</label>
        <select id="td-proj" bind:value={draft.projectId} style="width:100%">
          <option value={undefined}>(none)</option>
          {#each app.activeProjects as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
        </select>
      </div>
      <div>
        <label for="td-start">Start date</label>
        <input id="td-start" type="date" bind:value={draft.startDate} style="width:100%" />
      </div>
      <div>
        <label for="td-due">Due date</label>
        <input id="td-due" type="date" bind:value={draft.dueDate} style="width:100%" />
      </div>
      <div>
        <label for="td-reminder">Reminder date</label>
        <input id="td-reminder" type="date" bind:value={draft.reminderDate} style="width:100%" />
      </div>
      <div>
        <label for="td-tags">Tags <span class="field-hint">(comma separated)</span></label>
        <input id="td-tags" type="text" bind:value={tagsText} style="width:100%" />
      </div>
      {#if draft.status === "waiting"}
        <div>
          <label for="td-waitingon">Waiting on</label>
          <input id="td-waitingon" type="text" bind:value={draft.waitingOn} maxlength="200" style="width:100%" />
        </div>
        <div>
          <label for="td-waitingreason">Waiting reason</label>
          <input id="td-waitingreason" type="text" bind:value={draft.waitingReason} maxlength="500" style="width:100%" />
        </div>
        <div>
          <label for="td-followup">Follow-up date</label>
          <input id="td-followup" type="date" bind:value={draft.followUpDate} style="width:100%" />
        </div>
      {/if}
    </div>

    <div style="display:flex; gap:.5rem; margin-top:1rem; flex-wrap:wrap;">
      <button type="submit" class="primary" disabled={saving}>{saving ? "Saving..." : isNewTask ? "Create task" : "Save"}</button>
      {#if !isNewTask && initialTask.status !== "complete"}
        <button type="button" onclick={() => void completeNow()}>Complete</button>
      {/if}
      {#if !isNewTask && !initialTask.isArchived}
        <button type="button" onclick={() => void archive()}>Archive</button>
      {/if}
      <span class="spacer" style="flex:1"></span>
      <button type="button" onclick={discardAndClose} title="Close without saving changes">Cancel</button>
    </div>
  </form>

  {#if !isNewTask}
    <hr style="border:none; border-top:1px solid var(--border); margin:1rem 0" />

    <div class="grid2">
      <section>
        <h3>Checklist {#if checklist.length}<span class="muted small">({checklist.filter((c) => c.isComplete).length} of {checklist.length} complete)</span>{/if}</h3>
        <label class="show-on-card">
          <input
            type="checkbox"
            checked={draft.showOnCard === "checklist"}
            onchange={(e) => (draft.showOnCard = (e.currentTarget as HTMLInputElement).checked ? "checklist" : undefined)}
          />
          Show checklist on card
        </label>
        <ul class="checklist">
          {#each checklist as item (item.id)}
            <li>
              <label class="check-label">
                <input type="checkbox" checked={item.isComplete} onchange={() => void toggleChecklist(item.id)} />
                <span class:done={item.isComplete}>{item.title}</span>
              </label>
            </li>
          {/each}
        </ul>
        <div style="display:flex; gap:.4rem;">
          <input
            type="text"
            placeholder="Add checklist item"
            bind:value={newChecklistItem}
            maxlength="200"
            style="flex:1"
            onkeydown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void addChecklistItem();
              }
            }}
          />
          <button type="button" onclick={() => void addChecklistItem()}>Add</button>
        </div>
      </section>

      <section>
        <h3>Notes</h3>
        <div style="display:flex; gap:.4rem; margin-bottom:.5rem;">
          <textarea placeholder="Add a note" bind:value={newNote} rows="2" maxlength="10000" style="flex:1"></textarea>
          <button type="button" onclick={() => void addNote()}>Add</button>
        </div>
        {#each notes as note (note.id)}
          <div class="note">
            <div class="small muted">{formatTimestamp(note.createdAt)}</div>
            <div style="white-space:pre-wrap">{note.body}</div>
          </div>
        {/each}
      </section>
    </div>

    {#if activity.length}
      <section style="margin-top:1rem">
        <h3>Recent activity</h3>
        <ul class="activity">
          {#each activity as entry (entry.id)}
            <li><span class="muted small">{formatTimestamp(entry.timestamp)}</span> — {entry.summary}</li>
          {/each}
        </ul>
      </section>
    {/if}
  {/if}
</Dialog>

<style>
  .grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 0 .8rem;
  }
  .grid2 {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1rem;
  }
  @media (max-width: 800px) {
    .grid { grid-template-columns: 1fr 1fr; }
    .grid2 { grid-template-columns: 1fr; }
  }
  .show-on-card {
    display: flex;
    align-items: center;
    gap: .4rem;
    font-weight: 400;
    font-size: .82rem;
    color: var(--text-muted);
    margin: .3rem 0 .4rem;
  }
  .checklist { list-style: none; padding: 0; margin: 0 0 .5rem; }
  .check-label { display: flex; gap: .45rem; align-items: baseline; font-weight: 400; margin: .15rem 0; }
  .check-label .done { text-decoration: line-through; color: var(--text-muted); }
  .note { border-top: 1px solid var(--border); padding: .4rem 0; }
  .activity { list-style: none; padding: 0; margin: 0; font-size: .85rem; }
  .activity li { padding: .15rem 0; }
</style>
