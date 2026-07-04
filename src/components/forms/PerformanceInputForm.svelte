<script lang="ts">
  // Structured Context / Action / Result / Impact capture (plan 17.4).
  import Dialog from "../common/Dialog.svelte";
  import { app } from "../../stores/app.svelte";
  import type { PerformanceInput } from "../../domain/models";
  import { isValidIsoDate, nowTimestamp, todayIso } from "../../utils/dates";
  import { newId } from "../../utils/ids";

  let {
    prefill = {},
    onclose
  }: { prefill?: Partial<PerformanceInput>; onclose: () => void } = $props();

  let employeeId = $state(prefill.employeeId ?? "");
  let inputDate = $state(prefill.inputDate ?? todayIso());
  let situationOrContext = $state(prefill.situationOrContext ?? "");
  let actionOrAccomplishment = $state(prefill.actionOrAccomplishment ?? "");
  let result = $state(prefill.result ?? "");
  let impact = $state(prefill.impact ?? "");
  let projectId = $state(prefill.projectId ?? "");
  let performanceElementId = $state(prefill.performanceElementId ?? "");
  let recognitionPotential = $state(prefill.recognitionPotential ?? false);
  let error = $state("");

  async function save() {
    if (!employeeId) {
      error = "Employee is required.";
      return;
    }
    if (!actionOrAccomplishment.trim()) {
      error = "Action or accomplishment is required.";
      return;
    }
    if (!isValidIsoDate(inputDate)) {
      error = "Date is not valid.";
      return;
    }
    const now = nowTimestamp();
    const input: PerformanceInput = {
      id: newId(),
      employeeId,
      inputDate,
      situationOrContext: situationOrContext.trim() || undefined,
      actionOrAccomplishment: actionOrAccomplishment.trim(),
      result: result.trim() || undefined,
      impact: impact.trim() || undefined,
      projectId: projectId || undefined,
      performanceElementId: performanceElementId || undefined,
      relatedTaskId: prefill.relatedTaskId,
      source: prefill.source ?? "Supervisor",
      inputStatus: "draft",
      recognitionPotential,
      tags: [],
      createdAt: now,
      updatedAt: now,
      isArchived: false
    };
    await app.putRecord("performanceInputs", input, {
      actionType: "created",
      summary: `Recorded performance input for ${app.employeeName(employeeId)}`
    });
    // Mark the source task so we do not prompt again (plan 17.5).
    if (prefill.relatedTaskId) {
      const task = app.tasks.find((t) => t.id === prefill.relatedTaskId);
      if (task && !task.performanceInputCreated) {
        await app.putRecord("tasks", { ...task, performanceInputCreated: true });
      }
    }
    app.toast("Performance input saved", "success");
    onclose();
  }
</script>

<Dialog title="Performance Input" wide {onclose}>
  <form
    onsubmit={(e) => {
      e.preventDefault();
      void save();
    }}
  >
    <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:0 .8rem;">
      <div>
        <label for="pi-emp">Employee <span class="req">*</span></label>
        <select id="pi-emp" bind:value={employeeId} style="width:100%">
          <option value="">(select)</option>
          {#each app.activeEmployees as e (e.id)}<option value={e.id}>{e.displayName}</option>{/each}
        </select>
      </div>
      <div>
        <label for="pi-date">Date <span class="req">*</span></label>
        <input id="pi-date" type="date" bind:value={inputDate} style="width:100%" />
      </div>
      <div>
        <label for="pi-proj">Project</label>
        <select id="pi-proj" bind:value={projectId} style="width:100%">
          <option value="">(none)</option>
          {#each app.activeProjects as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
        </select>
      </div>
    </div>

    {#if app.performanceElements.filter((el) => el.active).length}
      <label for="pi-element">Performance element</label>
      <select id="pi-element" bind:value={performanceElementId} style="width:100%">
        <option value="">(none)</option>
        {#each app.performanceElements.filter((el) => el.active) as el (el.id)}
          <option value={el.id}>{el.name}</option>
        {/each}
      </select>
    {/if}

    <label for="pi-context">Context <span class="field-hint">What was happening or what problem existed?</span></label>
    <textarea id="pi-context" bind:value={situationOrContext} rows="2" maxlength="10000" style="width:100%"></textarea>

    <label for="pi-action">Action <span class="req">*</span> <span class="field-hint">What did the employee do?</span></label>
    <textarea id="pi-action" bind:value={actionOrAccomplishment} rows="2" maxlength="10000" style="width:100%"></textarea>
    {#if error}<div class="field-error">{error}</div>{/if}

    <label for="pi-result">Result <span class="field-hint">What happened because of the action?</span></label>
    <textarea id="pi-result" bind:value={result} rows="2" maxlength="10000" style="width:100%"></textarea>

    <label for="pi-impact">Impact <span class="field-hint">Why did the result matter (project, cost, schedule, quality, readiness, workforce)?</span></label>
    <textarea id="pi-impact" bind:value={impact} rows="2" maxlength="10000" style="width:100%"></textarea>

    <label class="check-inline">
      <input type="checkbox" bind:checked={recognitionPotential} />
      Recognition potential (candidate for award nomination)
    </label>

    <div style="display:flex; gap:.5rem; justify-content:flex-end; margin-top:1rem;">
      <button type="button" onclick={onclose}>Cancel</button>
      <button type="submit" class="primary">Save</button>
    </div>
  </form>
</Dialog>

<style>
  .check-inline { display: flex; align-items: center; gap: .45rem; font-weight: 400; margin-top: .8rem; }
</style>
