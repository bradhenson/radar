<script lang="ts">
  // Training tracking (plan 12.7, 18 — revised): due dates live on the
  // requirement (fixed date for everyone, or rolling from completion),
  // assignment is declarative (everyone, or a selected list), and the primary
  // working view is a per-requirement roster with one-click completion.
  import { app } from "../stores/app.svelte";
  import Dialog from "../components/common/Dialog.svelte";
  import EmptyState from "../components/common/EmptyState.svelte";
  import type { EmployeeTrainingRecord, TrainingRequirement } from "../domain/models";
  import type { TrainingStatusRow } from "../stores/app.svelte";
  import { TRAINING_STATE_LABELS, TRAINING_STATE_ORDER, rollingExpiration, type TrainingState, type TrainingStatus } from "../domain/rules/training";
  import { formatDate, isValidIsoDate, nowTimestamp, todayIso } from "../utils/dates";
  import { newId } from "../utils/ids";

  type Schedule = "annual" | "once" | "rolling";

  let reqFormOpen = $state(false);
  let editingReq = $state<TrainingRequirement | undefined>(undefined);
  let rName = $state("");
  let rSchedule = $state<Schedule>("annual");
  let rDueDate = $state("");
  let rInterval = $state(12);
  let rUnit = $state<"months" | "days">("months");
  let rScope = $state<"all" | "selected">("all");
  let rSelected = $state<string[]>([]);
  let rError = $state("");

  let selectedReqId = $state("");
  let checkedIds = $state<string[]>([]);
  let completeDate = $state(todayIso());
  let showMatrix = $state(false);

  let recordDialog = $state<{ employeeId: string; req: TrainingRequirement } | undefined>(undefined);
  let recDue = $state("");
  let recCompleted = $state("");
  let recStatus = $state<EmployeeTrainingRecord["status"]>("assigned");
  let recVerified = $state("");
  let recError = $state("");

  let activeReqs = $derived(
    app.trainingRequirements.filter((r) => r.active).sort((a, b) => a.name.localeCompare(b.name))
  );
  let selectedReq = $derived(activeReqs.find((r) => r.id === selectedReqId));

  let summaries = $derived(
    activeReqs.map((req) => {
      const rows = app.trainingStatusList.filter((r) => r.requirement.id === req.id);
      const counted = rows.filter((r) => r.status.state !== "waived" && r.status.state !== "not_applicable");
      return {
        req,
        applicable: rows.length,
        total: counted.length,
        done: counted.filter((r) => r.status.state === "complete" || r.status.state === "expiring").length,
        overdue: counted.filter((r) => r.status.state === "overdue" || r.status.state === "expired").length
      };
    })
  );

  let roster = $derived.by<TrainingStatusRow[]>(() => {
    if (!selectedReq) return [];
    return app.trainingStatusList
      .filter((r) => r.requirement.id === selectedReq!.id)
      .slice()
      .sort(
        (a, b) =>
          TRAINING_STATE_ORDER[a.status.state] - TRAINING_STATE_ORDER[b.status.state] ||
          a.employee.displayName.localeCompare(b.employee.displayName)
      );
  });
  let incompleteIds = $derived(
    roster
      .filter((r) => !["complete", "waived", "not_applicable"].includes(r.status.state))
      .map((r) => r.employee.id)
  );

  const CELL: Record<TrainingState, { symbol: string; cls: string }> = {
    complete: { symbol: "✓", cls: "success" },
    expiring: { symbol: "⚠", cls: "warning" },
    expired: { symbol: "✗", cls: "overdue" },
    due_soon: { symbol: "!", cls: "warning" },
    overdue: { symbol: "✗", cls: "overdue" },
    not_completed: { symbol: "–", cls: "" },
    waived: { symbol: "W", cls: "" },
    not_applicable: { symbol: "n/a", cls: "" }
  };

  let matrixCells = $derived.by(() => {
    const map = new Map<string, TrainingStatusRow>();
    for (const row of app.trainingStatusList) map.set(`${row.employee.id}|${row.requirement.id}`, row);
    return map;
  });

  function scheduleText(req: TrainingRequirement): string {
    if (req.recurrenceType === "months" || req.recurrenceType === "days")
      return `Every ${req.recurrenceInterval ?? 12} ${req.recurrenceType} after completion`;
    if (req.recurrenceType === "none") return req.dueDate ? `One-time — due ${formatDate(req.dueDate)}` : "One-time";
    return req.dueDate ? `Annual — due ${formatDate(req.dueDate)}` : "Annual (no date set)";
  }

  function scopeText(req: TrainingRequirement): string {
    if ((req.assignmentScope ?? "all") === "all") return "All active employees";
    return `${(req.assignedEmployeeIds ?? []).length} selected`;
  }

  function statusText(status: TrainingStatus): string {
    switch (status.state) {
      case "complete":
        return status.completedDate ? `Complete ${formatDate(status.completedDate)}` : "Complete";
      case "expiring":
        return `Expires ${formatDate(status.dueDate)}`;
      case "expired":
        return `Expired ${formatDate(status.dueDate)}`;
      case "due_soon":
      case "not_completed":
        return status.dueDate ? `Due ${formatDate(status.dueDate)}` : "Not completed";
      case "overdue":
        return `Overdue — due ${formatDate(status.dueDate)}`;
      default:
        return TRAINING_STATE_LABELS[status.state];
    }
  }

  function openReqForm(req?: TrainingRequirement) {
    editingReq = req;
    rName = req?.name ?? "";
    if (req?.recurrenceType === "months" || req?.recurrenceType === "days") {
      rSchedule = "rolling";
      rUnit = req.recurrenceType;
      rInterval = req.recurrenceInterval ?? 12;
    } else {
      rSchedule = req?.recurrenceType === "none" ? "once" : "annual";
      rUnit = "months";
      rInterval = 12;
    }
    rDueDate = req?.dueDate ?? "";
    rScope = req?.assignmentScope ?? "all";
    rSelected = [...(req?.assignedEmployeeIds ?? [])];
    rError = "";
    reqFormOpen = true;
  }

  async function saveReq() {
    const name = rName.trim();
    if (!name) {
      rError = "Name is required.";
      return;
    }
    if (rSchedule === "annual" && !isValidIsoDate(rDueDate)) {
      rError = "An annual requirement needs the shared due date.";
      return;
    }
    if (rSchedule === "once" && rDueDate && !isValidIsoDate(rDueDate)) {
      rError = "Due date must be a valid date.";
      return;
    }
    if (rSchedule === "rolling" && (!Number.isFinite(rInterval) || rInterval < 1)) {
      rError = "Interval must be at least 1.";
      return;
    }
    if (rScope === "selected" && rSelected.length === 0) {
      rError = "Select at least one employee, or apply to all.";
      return;
    }
    const now = nowTimestamp();
    const record: TrainingRequirement = {
      id: editingReq?.id ?? newId(),
      name,
      recurrenceType: rSchedule === "annual" ? "annual" : rSchedule === "once" ? "none" : rUnit,
      recurrenceInterval: rSchedule === "rolling" ? rInterval : 1,
      dueDate: rSchedule === "rolling" ? undefined : rDueDate || undefined,
      assignmentScope: rScope,
      assignedEmployeeIds: rScope === "selected" ? [...rSelected] : undefined,
      warningDays: editingReq?.warningDays ?? [30, 14, 7],
      active: editingReq?.active ?? true,
      createdAt: editingReq?.createdAt ?? now,
      updatedAt: now
    };
    await app.putRecord("trainingRequirements", record, {
      actionType: editingReq ? "updated" : "created",
      summary: `${editingReq ? "Updated" : "Created"} training requirement ${name}`
    });
    reqFormOpen = false;
    if (!editingReq) selectedReqId = record.id;
  }

  function toggleSelected(id: string) {
    rSelected = rSelected.includes(id) ? rSelected.filter((x) => x !== id) : [...rSelected, id];
  }

  function addCompetency(competencyId: string) {
    const ids = app.activeEmployees.filter((e) => e.competencyId === competencyId).map((e) => e.id);
    rSelected = [...new Set([...rSelected, ...ids])];
  }

  function openRoster(reqId: string) {
    selectedReqId = selectedReqId === reqId ? "" : reqId;
    checkedIds = [];
  }

  function toggleChecked(id: string) {
    checkedIds = checkedIds.includes(id) ? checkedIds.filter((x) => x !== id) : [...checkedIds, id];
  }

  function toggleCheckAll() {
    checkedIds = checkedIds.length === incompleteIds.length ? [] : [...incompleteIds];
  }

  async function markComplete(employeeIds: string[]) {
    const req = selectedReq;
    if (!req || employeeIds.length === 0) return;
    const date = isValidIsoDate(completeDate) ? completeDate : todayIso();
    const undos: { employeeId: string; before: EmployeeTrainingRecord | undefined }[] = [];
    for (const id of employeeIds) {
      const employee = app.activeEmployees.find((e) => e.id === id);
      if (!employee) continue;
      const before = await app.markTrainingComplete(employee, req, date);
      undos.push({ employeeId: id, before });
    }
    checkedIds = [];
    const n = undos.length;
    app.toast(`Marked ${req.name} complete for ${n} employee${n === 1 ? "" : "s"}`, "success", async () => {
      for (const u of undos) {
        const current = app.employeeTrainingRecords.find(
          (r) => r.employeeId === u.employeeId && r.trainingRequirementId === req.id
        );
        if (current) await app.undoTrainingComplete(req, current, u.before);
      }
    });
  }

  function openRecord(employeeId: string, req: TrainingRequirement) {
    const rec = app.employeeTrainingRecords.find((r) => r.employeeId === employeeId && r.trainingRequirementId === req.id);
    recordDialog = { employeeId, req };
    recDue = rec?.dueDate ?? "";
    recCompleted = rec?.completedDate ?? "";
    recStatus = rec?.status ?? "assigned";
    recVerified = rec?.lastVerifiedDate ?? "";
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
    const { employeeId, req } = recordDialog;
    const existing = app.employeeTrainingRecords.find((r) => r.employeeId === employeeId && r.trainingRequirementId === req.id);
    const now = nowTimestamp();
    const status = recCompleted ? "complete" : recStatus;
    const record: EmployeeTrainingRecord = {
      ...existing,
      id: existing?.id ?? newId(),
      employeeId,
      trainingRequirementId: req.id,
      dueDate: recDue || undefined,
      completedDate: recCompleted || undefined,
      expirationDate: recCompleted ? rollingExpiration(req, recCompleted) : undefined,
      status,
      lastVerifiedDate: recVerified || undefined,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    };
    await app.putRecord("employeeTrainingRecords", record, {
      actionType: "updated",
      summary: `Updated ${req.name} record for ${app.employeeName(employeeId)}`
    });
    recordDialog = undefined;
  }
