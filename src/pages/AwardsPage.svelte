<script lang="ts">
  // Awards (plan 12.10, 21). Optional module for the first MVP — a simple
  // status list; a status board can follow in Phase 9.
  import { app } from "../stores/app.svelte";
  import { ui } from "../stores/ui.svelte";
  import { awardFollowUpTask } from "../domain/rules/followUpTasks";
  import { router } from "../app/router.svelte";
  import ConfirmDialog from "../components/common/ConfirmDialog.svelte";
  import Dialog from "../components/common/Dialog.svelte";
  import EmptyState from "../components/common/EmptyState.svelte";
  import Icon from "../components/common/Icon.svelte";
  import WorkspaceHeader from "../components/common/WorkspaceHeader.svelte";
  import RichTextEditor from "../components/common/RichTextEditor.svelte";
  import type { AwardRecord } from "../domain/models";
  import { AWARD_STATUSES } from "../domain/models";
  import { appendToDraft, awardSteps, awardTypeOptions, citationLines, filterAwards, nextAwardStatus } from "../domain/rules/awards";
  import TravelSteps from "../components/cues/TravelSteps.svelte";
  import { mergeAwardEdit } from "../domain/rules/editMerge";
  import { formatDate, isValidIsoDate, nowTimestamp } from "../utils/dates";
  import { newId } from "../utils/ids";
  import { emptyRichText, normalizeRichText, richTextDocToPlainText, serializeRichText } from "../utils/richTextDoc";

  let search = $state("");
  let filterEmployee = $state("");
  let filterStatus = $state("");
  let filterType = $state("");
  let formOpen = $state(false);
  let editing = $state<AwardRecord | undefined>(undefined);
  let fEmployee = $state("");
  let fTitle = $state("");
  let fType = $state("");
  let fStatus = $state("Idea");
  let fDue = $state("");
  let fNotes = $state(emptyRichText());
  let fCitation = $state("");
  let fInputIds = $state<string[]>([]);
  let fError = $state("");
  let pendingDelete = $state<AwardRecord | undefined>(undefined);

  // Deep link: #/awards/{recordId} opens the exact award for editing. One-shot.
  $effect(() => {
    const id = router.current.param;
    if (router.current.page !== "awards" || !id) return;
    const record = app.awardRecords.find((a) => a.id === id);
    if (!record) return;
    router.go("awards");
    openForm(record);
  });

  // Snapshot of the values the form opened with, for the unsaved-changes guard.
  let openedSnapshot = $state("");
  function formSnapshot(): string {
    return JSON.stringify([fEmployee, fTitle, fType, fStatus, fDue, serializeRichText(fNotes), fCitation, [...fInputIds].sort()]);
  }

  function openForm(a?: AwardRecord) {
    editing = a;
    fEmployee = a?.employeeId ?? "";
    fTitle = a?.title ?? "";
    fType = a?.awardType ?? "";
    fStatus = a?.status ?? "Idea";
    fDue = a?.nominationDueDate ?? "";
    fNotes = normalizeRichText(a?.supportingNotes);
    fCitation = a?.citationDraft ?? "";
    fInputIds = [...(a?.relatedPerformanceInputIds ?? [])];
    fError = "";
    openedSnapshot = formSnapshot();
    formOpen = true;
  }

  async function save() {
    if (!fEmployee || !fTitle.trim()) {
      fError = "Employee and title are required.";
      return;
    }
    if (fDue && !isValidIsoDate(fDue)) {
      fError = "Nomination due date is not valid.";
      return;
    }
    // Merge over the existing record so fields this form doesn't expose
    // (accomplishment period, citation draft, project, submission/decision
    // dates, source reference) survive.
    const record: AwardRecord = mergeAwardEdit(
      editing,
      {
        employeeId: fEmployee,
        title: fTitle,
        awardType: fType,
        status: fStatus,
        nominationDueDate: fDue,
        supportingNotes: fNotes,
        citationDraft: fCitation,
        // Links only make sense for the person being nominated.
        relatedPerformanceInputIds: fInputIds.filter((id) => employeeInputs.some((p) => p.id === id))
      },
      { id: newId(), now: nowTimestamp() }
    );
    await app.putRecord("awardRecords", record, {
      actionType: editing ? "updated" : "created",
      summary: `${editing ? "Updated" : "Added"} award "${record.title}" for ${app.employeeName(fEmployee)}`
    });
    formOpen = false;
  }

  // Move an award one stage along its pipeline from the list, with Undo.
  // Reaching Submitted stamps the submitted date, as the stage implies.
  async function advance(a: AwardRecord) {
    const next = nextAwardStatus(a.status);
    if (!next) return;
    const before = { ...a };
    const who = app.employeeName(a.employeeId);
    await app.putRecord(
      "awardRecords",
      {
        ...a,
        status: next,
        submittedDate: next === "Submitted" ? (a.submittedDate ?? app.today) : a.submittedDate,
        updatedAt: nowTimestamp()
      },
      { actionType: "updated", summary: `Moved award "${a.title}" for ${who} from ${a.status} to ${next}` }
    );
    app.toast(`Award moved to ${next}`, "success", () => {
      void app.putRecord(
        "awardRecords",
        { ...before, updatedAt: nowTimestamp() },
        { actionType: "updated", summary: `Moved award "${a.title}" for ${who} back to ${before.status}` }
      );
    });
  }

  // The nominee's performance inputs, newest first. When the award has an
  // accomplishment period, the list starts limited to it.
  let showAllInputs = $state(false);
  let employeeInputs = $derived(
    app.performanceInputs
      .filter((p) => p.employeeId === fEmployee && !p.isArchived)
      .sort((x, y) => (x.inputDate < y.inputDate ? 1 : -1))
  );
  let period = $derived({ start: editing?.accomplishmentPeriodStart, end: editing?.accomplishmentPeriodEnd });
  let shownInputs = $derived(
    showAllInputs || (!period.start && !period.end)
      ? employeeInputs
      : employeeInputs.filter(
          (p) => fInputIds.includes(p.id) || ((!period.start || p.inputDate >= period.start) && (!period.end || p.inputDate <= period.end))
        )
  );

  function toggleInput(id: string) {
    fInputIds = fInputIds.includes(id) ? fInputIds.filter((x) => x !== id) : [...fInputIds, id];
  }

  function addSelectedToCitation() {
    const selected = employeeInputs.filter((p) => fInputIds.includes(p.id));
    fCitation = appendToDraft(fCitation, citationLines(selected));
  }

  // Start a board card for the nomination from the open award. The dialog
  // closes without saving; unsaved edits are asked about first, as with ✕.
  function addTaskFor(a: AwardRecord) {
    if (formSnapshot() !== openedSnapshot && !window.confirm("Discard unsaved changes to this award?")) return;
    formOpen = false;
    ui.openNewTask(awardFollowUpTask(a, app.employeeName(a.employeeId)));
  }

  function requestDelete(a: AwardRecord) {
    pendingDelete = a;
  }

  async function deleteAward(a: AwardRecord) {
    await app.deleteRecord("awardRecords", a.id, `Deleted award "${a.title}" for ${app.employeeName(a.employeeId)}`);
    if (editing?.id === a.id) {
      formOpen = false;
      editing = undefined;
    }
    pendingDelete = undefined;
    app.toast("Award record deleted", "success");
  }

  let typeOptions = $derived(awardTypeOptions(app.awardRecords));

  let hasFilters = $derived(Boolean(search.trim() || filterEmployee || filterStatus || filterType));

  function clearFilters() {
    search = "";
    filterEmployee = "";
    filterStatus = "";
    filterType = "";
  }

  let rows = $derived(
    filterAwards(
      app.awardRecords,
      { search, employeeId: filterEmployee, status: filterStatus, awardType: filterType },
      (id) => app.employeeName(id)
    )
  );
