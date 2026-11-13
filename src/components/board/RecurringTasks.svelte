<script lang="ts">
  // The Recurring view of the Tasks page (plan section 23): the schedules that
  // put a card on the board by themselves. A schedule is not a card; the app
  // creates an ordinary task from it shortly before each due date, so a
  // recurring task is finished, moved, and archived like any other.
  import { app } from "../../stores/app.svelte";
  import ConfirmDialog from "../common/ConfirmDialog.svelte";
  import Dialog from "../common/Dialog.svelte";
  import EmptyState from "../common/EmptyState.svelte";
  import Icon from "../common/Icon.svelte";
  import { TASK_PRIORITIES, priorityLabel, type RecurrenceUnit, type RecurringTask, type TaskPriority } from "../../domain/models";
  import {
    nextOccurrenceAfter,
    RECURRENCE_PRESETS,
    recurrencePresetKey,
    recurrenceSummary,
    recurringTaskError,
    resumeFrom,
    type RecurrencePresetKey,
    type RecurrenceSchedule
  } from "../../domain/rules/recurrence";
  import { addDays, compareDates, formatDate, nowTimestamp } from "../../utils/dates";
  import { newId } from "../../utils/ids";

  const UNITS: { value: RecurrenceUnit; label: string }[] = [
    { value: "days", label: "days" },
    { value: "weeks", label: "weeks" },
    { value: "months", label: "months" }
  ];

  let formOpen = $state(false);
  let editing = $state<RecurringTask | undefined>(undefined);
  let fTitle = $state("");
  let fDescription = $state("");
  let fPreset = $state<RecurrencePresetKey>("weekly");
  let fUnit = $state<RecurrenceUnit>("weeks");
  let fInterval = $state(1);
  let fWeekdaysOnly = $state(false);
  let fFirstDue = $state("");
  let fAdvance = $state(4);
  let fPriority = $state<TaskPriority>("normal");
  let fEmployee = $state("");
  let fProject = $state("");
  let fError = $state("");
  let pendingDelete = $state<RecurringTask | undefined>(undefined);

  let openedSnapshot = $state("");
  function formSnapshot(): string {
    return JSON.stringify([fTitle, fDescription, fUnit, fInterval, fWeekdaysOnly, fFirstDue, fAdvance, fPriority, fEmployee, fProject]);
  }

  /** Opened from the page header's "+ New Recurring Task" button as well as from a row. */
  export function openForm(r?: RecurringTask) {
    editing = r;
    fTitle = r?.title ?? "";
    fDescription = r?.description ?? "";
    fUnit = r?.unit ?? "weeks";
    fInterval = r?.interval ?? 1;
    fWeekdaysOnly = r?.weekdaysOnly ?? false;
    fFirstDue = r?.firstDueDate ?? "";
    fAdvance = r?.advanceCreateDays ?? 4;
    fPriority = r?.priority ?? "normal";
    fEmployee = r?.employeeId ?? "";
    fProject = r?.projectId ?? "";
    fPreset = r ? recurrencePresetKey(r) : "weekly";
    fError = "";
    openedSnapshot = formSnapshot();
    formOpen = true;
  }

  // Choosing a named schedule fills in its interval and a sensible lead time;
  // "Custom" leaves the fields as they are for the user to set.
  function applyPreset() {
    const preset = RECURRENCE_PRESETS.find((p) => p.key === fPreset);
    if (!preset) return;
    fUnit = preset.unit;
    fInterval = preset.interval;
    fWeekdaysOnly = preset.weekdaysOnly;
    fAdvance = preset.advanceCreateDays;
  }

  let formSchedule = $derived<RecurrenceSchedule>({
    unit: fUnit,
    interval: Number(fInterval),
    firstDueDate: fFirstDue,
    weekdaysOnly: fUnit === "days" && fWeekdaysOnly
  });

  // The first few due dates the schedule produces, so a mistake shows before saving.
  let preview = $derived.by(() => {
    if (recurringTaskError({ title: "x", ...formSchedule, advanceCreateDays: 0 })) return [];
    const dates: string[] = [];
    let cursor = addDays(fFirstDue, -1);
    for (let i = 0; i < 3; i += 1) {
      const next = nextOccurrenceAfter(formSchedule, cursor);
      if (!next) break;
      dates.push(next);
      cursor = next;
    }
    return dates;
  });

  async function save() {
    const draft = {
      title: fTitle,
      ...formSchedule,
      interval: Number(fInterval),
      advanceCreateDays: Number(fAdvance)
    };
    const error = recurringTaskError(draft);
    if (error) {
      fError = error;
      return;
    }
    const now = nowTimestamp();
    const record: RecurringTask = {
      id: editing?.id ?? newId(),
      tags: editing?.tags ?? [],
      active: editing?.active ?? true,
      createdAt: editing?.createdAt ?? now,
      ...draft,
      title: fTitle.trim(),
      description: fDescription.trim() || undefined,
      priority: fPriority,
      employeeId: fEmployee || undefined,
      projectId: fProject || undefined,
      // A new schedule looks forward only: a first due date in the past sets
      // the rhythm but does not create a card that is already overdue.
      lastGeneratedDueDate: editing ? editing.lastGeneratedDueDate : resumeFrom(undefined, app.today),
      updatedAt: now
    };
    await app.saveRecurringTask(record, !editing);
    formOpen = false;
  }

  async function setActive(r: RecurringTask, active: boolean) {
    await app.putRecord(
      "recurringTasks",
      {
        ...r,
        active,
        // Resuming picks up from today rather than back-filling the pause.
        lastGeneratedDueDate: active ? resumeFrom(r.lastGeneratedDueDate, app.today) : r.lastGeneratedDueDate,
        updatedAt: nowTimestamp()
      },
      { actionType: "updated", summary: `${active ? "Resumed" : "Paused"} recurring task "${r.title}"` }
    );
    if (active) await app.generateRecurringTasks();
    app.toast(active ? "Recurring task resumed" : "Recurring task paused", "success");
  }

  async function deleteRecurring(r: RecurringTask) {
    await app.deleteRecord("recurringTasks", r.id, `Deleted recurring task "${r.title}"`);
    if (editing?.id === r.id) {
      formOpen = false;
      editing = undefined;
    }
    pendingDelete = undefined;
    app.toast("Recurring task deleted. Cards it already created are kept.", "success");
  }

  function nextDue(r: RecurringTask): string | undefined {
    return nextOccurrenceAfter(r, r.lastGeneratedDueDate ?? addDays(r.firstDueDate, -1));
  }

  function openCardCount(r: RecurringTask): number {
    return app.tasks.filter(
      (t) => t.recurrenceTemplateId === r.id && !t.isArchived && t.status !== "complete" && t.status !== "cancelled"
    ).length;
  }

  let rows = $derived(
    app.recurringTasks
      .map((r) => ({ r, next: nextDue(r), open: openCardCount(r) }))
      .sort((a, b) => {
        if (a.r.active !== b.r.active) return a.r.active ? -1 : 1;
        return compareDates(a.next ?? "9999-12-31", b.next ?? "9999-12-31") || a.r.title.localeCompare(b.r.title);
      })
  );
