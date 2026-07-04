<script lang="ts">
  // Training tracking (plan 12.7, 18): requirements, per-employee records,
  // matrix view, bulk assignment, completion with expiration calculation.
  import { app } from "../stores/app.svelte";
  import Dialog from "../components/common/Dialog.svelte";
  import EmptyState from "../components/common/EmptyState.svelte";
  import type { EmployeeTrainingRecord, TrainingRequirement } from "../domain/models";
  import { addDays, addMonths, compareDates, daysBetween, formatDate, isValidIsoDate, nowTimestamp, todayIso } from "../utils/dates";
  import { newId } from "../utils/ids";

  let reqFormOpen = $state(false);
  let editingReq = $state<TrainingRequirement | undefined>(undefined);
  let rName = $state("");
  let rCategory = $state("");
  let rRecurrence = $state<"none" | "days" | "months" | "annual">("annual");
  let rInterval = $state(1);
  let rWarning = $state("30, 14, 7");
  let rError = $state("");

  let recordDialog = $state<{ record: EmployeeTrainingRecord; reqName: string } | undefined>(undefined);
  let recDue = $state("");
  let recCompleted = $state("");
  let recStatus = $state<EmployeeTrainingRecord["status"]>("assigned");
  let recVerified = $state("");
  let recError = $state("");

  let assignReqId = $state("");
  let assignScope = $state("all");

  let activeReqs = $derived(app.trainingRequirements.filter((r) => r.active));

  function openReqForm(req?: TrainingRequirement) {
    editingReq = req;
    rName = req?.name ?? "";
    rCategory = req?.category ?? "";
    rRecurrence = req?.recurrenceType ?? "annual";
    rInterval = req?.recurrenceInterval ?? 1;
    rWarning = (req?.warningDays ?? [30, 14, 7]).join(", ");
    rError = "";
    reqFormOpen = true;
  }

  async function saveReq() {
    const name = rName.trim();
    if (!name) {
      rError = "Name is required.";
      return;
    }
    const warningDays = rWarning
      .split(",")
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => Number.isFinite(n) && n > 0);
    const now = nowTimestamp();
    const record: TrainingRequirement = {
      id: editingReq?.id ?? newId(),
      name,
      category: rCategory.trim() || undefined,
      recurrenceType: rRecurrence,
      recurrenceInterval: rInterval,
      warningDays,
      active: editingReq?.active ?? true,
      createdAt: editingReq?.createdAt ?? now,
      updatedAt: now
    };
    await app.putRecord("trainingRequirements", record, {
      actionType: editingReq ? "updated" : "created",
      summary: `${editingReq ? "Updated" : "Created"} training requirement ${name}`
    });
    reqFormOpen = false;
  }

  async function bulkAssign() {
    if (!assignReqId) return;
    const targets = app.activeEmployees.filter(
      (e) => assignScope === "all" || e.competencyId === assignScope
    );
    const existing = new Set(
      app.employeeTrainingRecords.filter((r) => r.trainingRequirementId === assignReqId).map((r) => r.employeeId)
    );
    const now = nowTimestamp();
    let created = 0;
    for (const e of targets) {
      if (existing.has(e.id)) continue;
      await app.putRecord("employeeTrainingRecords", {
        id: newId(),
        employeeId: e.id,
        trainingRequirementId: assignReqId,
        assignedDate: todayIso(),
        status: "assigned",
        createdAt: now,
        updatedAt: now
      });
      created++;
    }
    app.toast(created ? `Assigned to ${created} employee${created === 1 ? "" : "s"}` : "All selected employees already have this requirement");
  }

  function openRecord(record: EmployeeTrainingRecord, reqName: string) {
    recordDialog = { record, reqName };
    recDue = record.dueDate ?? "";
    recCompleted = record.completedDate ?? "";
    recStatus = record.status;
    recVerified = record.lastVerifiedDate ?? "";
    recError = "";
  }

  async function saveRecord() {
    if (!recordDialog) return;
    for (const v of [recDue, recCompleted, recVerified]) {
      if (v && !isValidIsoDate(v)) {
        recError = "Dates must be valid.";
        return;
      }
    }
    const rec = recordDialog.record;
    const req = app.trainingRequirements.find((q) => q.id === rec.trainingRequirementId);
    let expirationDate = rec.expirationDate;
    let status = recStatus;
    if (recCompleted) {
      status = "complete";
      // Calculate expiration from recurrence (plan 18.6).
      if (req?.recurrenceType === "annual") expirationDate = addMonths(recCompleted, 12 * (req.recurrenceInterval ?? 1));
      else if (req?.recurrenceType === "months" && req.recurrenceInterval) expirationDate = addMonths(recCompleted, req.recurrenceInterval);
      else if (req?.recurrenceType === "days" && req.recurrenceInterval) expirationDate = addDays(recCompleted, req.recurrenceInterval);
      else expirationDate = undefined;
      if (expirationDate && expirationDate < recCompleted) {
        recError = "Expiration cannot be before completion.";
        return;
      }
    }
    await app.putRecord(
      "employeeTrainingRecords",
      {
        ...rec,
        dueDate: recDue || undefined,
        completedDate: recCompleted || undefined,
        expirationDate,
        status,
        lastVerifiedDate: recVerified || undefined,
        updatedAt: nowTimestamp()
      },
      {
        actionType: "updated",
        summary: `Updated ${recordDialog.reqName} record for ${app.employeeName(rec.employeeId)}`
      }
    );
    recordDialog = undefined;
  }

  type CellState = { label: string; cls: string; record?: EmployeeTrainingRecord };

  function cell(employeeId: string, reqId: string): CellState {
    const rec = app.employeeTrainingRecords.find((r) => r.employeeId === employeeId && r.trainingRequirementId === reqId);
    if (!rec) return { label: "—", cls: "" };
    if (rec.status === "not_applicable") return { label: "N/A", cls: "", record: rec };
    if (rec.status === "waived") return { label: "Waived", cls: "", record: rec };
    const due = rec.status === "complete" ? rec.expirationDate : rec.dueDate;
    if (rec.status === "complete") {
      if (due && compareDates(due, app.today) < 0) return { label: "Expired", cls: "overdue", record: rec };
      if (due && daysBetween(app.today, due) <= app.settings.trainingWarningDays)
        return { label: `Expires ${formatDate(due)}`, cls: "warning", record: rec };
      return { label: "Complete", cls: "success", record: rec };
    }
    if (due && compareDates(due, app.today) < 0) return { label: "Overdue", cls: "overdue", record: rec };
    if (due && daysBetween(app.today, due) <= app.settings.trainingWarningDays)
      return { label: `Due ${formatDate(due)}`, cls: "warning", record: rec };
    return { label: due ? `Due ${formatDate(due)}` : "Assigned", cls: "", record: rec };
  }
