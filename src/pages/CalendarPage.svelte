<script lang="ts">
  // Combined month calendar: task due dates (drag to reschedule, with keyboard
  // alternatives), plus leave and situational-telework day overlays.
  import { app } from "../stores/app.svelte";
  import { ui } from "../stores/ui.svelte";
  import { router } from "../app/router.svelte";
  import type { AwardRecord, IsoDate, LeaveRecord, Task, TeleworkRecord, TravelRecord } from "../domain/models";
  import { dueState, DUE_STATE_LABELS } from "../domain/rules/dueState";
  import { awardDueMap, leaveDayMap, monthGrid, monthOf, monthTitle, taskDueMap, teleworkDayMap, travelDayMap } from "../domain/rules/calendar";
  import { addDays, addMonths, formatDate } from "../utils/dates";

  const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const MONTHS_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  let anchor = $state<IsoDate>(app.today);
  let filterEmployee = $state("");
  let showTasks = $state(true);
  let showLeave = $state(false);
  let showTelework = $state(false);
  let showTravel = $state(false);
  let showAwards = $state(false);
  let hideComplete = $state(false);

  let ym = $derived(monthOf(anchor));
  let weeks = $derived(monthGrid(ym.year, ym.month));
  let gridStart = $derived(weeks[0]![0]!.date);
  let gridEnd = $derived(weeks[weeks.length - 1]![6]!.date);

  let taskMap = $derived(
    showTasks
      ? taskDueMap(
          app.tasks.filter(
            (t) => !(hideComplete && t.status === "complete") && (!filterEmployee || t.employeeId === filterEmployee)
          ),
          gridStart,
          gridEnd
        )
      : new Map<IsoDate, Task[]>()
  );
  let leaveMap = $derived(
    showLeave
      ? leaveDayMap(
          app.leaveRecords.filter((l) => !filterEmployee || l.employeeId === filterEmployee),
          gridStart,
          gridEnd
        )
      : new Map<IsoDate, LeaveRecord[]>()
  );
  let teleworkMap = $derived(
    showTelework
      ? teleworkDayMap(
          app.teleworkRecords.filter((r) => !filterEmployee || r.employeeId === filterEmployee),
          gridStart,
          gridEnd
        )
      : new Map<IsoDate, TeleworkRecord[]>()
  );
  let travelMap = $derived(
    showTravel
      ? travelDayMap(
          app.travelRecords.filter((r) => !filterEmployee || r.employeeId === filterEmployee),
          gridStart,
          gridEnd
        )
      : new Map<IsoDate, TravelRecord[]>()
  );
  let awardMap = $derived(
    showAwards
      ? awardDueMap(
          app.awardRecords.filter((r) => !filterEmployee || r.employeeId === filterEmployee),
          gridStart,
          gridEnd
        )
      : new Map<IsoDate, AwardRecord[]>()
  );

  const PRIORITY_RANK: Record<Task["priority"], number> = { critical: 0, high: 1, normal: 2, low: 3 };
  let unscheduled = $derived(
    app.tasks
      .filter(
        (t) =>
          !t.isArchived &&
          !t.dueDate &&
          t.status !== "complete" &&
          t.status !== "cancelled" &&
          (!filterEmployee || t.employeeId === filterEmployee)
      )
      .sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.title.localeCompare(b.title))
  );

  function shiftMonth(offset: number) {
    anchor = addMonths(anchor, offset);
  }

  function dayLabel(date: IsoDate): string {
    const day = Number(date.slice(8, 10));
    if (day !== 1) return String(day);
    return `${MONTHS_ABBR[Number(date.slice(5, 7)) - 1]} 1`;
  }

  function teleworkRange(record: TeleworkRecord): string {
    const start = record.effectiveDate;
    const end = record.expirationDate ?? record.effectiveDate;
    if (!start) return "";
    return start === end ? formatDate(start) : `${formatDate(start)} to ${formatDate(end)}`;
  }

  // --- drag to reschedule (keyboard alternative: bracket/brace keys or the
  // --- task detail dialog's due date field) ----------------------------------
  let draggingId = $state<string | undefined>(undefined);
  /** Day the dragged task would land on; "none" = the no-due-date tray. */
  let dropTarget = $state<IsoDate | "none" | undefined>(undefined);

  function onDragStart(e: DragEvent, task: Task) {
    draggingId = task.id;
    e.dataTransfer?.setData("text/plain", task.id);
    if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
  }

  function cancelDrag() {
    draggingId = undefined;
    dropTarget = undefined;
  }

  function onDragOver(e: DragEvent, target: IsoDate | "none") {
    if (!draggingId) return;
    e.preventDefault();
    dropTarget = target;
  }

  async function onDrop(e: DragEvent, target: IsoDate | "none") {
    e.preventDefault();
    const id = draggingId;
    cancelDrag();
    if (!id) return;
    const task = app.tasks.find((t) => t.id === id);
    if (!task) return;
    await app.rescheduleTask(task, target === "none" ? undefined : target);
  }

  async function nudge(task: Task, days: number) {
    if (!task.dueDate) {
      // Unscheduled: a forward nudge schedules it starting today.
      if (days > 0) await app.rescheduleTask(task, app.today);
      return;
    }
    await app.rescheduleTask(task, addDays(task.dueDate, days));
  }

  function onChipKeydown(e: KeyboardEvent, task: Task) {
    if (e.key === "Enter") {
      e.preventDefault();
      ui.openTaskDetail(task.id);
    } else if (e.key === "[") {
      e.preventDefault();
      void nudge(task, -1);
    } else if (e.key === "]") {
      e.preventDefault();
      void nudge(task, 1);
    } else if (e.key === "{") {
      e.preventDefault();
      void nudge(task, -7);
    } else if (e.key === "}") {
      e.preventDefault();
      void nudge(task, 7);
    } else if (e.key === "Escape") {
      cancelDrag();
    }
  }

  function taskChipLabel(task: Task): string {
    const due = task.dueDate ? `due ${formatDate(task.dueDate)}` : "no due date";
    const who = task.employeeId ? `, ${app.employeeName(task.employeeId)}` : "";
    return `Task "${task.title}", ${due}${who}. Enter opens details. Bracket keys move the due date by a day, brace keys by a week.`;
  }

  function taskChipTitle(task: Task): string {
    const ds = dueState(task, app.today, app.settings.dueSoonDays);
    const parts = [task.title];
    if (task.employeeId) parts.push(app.employeeName(task.employeeId));
    if (task.status === "complete") parts.push("Complete");
    else if (DUE_STATE_LABELS[ds]) parts.push(DUE_STATE_LABELS[ds]);
    return parts.join(" · ");
  }
