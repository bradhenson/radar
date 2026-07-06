<script lang="ts">
  // Structured Context / Action / Result & Impact capture (plan 17.4).
  // Creates a new input (optionally prefilled) or edits an existing one; either
  // way, task details can be imported into the empty fields (plan 17.5).
  import ConfirmDialog from "../common/ConfirmDialog.svelte";
  import Dialog from "../common/Dialog.svelte";
  import { app } from "../../stores/app.svelte";
  import type { PerformanceInput, Task } from "../../domain/models";
  import { statusLabel } from "../../domain/models";
  import {
    mergeTaskImportIntoDraft,
    performanceInputPrefillFromTask,
    shouldOfferTaskArchive
  } from "../../domain/rules/performanceImport";
  import { ui } from "../../stores/ui.svelte";
  import { formatDate, isValidIsoDate, nowTimestamp, todayIso } from "../../utils/dates";
  import { newId } from "../../utils/ids";

  let {
    input,
    prefill = {},
    onclose
  }: { input?: PerformanceInput; prefill?: Partial<PerformanceInput>; onclose: () => void } = $props();

  const base: Partial<PerformanceInput> = input ?? prefill;
  let employeeId = $state(base.employeeId ?? "");
  let inputDate = $state(base.inputDate ?? todayIso());
  // Distinguish the untouched default date from a chosen one, so a task import
  // can supply the completion date without discarding a user-picked date.
  let dateTouched = $state(Boolean(base.inputDate));
  let situationOrContext = $state(base.situationOrContext ?? "");
  let actionOrAccomplishment = $state(base.actionOrAccomplishment ?? "");
  let result = $state(base.result ?? "");
  let projectId = $state(base.projectId ?? "");
  let performanceElementId = $state(base.performanceElementId ?? "");
  let recognitionPotential = $state(base.recognitionPotential ?? false);
  let relatedTaskId = $state(base.relatedTaskId);
  let source = $state(base.source);
  let importTaskId = $state("");
  let importNote = $state("");
  let error = $state("");
  let confirmDelete = $state(false);

  // Task import candidates: when an employee is selected, their tasks plus
  // unassigned ones; most recently completed/updated first.
  let importCandidates = $derived.by(() => {
    const eligible = app.tasks.filter(
      (t) => !t.isArchived && (!employeeId || !t.employeeId || t.employeeId === employeeId)
    );
    const key = (t: Task) => t.completedDate ?? t.updatedAt.slice(0, 10);
    return eligible.sort((a, b) => key(b).localeCompare(key(a)) || a.title.localeCompare(b.title));
  });

  function importOptionLabel(t: Task): string {
    const parts = [t.completedDate ? `Completed ${formatDate(t.completedDate)}` : statusLabel(t.status)];
    if (!employeeId && t.employeeId) parts.push(app.employeeName(t.employeeId));
    if (t.performanceInputCreated) parts.push("input created");
    return `${t.title} (${parts.join(" · ")})`;
  }

  function importFromTask() {
    const task = app.tasks.find((t) => t.id === importTaskId);
    if (!task) return;
    const taskPrefill = performanceInputPrefillFromTask(task, {
      today: app.today,
      notes: app.taskNotes,
      checklistItems: app.checklistItems
    });
    const { merged, skipped } = mergeTaskImportIntoDraft(
      {
        employeeId,
        inputDate: dateTouched ? inputDate : "",
        situationOrContext,
        actionOrAccomplishment,
        result,
        projectId
      },
      taskPrefill
    );
    employeeId = merged.employeeId;
    if (merged.inputDate) {
      inputDate = merged.inputDate;
      dateTouched = true;
    }
    situationOrContext = merged.situationOrContext;
    actionOrAccomplishment = merged.actionOrAccomplishment;
    result = merged.result;
    projectId = merged.projectId;
    if (!relatedTaskId) relatedTaskId = task.id;
    if (!source || source === "Supervisor") source = taskPrefill.source;
    importNote = skipped.length
      ? `Imported from “${task.title}”. Fields you had already filled were kept: ${skipped.join(", ")}.`
      : `Imported from “${task.title}”.`;
  }

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
    const fields = {
      employeeId,
      inputDate,
      situationOrContext: situationOrContext.trim() || undefined,
      actionOrAccomplishment: actionOrAccomplishment.trim(),
      result: result.trim() || undefined,
      projectId: projectId || undefined,
      performanceElementId: performanceElementId || undefined,
      relatedTaskId,
      recognitionPotential,
      updatedAt: now
    };
    const record: PerformanceInput = input
      ? { ...input, ...fields, source }
      : {
          id: newId(),
          ...fields,
          source: source ?? "Supervisor",
          inputStatus: "draft",
          tags: [],
          createdAt: now,
          isArchived: false
        };
    await app.putRecord("performanceInputs", record, {
      actionType: input ? "updated" : "created",
      summary: `${input ? "Updated" : "Recorded"} performance input for ${app.employeeName(employeeId)}`
    });
    // Mark the source task so we do not prompt again (plan 17.5).
    if (relatedTaskId) {
      const task = app.tasks.find((t) => t.id === relatedTaskId);
      if (task && !task.performanceInputCreated) {
        await app.putRecord("tasks", { ...task, performanceInputCreated: true });
      }
      // The task's work is captured; offer to move it off the board.
      if (!input && task && shouldOfferTaskArchive(task)) {
        ui.archivePromptTaskId = task.id;
      }
    }
    app.toast("Performance input saved", "success");
    onclose();
  }

  async function deleteInput() {
    if (!input) return;
    await app.deletePerformanceInput(input);
    confirmDelete = false;
    onclose();
  }
