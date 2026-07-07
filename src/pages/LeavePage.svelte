<script lang="ts">
  // Leave awareness (plan 12.8, 19): availability tracking, not official
  // leave accounting. No medical or reason details are collected.
  import { app } from "../stores/app.svelte";
  import ConfirmDialog from "../components/common/ConfirmDialog.svelte";
  import Dialog from "../components/common/Dialog.svelte";
  import EmptyState from "../components/common/EmptyState.svelte";
  import type { LeaveRecord, LeaveStatus } from "../domain/models";
  import { LEAVE_TYPES } from "../domain/models";
  import { addDays, addMonths, compareDates, formatDate, isValidIsoDate, nowTimestamp } from "../utils/dates";
  import { newId } from "../utils/ids";

  const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  let view = $state<"list" | "calendar">("list");
  let showPast = $state(false);
  let calendarMonth = $state(`${app.today.slice(0, 7)}-01`);
  let formOpen = $state(false);
  let editing = $state<LeaveRecord | undefined>(undefined);
  let fEmployee = $state("");
  let fType = $state("Not specified");
  let fStart = $state("");
  let fEnd = $state("");
  let fStatus = $state<LeaveStatus>("planned");
  let fNote = $state("");
  let fError = $state("");
  let activeCalendarDate = $state<string | undefined>(undefined);
  let pendingDelete = $state<LeaveRecord | undefined>(undefined);

  function openForm(l?: LeaveRecord, defaults: Partial<Pick<LeaveRecord, "employeeId" | "startDate" | "endDate">> = {}) {
    editing = l;
    fEmployee = l?.employeeId ?? defaults.employeeId ?? "";
    fType = l?.leaveType ?? "Not specified";
    fStart = l?.startDate ?? defaults.startDate ?? "";
    fEnd = l?.endDate ?? defaults.endDate ?? "";
    fStatus = l?.status ?? "planned";
    fNote = l?.workloadImpactNote ?? "";
    fError = "";
    formOpen = true;
  }

  function openFormForDate(date: string) {
    openForm(undefined, { startDate: date, endDate: date });
  }

  function showDayActions(date: string) {
    activeCalendarDate = date;
  }

  function hideDayActions(date: string) {
    if (activeCalendarDate === date) activeCalendarDate = undefined;
  }

  function hideDayActionsAfterFocus(date: string, e: FocusEvent) {
    const next = e.relatedTarget;
    if (!(next instanceof Node) || !(e.currentTarget as HTMLElement).contains(next)) hideDayActions(date);
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
      lastVerifiedDate: editing?.lastVerifiedDate,
      sourceSystem: editing?.sourceSystem,
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

  let calendarTitle = $derived(monthLabel(calendarMonth));
  let calendarWeeks = $derived.by(() => {
    const nextMonth = addMonths(calendarMonth, 1);
    const gridStart = addDays(calendarMonth, -weekday(calendarMonth));
    const weeks = [];
    let cursor = gridStart;
    do {
      const week = [];
      for (let i = 0; i < 7; i++) {
        const date = cursor;
        week.push({
          date,
          day: Number(date.slice(8, 10)),
          inMonth: date >= calendarMonth && date < nextMonth,
          isToday: date === app.today,
          events: rows.filter((l) => leaveCoversDate(l, date))
        });
        cursor = addDays(cursor, 1);
      }
      weeks.push(week);
    } while (cursor < nextMonth);
    return weeks;
  });

  function leaveCoversDate(l: LeaveRecord, date: string): boolean {
    const end = l.endDate < l.startDate ? l.startDate : l.endDate;
    return l.startDate <= date && date <= end;
  }

  function weekday(date: string): number {
    const [y, m, d] = date.split("-").map(Number) as [number, number, number];
    return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  }

  function monthLabel(date: string): string {
    const [y, m] = date.split("-").map(Number) as [number, number];
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return `${months[m - 1]} ${y}`;
  }

  function setMonth(offset: number) {
    calendarMonth = addMonths(calendarMonth, offset);
  }

  function leaveTypeLabel(l: LeaveRecord): string {
    return l.leaveType ?? "Leave";
  }

  function editFromRow(l: LeaveRecord) {
    // Don't hijack a click the user made to select and copy text.
    if (window.getSelection()?.toString()) return;
    openForm(l);
  }

  function requestDelete(l: LeaveRecord) {
    pendingDelete = l;
  }

  async function deleteLeave(l: LeaveRecord) {
    await app.deleteRecord(
      "leaveRecords",
      l.id,
      `Deleted leave for ${app.employeeName(l.employeeId)} (${l.startDate} to ${l.endDate})`
    );
    if (editing?.id === l.id) {
      formOpen = false;
      editing = undefined;
    }
    pendingDelete = undefined;
    app.toast("Leave record deleted", "success");
  }
</script>

<div class="page leave-page" class:wide={view === "calendar"}>
  <div class="page-header">
    <h1>Leave and Availability</h1>
    <span class="muted">{rows.length} shown</span>
  </div>
  <div class="toolbar leave-toolbar">
    <label class="inline-toggle">
      <input type="checkbox" bind:checked={showPast} /> Show past leave
    </label>
    <div class="view-toggle" role="group" aria-label="Leave view">
      <button type="button" class:active={view === "list"} onclick={() => (view = "list")}>List</button>
      <button type="button" class:active={view === "calendar"} onclick={() => (view = "calendar")}>Calendar</button>
    </div>
    <span class="spacer"></span>
    <button type="button" class="primary" onclick={() => openForm()}>Add Leave</button>
  </div>

  {#if view === "list"}
    {#if rows.length === 0}
      <EmptyState message="No leave records." hint="Track upcoming absences for workload awareness. Details stay broad — no reasons required." />
    {:else}
      <table class="data">
        <thead><tr><th>Employee</th><th>Start</th><th>End</th><th>Type</th><th>Status</th><th></th></tr></thead>
        <tbody>
          {#each rows as l (l.id)}
            <!-- Row click is a mouse convenience; the name button is the keyboard path. -->
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
            <tr class="row-clickable" onclick={() => editFromRow(l)}>
              <td>
                <button
                  type="button"
                  class="link cell-link"
                  onclick={(ev) => {
                    ev.stopPropagation();
                    openForm(l);
                  }}>{app.employeeName(l.employeeId)}</button
                >
              </td>
              <td>{formatDate(l.startDate)}</td>
              <td>{formatDate(l.endDate)}</td>
              <td>{l.leaveType ?? ""}</td>
              <td>{l.status}</td>
              <td>
                <div class="row-actions">
                  <button
                    type="button"
                    class="danger"
                    onclick={(ev) => {
                      ev.stopPropagation();
                      requestDelete(l);
                    }}>Delete</button
                  >
                </div>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  {:else}
    <section class="calendar-view" aria-label="Leave calendar">
      <div class="calendar-header">
        <button type="button" onclick={() => setMonth(-1)} aria-label="Previous month">&lt;</button>
        <h2>{calendarTitle}</h2>
        <button type="button" onclick={() => (calendarMonth = `${app.today.slice(0, 7)}-01`)}>Today</button>
        <button type="button" onclick={() => setMonth(1)} aria-label="Next month">&gt;</button>
      </div>
      <div class="calendar-grid" aria-label="Leave month calendar">
        <div class="weekday-row">
          {#each WEEKDAYS as day (day)}
            <div class="calendar-weekday">{day}</div>
          {/each}
        </div>
        {#each calendarWeeks as week (week[0]!.date)}
          <div class="week-row">
            {#each week as day, i (day.date)}
              <div
                class="calendar-day"
                class:outside={!day.inMonth}
                class:today={day.isToday}
                class:weekend={i === 0 || i === 6}
                role="group"
                aria-label={formatDate(day.date)}
                onmouseenter={() => showDayActions(day.date)}
                onmouseleave={() => hideDayActions(day.date)}
                onfocusin={() => showDayActions(day.date)}
                onfocusout={(e) => hideDayActionsAfterFocus(day.date, e)}
              >
                <div class="day-head">
                  <span class="day-number" class:today-number={day.isToday}>{day.day}</span>
                  <button
                    type="button"
                    class="day-add"
                    class:visible={activeCalendarDate === day.date}
                    aria-label={`Add leave for ${formatDate(day.date)}`}
                    title="Add leave on this day"
                    onclick={() => openFormForDate(day.date)}>+</button>
                </div>
                <div class="day-events">
                  {#each day.events.slice(0, 4) as event (event.id)}
                    <button type="button" class="calendar-event status-{event.status}" onclick={() => openForm(event)}>
                      <span>{app.employeeName(event.employeeId)}</span>
                      <small>{leaveTypeLabel(event)} - {event.status}</small>
                    </button>
                  {/each}
                  {#if day.events.length > 4}
                    <span class="more-events">+{day.events.length - 4} more</span>
                  {/if}
                </div>
              </div>
            {/each}
          </div>
        {/each}
      </div>
    </section>
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
      <div class="dialog-actions">
        {#if editing}
          <button type="button" class="danger" onclick={() => requestDelete(editing!)}>Delete</button>
        {/if}
        <span class="spacer"></span>
        <button type="button" onclick={() => (formOpen = false)}>Cancel</button>
        <button type="submit" class="primary">Save</button>
      </div>
    </form>
  </Dialog>
{/if}

{#if pendingDelete}
  <ConfirmDialog
    title="Delete leave record"
    message={`Permanently delete ${app.employeeName(pendingDelete.employeeId)} leave from ${formatDate(pendingDelete.startDate)} to ${formatDate(pendingDelete.endDate)}?`}
    confirmLabel="Delete leave"
    danger
    onconfirm={() => void deleteLeave(pendingDelete!)}
    oncancel={() => (pendingDelete = undefined)}
  />
{/if}

<style>
  /* List view uses the default page width; only the calendar spans full width. */
  .leave-page.wide {
    max-width: none;
  }
  .leave-toolbar {
    align-items: center;
  }
  .inline-toggle {
    display: flex;
    align-items: center;
    gap: .35rem;
    font-weight: 400;
    margin: 0;
    white-space: nowrap;
  }
  .view-toggle {
    display: inline-flex;
    border: 1px solid var(--border);
    border-radius: 8px;
    overflow: hidden;
    background: var(--surface);
  }
  .view-toggle button {
    border: 0;
    border-radius: 0;
    background: transparent;
    min-height: 2.1rem;
  }
  .view-toggle button.active {
    background: var(--accent-soft);
    color: var(--accent);
  }
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
  .row-clickable {
    cursor: pointer;
  }
  .dialog-actions {
    justify-content: flex-end;
    margin-top: 1rem;
  }
  .calendar-view {
    min-width: 0;
    width: 100%;
  }
  .calendar-header {
    display: flex;
    align-items: center;
    gap: .5rem;
    margin-bottom: .75rem;
  }
  .calendar-header h2 {
    margin: 0;
    min-width: 8rem;
    font-size: 1rem;
  }
  .calendar-grid {
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    overflow: hidden;
    background: var(--surface);
    box-shadow: var(--shadow);
    min-width: 0;
  }
  .weekday-row,
  .week-row {
    display: grid;
    grid-template-columns: repeat(7, minmax(0, 1fr));
  }
  .calendar-weekday {
    padding: .45rem .55rem;
    background: var(--surface-2);
    border-bottom: 1px solid var(--border);
    border-right: 1px solid var(--border);
    color: var(--text-muted);
    font-size: .78rem;
    font-weight: 700;
  }
  .weekday-row .calendar-weekday:last-child {
    border-right: 0;
  }
  .calendar-day {
    min-height: 7.5rem;
    min-width: 0;
    padding: .35rem .4rem .45rem;
    border-bottom: 1px solid var(--border);
    border-right: 1px solid var(--border);
    background: var(--surface);
    display: flex;
    flex-direction: column;
    gap: .3rem;
    overflow: hidden;
  }
  .week-row .calendar-day:last-child {
    border-right: 0;
  }
  .calendar-grid > .week-row:last-child .calendar-day {
    border-bottom: 0;
  }
  .calendar-day.weekend {
    background: color-mix(in srgb, var(--surface-2) 32%, var(--surface));
  }
  .calendar-day.outside {
    background: color-mix(in srgb, var(--surface-2) 45%, var(--surface));
    color: var(--text-muted);
  }
  .calendar-day.outside .day-number {
    opacity: .55;
  }
  .calendar-day.today {
    box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--accent) 45%, transparent);
  }
  .day-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: .3rem;
    min-height: 1.45rem;
  }
  .day-number {
    font-weight: 700;
    font-size: .8rem;
  }
  .today-number {
    color: var(--accent);
  }
  .day-add {
    min-width: 1.45rem;
    min-height: 1.45rem;
    padding: 0;
    border: 0;
    border-radius: 999px;
    background: transparent;
    color: var(--text-muted);
    font-weight: 700;
    opacity: 0;
    transition: opacity .12s ease, background-color .12s ease, color .12s ease;
  }
  .day-add.visible,
  .day-add:focus {
    opacity: 1;
  }
  .day-add:hover {
    background: var(--accent-soft);
    color: var(--accent);
  }
  .day-events {
    display: flex;
    flex-direction: column;
    gap: .22rem;
    min-height: 0;
  }
  .calendar-event {
    display: grid;
    gap: .05rem;
    width: 100%;
    min-height: 2rem;
    padding: .25rem .35rem;
    border: 1px solid color-mix(in srgb, #ca5010 24%, var(--border));
    border-radius: 6px;
    background: color-mix(in srgb, #ca5010 16%, var(--surface));
    color: var(--text);
    text-align: left;
    overflow: hidden;
  }
  .calendar-event:hover {
    border-color: color-mix(in srgb, #ca5010 50%, var(--border));
  }
  .calendar-event span,
  .calendar-event small {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .calendar-event small {
    color: var(--text-muted);
    font-size: .68rem;
  }
  .calendar-event.status-requested,
  .calendar-event.status-changed {
    background: var(--duesoon-bg);
    color: var(--duesoon-fg);
  }
  .calendar-event.status-cancelled,
  .calendar-event.status-complete {
    background: var(--surface-2);
    color: var(--text-muted);
  }
  .more-events {
    color: var(--text-muted);
    font-size: .72rem;
  }
  @media (max-width: 900px) {
    .leave-toolbar {
      align-items: stretch;
    }
    .calendar-weekday {
      padding-inline: .3rem;
    }
    .calendar-day {
      min-height: 5.5rem;
      padding-inline: .3rem;
    }
  }
</style>