</script>

{#if rows.length === 0}
  <EmptyState
    message="No recurring tasks yet."
    hint="Add one for work that comes back on a schedule, like timecards each pay period or a weekly status report. RADAR puts the card on the board for you."
  />
{:else}
  <p class="section-hint">
    Each schedule adds a card to the first board column shortly before it is due. Pausing stops new cards; cards already on the board stay.
  </p>
  <!-- Keyboard focus lets the arrow keys scroll wide tables. -->
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <div class="table-scroll" role="region" aria-label="Recurring tasks" tabindex="0">
    <table class="data">
      <thead>
        <tr>
          <th>Task</th><th>Repeats</th><th>Next due</th><th>Card added</th><th>Assignee</th><th>Project</th><th>Open cards</th>
          <th class="row-action-cell" aria-label="Actions"></th>
        </tr>
      </thead>
      <tbody>
        {#each rows as { r, next, open } (r.id)}
          <!-- Row click is a mouse convenience; the title button is the keyboard path. -->
          <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_noninteractive_element_interactions -->
          <tr class="row-clickable" class:paused={!r.active} id={"recurring-row-" + r.id} onclick={() => openForm(r)}>
            <td>
              <button
                type="button"
                class="link cell-link"
                onclick={(ev) => {
                  ev.stopPropagation();
                  openForm(r);
                }}>{r.title}</button
              >
              {#if r.priority === "high" || r.priority === "critical"}
                <span class="badge priority-{r.priority}">{priorityLabel(r.priority)}</span>
              {/if}
            </td>
            <td>{recurrenceSummary(r)}</td>
            <td class="date-cell">
              {#if !r.active}
                <span class="badge">Paused</span>
              {:else}
                {next ? formatDate(next) : "—"}
              {/if}
            </td>
            <td>{r.advanceCreateDays === 0 ? "On the due date" : `${r.advanceCreateDays} day${r.advanceCreateDays === 1 ? "" : "s"} before`}</td>
            <td>{app.employees.some((e) => e.id === r.employeeId) ? app.employeeName(r.employeeId) : "—"}</td>
            <td>{app.projects.some((p) => p.id === r.projectId) ? app.projectName(r.projectId) : "—"}</td>
            <td>{open || "—"}</td>
            <td class="row-action-cell">
              <button
                type="button"
                aria-label={`${r.active ? "Pause" : "Resume"} recurring task ${r.title}`}
                onclick={(ev) => {
                  ev.stopPropagation();
                  void setActive(r, !r.active);
                }}>{r.active ? "Pause" : "Resume"}</button>
              <button
                type="button"
                class="icon-btn danger"
                aria-label={`Delete recurring task ${r.title}`}
                title="Delete"
                onclick={(ev) => {
                  ev.stopPropagation();
                  pendingDelete = r;
                }}><Icon name="trash" size={16} /></button>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{/if}

{#if formOpen}
  <Dialog
    title={editing ? "Edit Recurring Task" : "New Recurring Task"}
    onclose={() => (formOpen = false)}
    unsavedGuard={() => formSnapshot() !== openedSnapshot}
  >
    <form
      onsubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <label for="rt-title">Title <span class="req">*</span></label>
      <input id="rt-title" type="text" bind:value={fTitle} maxlength="200" style="width:100%" />
      <label for="rt-description">Description</label>
      <textarea id="rt-description" bind:value={fDescription} rows="2" maxlength="2000" style="width:100%"></textarea>
      <div class="form-grid">
        <div>
          <label for="rt-preset">Repeats</label>
          <select id="rt-preset" bind:value={fPreset} onchange={applyPreset} style="width:100%">
            {#each RECURRENCE_PRESETS as p (p.key)}<option value={p.key}>{p.label}</option>{/each}
            <option value="custom">Custom…</option>
          </select>
        </div>
        <div>
          <label for="rt-first">First due date <span class="req">*</span></label>
          <input id="rt-first" type="date" bind:value={fFirstDue} style="width:100%" />
        </div>
      </div>
      {#if fPreset === "custom"}
        <div class="custom-row">
          <label for="rt-interval">Every</label>
          <input id="rt-interval" type="number" min="1" max="365" step="1" bind:value={fInterval} />
          <select bind:value={fUnit} aria-label="Repeat unit">
            {#each UNITS as u (u.value)}<option value={u.value}>{u.label}</option>{/each}
          </select>
          {#if fUnit === "days"}
            <label class="inline-toggle"><input type="checkbox" bind:checked={fWeekdaysOnly} /> Weekdays only</label>
          {/if}
        </div>
      {/if}
      <div class="custom-row">
        <label for="rt-advance">Add the card</label>
        <input id="rt-advance" type="number" min="0" max="365" step="1" bind:value={fAdvance} />
        <span>day(s) before it is due</span>
      </div>
      <p class="small muted preview" aria-live="polite">
        {#if preview.length > 0}
          {recurrenceSummary(formSchedule)}. Due {preview.map((d) => formatDate(d)).join(", ")}, and so on.
        {:else}
          Pick a first due date to see the schedule.
        {/if}
      </p>
      <div class="form-grid">
        <div>
          <label for="rt-priority">Priority</label>
          <select id="rt-priority" bind:value={fPriority} style="width:100%">
            {#each TASK_PRIORITIES as p (p.value)}<option value={p.value}>{p.label}</option>{/each}
          </select>
        </div>
        <div>
          <label for="rt-employee">Employee</label>
          <select id="rt-employee" bind:value={fEmployee} style="width:100%">
            <option value="">(none)</option>
            {#each app.activeEmployees as e (e.id)}<option value={e.id}>{e.displayName}</option>{/each}
          </select>
        </div>
        <div>
          <label for="rt-project">Project</label>
          <select id="rt-project" bind:value={fProject} style="width:100%">
            <option value="">(none)</option>
            {#each app.activeProjects as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
          </select>
        </div>
      </div>
      {#if fError}<div class="field-error" role="alert">{fError}</div>{/if}
      <div class="dialog-actions">
        {#if editing}
          <button
            type="button"
            class="icon-btn danger"
            aria-label="Delete recurring task"
            title="Delete"
            onclick={() => (pendingDelete = editing)}><Icon name="trash" size={17} /></button>
          <span class="spacer"></span>
        {/if}
        <button type="button" onclick={() => (formOpen = false)}>Cancel</button>
        <button type="submit" class="primary">Save</button>
      </div>
    </form>
  </Dialog>
{/if}

{#if pendingDelete}
  <ConfirmDialog
    title="Delete recurring task"
    message={`Stop "${pendingDelete.title}" from recurring and delete its schedule? Cards it already created stay on the board.`}
    confirmLabel="Delete schedule"
    danger
    onconfirm={() => void deleteRecurring(pendingDelete!)}
    oncancel={() => (pendingDelete = undefined)}
  />
{/if}

<style>
  .section-hint {
    margin: 0 0 .6rem;
    color: var(--text-muted);
    font-size: .82rem;
  }
  tr.paused td {
    color: var(--text-muted);
  }
  .custom-row {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: .5rem;
    margin-top: .7rem;
  }
  .custom-row label {
    margin: 0;
  }
  .custom-row input[type="number"] {
    width: 5rem;
  }
  .preview {
    margin: .6rem 0 0;
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