</script>

<div class="page">
  <div class="page-header">
    <h1>Training</h1>
  </div>

  <div class="toolbar">
    <select bind:value={assignReqId} aria-label="Requirement to assign">
      <option value="">Select requirement…</option>
      {#each activeReqs as r (r.id)}<option value={r.id}>{r.name}</option>{/each}
    </select>
    <select bind:value={assignScope} aria-label="Assignment scope">
      <option value="all">All active employees</option>
      {#each app.competencies as c (c.id)}<option value={c.id}>Competency {c.code}</option>{/each}
    </select>
    <button type="button" onclick={() => void bulkAssign()} disabled={!assignReqId}>Assign</button>
    <span class="spacer"></span>
    <button type="button" class="primary" onclick={() => openReqForm()}>Add Requirement</button>
  </div>

  {#if activeReqs.length === 0}
    <EmptyState message="No training requirements defined." hint="Add a requirement (for example, Annual Cybersecurity Awareness), then assign it to employees." />
  {:else}
    <h2>Requirements</h2>
    <table class="data" style="margin-bottom:1.2rem">
      <thead><tr><th>Name</th><th>Category</th><th>Recurrence</th><th>Warning days</th><th></th></tr></thead>
      <tbody>
        {#each activeReqs as r (r.id)}
          <tr>
            <td>{r.name}</td>
            <td>{r.category ?? ""}</td>
            <td>{r.recurrenceType === "none" ? "One time" : r.recurrenceType === "annual" ? "Annual" : `Every ${r.recurrenceInterval} ${r.recurrenceType}`}</td>
            <td>{r.warningDays.join(", ")}</td>
            <td><button type="button" onclick={() => openReqForm(r)}>Edit</button></td>
          </tr>
        {/each}
      </tbody>
    </table>

    <h2>Matrix</h2>
    <p class="muted small">Click a cell to update the record. “—” means not assigned.</p>
    <div style="overflow-x:auto">
      <table class="data">
        <thead>
          <tr>
            <th>Employee</th>
            {#each activeReqs as r (r.id)}<th>{r.name}</th>{/each}
          </tr>
        </thead>
        <tbody>
          {#each app.activeEmployees as e (e.id)}
            <tr>
              <td>{e.displayName}</td>
              {#each activeReqs as r (r.id)}
                {@const c = cell(e.id, r.id)}
                <td>
                  {#if c.record}
                    <button type="button" class="cell-btn" onclick={() => openRecord(c.record!, r.name)}>
                      <span class="badge {c.cls}">{c.label}</span>
                    </button>
                  {:else}
                    <span class="muted">—</span>
                  {/if}
                </td>
              {/each}
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</div>

{#if reqFormOpen}
  <Dialog title={editingReq ? "Edit Requirement" : "Add Training Requirement"} onclose={() => (reqFormOpen = false)}>
    <form
      onsubmit={(e) => {
        e.preventDefault();
        void saveReq();
      }}
    >
      <label for="tr-name">Name <span class="req">*</span></label>
      <input id="tr-name" type="text" bind:value={rName} maxlength="200" style="width:100%" />
      {#if rError}<div class="field-error">{rError}</div>{/if}
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:0 .8rem;">
        <div>
          <label for="tr-cat">Category</label>
          <input id="tr-cat" type="text" bind:value={rCategory} maxlength="100" style="width:100%" />
        </div>
        <div>
          <label for="tr-rec">Recurrence</label>
          <select id="tr-rec" bind:value={rRecurrence} style="width:100%">
            <option value="none">One time</option>
            <option value="annual">Annual</option>
            <option value="months">Every N months</option>
            <option value="days">Every N days</option>
          </select>
        </div>
        {#if rRecurrence === "months" || rRecurrence === "days"}
          <div>
            <label for="tr-int">Interval (N)</label>
            <input id="tr-int" type="number" min="1" bind:value={rInterval} style="width:100%" />
          </div>
        {/if}
        <div>
          <label for="tr-warn">Warning days <span class="field-hint">(comma separated)</span></label>
          <input id="tr-warn" type="text" bind:value={rWarning} style="width:100%" />
        </div>
      </div>
      <div style="display:flex; gap:.5rem; justify-content:flex-end; margin-top:1rem;">
        <button type="button" onclick={() => (reqFormOpen = false)}>Cancel</button>
        <button type="submit" class="primary">Save</button>
      </div>
    </form>
  </Dialog>
{/if}

{#if recordDialog}
  <Dialog title={`${recordDialog.reqName} — ${app.employeeName(recordDialog.record.employeeId)}`} onclose={() => (recordDialog = undefined)}>
    <form
      onsubmit={(e) => {
        e.preventDefault();
        void saveRecord();
      }}
    >
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:0 .8rem;">
        <div>
          <label for="rec-status">Status</label>
          <select id="rec-status" bind:value={recStatus} style="width:100%">
            {#each ["assigned", "complete", "not_applicable", "waived", "unknown"] as s (s)}
              <option value={s}>{s.replace(/_/g, " ")}</option>
            {/each}
          </select>
        </div>
        <div>
          <label for="rec-due">Due date</label>
          <input id="rec-due" type="date" bind:value={recDue} style="width:100%" />
        </div>
        <div>
          <label for="rec-completed">Completed date <span class="field-hint">sets status to complete</span></label>
          <input id="rec-completed" type="date" bind:value={recCompleted} style="width:100%" />
        </div>
        <div>
          <label for="rec-verified">Last verified <span class="field-hint">against SWAT/authoritative system</span></label>
          <input id="rec-verified" type="date" bind:value={recVerified} style="width:100%" />
        </div>
      </div>
      {#if recError}<div class="field-error">{recError}</div>{/if}
      <div style="display:flex; gap:.5rem; justify-content:flex-end; margin-top:1rem;">
        <button type="button" onclick={() => (recordDialog = undefined)}>Cancel</button>
        <button type="submit" class="primary">Save</button>
      </div>
    </form>
  </Dialog>
{/if}

<style>
  .cell-btn { border: none; background: none; padding: 0; cursor: pointer; }
</style>
