<script lang="ts">
  // Fast capture: title only is enough (plan 4.3, 7.2).
  import Dialog from "../common/Dialog.svelte";
  import { app } from "../../stores/app.svelte";
  import { ui } from "../../stores/ui.svelte";
  import { TASK_CATEGORIES } from "../../domain/models";
  import { isValidIsoDate } from "../../utils/dates";

  let title = $state("");
  let category = $state(ui.quickAddDefaults.category ?? "general");
  let employeeId = $state(ui.quickAddDefaults.employeeId ?? "");
  let projectId = $state(ui.quickAddDefaults.projectId ?? "");
  let dueDate = $state(ui.quickAddDefaults.dueDate ?? "");
  let error = $state("");

  async function save(openDetail: boolean) {
    const trimmed = title.trim();
    if (!trimmed) {
      error = "Title is required.";
      return;
    }
    if (trimmed.length > 200) {
      error = "Title must be 200 characters or fewer.";
      return;
    }
    if (dueDate && !isValidIsoDate(dueDate)) {
      error = "Due date is not a valid date.";
      return;
    }
    const emp = employeeId ? app.employees.find((e) => e.id === employeeId) : undefined;
    const task = app.createTask({
      ...ui.quickAddDefaults,
      title: trimmed,
      category,
      employeeId: employeeId || undefined,
      projectId: projectId || undefined,
      competencyId: emp?.competencyId ?? ui.quickAddDefaults.competencyId,
      dueDate: dueDate || undefined
    });
    await app.saveNewTask(task);
    ui.quickAddOpen = false;
    if (openDetail) ui.openTaskDetail(task.id);
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void save(false);
    }
  }
</script>

<Dialog title="New Task" onclose={() => (ui.quickAddOpen = false)}>
  <form
    onsubmit={(e) => {
      e.preventDefault();
      void save(false);
    }}
    onkeydown={onKeydown}
  >
    <label for="qa-title">Title <span class="req">*</span></label>
    <!-- svelte-ignore a11y_autofocus -->
    <input id="qa-title" type="text" bind:value={title} maxlength="200" autofocus style="width:100%" />
    {#if error}<div class="field-error">{error}</div>{/if}

    <div style="display:grid; grid-template-columns:1fr 1fr; gap:0 .8rem;">
      <div>
        <label for="qa-category">Category</label>
        <select id="qa-category" bind:value={category} style="width:100%">
          {#each TASK_CATEGORIES as c (c.value)}<option value={c.value}>{c.label}</option>{/each}
        </select>
      </div>
      <div>
        <label for="qa-due">Due date</label>
        <input id="qa-due" type="date" bind:value={dueDate} style="width:100%" />
      </div>
      <div>
        <label for="qa-emp">Employee</label>
        <select id="qa-emp" bind:value={employeeId} style="width:100%">
          <option value="">(none)</option>
          {#each app.activeEmployees as e (e.id)}<option value={e.id}>{e.displayName}</option>{/each}
        </select>
      </div>
      <div>
        <label for="qa-proj">Project</label>
        <select id="qa-proj" bind:value={projectId} style="width:100%">
          <option value="">(none)</option>
          {#each app.activeProjects as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
        </select>
      </div>
    </div>

    <div style="display:flex; gap:.5rem; justify-content:flex-end; margin-top:1rem;">
      <button type="button" onclick={() => (ui.quickAddOpen = false)}>Cancel</button>
      <button type="button" onclick={() => void save(true)}>Save and open</button>
      <button type="submit" class="primary">Save</button>
    </div>
    <p class="small muted" style="margin:.5rem 0 0">New tasks go to Inbox. Ctrl+Enter saves.</p>
  </form>
</Dialog>
