<script lang="ts">
  // Situational telework request tracking (plan 12.9, 20).
  import { app } from "../stores/app.svelte";
  import { router } from "../app/router.svelte";
  import ConfirmDialog from "../components/common/ConfirmDialog.svelte";
  import Dialog from "../components/common/Dialog.svelte";
  import EmptyState from "../components/common/EmptyState.svelte";
  import Icon from "../components/common/Icon.svelte";
  import { TELEWORK_RECORD_TYPES, type TeleworkRecord, type TeleworkStatus } from "../domain/models";
  import { mergeTeleworkEdit } from "../domain/rules/editMerge";
  import { monthGrid, monthOf } from "../domain/rules/calendar";
  import {
    allowanceState,
    countsTowardTeleworkLimit,
    isSituationalRequest,
    isWithinTeleworkWindow,
    payPeriodFor,
    payPeriodLabel,
    requestEndDate,
    requestPayPeriodStart,
    SITUATIONAL_REQUEST_TYPE,
    teleworkDays,
    teleworkUsageByPayPeriod,
    usageKey,
    type TeleworkPayPeriodUsage
  } from "../domain/rules/telework";
  import { addMonths, daysBetween, formatDate, isValidIsoDate, nowTimestamp, todayIso } from "../utils/dates";
  import { newId } from "../utils/ids";
  import { toCsv } from "../utils/csv";
  import { backupFilename, downloadText } from "../utils/download";

  const SITUATIONAL_TYPE = SITUATIONAL_REQUEST_TYPE;
  const HISTORICAL_STATUSES = new Set<TeleworkStatus>(["denied", "cancelled", "expired"]);
  const STATUS_OPTIONS: { value: TeleworkStatus; label: string }[] = [
    { value: "pending", label: "Pending" },
    { value: "approved", label: "Approved" },
    { value: "denied", label: "Denied" },
    { value: "cancelled", label: "Cancelled" }
  ];

  const AGREEMENT_TYPES = TELEWORK_RECORD_TYPES.filter((t) => t !== SITUATIONAL_TYPE);
  const AGREEMENT_STATUS_OPTIONS: { value: TeleworkStatus; label: string }[] = [
    { value: "draft", label: "Draft" },
    { value: "pending", label: "Pending" },
    { value: "approved", label: "Approved" },
    { value: "active", label: "Active" },
    { value: "expired", label: "Expired" },
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
  // Agreement form (telework agreements, renewals, modifications).
  let agreementFormOpen = $state(false);
  let editingAgreement = $state<TeleworkRecord | undefined>(undefined);
  let aEmployee = $state("");
  let aType = $state("Agreement");
  let aStatus = $state<TeleworkStatus>("active");
  let aRequestDate = $state("");
  let aEffective = $state("");
  let aExpiration = $state("");
  let aSchedule = $state("");
  let aNotes = $state("");
  let aError = $state("");
  let activeCalendarDate = $state<string | undefined>(undefined);
  let pendingDelete = $state<TeleworkRecord | undefined>(undefined);

  let expanded = $state<Record<string, boolean>>({});

  // Deep link: #/telework/{recordId} expands the record in the list, so
  // attention items land on the actual agreement instead of a generic list.
  $effect(() => {
    const id = router.current.param;
    if (router.current.page !== "telework" || !id) return;
    const record = app.teleworkRecords.find((t) => t.id === id);
    if (!record) return;
    view = "list";
    if (isSituationalRequest(record) ? !inRequestWindow(record) : isHistorical(record)) showHistorical = true;
    if (filterEmployee && filterEmployee !== record.employeeId) filterEmployee = "";
    if (filterStatus && filterStatus !== record.status) filterStatus = "";
    expanded[id] = true;
    router.go("telework");
    requestAnimationFrame(() => {
      document.getElementById(`telework-row-${id}`)?.scrollIntoView({ block: "center" });
    });
  });

  function toggleRow(id: string) {
    expanded[id] = !expanded[id];
  }

  function toggleFromRow(id: string) {
    // Don't hijack a click the user made to select and copy text.
    if (window.getSelection()?.toString()) return;
    toggleRow(id);
  }

  function statusLabel(status: TeleworkStatus): string {
    return STATUS_OPTIONS.find((s) => s.value === status)?.label ?? status.replace(/_/g, " ");
  }

  /**
   * Agreements keep the original rule (final states and lapsed records are
   * history). Situational requests use the date window instead — see
   * `inRequestWindow` — so a denied or cancelled request from last week still
   * shows up in the record of who asked for what.
   */
  function isHistorical(t: TeleworkRecord): boolean {
    const end = requestEndDate(t);
    if (HISTORICAL_STATUSES.has(t.status)) return true;
    return Boolean(end && end < app.today && (t.status === "approved" || t.status === "active"));
  }

  function inRequestWindow(t: TeleworkRecord): boolean {
    return isWithinTeleworkWindow(t, app.today, app.settings.teleworkLookbackDays);
  }

  // Snapshots of the values each form opened with, for the unsaved-changes guards.
  let openedSnapshot = $state("");
  function formSnapshot(): string {
    return JSON.stringify([fEmployee, fStatus, fRequestDate, fStartDate, fEndDate, fNotes]);
  }
  let openedAgreementSnapshot = $state("");
  function agreementSnapshot(): string {
    return JSON.stringify([aEmployee, aType, aStatus, aRequestDate, aEffective, aExpiration, aSchedule, aNotes]);
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
    openedSnapshot = formSnapshot();
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
    // Merge over the existing record so unexposed fields (schedule summary,
    // source system/reference, verification date, related task) survive.
    const record: TeleworkRecord = mergeTeleworkEdit(
      editing,
      {
        employeeId: fEmployee,
        recordType: editing?.recordType ?? SITUATIONAL_TYPE,
        status: fStatus,
        requestDate: fRequestDate,
        effectiveDate: fStartDate,
        expirationDate: endDate,
        notes: fNotes
      },
      { id: newId(), now: nowTimestamp() }
    );
    await app.putRecord("teleworkRecords", record, {
      actionType: editing ? "updated" : "created",
      summary: `${editing ? "Updated" : "Added"} situational telework request for ${app.employeeName(fEmployee)}`
    });
    formOpen = false;
  }

  function openAgreementForm(t?: TeleworkRecord) {
    editingAgreement = t;
    aEmployee = t?.employeeId ?? "";
    aType = t?.recordType ?? "Agreement";
    aStatus = t?.status ?? "active";
    aRequestDate = t?.requestDate ?? "";
    aEffective = t?.effectiveDate ?? "";
    aExpiration = t?.expirationDate ?? "";
    aSchedule = t?.scheduleSummary ?? "";
    aNotes = t?.notes ?? "";
    aError = "";
    openedAgreementSnapshot = agreementSnapshot();
    agreementFormOpen = true;
  }

  async function saveAgreement() {
    if (!aEmployee) {
      aError = "Employee is required.";
      return;
    }
    for (const v of [aRequestDate, aEffective, aExpiration]) {
      if (v && !isValidIsoDate(v)) {
        aError = "Dates must be valid.";
        return;
      }
    }
    if (aEffective && aExpiration && aExpiration < aEffective) {
      aError = "Expiration must be on or after the effective date.";
      return;
    }
    const record: TeleworkRecord = mergeTeleworkEdit(
      editingAgreement,
      {
        employeeId: aEmployee,
        recordType: aType,
        status: aStatus,
        requestDate: aRequestDate,
        effectiveDate: aEffective,
        expirationDate: aExpiration,
        scheduleSummary: aSchedule,
        notes: aNotes
      },
      { id: newId(), now: nowTimestamp() }
    );
    await app.putRecord("teleworkRecords", record, {
      actionType: editingAgreement ? "updated" : "created",
      summary: `${editingAgreement ? "Updated" : "Added"} telework ${aType.toLowerCase()} for ${app.employeeName(aEmployee)}`
    });
    agreementFormOpen = false;
  }

  function expirationState(t: TeleworkRecord): "overdue" | "soon" | "" {
    if (!t.expirationDate || HISTORICAL_STATUSES.has(t.status)) return "";
    const diff = daysBetween(app.today, t.expirationDate);
    if (diff < 0) return "overdue";
    if (diff <= 30) return "soon";
    return "";
  }

  // Default view: everything from the last `teleworkLookbackDays` days plus
  // every upcoming request. "Show historical" reaches further back.
  let rows = $derived(
    app.teleworkRecords
      .filter(isSituationalRequest)
      .filter((t) => showHistorical || inRequestWindow(t))
      .filter((t) => !filterEmployee || t.employeeId === filterEmployee)
      .filter((t) => !filterStatus || t.status === filterStatus)
      .sort((a, b) => {
        const aDate = a.effectiveDate ?? a.requestDate ?? "9999-12-31";
        const bDate = b.effectiveDate ?? b.requestDate ?? "9999-12-31";
        return aDate.localeCompare(bDate) || app.employeeName(a.employeeId).localeCompare(app.employeeName(b.employeeId));
      })
  );

  // --- pay period allowance ------------------------------------------------
  // Usage is computed from every situational request in the database, not just
  // the visible rows: filtering the list to one status must not make an
  // employee look under their allowance.
  let teleworkLimit = $derived(app.settings.teleworkDaysPerPayPeriod);
  let usageByPeriod = $derived(teleworkUsageByPayPeriod(app.teleworkRecords, app.settings.payPeriodAnchorDate));
  let currentPeriodStart = $derived(payPeriodFor(app.today, app.settings.payPeriodAnchorDate).start);

  function usageFor(t: TeleworkRecord): TeleworkPayPeriodUsage | undefined {
    const periodStart = requestPayPeriodStart(t, app.settings.payPeriodAnchorDate);
    return periodStart ? usageByPeriod.get(usageKey(t.employeeId, periodStart)) : undefined;
  }

  function usageDetail(t: TeleworkRecord): string {
    const usage = usageFor(t);
    if (!usage) {
      return countsTowardTeleworkLimit(t)
        ? "No telework date on this request"
        : `A ${statusLabel(t.status).toLowerCase()} request uses none of the pay period allowance`;
    }
    const period = payPeriodLabel(payPeriodFor(usage.periodStart, app.settings.payPeriodAnchorDate));
    const parts = [`${usage.totalDays} of ${teleworkLimit} day${teleworkLimit === 1 ? "" : "s"} used in ${period}`];
    if (usage.pendingDays > 0) parts.push(`${usage.approvedDays} approved, ${usage.pendingDays} pending`);
    if (usage.totalDays > teleworkLimit) parts.push("over the pay period allowance");
    return parts.join(" — ");
  }

  function usageTitle(t: TeleworkRecord): string {
    const usage = usageFor(t);
    if (!usage) return "";
    const period = payPeriodLabel(payPeriodFor(usage.periodStart, app.settings.payPeriodAnchorDate));
    const pending = usage.pendingDays > 0 ? `, ${usage.pendingDays} still pending` : "";
    return `${app.employeeName(t.employeeId)} has ${usage.totalDays} telework day${usage.totalDays === 1 ? "" : "s"}${pending} in the pay period ${period} (allowance ${teleworkLimit})`;
  }

  // Rows are sorted by date, so a run of equal pay periods is one group.
  let requestGroups = $derived.by(() => {
    const anchor = app.settings.payPeriodAnchorDate;
    const groups: { periodStart: string; rows: TeleworkRecord[] }[] = [];
    for (const row of rows) {
      const periodStart = requestPayPeriodStart(row, anchor) ?? "";
      const last = groups[groups.length - 1];
      if (last && last.periodStart === periodStart) last.rows.push(row);
      else groups.push({ periodStart, rows: [row] });
    }
    return groups.map((group) => {
      const period = payPeriodFor(group.periodStart || app.today, anchor);
      // Employees over their allowance in this period, counted once each.
      const over = new Set(
        group.rows
          .map((row) => usageFor(row))
          .filter((usage): usage is TeleworkPayPeriodUsage => Boolean(usage) && usage!.totalDays > teleworkLimit)
          .map((usage) => usage.employeeId)
      );
      return {
        ...group,
        label: group.periodStart ? payPeriodLabel(period) : "No telework date",
        isCurrent: group.periodStart === currentPeriodStart,
        overCount: over.size
      };
    });
  });

  let agreementRows = $derived(
    app.teleworkRecords
      .filter((t) => !isSituationalRequest(t))
      .filter((t) => showHistorical || !isHistorical(t))
      .filter((t) => !filterEmployee || t.employeeId === filterEmployee)
      .sort(
        (a, b) =>
          (a.expirationDate ?? "9999-12-31").localeCompare(b.expirationDate ?? "9999-12-31") ||
          app.employeeName(a.employeeId).localeCompare(app.employeeName(b.employeeId))
      )
  );

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
        events: rows.filter((t) => requestCoversDate(t, cell.date))
      }))
    );
  });

  function requestCoversDate(t: TeleworkRecord, date: string): boolean {
    if (!t.effectiveDate) return false;
    const end = requestEndDate(t) ?? t.effectiveDate;
    return t.effectiveDate <= date && date <= end;
  }

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
        "Employee",
        "Status",
        "Request received",
        "Telework start",
        "Telework end",
        "Telework days",
        "Pay period",
        "Days used in pay period",
        "Pay period allowance",
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
        teleworkDays(t).length,
        requestPayPeriodStart(t, app.settings.payPeriodAnchorDate),
        usageFor(t)?.totalDays,
        teleworkLimit,
        t.notes,
        t.createdAt.slice(0, 10),
        t.updatedAt.slice(0, 10)
      ])
    );
    try {
      await downloadText(backupFilename("RADAR_SituationalTelework", "csv"), csv, "text/csv");
    } catch {
      app.toast("Telework export failed", "error");
    }
  }

  function requestDelete(t: TeleworkRecord) {
    pendingDelete = t;
  }

  async function deleteTelework(t: TeleworkRecord) {
    await app.deleteRecord(
      "teleworkRecords",
      t.id,
      `Deleted telework ${t.recordType.toLowerCase()} for ${app.employeeName(t.employeeId)} (${t.effectiveDate ?? "no start"} to ${requestEndDate(t) ?? "no end"})`
    );
    if (editing?.id === t.id) {
      formOpen = false;
      editing = undefined;
    }
    if (editingAgreement?.id === t.id) {
      agreementFormOpen = false;
      editingAgreement = undefined;
    }
    pendingDelete = undefined;
    app.toast("Telework record deleted", "success");
  }
