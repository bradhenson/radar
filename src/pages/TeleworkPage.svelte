<script lang="ts">
  // Situational telework request tracking (plan 12.9, 20).
  import { app } from "../stores/app.svelte";
  import ConfirmDialog from "../components/common/ConfirmDialog.svelte";
  import Dialog from "../components/common/Dialog.svelte";
  import EmptyState from "../components/common/EmptyState.svelte";
  import type { TeleworkRecord, TeleworkStatus } from "../domain/models";
  import { addDays, addMonths, daysBetween, formatDate, isValidIsoDate, nowTimestamp, todayIso } from "../utils/dates";
  import { newId } from "../utils/ids";
  import { toCsv } from "../utils/csv";
  import { backupFilename, downloadText } from "../utils/download";

  const SITUATIONAL_TYPE = "Situational request";
  const CALENDAR_WEEK_COUNT = 5;
  const CALENDAR_DAY_COUNT = CALENDAR_WEEK_COUNT * 7;
  const HISTORICAL_STATUSES = new Set<TeleworkStatus>(["denied", "cancelled", "expired"]);
  const STATUS_OPTIONS: { value: TeleworkStatus; label: string }[] = [
    { value: "pending", label: "Pending" },
    { value: "approved", label: "Approved" },
    { value: "denied", label: "Denied" },
    { value: "cancelled", label: "Cancelled" }
  ];

  let view = $state<"list" | "calendar">("list");
  let showHistorical = $state(false);
  let filterEmployee = $state("");
  let filterStatus = $state("");
  let calendarMonth = $state(`${app.today.slice(0, 7)}-01`);
  let formOpen = $state(false);
  let editing = $state<TeleworkRecord | undefined>(undefined);
  let fEmployee = $state("");
  let fStatus = $state<TeleworkStatus>("pending");
  let fRequestDate = $state(todayIso());
  let fStartDate = $state("");
  let fEndDate = $state("");
  let fNotes = $state("");
  let fError = $state("");
  let activeCalendarDate = $state<string | undefined>(undefined);
  let pendingDelete = $state<TeleworkRecord | undefined>(undefined);

  function statusLabel(status: TeleworkStatus): string {
    return STATUS_OPTIONS.find((s) => s.value === status)?.label ?? status.replace(/_/g, " ");
  }

  function isSituationalRequest(t: TeleworkRecord): boolean {
    return t.recordType === SITUATIONAL_TYPE;
  }

  function requestEndDate(t: Pick<TeleworkRecord, "effectiveDate" | "expirationDate">): string | undefined {
    return t.expirationDate || t.effectiveDate;
  }

  function isHistorical(t: TeleworkRecord): boolean {
    const end = requestEndDate(t);
    if (HISTORICAL_STATUSES.has(t.status)) return true;
    return Boolean(end && end < app.today && (t.status === "approved" || t.status === "active"));
  }

  function openForm(
    t?: TeleworkRecord,
    defaults: Partial<Pick<TeleworkRecord, "employeeId" | "effectiveDate" | "expirationDate">> = {}
  ) {
    editing = t;
    fEmployee = t?.employeeId ?? defaults.employeeId ?? "";
    fStatus = t?.status ?? "pending";
    fRequestDate = t?.requestDate ?? todayIso();
    fStartDate = t?.effectiveDate ?? defaults.effectiveDate ?? "";
    fEndDate = t?.expirationDate ?? defaults.expirationDate ?? "";
    fNotes = t?.notes ?? "";
    fError = "";
    formOpen = true;
  }

  function openFormForDate(date: string) {
    openForm(undefined, {
      employeeId: filterEmployee || undefined,
      effectiveDate: date,
      expirationDate: date
    });
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
    if (!fStartDate) {
      fError = "Telework start date is required.";
      return;
    }
    for (const v of [fRequestDate, fStartDate, fEndDate]) {
      if (v && !isValidIsoDate(v)) {
        fError = "Dates must be valid.";
        return;
      }
    }
    const endDate = fEndDate || fStartDate;
    if (endDate < fStartDate) {
      fError = "Telework end date must be on or after the start date.";
      return;
    }
    const now = nowTimestamp();
    const record: TeleworkRecord = {
      id: editing?.id ?? newId(),
      employeeId: fEmployee,
      recordType: SITUATIONAL_TYPE,
      status: fStatus,
      requestDate: fRequestDate || undefined,
      effectiveDate: fStartDate,
      expirationDate: endDate,
      scheduleSummary: editing?.scheduleSummary,
      sourceSystem: editing?.sourceSystem,
      sourceReference: editing?.sourceReference,
      lastVerifiedDate: editing?.lastVerifiedDate,
      notes: fNotes.trim() || undefined,
      relatedTaskId: editing?.relatedTaskId,
      createdAt: editing?.createdAt ?? now,
      updatedAt: now
    };
    await app.putRecord("teleworkRecords", record, {
      actionType: editing ? "updated" : "created",
      summary: `${editing ? "Updated" : "Added"} situational telework request for ${app.employeeName(fEmployee)}`
    });
    formOpen = false;
  }

  let rows = $derived(
    app.teleworkRecords
      .filter(isSituationalRequest)
      .filter((t) => showHistorical || !isHistorical(t))
      .filter((t) => !filterEmployee || t.employeeId === filterEmployee)
      .filter((t) => !filterStatus || t.status === filterStatus)
      .sort((a, b) => {
        const aDate = a.effectiveDate ?? a.requestDate ?? "9999-12-31";
        const bDate = b.effectiveDate ?? b.requestDate ?? "9999-12-31";
        return aDate.localeCompare(bDate) || app.employeeName(a.employeeId).localeCompare(app.employeeName(b.employeeId));
      })
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
        events: rows.filter((t) => requestCoversDate(t, date))
      };
    });
  });
  let calendarWeeks = $derived.by(() =>
    Array.from({ length: CALENDAR_WEEK_COUNT }, (_, i) => calendarDays.slice(i * 7, i * 7 + 7))
  );

  function requestCoversDate(t: TeleworkRecord, date: string): boolean {
    if (!t.effectiveDate) return false;
    const end = requestEndDate(t) ?? t.effectiveDate;
    return t.effectiveDate <= date && date <= end;
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

  function exportCsv() {
    const csv = toCsv(
      [
        "Employee",
        "Status",
        "Request received",
        "Telework start",
        "Telework end",
        "Notes",
        "Created",
        "Updated"
      ],
      rows.map((t) => [
        app.employeeName(t.employeeId),
        statusLabel(t.status),
        t.requestDate,
        t.effectiveDate,
        requestEndDate(t),
        t.notes,
        t.createdAt.slice(0, 10),
        t.updatedAt.slice(0, 10)
      ])
    );
    downloadText(backupFilename("RADAR_SituationalTelework", "csv"), csv, "text/csv");
  }

  function requestDelete(t: TeleworkRecord) {
    pendingDelete = t;
  }

  async function deleteTelework(t: TeleworkRecord) {
    await app.deleteRecord(
      "teleworkRecords",
      t.id,
      `Deleted situational telework request for ${app.employeeName(t.employeeId)} (${t.effectiveDate ?? "no start"} to ${requestEndDate(t) ?? "no end"})`
    );
    if (editing?.id === t.id) {
      formOpen = false;
      editing = undefined;
    }
    pendingDelete = undefined;
    app.toast("Telework request deleted", "success");
  }
</script>

<div class="page telework-page">
  <div class="page-header">
    <h1>Situational Telework</h1>
    <span class="muted">{rows.length} shown</span>
  </div>

  <div class="toolbar telework-toolbar">
    <select bind:value={filterEmployee} aria-label="Filter by employee">
      <option value="">All employees</option>
      {#each app.activeEmployees as e (e.id)}<option value={e.id}>{e.displayName}</option>{/each}
    </select>
    <select bind:value={filterStatus} aria-label="Filter by status">
      <option value="">All statuses</option>
      {#each STATUS_OPTIONS as s (s.value)}<option value={s.value}>{s.label}</option>{/each}
    </select>
    <label class="inline-toggle">
      <input type="checkbox" bind:checked={showHistorical} /> Show historical
    </label>
    <div class="view-toggle" role="group" aria-label="Telework view">
      <button type="button" class:active={view === "list"} onclick={() => (view = "list")}>List</button>
      <button type="button" class:active={view === "calendar"} onclick={() => (view = "calendar")}>Calendar</button>
    </div>
    <span class="spacer"></span>
    <button type="button" onclick={exportCsv} disabled={rows.length === 0}>Export CSV</button>
    <button type="button" class="primary" onclick={() => openForm()}>Add Request</button>
  </div>

  {#if view === "list"}
    {#if rows.length === 0}
      <EmptyState message="No situational telework requests." hint="Add requests as they arrive by email." />
    {:else}
      <table class="data">
        <thead>
          <tr>
            <th>Employee</th><th>Status</th><th>Request received</th><th>Telework start</th><th>Telework end</th><th>Notes</th><th></th>
          </tr>
        </thead>
        <tbody>
          {#each rows as t (t.id)}
            <tr>
              <td>{app.employeeName(t.employeeId)}</td>
              <td><span class="badge status-{t.status}">{statusLabel(t.status)}</span></td>
              <td>{formatDate(t.requestDate)}</td>
              <td>{formatDate(t.effectiveDate)}</td>
              <td>{formatDate(requestEndDate(t))}</td>
              <td class="notes-cell">{t.notes ?? ""}</td>
              <td>
                <div class="row-actions">
                  <button type="button" onclick={() => openForm(t)}>Edit</button>
                  <button type="button" class="danger" onclick={() => requestDelete(t)}>Delete</button>
                </div>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  {:else}
    <section class="calendar-view" aria-label="Situational telework calendar">
      <div class="calendar-header">
        <button type="button" onclick={() => setMonth(-1)} aria-label="Previous month">&lt;</button>
        <h2>{calendarTitle}</h2>
        <button type="button" onclick={() => (calendarMonth = `${app.today.slice(0, 7)}-01`)}>Today</button>
        <button type="button" onclick={() => setMonth(1)} aria-label="Next month">&gt;</button>
      </div>
      <div class="calendar-grid" aria-label="Situational telework month calendar">
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
                    aria-label={`Add situational telework for ${formatDate(day.date)}`}
                    title="Add situational telework on this day"
                    onclick={() => openFormForDate(day.date)}>+</button>
                </div>
                <div class="day-events">
                  {#each day.events.slice(0, 4) as event (event.id)}
                    <button type="button" class="calendar-event status-{event.status}" onclick={() => openForm(event)}>
                      <span>{app.employeeName(event.employeeId)}</span>
                      <small>{statusLabel(event.status)}</small>
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
  <Dialog title={editing ? "Edit Situational Telework" : "Add Situational Telework"} onclose={() => (formOpen = false)}>
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
      <div class="form-grid">
        <div>
          <label for="tw-status">Status</label>
          <select id="tw-status" bind:value={fStatus} style="width:100%">
            {#each STATUS_OPTIONS as s (s.value)}<option value={s.value}>{s.label}</option>{/each}
          </select>
        </div>
        <div>
          <label for="tw-request">Request received</label>
          <input id="tw-request" type="date" bind:value={fRequestDate} style="width:100%" />
        </div>
        <div>
          <label for="tw-start">Telework start <span class="req">*</span></label>
          <input id="tw-start" type="date" bind:value={fStartDate} style="width:100%" />
        </div>
        <div>
          <label for="tw-end">Telework end</label>
          <input id="tw-end" type="date" bind:value={fEndDate} style="width:100%" />
        </div>
      </div>
      <label for="tw-notes">Notes</label>
      <textarea id="tw-notes" bind:value={fNotes} maxlength="2000" rows="3" style="width:100%"></textarea>
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
    title="Delete telework request"
    message={`Permanently delete ${app.employeeName(pendingDelete.employeeId)} telework from ${formatDate(pendingDelete.effectiveDate)} to ${formatDate(requestEndDate(pendingDelete))}?`}
    confirmLabel="Delete request"
    danger
    onconfirm={() => void deleteTelework(pendingDelete!)}
    oncancel={() => (pendingDelete = undefined)}
  />
{/if}

<style>
  .telework-page {
    max-width: none;
  }
  .telework-toolbar {
    align-items: center;
  }
  .telework-toolbar select {
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
  .calendar-event.status-denied,
  .calendar-event.status-cancelled,
  .calendar-event.status-expired {
    background: var(--surface-2);
    color: var(--text-muted);
  }
  .more-events {
    color: var(--text-muted);
    font-size: .72rem;
  }
  .notes-cell {
    max-width: 22rem;
    white-space: pre-wrap;
    color: var(--text-muted);
  }
  .status-pending {
    background: var(--duesoon-bg);
    color: var(--duesoon-fg);
  }
  .status-denied,
  .status-cancelled {
    background: var(--surface-2);
    color: var(--text-muted);
  }
  @media (max-width: 900px) {
    .form-grid {
      grid-template-columns: 1fr;
    }
    .telework-toolbar {
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