</script>

<Dialog title={input ? "Edit Performance Input" : "Performance Input"} wide {onclose}>
  <form
    onsubmit={(e) => {
      e.preventDefault();
      void save();
    }}
  >
    <div class="import-box">
      <label for="pi-import">
        Import from task
        <span class="field-hint">Fills the empty fields below from the selected task; text you have entered is kept.</span>
      </label>
      <div style="display:flex; gap:.5rem;">
        <select id="pi-import" bind:value={importTaskId} style="flex:1; min-width:0">
          <option value="">(select a task)</option>
          {#each importCandidates as t (t.id)}<option value={t.id}>{importOptionLabel(t)}</option>{/each}
        </select>
        <button type="button" onclick={importFromTask} disabled={!importTaskId}>Import</button>
      </div>
      {#if importNote}<div class="small muted" role="status">{importNote}</div>{/if}
    </div>

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
        <input
          id="pi-date"
          type="date"
          bind:value={inputDate}
          onchange={() => (dateTouched = true)}
          style="width:100%"
        />
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

    <label for="pi-result-impact">
      Result / Impact
      <span class="field-hint">What happened, and why did it matter (project, cost, schedule, quality, readiness, workforce)?</span>
    </label>
    <textarea id="pi-result-impact" bind:value={result} rows="3" maxlength="10000" style="width:100%"></textarea>

    <label class="check-inline">
      <input type="checkbox" bind:checked={recognitionPotential} />
      Recognition potential (candidate for award nomination)
    </label>

    <div class="dialog-actions">
      {#if input}
        <button type="button" class="danger delete-action" onclick={() => (confirmDelete = true)}>Delete</button>
      {/if}
      <button type="button" onclick={onclose}>Cancel</button>
      <button type="submit" class="primary">Save</button>
    </div>
  </form>
</Dialog>

{#if confirmDelete && input}
  <ConfirmDialog
    title="Delete performance input"
    message={`Permanently delete the ${formatDate(input.inputDate)} performance input for ${app.employeeName(input.employeeId)}?`}
    confirmLabel="Delete input"
    danger
    onconfirm={() => void deleteInput()}
    oncancel={() => (confirmDelete = false)}
  />
{/if}

<style>
  .check-inline { display: flex; align-items: center; gap: .45rem; font-weight: 400; margin-top: .8rem; }
  .dialog-actions {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: .5rem;
    margin-top: 1rem;
  }
  .delete-action {
    margin-right: auto;
  }
  .import-box {
    border: 1px dashed var(--border);
    border-radius: .5rem;
    padding: .6rem .8rem .7rem;
    margin-bottom: 1rem;
  }
</style>
