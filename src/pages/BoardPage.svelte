<script lang="ts">
  // Kanban board (plan sections 12.2 and 13): drag-and-drop with a keyboard
  // alternative, filters, gap-based ordering, completed cards visible for a
  // configurable number of days.
  import { app } from "../stores/app.svelte";
  import { ui } from "../stores/ui.svelte";
  import EmptyState from "../components/common/EmptyState.svelte";
  import {
    BOARD_STATUSES,
    TASK_CATEGORIES,
    TASK_PRIORITIES,
    categoryLabel,
    statusLabel,
    type Task,
    type TaskStatus
  } from "../domain/models";
  import { dueState, DUE_STATE_LABELS } from "../domain/rules/dueState";
  import { orderBetween } from "../domain/rules/boardOrder";
  import { daysBetween, daysSinceTimestamp, formatDate } from "../utils/dates";

  let search = $state("");
  let filterEmployee = $state("");
  let filterCompetency = $state("");
  let filterProject = $state("");
  let filterCategory = $state("");
  let filterPriority = $state("");
  let hideComplete = $state(false);
  let addingStatus = $state<TaskStatus | undefined>(undefined);
  let newTaskTitle = $state("");
  let quickAddError = $state("");

  let visibleTasks = $derived(
    app.tasks.filter((t) => {
      if (t.isArchived) return false;
      if (t.status === "cancelled") return false;
      if (
        t.status === "complete" &&
        t.completedDate &&
        daysBetween(t.completedDate, app.today) > app.settings.completedVisibleDays
      ) {
        return false;
      }
      if (filterEmployee && t.employeeId !== filterEmployee) return false;
      if (filterCompetency && t.competencyId !== filterCompetency) return false;
      if (filterProject && t.projectId !== filterProject) return false;
      if (filterCategory && t.category !== filterCategory) return false;
      if (filterPriority && t.priority !== filterPriority) return false;
      if (search) {
        const q = search.toLowerCase();
        const hay = `${t.title} ${t.description ?? ""} ${t.tags.join(" ")} ${app.employeeName(t.employeeId)}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    })
  );

  let columns = $derived(
    BOARD_STATUSES.filter((s) => !(hideComplete && s === "complete")).map((status) => ({
      status,
      tasks: visibleTasks.filter((t) => t.status === status).sort((a, b) => a.boardOrder - b.boardOrder)
    }))
  );

  let boardStats = $derived({
    total: visibleTasks.length,
    overdue: visibleTasks.filter((t) => dueState(t, app.today, app.settings.dueSoonDays) === "overdue").length,
    dueSoon: visibleTasks.filter((t) => {
      const state = dueState(t, app.today, app.settings.dueSoonDays);
      return state === "due_today" || state === "due_soon";
    }).length,
    waiting: visibleTasks.filter((t) => t.status === "waiting").length,
    priority: visibleTasks.filter((t) => t.priority === "high" || t.priority === "critical").length
  });

  // --- drag and drop --------------------------------------------------------
  let draggingId = $state<string | undefined>(undefined);
  let dropTarget = $state<{ status: TaskStatus; index: number } | undefined>(undefined);

  function onDragStart(e: DragEvent, task: Task) {
    draggingId = task.id;
    e.dataTransfer?.setData("text/plain", task.id);
    if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
  }

  function onDragOverColumn(e: DragEvent, status: TaskStatus) {
    if (!draggingId) return;
    e.preventDefault();
    const columnEl = e.currentTarget as HTMLElement;
    const cards = Array.from(columnEl.querySelectorAll<HTMLElement>("[data-card-id]")).filter(
      (el) => el.dataset.cardId !== draggingId
    );
    let index = cards.length;
    for (let i = 0; i < cards.length; i++) {
      const rect = cards[i]!.getBoundingClientRect();
      if (e.clientY < rect.top + rect.height / 2) {
        index = i;
        break;
      }
    }
    dropTarget = { status, index };
  }

  async function onDrop(e: DragEvent) {
    e.preventDefault();
    const id = draggingId;
    const target = dropTarget;
    draggingId = undefined;
    dropTarget = undefined;
    if (!id || !target) return;
    const task = app.tasks.find((t) => t.id === id);
    if (!task) return;
    const col = columns.find((c) => c.status === target.status);
    if (!col) return;
    const others = col.tasks.filter((t) => t.id !== id);
    const before = others[target.index - 1]?.boardOrder;
    const after = others[target.index]?.boardOrder;
    const order = orderBetween(before, after);
    await app.moveTask(task, target.status, order);
    if (target.status === "complete" && task.status !== "complete" && task.employeeId && !task.performanceInputCreated) {
      ui.performancePromptTask = app.tasks.find((t) => t.id === id);
    }
  }

  function cancelDrag() {
    draggingId = undefined;
    dropTarget = undefined;
  }

  function clearFilters() {
    search = "";
    filterEmployee = "";
    filterCompetency = "";
    filterProject = "";
    filterCategory = "";
    filterPriority = "";
    hideComplete = false;
  }

  function startInlineAdd(status: TaskStatus) {
    addingStatus = status;
    newTaskTitle = "";
    quickAddError = "";
  }

  function cancelInlineAdd() {
    addingStatus = undefined;
    newTaskTitle = "";
    quickAddError = "";
  }

  async function saveInlineTask(status: TaskStatus) {
    const title = newTaskTitle.trim();
    if (!title) {
      quickAddError = "Title is required.";
      return;
    }
    if (title.length > 200) {
      quickAddError = "Title must be 200 characters or fewer.";
      return;
    }
    const task = app.createTask({ title, status });
    await app.saveNewTask(task);
    cancelInlineAdd();
  }

  function onInlineAddKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      cancelInlineAdd();
    }
  }

  function cancelTransientState() {
    cancelDrag();
    cancelInlineAdd();
  }

  // --- keyboard movement (plan 13.4, 29.4) -----------------------------------
  async function moveByOffset(task: Task, offset: number) {
    const statuses = BOARD_STATUSES;
    const idx = statuses.indexOf(task.status);
    const next = statuses[idx + offset];
    if (!next) return;
    const col = visibleTasks.filter((t) => t.status === next).sort((a, b) => a.boardOrder - b.boardOrder);
    const order = orderBetween(col[col.length - 1]?.boardOrder, undefined);
    await app.moveTask(task, next, order);
    if (next === "complete" && task.employeeId && !task.performanceInputCreated) {
      ui.performancePromptTask = app.tasks.find((t) => t.id === task.id);
    }
  }

  async function completeCard(task: Task) {
    const updated = await app.completeTask(task);
    if (updated.employeeId && !updated.performanceInputCreated) {
      ui.performancePromptTask = updated;
    }
  }

  function onCardKeydown(e: KeyboardEvent, task: Task) {
    if (e.key === "Enter") {
      e.preventDefault();
      ui.openTaskDetail(task.id);
    } else if (e.key === "[") {
      e.preventDefault();
      void moveByOffset(task, -1);
    } else if (e.key === "]") {
      e.preventDefault();
      void moveByOffset(task, 1);
    } else if (e.key.toLowerCase() === "c" && task.status !== "complete") {
      e.preventDefault();
      void completeCard(task);
    } else if (e.key === "Escape") {
      cancelDrag();
    }
  }

  function checklistProgress(taskId: string): string {
    const items = app.checklistItems.filter((c) => c.taskId === taskId);
    if (items.length === 0) return "";
    return `${items.filter((c) => c.isComplete).length}/${items.length}`;
  }

  function employeeInitials(employeeId: string | undefined): string {
    const name = app.employeeName(employeeId);
    if (!name) return "";
    return name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("");
  }

  let anyFilter = $derived(
    Boolean(search || filterEmployee || filterCompetency || filterProject || filterCategory || filterPriority || hideComplete)
  );
</script>

<svelte:window onkeydown={(e) => e.key === "Escape" && cancelTransientState()} />

<div class="page board-page">
  <div class="board-header">
    <div>
      <span class="eyebrow">Tasks</span>
      <h1>Supervisor Task Board</h1>
    </div>
    <div class="board-stats" aria-label="Board summary">
      <span><strong>{boardStats.total}</strong> visible</span>
      <span class:warn={boardStats.dueSoon > 0}><strong>{boardStats.dueSoon}</strong> due soon</span>
      <span class:alert={boardStats.overdue > 0}><strong>{boardStats.overdue}</strong> overdue</span>
      <span><strong>{boardStats.waiting}</strong> waiting</span>
      <span class:alert={boardStats.priority > 0}><strong>{boardStats.priority}</strong> high priority</span>
    </div>
    <button type="button" class="primary board-new-task" onclick={() => ui.openQuickAdd()}>+ New task</button>
  </div>

  <div class="board-toolbar" aria-label="Board filters">
    <div class="search-field">
      <input type="search" placeholder="Search tasks" bind:value={search} aria-label="Search tasks" />
    </div>
    <select bind:value={filterEmployee} aria-label="Filter by employee">
      <option value="">All employees</option>
      {#each app.activeEmployees as e (e.id)}<option value={e.id}>{e.displayName}</option>{/each}
    </select>
    <select bind:value={filterCompetency} aria-label="Filter by competency">
      <option value="">All competencies</option>
      {#each app.competencies as c (c.id)}<option value={c.id}>{c.code}</option>{/each}
    </select>
    <select bind:value={filterProject} aria-label="Filter by project">
      <option value="">All projects</option>
      {#each app.activeProjects as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
    </select>
    <select bind:value={filterCategory} aria-label="Filter by category">
      <option value="">All categories</option>
      {#each TASK_CATEGORIES as c (c.value)}<option value={c.value}>{c.label}</option>{/each}
    </select>
    <select bind:value={filterPriority} aria-label="Filter by priority">
      <option value="">All priorities</option>
      {#each TASK_PRIORITIES as p (p.value)}<option value={p.value}>{p.label}</option>{/each}
    </select>
    <label class="pill-toggle" class:active={hideComplete}>
      <input type="checkbox" bind:checked={hideComplete} />
      Active only
    </label>
    {#if anyFilter}
      <button type="button" class="clear-filters" onclick={clearFilters}>Clear filters</button>
    {/if}
  </div>

  {#if visibleTasks.length === 0 && anyFilter}
    <EmptyState
      message="No tasks match this view."
      hint="Create a task or clear one or more filters."
    />
  {:else}
    <div class="columns" aria-label="Task board">
      {#each columns as col (col.status)}
        <section
          class="column bucket-{col.status}"
          aria-label={statusLabel(col.status)}
          ondragover={(e) => onDragOverColumn(e, col.status)}
          ondrop={onDrop}
          ondragleave={(e) => {
            if (e.currentTarget === e.target) dropTarget = undefined;
          }}
        >
          <header class="bucket-header">
            <div class="bucket-title">
              <span class="bucket-color" aria-hidden="true"></span>
              <span>{statusLabel(col.status)}</span>
            </div>
            <span class="count">{col.tasks.length}</span>
          </header>
          <div class="bucket-add">
            {#if addingStatus === col.status}
              <form
                class="inline-add"
                onsubmit={(e) => {
                  e.preventDefault();
                  void saveInlineTask(col.status);
                }}
              >
                <!-- svelte-ignore a11y_autofocus -->
                <input
                  type="text"
                  bind:value={newTaskTitle}
                  maxlength="200"
                  placeholder="Task name"
                  aria-label={`New ${statusLabel(col.status)} task title`}
                  autofocus
                  onkeydown={onInlineAddKeydown}
                />
                {#if quickAddError}<div class="field-error">{quickAddError}</div>{/if}
                <div class="inline-add-actions">
                  <button type="submit" class="primary">Add</button>
                  <button type="button" onclick={cancelInlineAdd}>Cancel</button>
                </div>
              </form>
            {:else}
              <button type="button" class="add-card-button" onclick={() => startInlineAdd(col.status)}>+ Add task</button>
            {/if}
          </div>
          <div class="cards">
            {#each col.tasks as task, i (task.id)}
              {#if dropTarget?.status === col.status && dropTarget.index === i && draggingId !== task.id}
                <div class="placeholder" aria-hidden="true"></div>
              {/if}
              {@const ds = dueState(task, app.today, app.settings.dueSoonDays)}
              <div
                class="task-card"
                class:dragging={draggingId === task.id}
                data-card-id={task.id}
                draggable="true"
                role="button"
                tabindex="0"
                ondragstart={(e) => onDragStart(e, task)}
                ondragend={cancelDrag}
                onclick={() => ui.openTaskDetail(task.id)}
                onkeydown={(e) => onCardKeydown(e, task)}
              >
                <div class="card-labels">
                  <span class="label-chip label-{task.category}">{categoryLabel(task.category)}</span>
                  {#each task.tags.slice(0, 2) as tag (tag)}
                    <span class="tag-chip">{tag}</span>
                  {/each}
                </div>
                <div class="card-title">{task.title}</div>
                {#if task.projectId}
                  <div class="card-context">{app.projectName(task.projectId)}</div>
                {/if}
                <div class="card-meta">
                  {#if task.priority === "high" || task.priority === "critical"}
                    <span class="badge priority-{task.priority}">{task.priority === "critical" ? "Critical" : "High"}</span>
                  {/if}
                  {#if ds === "overdue" || ds === "due_today" || ds === "due_soon"}
                    <span class="badge {ds}">{DUE_STATE_LABELS[ds]} {task.dueDate ? formatDate(task.dueDate) : ""}</span>
                  {:else if task.dueDate && task.status !== "complete"}
                    <span class="badge">{formatDate(task.dueDate)}</span>
                  {/if}
                  {#if task.status === "waiting"}
                    <span class="badge warning" title={task.waitingOn ? `Waiting on ${task.waitingOn}` : "Waiting"}>
                      Waiting {daysSinceTimestamp(task.waitingSince ?? task.updatedAt, app.today)}d
                    </span>
                  {/if}
                  {#if checklistProgress(task.id)}<span class="badge checklist-badge">{checklistProgress(task.id)}</span>{/if}
                  {#if task.sourceSystem && task.sourceSystem !== "None"}<span class="badge">{task.sourceSystem}</span>{/if}
                </div>
                <div class="card-footer">
                  {#if task.employeeId}
                    <span class="assignee">
                      <span class="avatar" aria-hidden="true">{employeeInitials(task.employeeId)}</span>
                      <span>{app.employeeName(task.employeeId)}</span>
                    </span>
                  {:else}
                    <span class="muted small">Unassigned</span>
                  {/if}
                </div>
                {#if task.status !== "complete"}
                  <div class="card-actions">
                    <button
                      type="button"
                      title="Move left"
                      aria-label="Move to previous column"
                      onclick={(e) => {
                        e.stopPropagation();
                        void moveByOffset(task, -1);
                      }}>&lt;</button
                    >
                    <button
                      type="button"
                      title="Move right"
                      aria-label="Move to next column"
                      onclick={(e) => {
                        e.stopPropagation();
                        void moveByOffset(task, 1);
                      }}>&gt;</button
                    >
                    <button
                      type="button"
                      title="Complete"
                      aria-label="Complete task"
                      onclick={(e) => {
                        e.stopPropagation();
                        void completeCard(task);
                      }}>Done</button
                    >
                  </div>
                {/if}
              </div>
            {/each}
            {#if dropTarget?.status === col.status && dropTarget.index >= col.tasks.filter((t) => t.id !== draggingId).length}
              <div class="placeholder" aria-hidden="true"></div>
            {/if}
          </div>
        </section>
      {/each}
    </div>
  {/if}
</div>

<style>
  .board-page {
    max-width: none;
    padding: 1rem 1.25rem 3.5rem;
  }
  .board-header {
    display: grid;
    grid-template-columns: minmax(13rem, 1fr) auto auto;
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
  .board-header h1 {
    font-size: 1.45rem;
    margin: 0;
  }
  .board-stats {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: .45rem;
    flex-wrap: wrap;
  }
  .board-stats span {
    display: inline-flex;
    align-items: baseline;
    gap: .3rem;
    min-height: 1.8rem;
    padding: .25rem .55rem;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--surface);
    color: var(--text-muted);
    box-shadow: 0 1px 1px rgba(16, 24, 40, .04);
    white-space: nowrap;
  }
  .board-stats strong {
    color: var(--text);
    font-size: .98rem;
  }
  .board-stats span.warn {
    background: var(--duesoon-bg);
    border-color: transparent;
    color: var(--duesoon-fg);
  }
  .board-stats span.alert {
    background: var(--overdue-bg);
    border-color: transparent;
    color: var(--overdue-fg);
  }
  .board-stats span.warn strong,
  .board-stats span.alert strong {
    color: inherit;
  }
  .board-new-task {
    white-space: nowrap;
  }
  .board-toolbar {
    display: grid;
    grid-template-columns: minmax(15rem, 1.35fr) repeat(5, minmax(8rem, .75fr)) auto auto;
    gap: .45rem;
    align-items: center;
    padding: .65rem;
    margin-bottom: .85rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: color-mix(in srgb, var(--surface) 88%, var(--bg));
    box-shadow: var(--shadow);
  }
  .search-field input,
  .board-toolbar select {
    width: 100%;
    min-height: 2.15rem;
  }
  .pill-toggle {
    display: inline-flex;
    align-items: center;
    justify-content: center;
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
  }
  .pill-toggle.active {
    border-color: color-mix(in srgb, var(--accent) 55%, var(--border));
    background: var(--accent-soft);
    color: var(--accent);
  }
  .clear-filters {
    min-height: 2.15rem;
    white-space: nowrap;
  }
  .columns {
    display: flex;
    gap: .85rem;
    align-items: flex-start;
    overflow-x: auto;
    padding: .15rem .15rem 1rem;
    min-height: calc(100vh - 15rem);
  }
  .column {
    background: var(--bucket-bg);
    border: 1px solid color-mix(in srgb, var(--border) 80%, transparent);
    border-radius: var(--radius-lg);
    min-width: 17.5rem;
    width: 17.5rem;
    flex-shrink: 0;
    max-height: calc(100vh - 15.5rem);
    display: flex;
    flex-direction: column;
    box-shadow: var(--shadow);
  }
  .bucket-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: .6rem;
    padding: .7rem .75rem .45rem;
  }
  .bucket-title {
    display: flex;
    align-items: center;
    min-width: 0;
    gap: .45rem;
    font-weight: 700;
    font-size: .92rem;
    color: var(--text);
  }
  .bucket-title span:last-child {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .bucket-color {
    width: .55rem;
    height: .55rem;
    border-radius: 999px;
    background: var(--bucket-color, var(--accent));
    flex: 0 0 auto;
  }
  .column .count {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 999px;
    padding: .05rem .45rem;
    color: var(--text-muted);
    font-size: .75rem;
    font-weight: 700;
  }
  .bucket-inbox { --bucket-color: #616161; }
  .bucket-planned { --bucket-color: #2564cf; }
  .bucket-in_progress { --bucket-color: #038387; }
  .bucket-waiting { --bucket-color: #ca5010; }
  .bucket-needs_review { --bucket-color: #8764b8; }
  .bucket-complete { --bucket-color: #107c10; }
  .bucket-add {
    padding: 0 .55rem .55rem;
  }
  .add-card-button {
    width: 100%;
    min-height: 2.15rem;
    border-style: dashed;
    background: transparent;
    color: var(--text-muted);
    font-weight: 600;
    text-align: left;
  }
  .add-card-button:hover {
    color: var(--accent);
    border-color: color-mix(in srgb, var(--accent) 60%, var(--border));
    background: var(--surface);
  }
  .inline-add {
    display: grid;
    gap: .4rem;
    padding: .45rem;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
  }
  .inline-add input {
    width: 100%;
  }
  .inline-add-actions {
    display: flex;
    gap: .35rem;
    justify-content: flex-end;
  }
  .cards {
    padding: 0 .55rem .6rem;
    overflow-y: auto;
    flex: 1;
    scrollbar-gutter: stable;
  }
  .task-card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    box-shadow: 0 1px 2px rgba(16, 24, 40, .08);
    padding: .65rem .7rem .6rem;
    margin-bottom: .55rem;
    cursor: grab;
    position: relative;
    transition:
      border-color .15s ease,
      box-shadow .15s ease,
      transform .15s ease;
  }
  .task-card:hover,
  .task-card:focus {
    border-color: color-mix(in srgb, var(--accent) 40%, var(--border));
    box-shadow: 0 4px 12px rgba(16, 24, 40, .13);
    transform: translateY(-1px);
  }
  .task-card.dragging { opacity: .4; }
  .card-labels {
    display: flex;
    flex-wrap: wrap;
    gap: .25rem;
    padding-right: 3.5rem;
    margin-bottom: .45rem;
  }
  .label-chip,
  .tag-chip {
    display: inline-flex;
    align-items: center;
    max-width: 100%;
    min-height: 1rem;
    padding: .05rem .38rem;
    border-radius: 999px;
    font-size: .68rem;
    font-weight: 700;
    line-height: 1.2;
    color: #1f1f1f;
    background: #e5e5e5;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tag-chip {
    color: var(--text-muted);
    background: var(--surface-2);
  }
  .label-project { background: #cfe4ff; }
  .label-personnel { background: #dff6dd; }
  .label-performance { background: #e9d8fd; }
  .label-training { background: #d2f4f8; }
  .label-leave { background: #ffe5d0; }
  .label-telework { background: #d6eaff; }
  .label-award { background: #fff1ba; }
  .label-timekeeping { background: #fde7e9; }
  .label-meeting { background: #e1dfdd; }
  .label-administrative { background: #e0e7ff; }
  .label-general { background: #edebe9; }
  .card-title {
    font-weight: 650;
    line-height: 1.25;
    margin-bottom: .35rem;
    padding-right: 2.8rem;
    overflow-wrap: anywhere;
  }
  .card-context {
    color: var(--text-muted);
    font-size: .78rem;
    margin-bottom: .45rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .card-meta {
    display: flex;
    flex-wrap: wrap;
    gap: .25rem;
    margin-bottom: .55rem;
  }
  .checklist-badge::before {
    content: "Checklist ";
  }
  .card-footer {
    display: flex;
    align-items: center;
    gap: .4rem;
    min-height: 1.45rem;
  }
  .assignee {
    display: inline-flex;
    align-items: center;
    gap: .35rem;
    min-width: 0;
    color: var(--text-muted);
    font-size: .78rem;
    font-weight: 600;
  }
  .assignee span:last-child {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .avatar {
    display: inline-grid;
    place-items: center;
    width: 1.4rem;
    height: 1.4rem;
    border-radius: 999px;
    background: var(--avatar-bg);
    color: var(--avatar-fg);
    font-size: .63rem;
    font-weight: 800;
    flex: 0 0 auto;
  }
  .card-actions {
    display: none;
    position: absolute;
    top: .45rem;
    right: .45rem;
    gap: .2rem;
    padding: .15rem;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: color-mix(in srgb, var(--surface) 92%, transparent);
    box-shadow: 0 2px 8px rgba(16, 24, 40, .12);
  }
  .task-card:hover .card-actions,
  .task-card:focus-within .card-actions,
  .task-card:focus .card-actions { display: flex; }
  .card-actions button {
    min-width: 1.55rem;
    min-height: 1.55rem;
    padding: 0 .38rem;
    border: none;
    border-radius: 999px;
    font-size: .72rem;
    font-weight: 700;
    background: transparent;
  }
  .card-actions button:hover {
    background: var(--surface-2);
  }
  .placeholder {
    height: 3rem;
    border: 2px dashed color-mix(in srgb, var(--accent) 70%, var(--border));
    border-radius: var(--radius);
    margin-bottom: .55rem;
    background: var(--accent-soft);
  }
  @media (max-width: 1200px) {
    .board-header {
      grid-template-columns: 1fr auto;
    }
    .board-stats {
      grid-column: 1 / -1;
      justify-content: flex-start;
      order: 3;
    }
    .board-toolbar {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
    .search-field {
      grid-column: 1 / -1;
    }
  }
  @media (max-width: 760px) {
    .board-page {
      padding-inline: .75rem;
    }
    .board-header {
      grid-template-columns: 1fr;
      align-items: stretch;
    }
    .board-stats {
      order: initial;
    }
    .board-new-task {
      width: 100%;
    }
    .board-toolbar {
      grid-template-columns: 1fr;
    }
    .columns {
      min-height: calc(100vh - 19rem);
    }
    .column {
      min-width: min(86vw, 18rem);
      width: min(86vw, 18rem);
      max-height: calc(100vh - 19.5rem);
    }
  }
</style>
