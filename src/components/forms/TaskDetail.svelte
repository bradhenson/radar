<script lang="ts">
  // Full task editor with notes, checklist, and activity (plan 12.2, 14).
  import Dialog from "../common/Dialog.svelte";
  import { app } from "../../stores/app.svelte";
  import { ui } from "../../stores/ui.svelte";
  import {
    SOURCE_SYSTEMS,
    TASK_CATEGORIES,
    TASK_PRIORITIES,
    TASK_STATUSES,
    statusLabel,
    type Task
  } from "../../domain/models";
  import { formatTimestamp, isValidIsoDate, nowTimestamp } from "../../utils/dates";
  import { newId } from "../../utils/ids";
  import { orderForAppend } from "../../domain/rules/boardOrder";

  let { task }: { task: Task } = $props();

  // Editable copy; persisted on Save.
  let draft = $state({ ...task, tags: [...task.tags] });
  let tagsText = $state(task.tags.join(", "));
  let newNote = $state("");
  let newChecklistItem = $state("");
  let error = $state("");

  let notes = $derived(
    app.taskNotes.filter((n) => n.taskId === task.id).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  );
  let checklist = $derived(
    app.checklistItems.filter((c) => c.taskId === task.id).sort((a, b) => a.order - b.order)
  );
  let activity = $derived(
    app.activityEntries
      .filter((a) => a.entityType === "tasks" && a.entityId === task.id)
      .sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1))
      .slice(0, 15)
  );

  function close() {
    ui.detailTaskId = undefined;
  }

  async function save() {
    const title = draft.title.trim();
    if (!title) {
      error = "Title is required.";
      return;
    }
    for (const [label, v] of [
      ["Due date", draft.dueDate],
      ["Start date", draft.startDate],
      ["Reminder date", draft.reminderDate],
      ["Follow-up date", draft.followUpDate]
    ] as const) {
      if (v && !isValidIsoDate(v)) {
        error = `${label} is not a valid date.`;
        return;
      }
    }
    if (draft.startDate && draft.dueDate && draft.dueDate < draft.startDate) {
      error = "Due date must be on or after the start date.";
      return;
    }
    const tags = tagsText
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean)
      .slice(0, 20);

    const statusChanged = draft.status !== task.status;
    const updated: Task = {
      ...draft,
      title,
      tags,
      description: draft.description?.trim() || undefined,
      employeeId: draft.employeeId || undefined,
      projectId: draft.projectId || undefined,
      dueDate: draft.dueDate || undefined,
      startDate: draft.startDate || undefined,
      reminderDate: draft.reminderDate || undefined,
      followUpDate: draft.followUpDate || undefined,
      sourceSystem: draft.sourceSystem === "None" ? undefined : draft.sourceSystem,
      sourceReference: draft.sourceReference?.trim() || undefined,
      waitingReason: draft.waitingReason?.trim() || undefined,
      waitingOn: draft.waitingOn?.trim() || undefined
    };
    if (statusChanged) {
      updated.boardOrder = orderForAppend(
        app.tasks.filter((t) => t.status === updated.status && !t.isArchived && t.id !== task.id).map((t) => t.boardOrder)
      );
      if (updated.status === "waiting") updated.waitingSince = nowTimestamp();
      if (updated.status === "complete" && task.status !== "complete") updated.completedDate = app.today;
      if (updated.status !== "complete") updated.completedDate = undefined;
    }
    await app.updateTask(
      updated,
      statusChanged ? `Moved "${title}" from ${statusLabel(task.status)} to ${statusLabel(updated.status)}` : undefined,
      statusChanged ? "status_changed" : "updated"
    );
    if (statusChanged && updated.status === "complete" && updated.employeeId && !updated.performanceInputCreated) {
      ui.performancePromptTask = updated;
    }
    close();
  }

  async function completeNow() {
    const updated = await app.completeTask(task);
    if (updated.employeeId && !updated.performanceInputCreated) {
      ui.performancePromptTask = updated;
    }
    close();
  }

  async function archive() {
    await app.updateTask({ ...task, isArchived: true }, `Archived "${task.title}"`, "archived");
    close();
  }

  async function addNote() {
    const body = newNote.trim();
    if (!body) return;
    const now = nowTimestamp();
    await app.putRecord(
      "taskNotes",
      { id: newId(), taskId: task.id, body, noteType: "general", createdAt: now, updatedAt: now },
      { actionType: "updated", summary: `Added note to "${task.title}"`, entityType: "tasks" }
    );
    newNote = "";
  }

  async function addChecklistItem() {
    const title = newChecklistItem.trim();
    if (!title) return;
    await app.putRecord("checklistItems", {
      id: newId(),
      taskId: task.id,
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

<Dialog title="Task" wide onclose={close}>
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

    <div class="grid">
      <div>
        <label for="td-status">Status</label>
        <select id="td-status" bind:value={draft.status} style="width:100%">
          {#each TASK_STATUSES as s (s.value)}<option value={s.value}>{s.label}</option>{/each}
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
          {#each TASK_CATEGORIES as c (c.value)}<option value={c.value}>{c.label}</option>{/each}
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
        <label for="td-source">Source system</label>
        <select id="td-source" bind:value={draft.sourceSystem} style="width:100%">
          {#each SOURCE_SYSTEMS as s (s)}<option value={s}>{s}</option>{/each}
        </select>
      </div>
      <div>
        <label for="td-sourceref">Source reference</label>
        <input id="td-sourceref" type="text" bind:value={draft.sourceReference} maxlength="500" style="width:100%" />
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
      <button type="submit" class="primary">Save</button>
      {#if task.status !== "complete"}
        <button type="button" onclick={() => void completeNow()}>Complete</button>
      {/if}
      {#if !task.isArchived}
        <button type="button" onclick={() => void archive()}>Archive</button>
      {/if}
      <span class="spacer" style="flex:1"></span>
      <button type="button" onclick={close}>Cancel</button>
    </div>
  </form>

  <hr style="border:none; border-top:1px solid var(--border); margin:1rem 0" />

  <div class="grid2">
    <section>
      <h3>Checklist {#if checklist.length}<span class="muted small">({checklist.filter((c) => c.isComplete).length} of {checklist.length} complete)</span>{/if}</h3>
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
  .checklist { list-style: none; padding: 0; margin: 0 0 .5rem; }
  .check-label { display: flex; gap: .45rem; align-items: baseline; font-weight: 400; margin: .15rem 0; }
  .check-label .done { text-decoration: line-through; color: var(--text-muted); }
  .note { border-top: 1px solid var(--border); padding: .4rem 0; }
  .activity { list-style: none; padding: 0; margin: 0; font-size: .85rem; }
  .activity li { padding: .15rem 0; }
</style>
