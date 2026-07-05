<script lang="ts">
  // Awards (plan 12.10, 21). Optional module for the first MVP — a simple
  // status list; a status board can follow in Phase 9.
  import { app } from "../stores/app.svelte";
  import ConfirmDialog from "../components/common/ConfirmDialog.svelte";
  import Dialog from "../components/common/Dialog.svelte";
  import EmptyState from "../components/common/EmptyState.svelte";
  import type { AwardRecord } from "../domain/models";
  import { AWARD_STATUSES } from "../domain/models";
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

  function openForm(a?: AwardRecord) {
    editing = a;
    fEmployee = a?.employeeId ?? "";
    fTitle = a?.title ?? "";
    fType = a?.awardType ?? "";
    fStatus = a?.status ?? "Idea";
    fDue = a?.nominationDueDate ?? "";
    fNotes = a?.supportingNotes ?? "";
    fError = "";
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
    const now = nowTimestamp();
    const record: AwardRecord = {
      id: editing?.id ?? newId(),
      employeeId: fEmployee,
      title: fTitle.trim(),
      awardType: fType.trim() || undefined,
      status: fStatus,
      nominationDueDate: fDue || undefined,
      supportingNotes: fNotes.trim() || undefined,
      relatedPerformanceInputIds: editing?.relatedPerformanceInputIds ?? [],
      createdAt: editing?.createdAt ?? now,
      updatedAt: now
    };
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
      <thead><tr><th>Title</th><th>Employee</th><th>Type</th><th>Status</th><th>Nomination due</th><th></th></tr></thead>
      <tbody>
        {#each rows as a (a.id)}
          <tr>
            <td>{a.title}</td>
            <td>{app.employeeName(a.employeeId)}</td>
            <td>{a.awardType ?? ""}</td>
            <td>{a.status}</td>
            <td>{formatDate(a.nominationDueDate)}</td>
            <td>
              <div class="row-actions">
                <button type="button" onclick={() => openForm(a)}>Edit</button>
                <button type="button" class="danger" onclick={() => requestDelete(a)}>Delete</button>
              </div>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</div>

{#if formOpen}
  <Dialog title={editing ? "Edit Award" : "Add Award"} onclose={() => (formOpen = false)}>
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
      {#if fError}<div class="field-error">{fError}</div>{/if}
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
          <button type="button" class="danger delete-action" onclick={() => requestDelete(editing!)}>Delete</button>
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
  .row-actions,
  .dialog-actions {
    display: flex;
    align-items: center;
    gap: .5rem;
  }
  .row-actions {
    justify-content: flex-end;
    flex-wrap: wrap;
  }
  .dialog-actions {
    justify-content: flex-end;
    margin-top: 1rem;
  }
  .delete-action {
    margin-right: auto;
  }
</style>
