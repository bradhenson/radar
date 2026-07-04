<script lang="ts">
  // Leave awareness (plan 12.8, 19): availability tracking, not official
  // leave accounting. No medical or reason details are collected.
  import { app } from "../stores/app.svelte";
  import Dialog from "../components/common/Dialog.svelte";
  import EmptyState from "../components/common/EmptyState.svelte";
  import type { LeaveRecord, LeaveStatus } from "../domain/models";
  import { LEAVE_TYPES } from "../domain/models";
  import { compareDates, formatDate, isValidIsoDate, nowTimestamp, todayIso } from "../utils/dates";
  import { newId } from "../utils/ids";

  let showPast = $state(false);
  let formOpen = $state(false);
  let editing = $state<LeaveRecord | undefined>(undefined);
  let fEmployee = $state("");
  let fType = $state("Not specified");
  let fStart = $state("");
  let fEnd = $state("");
  let fStatus = $state<LeaveStatus>("planned");
  let fNote = $state("");
  let fVerified = $state("");
  let fError = $state("");

  function openForm(l?: LeaveRecord) {
    editing = l;
    fEmployee = l?.employeeId ?? "";
    fType = l?.leaveType ?? "Not specified";
    fStart = l?.startDate ?? "";
    fEnd = l?.endDate ?? "";
    fStatus = l?.status ?? "planned";
    fNote = l?.workloadImpactNote ?? "";
    fVerified = l?.lastVerifiedDate ?? "";
    fError = "";
    formOpen = true;
  }

  async function save() {
    if (!fEmployee) {
      fError = "Employee is required.";
      return;
    }
    if (!isValidIsoDate(fStart) || !isValidIsoDate(fEnd)) {
      fError = "Start and end dates are required and must be valid.";
      return;
    }
    if (fEnd < fStart) {
      fError = "End date must be on or after the start date.";
      return;
    }
    const now = nowTimestamp();
    const record: LeaveRecord = {
      id: editing?.id ?? newId(),
      employeeId: fEmployee,
      leaveType: fType === "Not specified" ? undefined : fType,
      startDate: fStart,
      endDate: fEnd,
      status: fStatus,
      workloadImpactNote: fNote.trim() || undefined,
      lastVerifiedDate: fVerified || undefined,
      sourceSystem: editing?.sourceSystem ?? "ERP",
      createdAt: editing?.createdAt ?? now,
      updatedAt: now
    };
    await app.putRecord("leaveRecords", record, {
      actionType: editing ? "updated" : "created",
      summary: `${editing ? "Updated" : "Added"} leave for ${app.employeeName(fEmployee)} (${fStart} to ${fEnd})`
    });
    formOpen = false;
  }

  let rows = $derived(
    app.leaveRecords
      .filter((l) => showPast || compareDates(l.endDate, app.today) >= 0)
      .sort((a, b) => compareDates(a.startDate, b.startDate))
  );

  // Advisory overlap warnings (plan 19.6).
  function overlaps(l: LeaveRecord): string[] {
    const warnings: string[] = [];
    for (const other of app.leaveRecords) {
      if (other.id === l.id || ["cancelled", "complete"].includes(other.status)) continue;
      if (other.startDate <= l.endDate && l.startDate <= other.endDate) {
        const empProjects = new Set(
          app.tasks.filter((t) => t.employeeId === l.employeeId && t.projectId).map((t) => t.projectId)
        );
        const shared = app.tasks.some((t) => t.employeeId === other.employeeId && t.projectId && empProjects.has(t.projectId));
        if (shared) warnings.push(`Overlaps ${app.employeeName(other.employeeId)} (same project)`);
      }
    }
    const dueDuring = app.tasks.filter(
      (t) =>
        t.employeeId === l.employeeId &&
        !t.isArchived &&
        t.status !== "complete" &&
        t.status !== "cancelled" &&
        t.dueDate &&
        t.dueDate >= l.startDate &&
        t.dueDate <= l.endDate
    );
    if (dueDuring.length) warnings.push(`${dueDuring.length} task(s) due during this leave`);
    return warnings;
  }

  async function markVerified(l: LeaveRecord) {
    await app.putRecord("leaveRecords", { ...l, lastVerifiedDate: todayIso(), updatedAt: nowTimestamp() });
  }
