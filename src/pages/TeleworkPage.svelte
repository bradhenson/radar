<script lang="ts">
  // Telework tracking (plan 12.9, 20).
  import { app } from "../stores/app.svelte";
  import Dialog from "../components/common/Dialog.svelte";
  import EmptyState from "../components/common/EmptyState.svelte";
  import type { TeleworkRecord, TeleworkStatus } from "../domain/models";
  import { TELEWORK_RECORD_TYPES } from "../domain/models";
  import { compareDates, daysBetween, formatDate, isValidIsoDate, nowTimestamp, todayIso } from "../utils/dates";
  import { newId } from "../utils/ids";

  const STATUSES: TeleworkStatus[] = [
    "draft",
    "pending_employee",
    "pending_supervisor",
    "pending_approval",
    "approved",
    "active",
    "expired",
    "denied",
    "cancelled"
  ];

  let showHistorical = $state(false);
  let formOpen = $state(false);
  let editing = $state<TeleworkRecord | undefined>(undefined);
  let fEmployee = $state("");
  let fType = $state("Agreement");
  let fStatus = $state<TeleworkStatus>("pending_supervisor");
  let fEffective = $state("");
  let fExpires = $state("");
  let fSchedule = $state("");
  let fVerified = $state("");
  let fError = $state("");

  function openForm(t?: TeleworkRecord) {
    editing = t;
    fEmployee = t?.employeeId ?? "";
    fType = t?.recordType ?? "Agreement";
    fStatus = t?.status ?? "pending_supervisor";
    fEffective = t?.effectiveDate ?? "";
    fExpires = t?.expirationDate ?? "";
    fSchedule = t?.scheduleSummary ?? "";
    fVerified = t?.lastVerifiedDate ?? "";
    fError = "";
    formOpen = true;
  }

  async function save() {
    if (!fEmployee) {
      fError = "Employee is required.";
      return;
    }
    for (const v of [fEffective, fExpires, fVerified]) {
      if (v && !isValidIsoDate(v)) {
        fError = "Dates must be valid.";
        return;
      }
    }
    if (fEffective && fExpires && fExpires < fEffective) {
      fError = "Expiration must be on or after the effective date.";
      return;
    }
    const now = nowTimestamp();
    const record: TeleworkRecord = {
      id: editing?.id ?? newId(),
      employeeId: fEmployee,
      recordType: fType,
      status: fStatus,
      effectiveDate: fEffective || undefined,
      expirationDate: fExpires || undefined,
      scheduleSummary: fSchedule.trim() || undefined,
      lastVerifiedDate: fVerified || undefined,
      requestDate: editing?.requestDate ?? todayIso(),
      createdAt: editing?.createdAt ?? now,
      updatedAt: now
    };
    await app.putRecord("teleworkRecords", record, {
      actionType: editing ? "updated" : "created",
      summary: `${editing ? "Updated" : "Added"} telework ${fType.toLowerCase()} for ${app.employeeName(fEmployee)}`
    });
    formOpen = false;
  }

  let rows = $derived(
    app.teleworkRecords
      .filter((t) => showHistorical || !["expired", "denied", "cancelled"].includes(t.status))
      .sort((a, b) => (a.expirationDate ?? "9999").localeCompare(b.expirationDate ?? "9999"))
  );

  function expiryBadge(t: TeleworkRecord): { label: string; cls: string } | undefined {
    if (!t.expirationDate || !["active", "approved"].includes(t.status)) return undefined;
    if (compareDates(t.expirationDate, app.today) < 0) return { label: "Expired", cls: "overdue" };
    const days = daysBetween(app.today, t.expirationDate);
    if (days <= 30) return { label: `Expires in ${days}d`, cls: "warning" };
    return undefined;
  }
</script>

<div class="page">
  <div class="page-header">
    <h1>Telework</h1>
  </div>
  <div class="toolbar">
    <label style="display:flex; align-items:center; gap:.35rem; font-weight:400; margin:0">
      <input type="checkbox" bind:checked={showHistorical} /> Show historical
    </label>
    <span class="spacer"></span>
    <button type="button" class="primary" onclick={() => openForm()}>Add Telework Item</button>
  </div>

  {#if rows.length === 0}
    <EmptyState message="No telework records." hint="Track agreements and requests here so renewals and pending actions surface on Today." />
  {:else}
    <table class="data">
      <thead><tr><th>Employee</th><th>Type</th><th>Status</th><th>Effective</th><th>Expires</th><th>Schedule</th><th>Verified</th><th></th></tr></thead>
      <tbody>
        {#each rows as t (t.id)}
          {@const badge = expiryBadge(t)}
          <tr>
            <td>{app.employeeName(t.employeeId)}</td>
            <td>{t.recordType}</td>
            <td>
              {t.status.replace(/_/g, " ")}
              {#if t.status === "pending_supervisor"}<span class="badge overdue">Action needed</span>{/if}
            </td>
            <td>{formatDate(t.effectiveDate)}</td>
            <td>{formatDate(t.expirationDate)} {#if badge}<span class="badge {badge.cls}">{badge.label}</span>{/if}</td>
            <td>{t.scheduleSummary ?? ""}</td>
            <td>{formatDate(t.lastVerifiedDate)}</td>
            <td><button type="button" onclick={() => openForm(t)}>Edit</button></td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</div>

{#if formOpen}
  <Dialog title={editing ? "Edit Telework Record" : "Add Telework Record"} onclose={() => (formOpen = false)}>
    <form
      onsubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <label for="tw-emp">Employee <span class="req">*</span></label>
      <select id="tw-emp" bind:value={fEmployee} style="width:100%">
        <option value="">(select)</option>
        {#each app.activeEmployees as e (e.id)}<option value={e.id}>{e.displayName}</option>{/each}
      </select>
      {#if fError}<div class="field-error">{fError}</div>{/if}
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:0 .8rem;">
        <div>
          <label for="tw-type">Record type</label>
          <select id="tw-type" bind:value={fType} style="width:100%">
            {#each TELEWORK_RECORD_TYPES as t (t)}<option value={t}>{t}</option>{/each}
          </select>
        </div>
        <div>
          <label for="tw-status">Status</label>
          <select id="tw-status" bind:value={fStatus} style="width:100%">
            {#each STATUSES as s (s)}<option value={s}>{s.replace(/_/g, " ")}</option>{/each}
          </select>
        </div>
        <div>
          <label for="tw-eff">Effective date</label>
          <input id="tw-eff" type="date" bind:value={fEffective} style="width:100%" />
        </div>
        <div>
          <label for="tw-exp">Expiration date</label>
          <input id="tw-exp" type="date" bind:value={fExpires} style="width:100%" />
        </div>
      </div>
      <label for="tw-sched">Schedule summary</label>
      <input id="tw-sched" type="text" bind:value={fSchedule} maxlength="200" style="width:100%" />
      <label for="tw-verified">Verified on</label>
      <input id="tw-verified" type="date" bind:value={fVerified} style="width:100%" />
      <div style="display:flex; gap:.5rem; justify-content:flex-end; margin-top:1rem;">
        <button type="button" onclick={() => (formOpen = false)}>Cancel</button>
        <button type="submit" class="primary">Save</button>
      </div>
    </form>
  </Dialog>
{/if}
