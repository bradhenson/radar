<script lang="ts">
  // Travel awareness: who is on travel, where, when, and the DTS paperwork
  // state around each trip (IPT concurrence, authorization, voucher due).
  import { app } from "../stores/app.svelte";
  import { router } from "../app/router.svelte";
  import ConfirmDialog from "../components/common/ConfirmDialog.svelte";
  import Dialog from "../components/common/Dialog.svelte";
  import EmptyState from "../components/common/EmptyState.svelte";
  import Icon from "../components/common/Icon.svelte";
  import {
    TRAVEL_DTS_AUTH_STATUS_OPTIONS,
    TRAVEL_IPT_CONCURRENCE_OPTIONS,
    TRAVEL_VOUCHER_STATUS_OPTIONS,
    type TravelDtsAuthStatus,
    type TravelIptConcurrence,
    type TravelRecord,
    type TravelVoucherStatus
  } from "../domain/models";
  import {
    isPastTravel,
    isTripCancelled,
    isVoucherSettled,
    matchesTravelSummaryFilter,
    TRAVEL_PHASE_LABELS,
    travelPhase,
    travelPhaseRank,
    travelVoucherDueDate,
    voucherStatusOf,
    voucherUrgency,
    type TravelPhase,
    type TravelSummaryFilter
  } from "../domain/rules/travel";
  import { mergeTravelEdit } from "../domain/rules/editMerge";
  import { monthGrid, monthOf } from "../domain/rules/calendar";
  import { addDays, addMonths, compareDates, formatDate, isValidIsoDate, nowTimestamp } from "../utils/dates";
  import { newId } from "../utils/ids";
  import { toCsv } from "../utils/csv";
  import { backupFilename, downloadText } from "../utils/download";

  let view = $state<"list" | "calendar">("list");
  let showPast = $state(false);
  let filterEmployee = $state("");
  let summaryFilter = $state<TravelSummaryFilter>("");
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
  let fVoucherStatus = $state<TravelVoucherStatus>("not_submitted");
  let fVoucherSubmitted = $state("");
  let fNotes = $state("");
  let fError = $state("");
  // When true the user has typed their own voucher date, so we stop
  // auto-filling it from the return date.
  let voucherManual = $state(false);
  let activeCalendarDate = $state<string | undefined>(undefined);
  let pendingDelete = $state<TravelRecord | undefined>(undefined);
  let pendingCancel = $state<TravelRecord | undefined>(undefined);
  let expanded = $state<Record<string, boolean>>({});

  // Deep link: #/travel/{recordId} expands the trip in the list (Today page
  // attention items and search results land on the actual record). One-shot.
  $effect(() => {
    const id = router.current.param;
    if (router.current.page !== "travel" || !id) return;
    const record = app.travelRecords.find((t) => t.id === id);
    if (!record) return;
    view = "list";
    if (isPast(record)) showPast = true;
    if (filterEmployee && filterEmployee !== record.employeeId) filterEmployee = "";
    if (!matchesTravelSummaryFilter(record, summaryFilter, app.today)) summaryFilter = "";
    expanded[id] = true;
    router.go("travel");
    requestAnimationFrame(() => {
      document.getElementById(`travel-row-${id}`)?.scrollIntoView({ block: "center" });
    });
  });

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

  function voucherLabel(v: TravelVoucherStatus): string {
    return TRAVEL_VOUCHER_STATUS_OPTIONS.find((o) => o.value === v)?.label ?? v.replace(/_/g, " ");
  }

  // Lifecycle helpers (domain/rules/travel.ts). A trip is only "past" once it
  // has returned AND its voucher is settled, or it was cancelled — so someone
  // who still owes a voucher can't drop off the list.
  function phaseOf(t: TravelRecord): TravelPhase {
    return travelPhase(t, app.today);
  }
  function isPast(t: TravelRecord): boolean {
    return isPastTravel(t, app.today);
  }
  function voucherState(t: TravelRecord): "overdue" | "due_soon" | "" {
    return voucherUrgency(t, app.today);
  }

  // Built as strings rather than inline markup: Svelte trims whitespace at
  // block boundaries, which would glue the separator to the status word.
  function tripStatusDetail(t: TravelRecord): string {
    const label = TRAVEL_PHASE_LABELS[phaseOf(t)];
    return isTripCancelled(t) && t.cancelledDate ? `${label} on ${formatDate(t.cancelledDate)}` : label;
  }
  function voucherDetail(t: TravelRecord): string {
    const status = voucherStatusOf(t);
    const label = voucherLabel(status);
    if (status === "submitted" && t.voucherSubmittedDate) return `${label} on ${formatDate(t.voucherSubmittedDate)}`;
    if (status === "not_submitted" && t.voucherDueDate) return `${label} — due ${formatDate(t.voucherDueDate)}`;
    return label;
  }

  // Snapshot of the values the form opened with, for the unsaved-changes
  // guard. The auto-filled voucher date only counts once the user touches it.
  let openedSnapshot = $state("");
  function formSnapshot(): string {
    return JSON.stringify([
      fEmployee, fDestination, fStart, fEnd, fIpt, fDtsStatus, fDtsId,
      voucherManual ? fVoucher : "", fVoucherStatus, fVoucherSubmitted, fNotes
    ]);
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
    fVoucherStatus = t ? voucherStatusOf(t) : "not_submitted";
    fVoucherSubmitted = t?.voucherSubmittedDate ?? "";
    fNotes = t?.notes ?? "";
    voucherManual = Boolean(t?.voucherDueDate);
    fError = "";
    openedSnapshot = formSnapshot();
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
    if (fVoucherStatus === "submitted" && fVoucherSubmitted && !isValidIsoDate(fVoucherSubmitted)) {
      fError = "Voucher submitted date must be valid.";
      return;
    }
    // Merge over the existing record so unexposed fields (archive flag) survive.
    const record: TravelRecord = mergeTravelEdit(
      editing,
      {
        employeeId: fEmployee,
        destination: fDestination,
        startDate: fStart,
        endDate: fEnd,
        iptConcurrence: fIpt,
        dtsAuthorizationStatus: fDtsStatus,
        dtsAuthorizationId: fDtsId,
        voucherDueDate: fVoucher || travelVoucherDueDate(fEnd),
        voucherStatus: fVoucherStatus,
        voucherSubmittedDate: fVoucherSubmitted,
        notes: fNotes
      },
      { id: newId(), now: nowTimestamp() }
    );
    await app.putRecord("travelRecords", record, {
      actionType: editing ? "updated" : "created",
      summary: `${editing ? "Updated" : "Added"} travel for ${app.employeeName(fEmployee)} to ${record.destination} (${fStart} to ${fEnd})`
    });
    formOpen = false;
  }

  // The employee filter sets the working set; the quick-filter pills narrow it
  // without changing their own counts underneath the user (as on the board).
  let scopedTrips = $derived(app.travelRecords.filter((t) => !filterEmployee || t.employeeId === filterEmployee));

  /** Trips the list would show with no quick filter selected. */
  let inScopeCount = $derived(scopedTrips.filter((t) => showPast || !isPast(t)).length);

  let phaseCounts = $derived({
    voucherDue: scopedTrips.filter((t) => phaseOf(t) === "voucher_due").length,
    onTravel: scopedTrips.filter((t) => phaseOf(t) === "on_travel").length,
    upcoming: scopedTrips.filter((t) => phaseOf(t) === "upcoming").length
  });

  /** Date each group is ordered by: the one the supervisor is watching. */
  function groupSortDate(t: TravelRecord, phase: TravelPhase): string {
    if (phase === "voucher_due") return t.voucherDueDate ?? t.endDate;
    if (phase === "on_travel") return t.endDate;
    return t.startDate;
  }

  let rows = $derived(
    scopedTrips
      .filter((t) => showPast || !isPast(t))
      .filter((t) => matchesTravelSummaryFilter(t, summaryFilter, app.today))
      .sort((a, b) => {
        const pa = phaseOf(a);
        const pb = phaseOf(b);
        const byPhase = travelPhaseRank(pa) - travelPhaseRank(pb);
        if (byPhase !== 0) return byPhase;
        // History reads newest first; everything still live reads soonest first.
        const direction = pa === "complete" || pa === "cancelled" ? -1 : 1;
        return (
          direction * compareDates(groupSortDate(a, pa), groupSortDate(b, pb)) ||
          app.employeeName(a.employeeId).localeCompare(app.employeeName(b.employeeId))
        );
      })
  );

  // Rows are already phase-ordered, so a run of equal phases is one group.
  let groups = $derived.by(() => {
    const out: { phase: TravelPhase; trips: TravelRecord[] }[] = [];
    for (const trip of rows) {
      const phase = phaseOf(trip);
      const last = out[out.length - 1];
      if (last && last.phase === phase) last.trips.push(trip);
      else out.push({ phase, trips: [trip] });
    }
    return out;
  });

  function toggleSummaryFilter(filter: Exclude<TravelSummaryFilter, "">) {
    summaryFilter = summaryFilter === filter ? "" : filter;
  }

  let calendarTitle = $derived(monthLabel(calendarMonth));
  // Shared month grid (domain/rules/calendar.ts) sizes itself to the month, so
  // six-row months like August 2026 keep all of their days.
  let calendarWeeks = $derived.by(() => {
    const { year, month } = monthOf(calendarMonth);
    return monthGrid(year, month).map((week) =>
      week.map((cell) => ({
        date: cell.date,
        day: Number(cell.date.slice(8, 10)),
        inMonth: cell.inMonth,
        isToday: cell.date === app.today,
        // Cancelled trips are visible in the list (with "show past") but never
        // occupy a calendar day — nobody is away.
        events: rows.filter((t) => !isTripCancelled(t) && t.startDate <= cell.date && cell.date <= t.endDate)
      }))
    );
  });

  function monthLabel(date: string): string {
    const [y, m] = date.split("-").map(Number) as [number, number];
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return `${months[m - 1]} ${y}`;
  }
  function setMonth(offset: number) {
    calendarMonth = addMonths(calendarMonth, offset);
  }

  async function exportCsv() {
    const csv = toCsv(
      [
        "Employee", "Destination", "Start", "End", "Trip status", "IPT concurrence",
        "DTS authorization", "DTS auth ID", "Voucher due", "Voucher status", "Voucher submitted", "Notes"
      ],
      rows.map((t) => [
        app.employeeName(t.employeeId),
        t.destination,
        t.startDate,
        t.endDate,
        TRAVEL_PHASE_LABELS[phaseOf(t)],
        iptLabel(t.iptConcurrence),
        dtsLabel(t.dtsAuthorizationStatus),
        t.dtsAuthorizationId,
        t.voucherDueDate,
        voucherLabel(voucherStatusOf(t)),
        t.voucherSubmittedDate,
        t.notes
      ])
    );
    try {
      await downloadText(backupFilename("RADAR_Travel", "csv"), csv, "text/csv");
    } catch {
      app.toast("Travel export failed", "error");
    }
  }

  function toggleRow(id: string) {
    expanded[id] = !expanded[id];
  }

  function toggleFromRow(id: string) {
    // Don't hijack a click the user made to select and copy text.
    if (window.getSelection()?.toString()) return;
    toggleRow(id);
  }

  function requestDelete(t: TravelRecord) {
    pendingDelete = t;
  }

  // --- voucher completion and trip cancellation --------------------------------
  // Both are ordinary field edits (never deletions), so each writes an activity
  // entry and offers an Undo toast that restores the record as it was.

  async function writeTrip(next: TravelRecord, summary: string, undoSummary: string) {
    const before = app.travelRecords.find((t) => t.id === next.id);
    await app.putRecord("travelRecords", next, { actionType: "updated", summary });
    return () => {
      if (!before) return;
      void app.putRecord(
        "travelRecords",
        { ...before, updatedAt: nowTimestamp() },
        { actionType: "updated", summary: undoSummary }
      );
    };
  }

  async function setVoucherStatus(t: TravelRecord, status: TravelVoucherStatus) {
    const who = `${app.employeeName(t.employeeId)} (${t.destination})`;
    const next: TravelRecord = {
      ...t,
      voucherStatus: status,
      voucherSubmittedDate: status === "submitted" ? app.today : undefined,
      updatedAt: nowTimestamp()
    };
    const undo = await writeTrip(
      next,
      status === "not_submitted"
        ? `Travel voucher reopened for ${who}`
        : `Travel voucher marked ${voucherLabel(status).toLowerCase()} for ${who}`,
      `Reverted travel voucher status for ${who}`
    );
    const message =
      status === "submitted"
        ? "Voucher marked submitted"
        : status === "not_required"
          ? "Voucher marked not required"
          : "Voucher reopened";
    app.toast(message, "success", undo);
  }

  async function cancelTrip(t: TravelRecord) {
    const who = `${app.employeeName(t.employeeId)} (${t.destination})`;
    const next: TravelRecord = {
      ...t,
      tripStatus: "cancelled",
      cancelledDate: app.today,
      // A trip that never happened cannot owe a voucher.
      voucherStatus: "not_required",
      voucherSubmittedDate: undefined,
      updatedAt: nowTimestamp()
    };
    const undo = await writeTrip(next, `Cancelled travel for ${who}`, `Reinstated travel for ${who}`);
    pendingCancel = undefined;
    app.toast("Trip cancelled", "success", undo);
  }

  async function reinstateTrip(t: TravelRecord) {
    const who = `${app.employeeName(t.employeeId)} (${t.destination})`;
    const next: TravelRecord = {
      ...t,
      tripStatus: "scheduled",
      cancelledDate: undefined,
      // Reinstating restores the voucher obligation the cancellation cleared.
      voucherStatus: t.voucherSubmittedDate ? "submitted" : "not_submitted",
      updatedAt: nowTimestamp()
    };
    const undo = await writeTrip(next, `Reinstated travel for ${who}`, `Cancelled travel for ${who}`);
    app.toast("Trip reinstated", "success", undo);
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

  <div class="travel-stats" aria-label="Quick travel filters">
    <button
      type="button"
      class:active={!summaryFilter}
      aria-pressed={!summaryFilter}
      onclick={() => (summaryFilter = "")}><strong>{inScopeCount}</strong> trips</button
    >
    <button
      type="button"
      class:alert={phaseCounts.voucherDue > 0}
      class:active={summaryFilter === "voucher_due"}
      aria-pressed={summaryFilter === "voucher_due"}
      onclick={() => toggleSummaryFilter("voucher_due")}><strong>{phaseCounts.voucherDue}</strong> voucher due</button
    >
    <button
      type="button"
      class:on-travel={phaseCounts.onTravel > 0}
      class:active={summaryFilter === "on_travel"}
      aria-pressed={summaryFilter === "on_travel"}
      onclick={() => toggleSummaryFilter("on_travel")}><strong>{phaseCounts.onTravel}</strong> on travel now</button
    >
    <button
      type="button"
      class:active={summaryFilter === "upcoming"}
      aria-pressed={summaryFilter === "upcoming"}
      onclick={() => toggleSummaryFilter("upcoming")}><strong>{phaseCounts.upcoming}</strong> upcoming</button
    >
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
      <table class="data travel-table">
        <thead>
          <tr>
            <th>Employee</th><th>Destination</th><th class="date-col">Start</th><th class="date-col">End</th><th>IPT</th><th>DTS authorization</th><th>Voucher</th>
          </tr>
        </thead>
        <tbody>
          <!-- Rows are grouped by lifecycle phase so the answer to "who owes a
               voucher / who is away / who leaves soon" is readable at a glance. -->
          {#each groups as group (group.phase)}
            <tr class="group-row">
              <td colspan="7">{TRAVEL_PHASE_LABELS[group.phase]} <span>({group.trips.length})</span></td>
            </tr>
            {#each group.trips as t (t.id)}
              {@const open = Boolean(expanded[t.id])}
              {@const cancelled = isTripCancelled(t)}
              {@const voucher = voucherStatusOf(t)}
              <!-- Row click toggles the inline detail; the chevron is the keyboard control. -->
              <!-- svelte-ignore a11y_click_events_have_key_events -->
              <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
              <tr
                class="row-clickable"
                class:row-open={open}
                class:row-cancelled={cancelled}
                id={"travel-row-" + t.id}
                onclick={() => toggleFromRow(t.id)}
              >
                <td>
                  <button
                    type="button"
                    class="disclosure"
                    class:open
                    aria-expanded={open}
                    aria-label={open ? `Hide travel details for ${app.employeeName(t.employeeId)}` : `Show travel details for ${app.employeeName(t.employeeId)}`}
                    onclick={(ev) => {
                      ev.stopPropagation();
                      toggleRow(t.id);
                    }}><Icon name="chevron" size={13} /></button>
                  {app.employeeName(t.employeeId)}
                </td>
                <td>
                  {t.destination}
                  {#if cancelled}<span class="badge cancelled-badge">Cancelled</span>{/if}
                </td>
                <td class="date-col">{formatDate(t.startDate)}</td>
                <td class="date-col">{formatDate(t.endDate)}</td>
                <td><span class="badge {iptBadgeClass(t.iptConcurrence)}">{iptLabel(t.iptConcurrence)}</span></td>
                <td><span class="badge {dtsBadgeClass(t.dtsAuthorizationStatus)}">{dtsLabel(t.dtsAuthorizationStatus)}</span></td>
                <td class="voucher-cell">
                  {#if cancelled}
                    <span class="muted">Not required</span>
                  {:else if voucher === "submitted"}
                    <span class="badge success" title={t.voucherSubmittedDate ? `Submitted ${formatDate(t.voucherSubmittedDate)}` : "Voucher submitted"}>Submitted</span>
                  {:else if voucher === "not_required"}
                    <span class="badge">Not required</span>
                  {:else if voucherState(t) === "overdue"}
                    <span class="badge overdue" title="Voucher past due">Due {formatDate(t.voucherDueDate)}</span>
                  {:else if voucherState(t) === "due_soon"}
                    <span class="badge warning" title="Voucher due soon">Due {formatDate(t.voucherDueDate)}</span>
                  {:else}
                    <span class="muted">Due {formatDate(t.voucherDueDate)}</span>
                  {/if}
                </td>
              </tr>
              {#if open}
                <tr class="detail-row">
                  <td colspan="7">
                    <div class="detail" aria-label={`Travel details for ${app.employeeName(t.employeeId)}`}>
                      <dl class="detail-grid">
                        <div><dt>Trip status</dt><dd>{tripStatusDetail(t)}</dd></div>
                        <div><dt>Voucher</dt><dd>{voucherDetail(t)}</dd></div>
                        {#if t.dtsAuthorizationId}
                          <div><dt>DTS authorization ID</dt><dd>{t.dtsAuthorizationId}</dd></div>
                        {/if}
                        <div><dt>Notes</dt><dd class="prewrap">{t.notes || "None"}</dd></div>
                      </dl>
                      <div class="detail-footer">
                        <button type="button" onclick={() => openForm(t)}>Edit</button>
                        {#if cancelled}
                          <button type="button" onclick={() => void reinstateTrip(t)}>Reinstate trip</button>
                        {:else}
                          {#if isVoucherSettled(t)}
                            <button type="button" onclick={() => void setVoucherStatus(t, "not_submitted")}>Reopen voucher</button>
                          {:else}
                            <button type="button" onclick={() => void setVoucherStatus(t, "submitted")}>Mark voucher submitted</button>
                          {/if}
                          <button type="button" onclick={() => (pendingCancel = t)}>Cancel trip</button>
                        {/if}
                        <button
                          type="button"
                          class="icon-btn danger"
                          aria-label="Delete travel"
                          title="Delete"
                          onclick={() => requestDelete(t)}><Icon name="trash" size={16} /></button>
                        <span class="spacer"></span>
                        <button type="button" onclick={() => router.go("employees", t.employeeId)}>Open employee</button>
                      </div>
                    </div>
                  </td>
                </tr>
              {/if}
            {/each}
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
  <Dialog
    title={editing ? "Edit Travel" : "Add Travel"}
    onclose={() => (formOpen = false)}
    unsavedGuard={() => formSnapshot() !== openedSnapshot}
  >
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
      {#if fError}<div class="field-error" role="alert">{fError}</div>{/if}
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
        <div>
          <label for="tv-voucher-status">Voucher status</label>
          <select
            id="tv-voucher-status"
            bind:value={fVoucherStatus}
            onchange={() => {
              // Marking it submitted here means "submitted today" unless the
              // user picks another date.
              if (fVoucherStatus === "submitted" && !fVoucherSubmitted) fVoucherSubmitted = app.today;
            }}
            style="width:100%"
          >
            {#each TRAVEL_VOUCHER_STATUS_OPTIONS as o (o.value)}<option value={o.value}>{o.label}</option>{/each}
          </select>
        </div>
        {#if fVoucherStatus === "submitted"}
          <div>
            <label for="tv-voucher-submitted">Voucher submitted</label>
            <input id="tv-voucher-submitted" type="date" bind:value={fVoucherSubmitted} style="width:100%" />
          </div>
        {/if}
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

{#if pendingCancel}
  <ConfirmDialog
    title="Cancel trip"
    message={`Mark travel for ${app.employeeName(pendingCancel.employeeId)} to ${pendingCancel.destination} (${formatDate(pendingCancel.startDate)} to ${formatDate(pendingCancel.endDate)}) as cancelled? The record is kept, and no voucher will be expected.`}
    confirmLabel="Cancel trip"
    onconfirm={() => void cancelTrip(pendingCancel!)}
    oncancel={() => (pendingCancel = undefined)}
  />
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
  /* Quick filters: same pill grammar as the board summary. */
  .travel-stats {
    display: flex;
    gap: .45rem;
    flex-wrap: wrap;
    margin-bottom: .75rem;
  }
  .travel-stats button {
    display: inline-flex;
    align-items: baseline;
    gap: .3rem;
    padding: .3rem .6rem;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--surface);
    font-size: .8rem;
    font-weight: 500;
    color: var(--text-muted);
    box-shadow: 0 1px 1px rgba(16, 24, 40, .04);
    white-space: nowrap;
  }
  .travel-stats button:hover { border-color: currentColor; }
  .travel-stats button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .travel-stats strong {
    color: var(--text);
    font-size: .98rem;
  }
  .travel-stats button.alert {
    background: var(--overdue-bg);
    border-color: transparent;
    color: var(--overdue-fg);
  }
  .travel-stats button.on-travel {
    background: var(--accent-soft);
    border-color: transparent;
    color: var(--accent);
  }
  .travel-stats button.alert strong,
  .travel-stats button.on-travel strong {
    color: inherit;
  }
  .travel-stats button.active {
    border-color: currentColor;
    box-shadow: inset 0 0 0 1px currentColor;
  }
  .travel-stats button.active::after {
    content: "✓";
    font-size: .7rem;
    font-weight: 800;
  }
  /* Phase separators inside the list (same grammar as Performance groups). */
  .group-row td {
    background: var(--surface-2);
    color: var(--text-muted);
    font-size: .75rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: .05em;
    padding-top: .45rem;
    padding-bottom: .45rem;
  }
  .group-row td span { font-weight: 500; }
  .travel-table tbody .group-row:hover td:first-child { box-shadow: none; }
  .row-cancelled td:not(:first-child) { color: var(--text-muted); }
  .cancelled-badge { margin-left: .4rem; }
  .voucher-cell {
    white-space: nowrap;
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
  .prewrap {
    white-space: pre-wrap;
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
