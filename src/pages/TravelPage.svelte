<script lang="ts">
  // Travel awareness: who is on travel, where, when, and the DTS paperwork
  // state around each trip (IPT concurrence, authorization, voucher due).
  import { app } from "../stores/app.svelte";
  import ConfirmDialog from "../components/common/ConfirmDialog.svelte";
  import Dialog from "../components/common/Dialog.svelte";
  import EmptyState from "../components/common/EmptyState.svelte";
  import Icon from "../components/common/Icon.svelte";
  import {
    TRAVEL_DTS_AUTH_STATUS_OPTIONS,
    TRAVEL_IPT_CONCURRENCE_OPTIONS,
    type TravelDtsAuthStatus,
    type TravelIptConcurrence,
    type TravelRecord
  } from "../domain/models";
  import { travelVoucherDueDate } from "../domain/rules/travel";
  import { addDays, addMonths, compareDates, formatDate, isValidIsoDate, nowTimestamp, todayIso } from "../utils/dates";
  import { newId } from "../utils/ids";
  import { toCsv } from "../utils/csv";
  import { backupFilename, downloadText } from "../utils/download";

  const CALENDAR_WEEK_COUNT = 5;
  const CALENDAR_DAY_COUNT = CALENDAR_WEEK_COUNT * 7;

  let view = $state<"list" | "calendar">("list");
  let showPast = $state(false);
  let filterEmployee = $state("");
  let calendarMonth = $state(`${app.today.slice(0, 7)}-01`);
  let formOpen = $state(false);
  let editing = $state<TravelRecord | undefined>(undefined);
  let fEmployee = $state("");
  let fDestination = $state("");
  let fStart = $state("");
  let fEnd = $state("");
  let fIpt = $state<TravelIptConcurrence>("pending");
  let fDtsStatus = $state<TravelDtsAuthStatus>("not_started");
  let fDtsId = $state("");
  let fVoucher = $state("");
  let fNotes = $state("");
  let fError = $state("");
  // When true the user has typed their own voucher date, so we stop
  // auto-filling it from the return date.
  let voucherManual = $state(false);
  let activeCalendarDate = $state<string | undefined>(undefined);
  let pendingDelete = $state<TravelRecord | undefined>(undefined);

  // Auto-fill the voucher due date (return + 5 days) until the user overrides it.
  $effect(() => {
    if (!voucherManual && isValidIsoDate(fEnd)) {
      const suggested = travelVoucherDueDate(fEnd);
      if (fVoucher !== suggested) fVoucher = suggested;
    }
  });

  function iptLabel(v: TravelIptConcurrence): string {
    return TRAVEL_IPT_CONCURRENCE_OPTIONS.find((o) => o.value === v)?.label ?? v.replace(/_/g, " ");
  }
  function dtsLabel(v: TravelDtsAuthStatus): string {
    return TRAVEL_DTS_AUTH_STATUS_OPTIONS.find((o) => o.value === v)?.label ?? v.replace(/_/g, " ");
  }
  function iptBadgeClass(v: TravelIptConcurrence): string {
    return v === "concurred" ? "success" : v === "pending" ? "warning" : "";
  }
  function dtsBadgeClass(v: TravelDtsAuthStatus): string {
    return v === "approved" ? "success" : v === "created" ? "warning" : "";
  }

  // A trip stays visible until its voucher (or return date) has passed.
  function trailingDate(t: TravelRecord): string {
    return t.voucherDueDate && t.voucherDueDate > t.endDate ? t.voucherDueDate : t.endDate;
  }
  function isPast(t: TravelRecord): boolean {
    return compareDates(trailingDate(t), app.today) < 0;
  }
  function voucherState(t: TravelRecord): "overdue" | "soon" | "" {
    if (!t.voucherDueDate) return "";
    if (compareDates(t.voucherDueDate, app.today) < 0) return "overdue";
    if (compareDates(t.voucherDueDate, addDays(app.today, 5)) <= 0) return "soon";
    return "";
  }

  function openForm(t?: TravelRecord, defaults: Partial<Pick<TravelRecord, "employeeId" | "startDate" | "endDate">> = {}) {
    editing = t;
    fEmployee = t?.employeeId ?? defaults.employeeId ?? "";
    fDestination = t?.destination ?? "";
    fStart = t?.startDate ?? defaults.startDate ?? "";
    fEnd = t?.endDate ?? defaults.endDate ?? "";
    fIpt = t?.iptConcurrence ?? "pending";
    fDtsStatus = t?.dtsAuthorizationStatus ?? "not_started";
    fDtsId = t?.dtsAuthorizationId ?? "";
    fVoucher = t?.voucherDueDate ?? "";
    fNotes = t?.notes ?? "";
    voucherManual = Boolean(t?.voucherDueDate);
    fError = "";
    formOpen = true;
  }

  function openFormForDate(date: string) {
    openForm(undefined, { employeeId: filterEmployee || undefined, startDate: date, endDate: date });
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
    if (!fDestination.trim()) {
      fError = "Destination is required.";
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
    if (fVoucher && !isValidIsoDate(fVoucher)) {
      fError = "Voucher due date must be valid.";
      return;
    }
    const now = nowTimestamp();
    const record: TravelRecord = {
      id: editing?.id ?? newId(),
      employeeId: fEmployee,
      destination: fDestination.trim(),
      startDate: fStart,
      endDate: fEnd,
      iptConcurrence: fIpt,
      dtsAuthorizationStatus: fDtsStatus,
      dtsAuthorizationId: fDtsId.trim() || undefined,
      voucherDueDate: fVoucher || travelVoucherDueDate(fEnd),
      notes: fNotes.trim() || undefined,
      createdAt: editing?.createdAt ?? now,
      updatedAt: now
    };
    await app.putRecord("travelRecords", record, {
      actionType: editing ? "updated" : "created",
      summary: `${editing ? "Updated" : "Added"} travel for ${app.employeeName(fEmployee)} to ${record.destination} (${fStart} to ${fEnd})`
    });
    formOpen = false;
  }

  let rows = $derived(
    app.travelRecords
      .filter((t) => showPast || !isPast(t))
      .filter((t) => !filterEmployee || t.employeeId === filterEmployee)
      .sort(
        (a, b) =>
          compareDates(a.startDate, b.startDate) ||
          app.employeeName(a.employeeId).localeCompare(app.employeeName(b.employeeId))
      )
  );

  let calendarTitle = $derived(monthLabel(calendarMonth));
  let calendarDays = $derived.by(() => {
    const nextMonth = addMonths(calendarMonth, 1);
    const gridStart = addDays(calendarMonth, -weekday(calendarMonth));
    return Array.from({ length: CALENDAR_DAY_COUNT }, (_, i) => {
      const date = addDays(gridStart, i);
      return {
        date,
        day: Number(date.slice(8, 10)),
        inMonth: date >= calendarMonth && date < nextMonth,
        isToday: date === app.today,
        events: rows.filter((t) => t.startDate <= date && date <= t.endDate)
      };
    });
  });
  let calendarWeeks = $derived.by(() =>
    Array.from({ length: CALENDAR_WEEK_COUNT }, (_, i) => calendarDays.slice(i * 7, i * 7 + 7))
  );

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

  function exportCsv() {
    const csv = toCsv(
      ["Employee", "Destination", "Start", "End", "IPT concurrence", "DTS authorization", "DTS auth ID", "Voucher due", "Notes"],
      rows.map((t) => [
        app.employeeName(t.employeeId),
        t.destination,
        t.startDate,
        t.endDate,
        iptLabel(t.iptConcurrence),
        dtsLabel(t.dtsAuthorizationStatus),
        t.dtsAuthorizationId,
        t.voucherDueDate,
        t.notes
      ])
    );
    downloadText(backupFilename("RADAR_Travel", "csv"), csv, "text/csv");
  }

  function editFromRow(t: TravelRecord) {
    // Don't hijack a click the user made to select and copy text.
    if (window.getSelection()?.toString()) return;
    openForm(t);
  }

  function requestDelete(t: TravelRecord) {
    pendingDelete = t;
  }

  async function deleteTravel(t: TravelRecord) {
    await app.deleteRecord(
      "travelRecords",
      t.id,
      `Deleted travel for ${app.employeeName(t.employeeId)} to ${t.destination} (${t.startDate} to ${t.endDate})`
    );
    if (editing?.id === t.id) {
      formOpen = false;
      editing = undefined;
    }
    pendingDelete = undefined;
    app.toast("Travel record deleted", "success");
  }
</script>

<div class="page travel-page" class:wide={view === "calendar"}>
  <div class="page-header">
    <h1>Travel</h1>
    <span class="muted">{rows.length} shown</span>
  </div>

  <div class="toolbar travel-toolbar">
    <select bind:value={filterEmployee} aria-label="Filter by employee">
      <option value="">All employees</option>
      {#each app.activeEmployees as e (e.id)}<option value={e.id}>{e.displayName}</option>{/each}
    </select>
    <label class="inline-toggle">
      <input type="checkbox" bind:checked={showPast} /> Show past travel
    </label>
    <div class="view-toggle" role="group" aria-label="Travel view">
      <button type="button" class:active={view === "list"} onclick={() => (view = "list")}>List</button>
      <button type="button" class:active={view === "calendar"} onclick={() => (view = "calendar")}>Calendar</button>
    </div>
    <span class="spacer"></span>
    <button type="button" onclick={exportCsv} disabled={rows.length === 0}>Export CSV</button>
    <button type="button" class="primary" onclick={() => openForm()}>Add Travel</button>
  </div>

  {#if view === "list"}
    {#if rows.length === 0}
      <EmptyState message="No travel records." hint="Add a trip to track who's away, DTS status, and voucher due dates." />
    {:else}
      <table class="data">
        <thead>
          <tr>
            <th>Employee</th><th>Destination</th><th class="date-col">Start</th><th class="date-col">End</th><th>IPT</th><th>DTS authorization</th><th>Voucher due</th><th></th>
          </tr>
        </thead>
        <tbody>
          {#each rows as t (t.id)}
            <!-- Row click is a mouse convenience; the name button is the keyboard path. -->
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
            <tr class="row-clickable" onclick={() => editFromRow(t)}>
              <td>
                <button
                  type="button"
                  class="link cell-link"
                  onclick={(ev) => {
                    ev.stopPropagation();
                    openForm(t);
                  }}>{app.employeeName(t.employeeId)}</button
                >
              </td>
              <td>
                {t.destination}
                {#if t.notes}<div class="notes-line">{t.notes}</div>{/if}
              </td>
              <td class="date-col">{formatDate(t.startDate)}</td>
              <td class="date-col">{formatDate(t.endDate)}</td>
              <td><span class="badge {iptBadgeClass(t.iptConcurrence)}">{iptLabel(t.iptConcurrence)}</span></td>
              <td>
                <span class="badge {dtsBadgeClass(t.dtsAuthorizationStatus)}">{dtsLabel(t.dtsAuthorizationStatus)}</span>
                {#if t.dtsAuthorizationId}<div class="auth-id">{t.dtsAuthorizationId}</div>{/if}
              </td>
              <td>
                {#if voucherState(t) === "overdue"}
                  <span class="badge overdue" title="Voucher past due">{formatDate(t.voucherDueDate)}</span>
                {:else if voucherState(t) === "soon"}
                  <span class="badge warning" title="Voucher due soon">{formatDate(t.voucherDueDate)}</span>
                {:else}
                  {formatDate(t.voucherDueDate)}
                {/if}
              </td>
              <td>
                <div class="row-actions">
                  <button
                    type="button"
                    class="icon-btn danger"
                    aria-label="Delete travel"
                    title="Delete"
                    onclick={(ev) => {
                      ev.stopPropagation();
                      requestDelete(t);
                    }}><Icon name="trash" size={16} /></button
                  >
                </div>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  {:else}
    <section class="calendar-view" aria-label="Travel calendar">
      <div class="calendar-header">
        <button type="button" onclick={() => setMonth(-1)} aria-label="Previous month">&lt;</button>
        <h2>{calendarTitle}</h2>
        <button type="button" onclick={() => (calendarMonth = `${app.today.slice(0, 7)}-01`)}>Today</button>
        <button type="button" onclick={() => setMonth(1)} aria-label="Next month">&gt;</button>
      </div>
      <div class="calendar-grid" aria-label="Travel month calendar">
        <div class="weekday-row">
          {#each ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as day (day)}
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
                    aria-label={`Add travel for ${formatDate(day.date)}`}
                    title="Add travel on this day"
                    onclick={() => openFormForDate(day.date)}>+</button>
                </div>
                <div class="day-events">
                  {#each day.events.slice(0, 4) as event (event.id)}
                    <button type="button" class="calendar-event" onclick={() => openForm(event)}>
                      <span>{app.employeeName(event.employeeId)}</span>
                      <small>{event.destination}</small>
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
  <Dialog title={editing ? "Edit Travel" : "Add Travel"} onclose={() => (formOpen = false)}>
    <form
      onsubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <label for="tv-emp">Employee <span class="req">*</span></label>
      <select id="tv-emp" bind:value={fEmployee} style="width:100%">
        <option value="">(select)</option>
        {#each app.activeEmployees as e (e.id)}<option value={e.id}>{e.displayName}</option>{/each}
      </select>
      <label for="tv-dest">Destination <span class="req">*</span></label>
      <input id="tv-dest" type="text" bind:value={fDestination} maxlength="200" placeholder="City, ST" style="width:100%" />
      {#if fError}<div class="field-error">{fError}</div>{/if}
      <div class="form-grid">
        <div>
          <label for="tv-start">Start <span class="req">*</span></label>
          <input id="tv-start" type="date" bind:value={fStart} style="width:100%" />
        </div>
        <div>
          <label for="tv-end">End (return) <span class="req">*</span></label>
          <input id="tv-end" type="date" bind:value={fEnd} style="width:100%" />
        </div>
        <div>
          <label for="tv-ipt">IPT concurrence</label>
          <select id="tv-ipt" bind:value={fIpt} style="width:100%">
            {#each TRAVEL_IPT_CONCURRENCE_OPTIONS as o (o.value)}<option value={o.value}>{o.label}</option>{/each}
          </select>
        </div>
        <div>
          <label for="tv-dts">DTS authorization</label>
          <select id="tv-dts" bind:value={fDtsStatus} style="width:100%">
            {#each TRAVEL_DTS_AUTH_STATUS_OPTIONS as o (o.value)}<option value={o.value}>{o.label}</option>{/each}
          </select>
        </div>
        <div>
          <label for="tv-dtsid">DTS authorization ID</label>
          <input id="tv-dtsid" type="text" bind:value={fDtsId} maxlength="60" style="width:100%" />
        </div>
        <div>
          <label for="tv-voucher">Voucher due</label>
          <input
            id="tv-voucher"
            type="date"
            bind:value={fVoucher}
            oninput={() => (voucherManual = true)}
            style="width:100%"
          />
          <div class="field-hint">Defaults to 5 days after return.</div>
        </div>
      </div>
      <label for="tv-notes">Notes</label>
      <textarea id="tv-notes" bind:value={fNotes} maxlength="2000" rows="3" style="width:100%"></textarea>
      <div class="dialog-actions">
        {#if editing}
          <button type="button" class="icon-btn danger" aria-label="Delete travel" title="Delete" onclick={() => requestDelete(editing!)}><Icon name="trash" size={17} /></button>
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
    title="Delete travel record"
    message={`Permanently delete ${app.employeeName(pendingDelete.employeeId)} travel to ${pendingDelete.destination} (${formatDate(pendingDelete.startDate)} to ${formatDate(pendingDelete.endDate)})?`}
    confirmLabel="Delete travel"
    danger
    onconfirm={() => void deleteTravel(pendingDelete!)}
    oncancel={() => (pendingDelete = undefined)}
  />
{/if}

<style>
  /* List view uses the default page width (matching Training/Awards); only the
     calendar spans full width. */
  .travel-page.wide {
    max-width: none;
  }
  .travel-toolbar {
    align-items: center;
  }
  .travel-toolbar select {
    min-width: 10rem;
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
  /* Keep the full date on one line so Start/End don't wrap. */
  .date-col {
    white-space: nowrap;
  }
  .notes-line {
    color: var(--text-muted);
    font-size: .8rem;
    max-width: 22rem;
    white-space: pre-wrap;
  }
  .auth-id {
    color: var(--text-muted);
    font-size: .78rem;
    margin-top: .1rem;
  }
  .field-hint {
    color: var(--text-muted);
    font-size: .75rem;
    margin-top: .2rem;
  }
  .form-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0 .8rem;
  }
  .dialog-actions {
    display: flex;
    align-items: center;
    gap: .5rem;
    justify-content: flex-end;
    margin-top: 1rem;
  }
  .row-actions {
    display: flex;
    justify-content: flex-end;
    gap: .5rem;
    flex-wrap: wrap;
  }
  .row-clickable {
    cursor: pointer;
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
    display: inline-grid;
    place-items: center;
    min-width: 1.55rem;
    height: 1.55rem;
    padding: 0 .3rem;
    border-radius: 999px;
    background: var(--accent);
    color: #fff;
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
    border: 1px solid color-mix(in srgb, var(--accent) 18%, var(--border));
    border-radius: 6px;
    background: var(--accent-soft);
    color: var(--text);
    text-align: left;
    overflow: hidden;
  }
  .calendar-event:hover {
    border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
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
  .more-events {
    color: var(--text-muted);
    font-size: .72rem;
  }
  @media (max-width: 900px) {
    .form-grid {
      grid-template-columns: 1fr;
    }
    .travel-toolbar {
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