</script>

<div class="page">
  <WorkspaceHeader title="Awards" section="People">
    {#snippet actions()}
      <button type="button" class="primary" onclick={() => openForm()}>+ Add Award</button>
    {/snippet}
  </WorkspaceHeader>

  <div class="toolbar record-toolbar">
    <input type="search" bind:value={search} placeholder="Search awards…" aria-label="Search awards" />
    <select bind:value={filterEmployee} aria-label="Filter by employee">
      <option value="">All employees</option>
      {#each app.activeEmployees as employee (employee.id)}<option value={employee.id}>{employee.displayName}</option>{/each}
    </select>
    <select bind:value={filterStatus} aria-label="Filter by status">
      <option value="">All statuses</option>
      {#each AWARD_STATUSES as status (status)}<option value={status}>{status}</option>{/each}
    </select>
    {#if typeOptions.length > 0}
      <select bind:value={filterType} aria-label="Filter by award type">
        <option value="">All types</option>
        {#each typeOptions as type (type)}<option value={type}>{type}</option>{/each}
      </select>
    {/if}
    <span class="spacer"></span>
    <span class="result-count">{rows.length} shown</span>
    {#if hasFilters}
      <button type="button" class="link small clear-filters" onclick={clearFilters}>Clear filters</button>
    {/if}
  </div>

  {#if rows.length === 0}
    <EmptyState
      message={hasFilters ? "No award records match." : "No award records."}
      hint={hasFilters
        ? "Clear the search or filters to see all award records."
        : "Track nomination ideas, drafts, and submissions here."}
    />
  {:else}
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <div class="table-scroll" role="region" aria-label="Award records" tabindex="0">
    <table class="data">
      <thead><tr><th>Title</th><th>Employee</th><th>Type</th><th>Status</th><th>Progress</th><th>Nomination due</th></tr></thead>
      <tbody>
        {#each rows as a (a.id)}
          <!-- Row click is a mouse convenience; the title button is the keyboard path. -->
          <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_noninteractive_element_interactions -->
          <tr class="row-clickable" id={"award-row-" + a.id} onclick={() => openForm(a)}>
            <td>
              <button
                type="button"
                class="link cell-link"
                onclick={(ev) => {
                  ev.stopPropagation();
                  openForm(a);
                }}>{a.title}</button
              >
            </td>
            <td>{app.employeeName(a.employeeId)}</td>
            <td>{a.awardType ?? ""}</td>
            <td><span class="badge" class:success={a.status === "Approved" || a.status === "Complete"}>{a.status}</span></td>
            <td class="progress-cell">
              {#if awardSteps(a.status, a.nominationDueDate, app.today).length}
                <TravelSteps
                  steps={awardSteps(a.status, a.nominationDueDate, app.today)}
                  who={`${a.title}, ${app.employeeName(a.employeeId)}`}
                  label="Nomination progress"
                  onadvance={() => void advance(a)}
                />
              {/if}
            </td>
            <td class="date-cell">{formatDate(a.nominationDueDate)}</td>
          </tr>
        {/each}
      </tbody>
    </table>
    </div>
  {/if}
</div>

{#if formOpen}
  <Dialog
    title={editing ? "Edit Award" : "Add Award"}
    onclose={() => (formOpen = false)}
    unsavedGuard={() => formSnapshot() !== openedSnapshot}
  >
    <form
      onsubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <label for="aw-emp">Employee <span class="req">*</span></label>
      <select id="aw-emp" bind:value={fEmployee} style="width:100%">
        <option value="">(select)</option>
        {#each app.activeEmployees as e (e.id)}<option value={e.id}>{e.displayName}</option>{/each}
      </select>
      <label for="aw-title">Title <span class="req">*</span></label>
      <input id="aw-title" type="text" bind:value={fTitle} maxlength="200" style="width:100%" />
      {#if fError}<div class="field-error" role="alert">{fError}</div>{/if}
      <div class="form-grid">
        <div>
          <label for="aw-type">Award type</label>
          <input id="aw-type" type="text" bind:value={fType} maxlength="100" style="width:100%" />
        </div>
        <div>
          <label for="aw-status">Status</label>
          <select id="aw-status" bind:value={fStatus} style="width:100%">
            {#each AWARD_STATUSES as s (s)}<option value={s}>{s}</option>{/each}
          </select>
        </div>
        <div>
          <label for="aw-due">Nomination due</label>
          <input id="aw-due" type="date" bind:value={fDue} style="width:100%" />
        </div>
      </div>
      <label for="aw-notes">Supporting notes</label>
      <RichTextEditor id="aw-notes" bind:value={fNotes} rows={3} maxlength={10000} ariaLabel="Supporting notes" />

      <fieldset class="award-inputs">
        <legend>Performance inputs for this nomination</legend>
        {#if !fEmployee}
          <p class="small muted">Choose the employee to see their performance inputs.</p>
        {:else if employeeInputs.length === 0}
          <p class="small muted">{app.employeeName(fEmployee)} has no performance inputs yet.</p>
        {:else}
          {#if period.start || period.end}
            <label class="inline-check">
              <input type="checkbox" bind:checked={showAllInputs} />
              Show inputs outside the accomplishment period
            </label>
          {/if}
          <ul class="input-list">
            {#each shownInputs as p (p.id)}
              <li>
                <label class="input-pick">
                  <input type="checkbox" checked={fInputIds.includes(p.id)} onchange={() => toggleInput(p.id)} />
                  <span class="small muted">{formatDate(p.inputDate)}</span>
                  <span class="input-pick-text">{richTextDocToPlainText(p.actionOrAccomplishment)}</span>
                </label>
              </li>
            {/each}
          </ul>
          <div class="input-actions">
            <span class="small muted">{fInputIds.length} selected</span>
            <button type="button" disabled={fInputIds.length === 0} onclick={addSelectedToCitation}>Add selected to citation draft</button>
          </div>
        {/if}
      </fieldset>

      <label for="aw-citation">Citation draft</label>
      <textarea id="aw-citation" bind:value={fCitation} rows="5" maxlength="10000" style="width:100%"></textarea>
      <div class="field-hint">Adding inputs appends to the end; nothing already here is replaced.</div>
      <div class="dialog-actions">
        {#if editing}
          <button type="button" class="icon-btn danger delete-action" aria-label="Delete award" title="Delete" onclick={() => requestDelete(editing!)}><Icon name="trash" size={17} /></button>
          <!-- Opens the new-task editor prefilled; nothing is created until it is saved. -->
          <button type="button" onclick={() => addTaskFor(editing!)}>Add task</button>
        {/if}
        <button type="button" onclick={() => (formOpen = false)}>Cancel</button>
        <button type="submit" class="primary">Save</button>
      </div>
    </form>
  </Dialog>
{/if}

{#if pendingDelete}
  <ConfirmDialog
    title="Delete award record"
    message={`Permanently delete "${pendingDelete.title}" for ${app.employeeName(pendingDelete.employeeId)}?`}
    confirmLabel="Delete award"
    danger
    onconfirm={() => void deleteAward(pendingDelete!)}
    oncancel={() => (pendingDelete = undefined)}
  />
{/if}

<style>
  .progress-cell { white-space: nowrap; }
  .award-inputs {
    min-width: 0;
    max-width: 100%;
    box-sizing: border-box;
    margin: .9rem 0 0;
    padding: .5rem .75rem .65rem;
    border: 1px solid var(--border);
    border-radius: var(--radius);
  }
  .award-inputs legend { padding: 0 .3rem; font-weight: 600; font-size: .85rem; }
  .inline-check { display: flex; align-items: center; gap: .4rem; margin: .1rem 0 .4rem; font-weight: 400; }
  .input-list { list-style: none; margin: 0; padding: 0; max-height: 12rem; overflow-y: auto; display: grid; gap: .15rem; }
  .input-pick { display: flex; align-items: baseline; gap: .45rem; margin: 0; font-weight: 400; cursor: pointer; }
  .input-pick input { flex-shrink: 0; align-self: center; }
  .input-pick .small { flex-shrink: 0; }
  .input-pick-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .input-actions { display: flex; align-items: center; justify-content: space-between; gap: .5rem; margin-top: .5rem; }
  .dialog-actions {
    display: flex;
    align-items: center;
    gap: .5rem;
    justify-content: flex-end;
    margin-top: 1rem;
  }
  .delete-action {
    margin-right: auto;
  }
</style>
