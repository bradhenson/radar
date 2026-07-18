<script lang="ts">
  // Awards (plan 12.10, 21). Optional module for the first MVP — a simple
  // status list; a status board can follow in Phase 9.
  import { app } from "../stores/app.svelte";
  import { router } from "../app/router.svelte";
  import ConfirmDialog from "../components/common/ConfirmDialog.svelte";
  import Dialog from "../components/common/Dialog.svelte";
  import EmptyState from "../components/common/EmptyState.svelte";
  import Icon from "../components/common/Icon.svelte";
  import type { AwardRecord } from "../domain/models";
  import { AWARD_STATUSES } from "../domain/models";
  import { mergeAwardEdit } from "../domain/rules/editMerge";
  import { formatDate, isValidIsoDate, nowTimestamp } from "../utils/dates";
  import { newId } from "../utils/ids";

  let formOpen = $state(false);
  let editing = $state<AwardRecord | undefined>(undefined);
  let fEmployee = $state("");
  let fTitle = $state("");
  let fType = $state("");
  let fStatus = $state("Idea");
  let fDue = $state("");
  let fNotes = $state("");
  let fError = $state("");
  let pendingDelete = $state<AwardRecord | undefined>(undefined);
  let expanded = $state<Record<string, boolean>>({});

  // Deep link: #/awards/{recordId} expands the award in the list. One-shot.
  $effect(() => {
    const id = router.current.param;
    if (router.current.page !== "awards" || !id) return;
    const record = app.awardRecords.find((a) => a.id === id);
    if (!record) return;
    expanded[id] = true;
    router.go("awards");
    requestAnimationFrame(() => {
      document.getElementById(`award-row-${id}`)?.scrollIntoView({ block: "center" });
    });
  });

  function toggleRow(id: string) {
    expanded[id] = !expanded[id];
  }

  function toggleFromRow(id: string) {
    // Don't hijack a click the user made to select and copy text.
    if (window.getSelection()?.toString()) return;
    toggleRow(id);
  }

  // Snapshot of the values the form opened with, for the unsaved-changes guard.
  let openedSnapshot = $state("");
  function formSnapshot(): string {
    return JSON.stringify([fEmployee, fTitle, fType, fStatus, fDue, fNotes]);
  }

  function openForm(a?: AwardRecord) {
    editing = a;
    fEmployee = a?.employeeId ?? "";
    fTitle = a?.title ?? "";
    fType = a?.awardType ?? "";
    fStatus = a?.status ?? "Idea";
    fDue = a?.nominationDueDate ?? "";
    fNotes = a?.supportingNotes ?? "";
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
        supportingNotes: fNotes
      },
      { id: newId(), now: nowTimestamp() }
    );
    await app.putRecord("awardRecords", record, {
      actionType: editing ? "updated" : "created",
      summary: `${editing ? "Updated" : "Added"} award "${record.title}" for ${app.employeeName(fEmployee)}`
    });
    formOpen = false;
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

  let rows = $derived(
    [...app.awardRecords].sort((a, b) => (a.nominationDueDate ?? "9999").localeCompare(b.nominationDueDate ?? "9999"))
  );
</script>

<div class="page">
  <div class="page-header">
    <h1>Awards</h1>
  </div>
  <div class="toolbar">
    <span class="muted small">Recognition candidates flagged on performance inputs appear on the Performance page.</span>
    <span class="spacer"></span>
    <button type="button" class="primary" onclick={() => openForm()}>Add Award</button>
  </div>

  {#if rows.length === 0}
    <EmptyState message="No award records." hint="Track nomination ideas, drafts, and submissions here." />
  {:else}
    <table class="data">
      <thead><tr><th>Title</th><th>Employee</th><th>Type</th><th>Status</th><th>Nomination due</th></tr></thead>
      <tbody>
        {#each rows as a (a.id)}
          {@const open = Boolean(expanded[a.id])}
          <!-- Row click toggles the inline detail; the chevron is the keyboard control. -->
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
          <tr class="row-clickable" class:row-open={open} id={"award-row-" + a.id} onclick={() => toggleFromRow(a.id)}>
            <td>
              <button
                type="button"
                class="disclosure"
                class:open
                aria-expanded={open}
                aria-label={open ? `Hide details for ${a.title}` : `Show details for ${a.title}`}
                onclick={(ev) => {
                  ev.stopPropagation();
                  toggleRow(a.id);
                }}><Icon name="chevron" size={13} /></button>
              <strong>{a.title}</strong>
            </td>
            <td>{app.employeeName(a.employeeId)}</td>
            <td>{a.awardType ?? ""}</td>
            <td><span class="badge">{a.status}</span></td>
            <td class="date-cell">{formatDate(a.nominationDueDate)}</td>
          </tr>
          {#if open}
            <tr class="detail-row">
              <td colspan="5">
                <div class="detail" aria-label={`Award details for ${a.title}`}>
                  <dl class="detail-grid">
                    {#if a.accomplishmentPeriodStart || a.accomplishmentPeriodEnd}
                      <div><dt>Accomplishment period</dt><dd>{formatDate(a.accomplishmentPeriodStart)} – {formatDate(a.accomplishmentPeriodEnd)}</dd></div>
                    {/if}
                    {#if a.submittedDate}
                      <div><dt>Submitted</dt><dd>{formatDate(a.submittedDate)}</dd></div>
                    {/if}
                    {#if a.decisionDate}
                      <div><dt>Decision</dt><dd>{formatDate(a.decisionDate)}</dd></div>
                    {/if}
                    {#if a.projectId}
                      <div><dt>Project</dt><dd>{app.projectName(a.projectId)}</dd></div>
                    {/if}
                    {#if a.relatedPerformanceInputIds.length}
                      <div><dt>Linked performance inputs</dt><dd>{a.relatedPerformanceInputIds.length}</dd></div>
                    {/if}
                    <div><dt>Supporting notes</dt><dd class="prewrap">{a.supportingNotes || "None"}</dd></div>
                    {#if a.citationDraft}
                      <div class="span-all"><dt>Citation draft</dt><dd class="prewrap">{a.citationDraft}</dd></div>
                    {/if}
                  </dl>
                  <div class="detail-footer">
                    <button type="button" onclick={() => openForm(a)}>Edit</button>
                    <button
                      type="button"
                      class="icon-btn danger"
                      aria-label="Delete award"
                      title="Delete"
                      onclick={() => requestDelete(a)}><Icon name="trash" size={16} /></button>
                    <span class="spacer"></span>
                    <button type="button" onclick={() => router.go("employees", a.employeeId)}>Open employee</button>
                  </div>
                </div>
              </td>
            </tr>
          {/if}
        {/each}
      </tbody>
    </table>
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
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:0 .8rem;">
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
      <textarea id="aw-notes" bind:value={fNotes} rows="3" maxlength="10000" style="width:100%"></textarea>
      <div class="dialog-actions">
        {#if editing}
          <button type="button" class="icon-btn danger delete-action" aria-label="Delete award" title="Delete" onclick={() => requestDelete(editing!)}><Icon name="trash" size={17} /></button>
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
  .prewrap {
    white-space: pre-wrap;
  }
  .span-all {
    grid-column: 1 / -1;
  }
</style>
