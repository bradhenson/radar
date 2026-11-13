<script lang="ts">
  // Settings card for the two lists performance tracking is organized by:
  // evaluation cycles (rating years) and performance elements. Inputs join a
  // cycle by date and an element by choice, so both are safe to edit later.
  import { app } from "../../stores/app.svelte";
  import ConfirmDialog from "../common/ConfirmDialog.svelte";
  import Dialog from "../common/Dialog.svelte";
  import Icon from "../common/Icon.svelte";
  import type { EvaluationCycle, PerformanceElement } from "../../domain/models";
  import { cycleContains, cyclePhase, evaluationCycleError, inputsInCycle, sortedCycles } from "../../domain/rules/evaluationCycles";
  import { formatDate } from "../../utils/dates";
  import { newId } from "../../utils/ids";

  const PHASE_LABELS = { upcoming: "Upcoming", first_half: "Current, first half", second_half: "Current, second half", ended: "Ended" };

  // --- cycles ---------------------------------------------------------------
  let cycleFormOpen = $state(false);
  let editingCycle = $state<EvaluationCycle | undefined>(undefined);
  let cName = $state("");
  let cStart = $state("");
  let cEnd = $state("");
  let cMidyear = $state("");
  let cError = $state("");
  let pendingCycleDelete = $state<EvaluationCycle | undefined>(undefined);

  let cycles = $derived(sortedCycles(app.evaluationCycles));
  let liveInputs = $derived(app.performanceInputs.filter((p) => !p.isArchived));

  let openedCycle = $state("");
  const cycleSnapshot = () => JSON.stringify([cName, cStart, cEnd, cMidyear]);

  function openCycleForm(cycle?: EvaluationCycle) {
    editingCycle = cycle;
    cName = cycle?.name ?? "";
    cStart = cycle?.startDate ?? "";
    cEnd = cycle?.endDate ?? "";
    cMidyear = cycle?.midyearDate ?? "";
    cError = "";
    openedCycle = cycleSnapshot();
    cycleFormOpen = true;
  }

  async function saveCycle() {
    const record: EvaluationCycle = {
      id: editingCycle?.id ?? newId(),
      name: cName.trim(),
      startDate: cStart,
      endDate: cEnd,
      midyearDate: cMidyear || undefined,
      active: editingCycle?.active ?? true
    };
    const error = evaluationCycleError(record, app.evaluationCycles);
    if (error) {
      cError = error;
      return;
    }
    await app.putRecord("evaluationCycles", record, {
      actionType: editingCycle ? "updated" : "created",
      summary: `${editingCycle ? "Updated" : "Added"} evaluation cycle "${record.name}"`
    });
    cycleFormOpen = false;
  }

  async function deleteCycle(cycle: EvaluationCycle) {
    await app.deleteRecord("evaluationCycles", cycle.id, `Deleted evaluation cycle "${cycle.name}"`);
    pendingCycleDelete = undefined;
    cycleFormOpen = false;
    app.toast("Evaluation cycle deleted. Performance inputs are unchanged.", "success");
  }

  // --- elements -------------------------------------------------------------
  let newElement = $state("");
  let elementError = $state("");
  let renamingId = $state<string | undefined>(undefined);
  let renameText = $state("");
  let pendingElementDelete = $state<PerformanceElement | undefined>(undefined);

  let elements = $derived([...app.performanceElements].sort((a, b) => a.name.localeCompare(b.name)));

  function elementUse(id: string): number {
    return liveInputs.filter((p) => p.performanceElementId === id).length;
  }

  function nameTaken(name: string, exceptId?: string): boolean {
    return app.performanceElements.some((el) => el.id !== exceptId && el.name.trim().toLowerCase() === name.toLowerCase());
  }

  async function addElement() {
    const name = newElement.trim();
    if (!name) {
      elementError = "Enter a name for the performance element.";
      return;
    }
    if (nameTaken(name)) {
      elementError = `"${name}" already exists.`;
      return;
    }
    await app.putRecord(
      "performanceElements",
      { id: newId(), name, active: true },
      { actionType: "created", summary: `Added performance element "${name}"` }
    );
    newElement = "";
    elementError = "";
  }

  async function saveRename(element: PerformanceElement) {
    const name = renameText.trim();
    if (!name || nameTaken(name, element.id)) {
      elementError = name ? `"${name}" already exists.` : "A performance element needs a name.";
      return;
    }
    if (name !== element.name) {
      await app.putRecord(
        "performanceElements",
        { ...element, name },
        { actionType: "updated", summary: `Renamed performance element "${element.name}" to "${name}"` }
      );
    }
    renamingId = undefined;
    elementError = "";
  }

  async function setElementActive(element: PerformanceElement, active: boolean) {
    await app.putRecord(
      "performanceElements",
      { ...element, active },
      { actionType: "updated", summary: `${active ? "Reactivated" : "Deactivated"} performance element "${element.name}"` }
    );
  }

  async function deleteElement(element: PerformanceElement) {
    await app.deleteRecord("performanceElements", element.id, `Deleted performance element "${element.name}"`);
    pendingElementDelete = undefined;
    app.toast("Performance element deleted", "success");
  }
