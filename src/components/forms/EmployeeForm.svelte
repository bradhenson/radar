<script lang="ts">
  import Dialog from "../common/Dialog.svelte";
  import { app } from "../../stores/app.svelte";
  import type { Employee } from "../../domain/models";
  import { nowTimestamp } from "../../utils/dates";
  import { newId } from "../../utils/ids";

  let { employee, onclose }: { employee?: Employee; onclose: () => void } = $props();

  let displayName = $state(employee?.displayName ?? "");
  let competencyId = $state(employee?.competencyId ?? app.competencies[0]?.id ?? "");
  let positionTitle = $state(employee?.positionTitle ?? "");
  let workEmail = $state(employee?.workEmail ?? "");
  let team = $state(employee?.team ?? "");
  let activeStatus = $state(employee?.activeStatus ?? "active");
  let error = $state("");

  async function save() {
    const name = displayName.trim();
    if (!name) {
      error = "Display name is required.";
      return;
    }
    if (!competencyId) {
      error = "Competency is required.";
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
      id: employee?.id ?? newId(),
      displayName: name,
      competencyId,
      positionTitle: positionTitle.trim() || undefined,
      workEmail: workEmail.trim() || undefined,
      team: team.trim() || undefined,
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

<Dialog title={employee ? "Edit Employee" : "Add Employee"} {onclose}>
  <form
    onsubmit={(e) => {
      e.preventDefault();
      void save();
    }}
  >
    <label for="ef-name">Display name <span class="req">*</span></label>
    <input id="ef-name" type="text" bind:value={displayName} maxlength="200" style="width:100%" />
    {#if error}<div class="field-error">{error}</div>{/if}

    <div style="display:grid; grid-template-columns:1fr 1fr; gap:0 .8rem;">
      <div>
        <label for="ef-comp">Competency <span class="req">*</span></label>
        <select id="ef-comp" bind:value={competencyId} style="width:100%">
          {#each app.competencies.filter((c) => c.active) as c (c.id)}<option value={c.id}>{c.code}</option>{/each}
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
      <div>
        <label for="ef-title">Position title</label>
        <input id="ef-title" type="text" bind:value={positionTitle} maxlength="200" style="width:100%" />
      </div>
      <div>
        <label for="ef-team">Team</label>
        <input id="ef-team" type="text" bind:value={team} maxlength="200" style="width:100%" />
      </div>
    </div>
    <label for="ef-email">Work email <span class="field-hint">(only if authorized)</span></label>
    <input id="ef-email" type="text" bind:value={workEmail} maxlength="200" style="width:100%" />

    <div style="display:flex; gap:.5rem; justify-content:flex-end; margin-top:1rem;">
      <button type="button" onclick={onclose}>Cancel</button>
      <button type="submit" class="primary">Save</button>
    </div>
  </form>
</Dialog>
