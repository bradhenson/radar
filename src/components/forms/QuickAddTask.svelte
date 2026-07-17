<script lang="ts">
  // Title-first rapid task capture: title plus optional employee and due date.
  // Create keeps the dialog open (and keeps the employee/date) so several
  // tasks can be entered in a row; "Create & open" jumps into the full editor.
  import Pane from "../common/Pane.svelte";
  import { app } from "../../stores/app.svelte";
  import { ui } from "../../stores/ui.svelte";
  import { isValidIsoDate } from "../../utils/dates";

  let { onclose }: { onclose: () => void } = $props();

  let title = $state("");
  let employeeId = $state("");
  let dueDate = $state("");
  let error = $state("");
  let createdCount = $state(0);
  let titleInput: HTMLInputElement | undefined = $state();

  async function create(openAfter: boolean) {
    const trimmed = title.trim();
    if (!trimmed) {
      error = "Title is required.";
      titleInput?.focus();
      return;
    }
    if (dueDate && !isValidIsoDate(dueDate)) {
      error = "Due date is not valid.";
      return;
    }
    const task = app.createTask({
      title: trimmed,
      employeeId: employeeId || undefined,
      dueDate: dueDate || undefined
    });
    await app.saveNewTask(task);
    if (openAfter) {
      onclose();
      ui.openTaskDetail(task.id);
      return;
    }
    createdCount += 1;
    title = "";
    error = "";
    titleInput?.focus();
  }
</script>

<Pane title="Quick add task" {onclose} unsavedGuard={() => title.trim().length > 0}>
  <form
    onsubmit={(e) => {
      e.preventDefault();
      void create(false);
    }}
  >
    <label for="qa-title">Title <span class="req">*</span></label>
    <input
      id="qa-title"
      type="text"
      bind:this={titleInput}
      bind:value={title}
      maxlength="300"
      placeholder="What needs to happen?"
      style="width:100%"
    />
    {#if error}<div class="field-error" role="alert">{error}</div>{/if}
    <div class="qa-grid">
      <div>
        <label for="qa-emp">Employee</label>
        <select id="qa-emp" bind:value={employeeId} style="width:100%">
          <option value="">(none)</option>
          {#each app.activeEmployees as e (e.id)}<option value={e.id}>{e.displayName}</option>{/each}
        </select>
      </div>
      <div>
        <label for="qa-due">Due date</label>
        <input id="qa-due" type="date" bind:value={dueDate} style="width:100%" />
      </div>
    </div>
    <div class="qa-actions">
      {#if createdCount > 0}
        <span class="muted small" role="status">{createdCount} task{createdCount === 1 ? "" : "s"} added</span>
      {/if}
      <span class="spacer"></span>
      <button type="button" onclick={onclose}>{createdCount > 0 ? "Done" : "Cancel"}</button>
      <button type="button" onclick={() => void create(true)}>Create &amp; open</button>
      <button type="submit" class="primary">Create</button>
    </div>
  </form>
</Pane>

<style>
  .qa-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0 .8rem;
  }
  .qa-actions {
    display: flex;
    align-items: center;
    gap: .5rem;
    margin-top: 1rem;
  }
  @media (max-width: 600px) {
    .qa-grid {
      grid-template-columns: 1fr;
    }
  }
</style>