</script>

<div class="page training-page" class:matrix-open={showMatrix}>
  <div class="page-header">
    <h1>Training</h1>
  </div>

  <div class="toolbar">
    <button type="button" class="primary" onclick={() => openReqForm()}>Add Requirement</button>
    <span class="spacer"></span>
    {#if activeReqs.length > 0}
      <button type="button" onclick={() => (showMatrix = !showMatrix)}>{showMatrix ? "Hide matrix" : "Show matrix"}</button>
    {/if}
  </div>

  {#if activeReqs.length === 0}
    <EmptyState
      message="No training requirements defined."
      hint="Add a requirement (for example, Annual Cybersecurity Awareness). It applies to every active employee unless you pick specific people."
    />
  {:else}
    <h2>Requirements</h2>
    <table class="data" style="margin-bottom:1.2rem">
      <thead><tr><th>Name</th><th>Due</th><th>Applies to</th><th>Progress</th><th></th></tr></thead>
      <tbody>
        {#each summaries as s (s.req.id)}
          <tr class:selected-req={s.req.id === selectedReqId}>
            <td>{s.req.name}</td>
            <td>{scheduleText(s.req)}</td>
            <td>{scopeText(s.req)}</td>
            <td>
              {s.done}/{s.total} complete
              {#if s.overdue > 0}<span class="badge overdue" style="margin-left:.4rem">{s.overdue} overdue</span>{/if}
            </td>
            <td style="white-space:nowrap">
              <button type="button" onclick={() => openRoster(s.req.id)}>{s.req.id === selectedReqId ? "Close" : "Track"}</button>
              <button type="button" onclick={() => openReqForm(s.req)}>Edit</button>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>

    {#if selectedReq}
      {@const summary = summaries.find((s) => s.req.id === selectedReq!.id)}
      <section class="card roster">
        <div class="roster-head">
          <h2>{selectedReq.name}</h2>
          <span class="muted">{scheduleText(selectedReq)} · {summary?.done ?? 0}/{summary?.total ?? 0} complete</span>
        </div>
        <div class="toolbar">
          <label for="complete-date" class="muted small">Completion date</label>
          <input id="complete-date" type="date" bind:value={completeDate} />
          <button type="button" class="primary" disabled={checkedIds.length === 0} onclick={() => void markComplete(checkedIds)}>
            Mark {checkedIds.length || "selected"} complete
          </button>
        </div>
        <table class="data">
          <thead>
            <tr>
              <th style="width:2rem">
                <input
                  type="checkbox"
                  aria-label="Select all employees who have not completed this training"
                  checked={incompleteIds.length > 0 && checkedIds.length === incompleteIds.length}
                  disabled={incompleteIds.length === 0}
                  onchange={toggleCheckAll}
                />
              </th>
              <th>Employee</th>
              <th>Status</th>
              <th>Verified</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {#each roster as row (row.employee.id)}
              <tr>
                <td>
                  <input
                    type="checkbox"
                    aria-label={`Select ${row.employee.displayName}`}
                    checked={checkedIds.includes(row.employee.id)}
                    onchange={() => toggleChecked(row.employee.id)}
                  />
                </td>
                <td>{row.employee.displayName}</td>
                <td><span class="badge {CELL[row.status.state].cls}">{statusText(row.status)}</span></td>
                <td>{formatDate(row.record?.lastVerifiedDate)}</td>
                <td style="white-space:nowrap">
                  {#if !["complete", "waived", "not_applicable"].includes(row.status.state)}
                    <button type="button" onclick={() => void markComplete([row.employee.id])}>Complete</button>
                  {/if}
                  <button type="button" onclick={() => openRecord(row.employee.id, selectedReq!)}>Details</button>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </section>
    {/if}

    {#if showMatrix}
      <section class="matrix-section">
        <h2>Matrix overview</h2>
        <p class="muted small">✓ complete · ⚠ expiring · ! due soon · ✗ overdue or expired · – not completed · W waived. Click a cell to edit.</p>
        <div class="matrix-wrap">
          <table class="data matrix">
            <thead>
              <tr>
                <th class="employee-col">Employee</th>
                {#each activeReqs as r (r.id)}<th class="requirement-col"><span>{r.name}</span></th>{/each}
              </tr>
            </thead>
            <tbody>
              {#each app.activeEmployees as e (e.id)}
                <tr>
                  <td class="employee-col employee-name">{e.displayName}</td>
                  {#each activeReqs as r (r.id)}
                    {@const row = matrixCells.get(`${e.id}|${r.id}`)}
                    <td class="matrix-cell">
                      {#if row}
                        <button
                          type="button"
                          class="cell-btn"
                          title={`${r.name} — ${e.displayName}: ${statusText(row.status)}`}
                          aria-label={`${r.name} — ${e.displayName}: ${statusText(row.status)}`}
                          onclick={() => openRecord(e.id, r)}
                        >
                          <span class="mark {CELL[row.status.state].cls}">{CELL[row.status.state].symbol}</span>
                        </button>
                      {:else}
                        <span class="muted" aria-label="Not assigned"></span>
                      {/if}
                    </td>
                  {/each}
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </section>
    {/if}
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

      <div style="display:grid; grid-template-columns:1fr 1fr; gap:0 .8rem;">
        <div>
          <label for="tr-sched">Due schedule</label>
          <select id="tr-sched" bind:value={rSchedule} style="width:100%">
            <option value="annual">Annual — everyone due by the same date</option>
            <option value="once">One-time</option>
            {#if editingReq?.recurrenceType === "months" || editingReq?.recurrenceType === "days"}
              <option value="rolling">Repeats — due again after each completion</option>
            {/if}
          </select>
        </div>
        {#if rSchedule === "rolling"}
          <div>
            <label for="tr-int">Repeat every</label>
            <div style="display:flex; gap:.4rem">
              <input id="tr-int" type="number" min="1" bind:value={rInterval} style="width:5rem" />
              <select bind:value={rUnit} aria-label="Interval unit">
                <option value="months">months</option>
                <option value="days">days</option>
              </select>
            </div>
          </div>
        {:else}
          <div>
            <label for="tr-due">
              Due date {#if rSchedule === "annual"}<span class="req">*</span>{:else}<span class="field-hint">(optional)</span>{/if}
            </label>
            <input id="tr-due" type="date" bind:value={rDueDate} style="width:100%" />
            {#if rSchedule === "annual"}
              <div class="field-hint">Everyone is due by this date. Move it forward when the next cycle starts and all completions reset automatically.</div>
            {/if}
          </div>
        {/if}
      </div>

      <fieldset style="border:none; padding:0; margin:.6rem 0 0">
        <legend>Applies to</legend>
        <label style="display:inline-flex; align-items:center; gap:.35rem; margin-right:1rem">
          <input type="radio" name="tr-scope" value="all" bind:group={rScope} /> All active employees
        </label>
        <label style="display:inline-flex; align-items:center; gap:.35rem">
          <input type="radio" name="tr-scope" value="selected" bind:group={rScope} /> Selected employees
        </label>
      </fieldset>
      {#if rScope === "selected"}
        <div class="toolbar" style="margin:.4rem 0 .2rem">
          {#each app.activeCompetencies as c (c.id)}
            <button type="button" onclick={() => addCompetency(c.id)}>Add {c.code}</button>
          {/each}
          <button type="button" onclick={() => (rSelected = [])}>Clear</button>
          <span class="muted small">{rSelected.length} selected</span>
        </div>
        <div class="employee-picker">
          {#each app.activeEmployees as e (e.id)}
            <label>
              <input type="checkbox" checked={rSelected.includes(e.id)} onchange={() => toggleSelected(e.id)} />
              {e.displayName}
            </label>
          {/each}
        </div>
      {/if}

      {#if rError}<div class="field-error">{rError}</div>{/if}
      <div style="display:flex; gap:.5rem; justify-content:flex-end; margin-top:1rem;">
        <button type="button" onclick={() => (reqFormOpen = false)}>Cancel</button>
        <button type="submit" class="primary">Save</button>
      </div>
    </form>
  </Dialog>
{/if}

{#if recordDialog}
  <Dialog title={`${recordDialog.req.name} — ${app.employeeName(recordDialog.employeeId)}`} onclose={() => (recordDialog = undefined)}>
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
          <label for="rec-due">Due date override</label>
          <input id="rec-due" type="date" bind:value={recDue} style="width:100%" />
        </div>
        <div>
          <label for="rec-completed">Completed date</label>
          <input id="rec-completed" type="date" bind:value={recCompleted} style="width:100%" />
        </div>
        <div>
          <label for="rec-verified">Last verified</label>
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
  .training-page.matrix-open { max-width: none; }
  .matrix-section { width: 100%; }
  .matrix-wrap {
    width: 100%;
    overflow-x: auto;
    padding-bottom: .25rem;
  }
  .matrix {
    width: 100%;
  }
  .matrix th,
  .matrix td {
    padding: .48rem .45rem;
  }
  .matrix .employee-col {
    width: 1%;
    white-space: nowrap;
    padding-right: .9rem;
  }
  .matrix thead .employee-col {
    position: sticky;
    left: 0;
    z-index: 3;
  }
  .matrix tbody .employee-col {
    position: sticky;
    left: 0;
    z-index: 2;
    background: var(--surface);
    font-weight: 600;
  }
  .matrix tbody tr:hover .employee-col {
    background: color-mix(in srgb, var(--accent-soft) 38%, var(--surface));
  }
  .matrix thead .requirement-col {
    width: 5.75rem;
    min-width: 5.75rem;
    max-width: 6.25rem;
    white-space: normal;
    text-align: center;
    vertical-align: bottom;
    text-transform: none;
    letter-spacing: 0;
    line-height: 1.15;
    font-size: .76rem;
  }
  .matrix thead .requirement-col span {
    display: block;
    overflow-wrap: anywhere;
  }
  .matrix-cell {
    text-align: center;
    vertical-align: middle;
  }
  .matrix-cell .cell-btn {
    display: inline-flex;
    justify-content: center;
    width: 100%;
    padding: .15rem 0;
    border-radius: 4px;
  }
  .matrix-cell .cell-btn:hover {
    background: color-mix(in srgb, var(--accent-soft) 55%, transparent);
  }
  .matrix-cell .mark {
    font-size: .85rem;
    font-weight: 700;
    line-height: 1.2;
  }
  .matrix-cell .mark.success { color: var(--success-fg); }
  .matrix-cell .mark.warning { color: var(--duesoon-fg); }
  .matrix-cell .mark.overdue { color: var(--overdue-fg); }
  .roster { margin-bottom: 1.2rem; }
  .roster-head { display: flex; align-items: baseline; gap: 0.8rem; flex-wrap: wrap; }
  .roster-head h2 { margin: 0; }
  .selected-req td { background: color-mix(in srgb, var(--accent-soft) 45%, transparent); }
  .employee-picker { max-height: 220px; overflow-y: auto; border: 1px solid var(--border); border-radius: 6px; padding: 0.4rem 0.6rem; display: grid; grid-template-columns: 1fr 1fr; gap: 0.1rem 0.8rem; }
  .employee-picker label { display: flex; align-items: center; gap: 0.35rem; font-weight: normal; }
</style>