</script>

<svelte:window onkeydown={(e) => e.key === "Escape" && cancelDrag()} />

<div class="page calendar-page">
  <div class="cal-header">
    <div>
      <span class="eyebrow">Tasks</span>
      <h1>Calendar</h1>
    </div>
    <div class="month-nav" aria-label="Month navigation">
      <button type="button" onclick={() => shiftMonth(-1)} aria-label="Previous month">&lsaquo;</button>
      <button type="button" onclick={() => (anchor = app.today)}>Today</button>
      <button type="button" onclick={() => shiftMonth(1)} aria-label="Next month">&rsaquo;</button>
      <h2 class="month-title" aria-live="polite">{monthTitle(ym.year, ym.month)}</h2>
    </div>
    <button type="button" class="primary" onclick={() => ui.openNewTask()}>+ New task</button>
  </div>

  <div class="cal-toolbar" aria-label="Calendar filters">
    <select bind:value={filterEmployee} aria-label="Filter by employee">
      <option value="">All employees</option>
      {#each app.activeEmployees as e (e.id)}<option value={e.id}>{e.displayName}</option>{/each}
    </select>
    <label class="pill-toggle kind-tasks" class:active={showTasks}>
      <input type="checkbox" bind:checked={showTasks} />
      <span class="kind-dot" aria-hidden="true"></span>
      Tasks
    </label>
    <label class="pill-toggle kind-leave" class:active={showLeave}>
      <input type="checkbox" bind:checked={showLeave} />
      <span class="kind-dot" aria-hidden="true"></span>
      Leave
    </label>
    <label class="pill-toggle kind-telework" class:active={showTelework}>
      <input type="checkbox" bind:checked={showTelework} />
      <span class="kind-dot" aria-hidden="true"></span>
      Telework
    </label>
    <label class="pill-toggle kind-travel" class:active={showTravel}>
      <input type="checkbox" bind:checked={showTravel} />
      <span class="kind-dot" aria-hidden="true"></span>
      Travel
    </label>
    <label class="pill-toggle kind-award" class:active={showAwards}>
      <input type="checkbox" bind:checked={showAwards} />
      <span class="kind-dot" aria-hidden="true"></span>
      Awards
    </label>
    <label class="pill-toggle" class:active={hideComplete}>
      <input type="checkbox" bind:checked={hideComplete} />
      Active only
    </label>
    <span class="hint muted small">Drag a task to reschedule it, or focus it and use [ ] for days, {"{ }"} for weeks.</span>
  </div>

  <div class="cal-grid" aria-label="Month calendar">
    <div class="weekday-row">
      {#each WEEKDAYS as wd (wd)}
        <div class="weekday">{wd}</div>
      {/each}
    </div>
    {#each weeks as week (week[0]!.date)}
      <div class="week">
        {#each week as cell, i (cell.date)}
          <div
            class="day"
            class:out={!cell.inMonth}
            class:today={cell.date === app.today}
            class:weekend={i === 0 || i === 6}
            class:drop={dropTarget === cell.date}
            ondragover={(e) => onDragOver(e, cell.date)}
            ondrop={(e) => void onDrop(e, cell.date)}
            ondragleave={(e) => {
              if (e.currentTarget === e.target && dropTarget === cell.date) dropTarget = undefined;
            }}
            role="group"
            aria-label={formatDate(cell.date)}
          >
            <div class="day-head">
              <span class="day-num" class:today-num={cell.date === app.today}>{dayLabel(cell.date)}</span>
              <button
                type="button"
                class="day-add"
                aria-label={`Add task due ${formatDate(cell.date)}`}
                title="Add task on this day"
                onclick={() => ui.openNewTask({ dueDate: cell.date })}>+</button
              >
            </div>
            <div class="chips">
              {#each taskMap.get(cell.date) ?? [] as task (task.id)}
                {@const ds = dueState(task, app.today, app.settings.dueSoonDays)}
                <div
                  class="chip task-chip state-{ds}"
                  class:complete={task.status === "complete"}
                  class:dragging={draggingId === task.id}
                  role="button"
                  tabindex="0"
                  draggable="true"
                  aria-label={taskChipLabel(task)}
                  title={taskChipTitle(task)}
                  ondragstart={(e) => onDragStart(e, task)}
                  ondragend={cancelDrag}
                  onclick={() => ui.openTaskDetail(task.id)}
                  onkeydown={(e) => onChipKeydown(e, task)}
                >
                  <span class="chip-text">{task.title}</span>
                </div>
              {/each}
              {#each leaveMap.get(cell.date) ?? [] as leave (leave.id)}
                <button
                  type="button"
                  class="chip kind-chip kind-leave"
                  title={`${app.employeeName(leave.employeeId)} — ${leave.leaveType ?? "Leave"} (${leave.status}), ${formatDate(leave.startDate)} to ${formatDate(leave.endDate)}. Opens the Leave page.`}
                  onclick={() => router.go("leave")}
                >
                  <span class="chip-text">Leave · {app.employeeName(leave.employeeId)}</span>
                </button>
              {/each}
              {#each teleworkMap.get(cell.date) ?? [] as rec (rec.id)}
                <button
                  type="button"
                  class="chip kind-chip kind-telework"
                  title={`${app.employeeName(rec.employeeId)} — situational telework (${rec.status.replace(/_/g, " ")}), ${teleworkRange(rec)}${rec.scheduleSummary ? ". " + rec.scheduleSummary : ""}. Opens the record.`}
                  onclick={() => router.go("telework", rec.id)}
                >
                  <span class="chip-text">Telework · {app.employeeName(rec.employeeId)}</span>
                </button>
              {/each}
              {#each travelMap.get(cell.date) ?? [] as trip (trip.id)}
                <button
                  type="button"
                  class="chip kind-chip kind-travel"
                  title={`${app.employeeName(trip.employeeId)} — travel to ${trip.destination}, ${formatDate(trip.startDate)} to ${formatDate(trip.endDate)}. Opens the record.`}
                  onclick={() => router.go("travel", trip.id)}
                >
                  <span class="chip-text">Travel · {app.employeeName(trip.employeeId)}</span>
                </button>
              {/each}
              {#each awardMap.get(cell.date) ?? [] as award (award.id)}
                <button
                  type="button"
                  class="chip kind-chip kind-award"
                  title={`Award nomination due: ${award.title} — ${app.employeeName(award.employeeId)} (${award.status}). Opens the record.`}
                  onclick={() => router.go("awards", award.id)}
                >
                  <span class="chip-text">Award due · {award.title}</span>
                </button>
              {/each}
            </div>
          </div>
        {/each}
      </div>
    {/each}
  </div>

  {#if showTasks}
  <section
    class="tray"
    class:drop={dropTarget === "none"}
    ondragover={(e) => onDragOver(e, "none")}
    ondrop={(e) => void onDrop(e, "none")}
    ondragleave={(e) => {
      if (e.currentTarget === e.target && dropTarget === "none") dropTarget = undefined;
    }}
    aria-label="Tasks with no due date"
  >
    <header class="tray-head">
      <strong>No due date</strong>
      <span class="count">{unscheduled.length}</span>
      <span class="muted small">Drag a task onto a day to schedule it, or drop one here to clear its due date.</span>
    </header>
    {#if unscheduled.length === 0}
      <p class="muted small tray-empty">Every active task has a due date.</p>
    {:else}
      <div class="tray-chips">
        {#each unscheduled as task (task.id)}
          <div
            class="chip task-chip state-none"
            class:dragging={draggingId === task.id}
            role="button"
            tabindex="0"
            draggable="true"
            aria-label={taskChipLabel(task)}
            title={taskChipTitle(task)}
            ondragstart={(e) => onDragStart(e, task)}
            ondragend={cancelDrag}
            onclick={() => ui.openTaskDetail(task.id)}
            onkeydown={(e) => onChipKeydown(e, task)}
          >
            <span class="chip-text">{task.title}</span>
          </div>
        {/each}
      </div>
    {/if}
  </section>
  {/if}
</div>

<style>
  .calendar-page {
    max-width: none;
    padding: 1rem 1.25rem 3.5rem;
  }
  .cal-header {
    display: grid;
    grid-template-columns: minmax(11rem, auto) 1fr auto;
    gap: 1rem;
    align-items: center;
    margin-bottom: .8rem;
  }
  .eyebrow {
    display: block;
    color: var(--text-muted);
    font-size: .75rem;
    font-weight: 700;
    letter-spacing: .08em;
    text-transform: uppercase;
    margin-bottom: .15rem;
  }
  .cal-header h1 {
    font-size: 1.45rem;
    margin: 0;
  }
  .month-nav {
    display: flex;
    align-items: center;
    gap: .4rem;
  }
  .month-nav button {
    min-width: 2.15rem;
    min-height: 2.15rem;
  }
  .month-title {
    margin: 0 0 0 .5rem;
    font-size: 1.15rem;
    font-weight: 700;
  }
  .cal-toolbar {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: .45rem;
    padding: .65rem;
    margin-bottom: .85rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: color-mix(in srgb, var(--surface) 88%, var(--bg));
    box-shadow: var(--shadow);
  }
  .cal-toolbar select {
    min-height: 2.15rem;
    min-width: 11rem;
  }
  .pill-toggle {
    display: inline-flex;
    align-items: center;
    gap: .35rem;
    min-height: 2.15rem;
    margin: 0;
    padding: .3rem .65rem;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--surface);
    color: var(--text-muted);
    font-weight: 600;
    white-space: nowrap;
    cursor: pointer;
  }
  .pill-toggle.active {
    border-color: color-mix(in srgb, var(--accent) 55%, var(--border));
    background: var(--accent-soft);
    color: var(--accent);
  }
  .kind-dot {
    width: .55rem;
    height: .55rem;
    border-radius: 999px;
    background: var(--kind-color, var(--accent));
    flex: 0 0 auto;
  }
  .kind-tasks { --kind-color: var(--accent); }
  .kind-leave { --kind-color: #ca5010; }
  .kind-telework { --kind-color: #2564cf; }
  .kind-travel { --kind-color: #038387; }
  .kind-award { --kind-color: #8764b8; }
  .hint {
    margin-left: auto;
  }

  .cal-grid {
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--surface);
    overflow: hidden;
    box-shadow: var(--shadow);
  }
  .weekday-row,
  .week {
    display: grid;
    grid-template-columns: repeat(7, minmax(0, 1fr));
  }
  .weekday {
    padding: .45rem .55rem;
    font-size: .72rem;
    font-weight: 750;
    text-transform: uppercase;
    letter-spacing: .06em;
    color: var(--text-muted);
    border-bottom: 1px solid var(--border);
  }
  .day {
    min-height: 7.5rem;
    padding: .35rem .4rem .45rem;
    border-bottom: 1px solid var(--border);
    border-right: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    gap: .3rem;
  }
  .week .day:last-child {
    border-right: none;
  }
  .cal-grid > .week:last-child .day {
    border-bottom: none;
  }
  .day.weekend {
    background: color-mix(in srgb, var(--surface-2) 40%, var(--surface));
  }
  .day.out {
    background: color-mix(in srgb, var(--surface-2) 65%, var(--surface));
  }
  .day.out .day-num {
    opacity: .45;
  }
  .day.drop {
    outline: 2px dashed var(--accent);
    outline-offset: -3px;
    background: var(--accent-soft);
  }
  .day-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: .3rem;
  }
  .day-num {
    font-size: .8rem;
    font-weight: 700;
    color: var(--text-muted);
  }
  .day-num.today-num {
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
    border: none;
    border-radius: 999px;
    background: transparent;
    color: var(--text-muted);
    font-weight: 700;
    opacity: 0;
    transition: opacity .12s ease;
  }
  .day:hover .day-add,
  .day-add:focus {
    opacity: 1;
  }
  .day-add:hover {
    background: var(--accent-soft);
    color: var(--accent);
  }
  .chips {
    display: flex;
    flex-direction: column;
    gap: .22rem;
    min-height: 0;
  }
  .chip {
    display: block;
    width: 100%;
    text-align: left;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--surface);
    padding: .18rem .4rem .2rem;
    font-size: .74rem;
    font-weight: 600;
    line-height: 1.25;
    color: var(--text);
    box-shadow: 0 1px 1px rgba(16, 24, 40, .05);
  }
  .chip-text {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .task-chip {
    cursor: grab;
    border-left: 3px solid var(--text-muted);
  }
  .task-chip:hover,
  .task-chip:focus {
    border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
    border-left-color: var(--accent);
    box-shadow: 0 2px 8px rgba(16, 24, 40, .12);
  }
  .task-chip.dragging {
    opacity: .4;
  }
  .task-chip.state-overdue {
    border-left-color: var(--danger);
    background: var(--overdue-bg);
  }
  .task-chip.state-due_today,
  .task-chip.state-due_soon {
    border-left-color: var(--warning);
    background: var(--duesoon-bg);
  }
  .task-chip.complete {
    border-left-color: var(--success);
    color: var(--text-muted);
  }
  .task-chip.complete .chip-text {
    text-decoration: line-through;
  }
  .kind-chip {
    cursor: pointer;
    min-height: 0;
    border-left: 3px solid var(--kind-color);
    background: color-mix(in srgb, var(--kind-color) 10%, var(--surface));
    color: var(--text);
  }
  .kind-chip:hover,
  .kind-chip:focus {
    background: color-mix(in srgb, var(--kind-color) 20%, var(--surface));
  }

  .tray {
    margin-top: .85rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: color-mix(in srgb, var(--surface) 88%, var(--bg));
    padding: .6rem .75rem .7rem;
    box-shadow: var(--shadow);
  }
  .tray.drop {
    outline: 2px dashed var(--accent);
    outline-offset: -3px;
    background: var(--accent-soft);
  }
  .tray-head {
    display: flex;
    align-items: baseline;
    gap: .5rem;
    margin-bottom: .45rem;
  }
  .tray-head .count {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 999px;
    padding: .05rem .45rem;
    color: var(--text-muted);
    font-size: .75rem;
    font-weight: 700;
  }
  .tray-empty {
    margin: 0;
  }
  .tray-chips {
    display: flex;
    flex-wrap: wrap;
    gap: .3rem;
  }
  .tray-chips .chip {
    width: auto;
    max-width: 16rem;
  }

  @media (max-width: 1000px) {
    .cal-header {
      grid-template-columns: 1fr auto;
    }
    .month-nav {
      grid-column: 1 / -1;
      order: 3;
    }
    .hint {
      display: none;
    }
  }
  @media (max-width: 760px) {
    .calendar-page {
      padding-inline: .75rem;
    }
    .day {
      min-height: 5.5rem;
    }
    .weekday {
      padding-inline: .3rem;
    }
  }
</style>