</script>

<section class="card settings-section" id="settings-performance">
  <h2>Performance cycles and elements</h2>

  <h3>Evaluation cycles</h3>
  <p class="small muted">
    A cycle is a rating period, such as a fiscal year. A performance input belongs to the cycle its date falls in, so
    nothing has to be assigned by hand. The Performance page and the write-up report can be limited to one cycle.
  </p>
  {#if cycles.length === 0}
    <p class="small muted">No evaluation cycles yet.</p>
  {:else}
    <table class="data settings-table">
      <thead>
        <tr><th>Cycle</th><th>Start</th><th>Mid-year</th><th>End</th><th>Inputs</th><th>Now</th><th aria-label="Actions"></th></tr>
      </thead>
      <tbody>
        {#each cycles as cycle (cycle.id)}
          <tr>
            <td><button type="button" class="link cell-link" onclick={() => openCycleForm(cycle)}>{cycle.name}</button></td>
            <td class="date-cell">{formatDate(cycle.startDate)}</td>
            <td class="date-cell">{cycle.midyearDate ? formatDate(cycle.midyearDate) : "—"}</td>
            <td class="date-cell">{formatDate(cycle.endDate)}</td>
            <td>{inputsInCycle(liveInputs, cycle).length}</td>
            <td>
              {#if cycleContains(cycle, app.today)}
                <span class="badge success">{PHASE_LABELS[cyclePhase(cycle, app.today)]}</span>
              {:else}
                <span class="muted">{PHASE_LABELS[cyclePhase(cycle, app.today)]}</span>
              {/if}
            </td>
            <td class="row-action-cell">
              <button type="button" class="icon-btn" aria-label={`Edit evaluation cycle ${cycle.name}`} title="Edit" onclick={() => openCycleForm(cycle)}><Icon name="edit" size={15} /></button>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
  <p><button type="button" onclick={() => openCycleForm()}>Add evaluation cycle</button></p>

  <h3>Performance elements</h3>
  <p class="small muted">
    The elements an evaluation is written against. Active elements can be chosen on a performance input, and the
    write-up report groups inputs by them. Deactivate one to stop offering it without changing inputs that already use it.
  </p>
  <form
    class="settings-add"
    onsubmit={(e) => {
      e.preventDefault();
      void addElement();
    }}
  >
    <input type="text" bind:value={newElement} maxlength="120" placeholder="Element name" aria-label="New performance element name" />
    <button type="submit" class="primary">Add element</button>
  </form>
  {#if elementError}<div class="field-error" role="alert">{elementError}</div>{/if}
  {#if elements.length === 0}
    <p class="small muted">No performance elements yet.</p>
  {:else}
    <table class="data settings-table">
      <thead><tr><th>Element</th><th>Inputs</th><th>Status</th><th aria-label="Actions"></th></tr></thead>
      <tbody>
        {#each elements as element (element.id)}
          <tr class:inactive={!element.active}>
            <td>
              {#if renamingId === element.id}
                <form
                  class="rename"
                  onsubmit={(e) => {
                    e.preventDefault();
                    void saveRename(element);
                  }}
                >
                  <!-- svelte-ignore a11y_autofocus -->
                  <input type="text" bind:value={renameText} maxlength="120" aria-label={`Rename ${element.name}`} autofocus
                    onkeydown={(e) => { if (e.key === "Escape") { e.stopPropagation(); renamingId = undefined; elementError = ""; } }} />
                  <button type="submit" class="primary">Save</button>
                  <button type="button" onclick={() => { renamingId = undefined; elementError = ""; }}>Cancel</button>
                </form>
              {:else}
                {element.name}
              {/if}
            </td>
            <td>{elementUse(element.id)}</td>
            <td>{#if element.active}<span class="muted">Active</span>{:else}<span class="badge">Inactive</span>{/if}</td>
            <td class="row-action-cell">
              {#if renamingId !== element.id}
                <button type="button" onclick={() => { renamingId = element.id; renameText = element.name; elementError = ""; }} aria-label={`Rename performance element ${element.name}`}>Rename</button>
                <button type="button" onclick={() => void setElementActive(element, !element.active)} aria-label={`${element.active ? "Deactivate" : "Reactivate"} performance element ${element.name}`}>{element.active ? "Deactivate" : "Reactivate"}</button>
                <button type="button" class="icon-btn danger" aria-label={`Delete performance element ${element.name}`} title="Delete" onclick={() => (pendingElementDelete = element)}><Icon name="trash" size={15} /></button>
              {/if}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</section>

{#if cycleFormOpen}
  <Dialog
    title={editingCycle ? "Edit Evaluation Cycle" : "Add Evaluation Cycle"}
    onclose={() => (cycleFormOpen = false)}
    unsavedGuard={() => cycleSnapshot() !== openedCycle}
  >
    <form
      onsubmit={(e) => {
        e.preventDefault();
        void saveCycle();
      }}
    >
      <label for="ec-name">Name <span class="req">*</span></label>
      <input id="ec-name" type="text" bind:value={cName} maxlength="120" placeholder="FY2027" style="width:100%" />
      <div class="form-grid">
        <div>
          <label for="ec-start">Start date <span class="req">*</span></label>
          <input id="ec-start" type="date" bind:value={cStart} style="width:100%" />
        </div>
        <div>
          <label for="ec-end">End date <span class="req">*</span></label>
          <input id="ec-end" type="date" bind:value={cEnd} style="width:100%" />
        </div>
        <div>
          <label for="ec-midyear">Mid-year date</label>
          <input id="ec-midyear" type="date" bind:value={cMidyear} style="width:100%" />
        </div>
      </div>
      {#if cError}<div class="field-error" role="alert">{cError}</div>{/if}
      <div class="dialog-actions">
        {#if editingCycle}
          <button type="button" class="icon-btn danger" aria-label="Delete evaluation cycle" title="Delete" onclick={() => (pendingCycleDelete = editingCycle)}><Icon name="trash" size={17} /></button>
          <span class="spacer"></span>
        {/if}
        <button type="button" onclick={() => (cycleFormOpen = false)}>Cancel</button>
        <button type="submit" class="primary">Save</button>
      </div>
    </form>
  </Dialog>
{/if}

{#if pendingCycleDelete}
  <ConfirmDialog
    title="Delete evaluation cycle"
    message={`Delete "${pendingCycleDelete.name}"? Performance inputs are not deleted; they just stop being grouped under this cycle.`}
    confirmLabel="Delete cycle"
    danger
    onconfirm={() => void deleteCycle(pendingCycleDelete!)}
    oncancel={() => (pendingCycleDelete = undefined)}
  />
{/if}

{#if pendingElementDelete}
  <ConfirmDialog
    title="Delete performance element"
    message={elementUse(pendingElementDelete.id) > 0
      ? `Delete "${pendingElementDelete.name}"? ${elementUse(pendingElementDelete.id)} performance input(s) use it; they are kept and will be listed with no element. Deactivating it instead keeps them grouped.`
      : `Delete "${pendingElementDelete.name}"? No performance inputs use it.`}
    confirmLabel="Delete element"
    danger
    onconfirm={() => void deleteElement(pendingElementDelete!)}
    oncancel={() => (pendingElementDelete = undefined)}
  />
{/if}

<style>
  h3 {
    margin: 1rem 0 .3rem;
    font-size: .95rem;
  }
  h3:first-of-type {
    margin-top: .2rem;
  }
  .settings-add,
  .rename {
    display: flex;
    flex-wrap: wrap;
    gap: .5rem;
    margin: .5rem 0;
  }
  .settings-add input {
    flex: 1 1 14rem;
    max-width: 26rem;
  }
  tr.inactive td {
    color: var(--text-muted);
  }
  .dialog-actions {
    display: flex;
    align-items: center;
    gap: .5rem;
    justify-content: flex-end;
    margin-top: 1rem;
  }
  .spacer {
    flex: 1;
  }
</style>
