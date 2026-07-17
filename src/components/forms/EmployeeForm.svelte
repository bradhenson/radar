<script lang="ts">
  import Pane from "../common/Pane.svelte";
  import { app } from "../../stores/app.svelte";
  import type { Employee } from "../../domain/models";
  import { nowTimestamp } from "../../utils/dates";
  import { newId } from "../../utils/ids";

  let { employee, onclose }: { employee?: Employee; onclose: () => void } = $props();

  let initialized = $state(false);
  let displayName = $state("");
  let competencyId = $state("");
  let activeStatus = $state<Employee["activeStatus"]>("active");
  let error = $state("");
  let openedSnapshot = $state("");

  function formSnapshot(): string {
    return JSON.stringify([displayName, competencyId, activeStatus]);
  }

  $effect(() => {
    if (initialized) return;
    displayName = employee?.displayName ?? "";
    competencyId = employee?.competencyId ?? "";
    activeStatus = employee?.activeStatus ?? "active";
    openedSnapshot = formSnapshot();
    initialized = true;
  });

  async function save() {
    const name = displayName.trim();
    if (!name) {
      error = "Display name is required.";
      return;
    }
    const duplicate = app.employees.find(
      (e) => e.id !== employee?.id && e.displayName.trim().toLowerCase() === name.toLowerCase()
    );
    if (duplicate && !confirm(`An employee named "${duplicate.displayName}" already exists. Save anyway?`)) {
      return;
    }
    const now = nowTimestamp();
    const record: Employee = {
      ...employee,
      id: employee?.id ?? newId(),
      displayName: name,
      competencyId: competencyId || undefined,
      activeStatus,
      lastCheckInDate: employee?.lastCheckInDate,
      tags: employee?.tags ?? [],
      createdAt: employee?.createdAt ?? now,
      updatedAt: now,
      isArchived: employee?.isArchived ?? false
    };
    await app.putRecord("employees", record, {
      actionType: employee ? "updated" : "created",
      summary: `${employee ? "Updated" : "Created"} employee ${name}`
    });
    onclose();
  }
</script>

<Pane
  title={employee ? "Edit Employee" : "Add Employee"}
  {onclose}
  unsavedGuard={() => initialized && formSnapshot() !== openedSnapshot}
>
  <form
    onsubmit={(e) => {
      e.preventDefault();
      void save();
    }}
  >
    <label for="ef-name">Display name <span class="req">*</span></label>
    <input id="ef-name" type="text" bind:value={displayName} maxlength="200" style="width:100%" />
    {#if error}<div class="field-error" role="alert">{error}</div>{/if}

    <div style="display:grid; grid-template-columns:1fr 1fr; gap:0 .8rem;">
      <div>
        <label for="ef-comp">Competency</label>
        <select id="ef-comp" bind:value={competencyId} style="width:100%">
          <option value="">No competency</option>
          {#each app.competencyOptions(competencyId) as c (c.id)}
            <option value={c.id}>{c.code}{#if !c.active} (inactive){/if}</option>
          {/each}
        </select>
      </div>
      <div>
        <label for="ef-status">Status</label>
        <select id="ef-status" bind:value={activeStatus} style="width:100%">
          <option value="active">Active</option>
          <option value="temporary_inactive">Temporarily inactive</option>
          <option value="departed">Departed</option>
          <option value="archived">Archived</option>
        </select>
      </div>
    </div>

    <div style="display:flex; gap:.5rem; justify-content:flex-end; margin-top:1rem;">
      <button type="button" onclick={onclose}>Cancel</button>
      <button type="submit" class="primary">Save</button>
    </div>
  </form>
</Pane>