</script>

<div class="page telework-page" class:wide={view === "calendar"}>
  <div class="page-header">
    <h1>Telework</h1>
    <span class="muted">{rows.length + agreementRows.length} shown</span>
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
    <button type="button" onclick={() => openAgreementForm()}>Add Agreement</button>
    <button type="button" class="primary" onclick={() => openForm()}>Add Request</button>
  </div>

  {#if view === "list"}
    <h2 class="section-heading">Situational requests</h2>
    <p class="small muted section-hint">
      Requests from the last {app.settings.teleworkLookbackDays} days plus everything upcoming, grouped by pay period.
      Each employee may use {teleworkLimit} telework day{teleworkLimit === 1 ? "" : "s"} per pay period.
    </p>
    {#if rows.length === 0}
      <EmptyState message="No situational telework requests." hint="Add requests as they arrive by email." />
    {:else}
      <table class="data request-table">
        <thead>
          <tr>
            <th>Employee</th><th>Status</th><th>Request received</th><th>Telework start</th><th>Telework end</th><th>Pay period use</th>
          </tr>
        </thead>
        <tbody>
          {#each requestGroups as group (group.periodStart)}
            <tr class="group-row">
              <td colspan="6">
                {group.label}
                {#if group.isCurrent}<span class="current-tag">This pay period</span>{/if}
                <span>({group.rows.length})</span>
                {#if group.overCount > 0}
                  <span class="over-tag">{group.overCount} over allowance</span>
                {/if}
              </td>
            </tr>
            {#each group.rows as t (t.id)}
              {@const open = Boolean(expanded[t.id])}
              {@const usage = usageFor(t)}
              {@const state = usage ? allowanceState(usage.totalDays, teleworkLimit) : "under"}
              <!-- Row click toggles the inline detail; the chevron is the keyboard control. -->
              <!-- svelte-ignore a11y_click_events_have_key_events -->
              <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
              <tr class="row-clickable" class:row-open={open} id={"telework-row-" + t.id} onclick={() => toggleFromRow(t.id)}>
                <td>
                  <button
                    type="button"
                    class="disclosure"
                    class:open
                    aria-expanded={open}
                    aria-label={open ? `Hide request details for ${app.employeeName(t.employeeId)}` : `Show request details for ${app.employeeName(t.employeeId)}`}
                    onclick={(ev) => {
                      ev.stopPropagation();
                      toggleRow(t.id);
                    }}><Icon name="chevron" size={13} /></button>
                  {app.employeeName(t.employeeId)}
                </td>
                <td><span class="badge status-{t.status}">{statusLabel(t.status)}</span></td>
                <td class="date-cell">{formatDate(t.requestDate)}</td>
                <td class="date-cell">{formatDate(t.effectiveDate)}</td>
                <td class="date-cell">{formatDate(requestEndDate(t))}</td>
                <td class="usage-cell">
                  {#if usage}
                    <span
                      class="badge"
                      class:overdue={state === "over"}
                      class:warning={state === "at"}
                      title={usageTitle(t)}
                    >{usage.totalDays} of {teleworkLimit}</span>
                    {#if usage.pendingDays > 0}
                      <span class="muted small">{usage.pendingDays} pending</span>
                    {/if}
                  {:else if !countsTowardTeleworkLimit(t)}
                    <span class="muted" title={`A ${statusLabel(t.status).toLowerCase()} request uses none of the pay period allowance`}>Not counted</span>
                  {:else}
                    <span class="muted">—</span>
                  {/if}
                </td>
              </tr>
              {#if open}
                <tr class="detail-row">
                  <td colspan="6">
                    <div class="detail" aria-label={`Request details for ${app.employeeName(t.employeeId)}`}>
                      <dl class="detail-grid">
                        <div>
                          <dt>Pay period use</dt>
                          <dd>{usageDetail(t)}</dd>
                        </div>
                        <div><dt>Notes</dt><dd class="prewrap">{t.notes || "None"}</dd></div>
                      </dl>
                      <div class="detail-footer">
                        <button type="button" onclick={() => openForm(t)}>Edit</button>
                        <button
                          type="button"
                          class="icon-btn danger"
                          aria-label="Delete telework request"
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

    <h2 class="section-heading">Agreements</h2>
    <p class="small muted section-hint">
      Telework agreements, renewals, and modifications. Expiration alerts on the Today page link here.
    </p>
    {#if agreementRows.length === 0}
      <EmptyState message="No telework agreements." hint="Track agreement effective and expiration dates to get renewal reminders." />
    {:else}
      <table class="data">
        <thead>
          <tr>
            <th>Employee</th><th>Type</th><th>Status</th><th>Effective</th><th>Expires</th><th>Schedule</th>
          </tr>
        </thead>
        <tbody>
          {#each agreementRows as t (t.id)}
            {@const open = Boolean(expanded[t.id])}
            <!-- Row click toggles the inline detail; the chevron is the keyboard control. -->
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
            <tr class="row-clickable" class:row-open={open} id={"telework-row-" + t.id} onclick={() => toggleFromRow(t.id)}>
              <td>
                <button
                  type="button"
                  class="disclosure"
                  class:open
                  aria-expanded={open}
                  aria-label={open ? `Hide agreement details for ${app.employeeName(t.employeeId)}` : `Show agreement details for ${app.employeeName(t.employeeId)}`}
                  onclick={(ev) => {
                    ev.stopPropagation();
                    toggleRow(t.id);
                  }}><Icon name="chevron" size={13} /></button>
                {app.employeeName(t.employeeId)}
              </td>
              <td>{t.recordType}</td>
              <td><span class="badge status-{t.status}">{t.status.replace(/_/g, " ")}</span></td>
              <td class="date-cell">{formatDate(t.effectiveDate)}</td>
              <td class="date-cell">
                {#if expirationState(t) === "overdue"}
                  <span class="badge overdue" title="Agreement expired">{formatDate(t.expirationDate)}</span>
                {:else if expirationState(t) === "soon"}
                  <span class="badge warning" title="Agreement expires within 30 days">{formatDate(t.expirationDate)}</span>
                {:else}
                  {formatDate(t.expirationDate)}
                {/if}
              </td>
              <td class="notes-cell">{t.scheduleSummary ?? ""}</td>
            </tr>
            {#if open}
              <tr class="detail-row">
                <td colspan="6">
                  <div class="detail" aria-label={`Agreement details for ${app.employeeName(t.employeeId)}`}>
                    <dl class="detail-grid">
                      {#if t.requestDate}
                        <div><dt>Request date</dt><dd>{formatDate(t.requestDate)}</dd></div>
                      {/if}
                      {#if t.scheduleSummary}
                        <div><dt>Schedule</dt><dd class="prewrap">{t.scheduleSummary}</dd></div>
                      {/if}
                      <div><dt>Notes</dt><dd class="prewrap">{t.notes || "None"}</dd></div>
                    </dl>
                    <div class="detail-footer">
                      <button type="button" onclick={() => openAgreementForm(t)}>Edit</button>
                      <button
                        type="button"
                        class="icon-btn danger"
                        aria-label="Delete telework agreement"
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
  <Dialog
    title={editing ? "Edit Situational Telework" : "Add Situational Telework"}
    onclose={() => (formOpen = false)}
    unsavedGuard={() => formSnapshot() !== openedSnapshot}
  >
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
      {#if fError}<div class="field-error" role="alert">{fError}</div>{/if}
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
          <button type="button" class="icon-btn danger" aria-label="Delete telework request" title="Delete" onclick={() => requestDelete(editing!)}><Icon name="trash" size={17} /></button>
        {/if}
        <span class="spacer"></span>
        <button type="button" onclick={() => (formOpen = false)}>Cancel</button>
        <button type="submit" class="primary">Save</button>
      </div>
    </form>
  </Dialog>
{/if}

{#if agreementFormOpen}
  <Dialog
    title={editingAgreement ? "Edit Telework Agreement" : "Add Telework Agreement"}
    onclose={() => (agreementFormOpen = false)}
    unsavedGuard={() => agreementSnapshot() !== openedAgreementSnapshot}
  >
    <form
      onsubmit={(e) => {
        e.preventDefault();
        void saveAgreement();
      }}
    >
      <label for="ta-emp">Employee <span class="req">*</span></label>
      <select id="ta-emp" bind:value={aEmployee} style="width:100%">
        <option value="">(select)</option>
        {#each app.activeEmployees as e (e.id)}<option value={e.id}>{e.displayName}</option>{/each}
      </select>
      {#if aError}<div class="field-error" role="alert">{aError}</div>{/if}
      <div class="form-grid">
        <div>
          <label for="ta-type">Type</label>
          <select id="ta-type" bind:value={aType} style="width:100%">
            {#each AGREEMENT_TYPES as t (t)}<option value={t}>{t}</option>{/each}
          </select>
        </div>
        <div>
          <label for="ta-status">Status</label>
          <select id="ta-status" bind:value={aStatus} style="width:100%">
            {#each AGREEMENT_STATUS_OPTIONS as s (s.value)}<option value={s.value}>{s.label}</option>{/each}
          </select>
        </div>
        <div>
          <label for="ta-request">Request date</label>
          <input id="ta-request" type="date" bind:value={aRequestDate} style="width:100%" />
        </div>
        <div>
          <label for="ta-effective">Effective</label>
          <input id="ta-effective" type="date" bind:value={aEffective} style="width:100%" />
        </div>
        <div>
          <label for="ta-expiration">Expires</label>
          <input id="ta-expiration" type="date" bind:value={aExpiration} style="width:100%" />
        </div>
        <div>
          <label for="ta-schedule">Schedule summary</label>
          <input id="ta-schedule" type="text" bind:value={aSchedule} maxlength="200" placeholder="e.g. Mon/Wed remote" style="width:100%" />
        </div>
      </div>
      <label for="ta-notes">Notes</label>
      <textarea id="ta-notes" bind:value={aNotes} maxlength="2000" rows="3" style="width:100%"></textarea>
      <div class="dialog-actions">
        {#if editingAgreement}
          <button type="button" class="icon-btn danger" aria-label="Delete telework agreement" title="Delete" onclick={() => requestDelete(editingAgreement!)}><Icon name="trash" size={17} /></button>
        {/if}
        <span class="spacer"></span>
        <button type="button" onclick={() => (agreementFormOpen = false)}>Cancel</button>
        <button type="submit" class="primary">Save</button>
      </div>
    </form>
  </Dialog>
{/if}

{#if pendingDelete}
  <ConfirmDialog
    title={`Delete telework ${isSituationalRequest(pendingDelete) ? "request" : "record"}`}
    message={`Permanently delete the ${pendingDelete.recordType.toLowerCase()} for ${app.employeeName(pendingDelete.employeeId)}${pendingDelete.effectiveDate ? ` (${formatDate(pendingDelete.effectiveDate)} to ${formatDate(requestEndDate(pendingDelete)) || "no end"})` : ""}?`}
    confirmLabel="Delete"
    danger
    onconfirm={() => void deleteTelework(pendingDelete!)}
    oncancel={() => (pendingDelete = undefined)}
  />
{/if}

<style>
  /* List view uses the default page width (matching Training/Awards); only the
     calendar spans full width. */
  .telework-page.wide {
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
  .prewrap {
    white-space: pre-wrap;
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
  .status-cancelled,
  .status-expired {
    background: var(--surface-2);
    color: var(--text-muted);
  }
  .status-approved,
  .status-active {
    background: var(--success-bg, var(--surface-2));
  }
  /* Pay period separators in the request list (same grammar as Performance
     groups and the Travel phase groups). */
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
  .request-table tbody .group-row:hover td:first-child { box-shadow: none; }
  .current-tag {
    margin-left: .35rem;
    padding: .05rem .4rem;
    border-radius: 999px;
    background: var(--accent-soft);
    color: var(--accent);
    letter-spacing: normal;
    text-transform: none;
  }
  .over-tag {
    margin-left: .35rem;
    padding: .05rem .4rem;
    border-radius: 999px;
    background: var(--overdue-bg);
    color: var(--overdue-fg);
    letter-spacing: normal;
    text-transform: none;
  }
  .usage-cell {
    white-space: nowrap;
  }
  .usage-cell .small {
    margin-left: .35rem;
    font-size: .72rem;
  }
  .section-heading {
    margin: 1.1rem 0 .4rem;
    font-size: 1rem;
  }
  .section-hint {
    margin: 0 0 .5rem;
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