</script>

<div class="page">
  <div class="page-header">
    <h1>Leave and Availability</h1>
  </div>
  <div class="toolbar">
    <label style="display:flex; align-items:center; gap:.35rem; font-weight:400; margin:0">
      <input type="checkbox" bind:checked={showPast} /> Show past leave
    </label>
    <span class="spacer"></span>
    <button type="button" class="primary" onclick={() => openForm()}>Add Leave</button>
  </div>

  {#if rows.length === 0}
    <EmptyState message="No leave records." hint="Track upcoming absences for workload awareness. Details stay broad — no reasons required." />
  {:else}
    <table class="data">
      <thead><tr><th>Employee</th><th>Start</th><th>End</th><th>Type</th><th>Status</th><th>Warnings</th><th>Verified</th><th></th></tr></thead>
      <tbody>
        {#each rows as l (l.id)}
          <tr>
            <td>{app.employeeName(l.employeeId)}</td>
            <td>{formatDate(l.startDate)}</td>
            <td>{formatDate(l.endDate)}</td>
            <td>{l.leaveType ?? ""}</td>
            <td>{l.status}</td>
            <td>
              {#each overlaps(l) as w, i (i)}<span class="badge warning">{w}</span>{/each}
            </td>
            <td>
              {#if l.lastVerifiedDate}{formatDate(l.lastVerifiedDate)}
              {:else}<button type="button" class="link" onclick={() => void markVerified(l)}>Mark verified</button>{/if}
            </td>
            <td><button type="button" onclick={() => openForm(l)}>Edit</button></td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</div>

{#if formOpen}
  <Dialog title={editing ? "Edit Leave" : "Add Leave"} onclose={() => (formOpen = false)}>
    <form
      onsubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <label for="lf-emp">Employee <span class="req">*</span></label>
      <select id="lf-emp" bind:value={fEmployee} style="width:100%">
        <option value="">(select)</option>
        {#each app.activeEmployees as e (e.id)}<option value={e.id}>{e.displayName}</option>{/each}
      </select>
      {#if fError}<div class="field-error">{fError}</div>{/if}
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:0 .8rem;">
        <div>
          <label for="lf-start">Start <span class="req">*</span></label>
          <input id="lf-start" type="date" bind:value={fStart} style="width:100%" />
        </div>
        <div>
          <label for="lf-end">End <span class="req">*</span></label>
          <input id="lf-end" type="date" bind:value={fEnd} style="width:100%" />
        </div>
        <div>
          <label for="lf-type">Type</label>
          <select id="lf-type" bind:value={fType} style="width:100%">
            {#each LEAVE_TYPES as t (t)}<option value={t}>{t}</option>{/each}
          </select>
        </div>
        <div>
          <label for="lf-status">Status</label>
          <select id="lf-status" bind:value={fStatus} style="width:100%">
            {#each ["planned", "requested", "approved", "changed", "cancelled", "complete", "unknown"] as s (s)}
              <option value={s}>{s}</option>
            {/each}
          </select>
        </div>
      </div>
      <label for="lf-note">Workload impact note</label>
      <input id="lf-note" type="text" bind:value={fNote} maxlength="500" style="width:100%" />
      <label for="lf-verified">Verified against ERP on</label>
      <input id="lf-verified" type="date" bind:value={fVerified} style="width:100%" />
      <div style="display:flex; gap:.5rem; justify-content:flex-end; margin-top:1rem;">
        <button type="button" onclick={() => (formOpen = false)}>Cancel</button>
        <button type="submit" class="primary">Save</button>
      </div>
    </form>
  </Dialog>
{/if}
