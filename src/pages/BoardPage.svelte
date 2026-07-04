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

  let anyFilter = $derived(
    Boolean(search || filterEmployee || filterCompetency || filterProject || filterCategory || filterPriority)
  );
</script>

<svelte:window onkeydown={(e) => e.key === "Escape" && cancelDrag()} />

<div class="page board-page">
  <div class="page-header">
    <h1>Board</h1>
    <span class="muted small">Drag cards, or focus a card and use [ and ] to move, C to complete, Enter to open.</span>
  </div>

  <div class="toolbar">
    <input type="search" placeholder="Search tasks" bind:value={search} aria-label="Search tasks" />
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
    <label class="check-inline"><input type="checkbox" bind:checked={hideComplete} /> Hide complete</label>
  </div>

  {#if visibleTasks.length === 0}
    <EmptyState
      message="No tasks match this view."
      hint={anyFilter ? "Create a task or clear one or more filters." : "Press N or use + New Task to capture your first task."}
    />
  {:else}
    <div class="columns">
      {#each columns as col (col.status)}
        <section
          class="column"
          aria-label={statusLabel(col.status)}
          ondragover={(e) => onDragOverColumn(e, col.status)}
          ondrop={onDrop}
          ondragleave={(e) => {
            if (e.currentTarget === e.target) dropTarget = undefined;
          }}
        >
          <header>
            <span>{statusLabel(col.status)}</span>
            <span class="count">{col.tasks.length}</span>
          </header>
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
                <div class="card-title">{task.title}</div>
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
                      ⏳ {daysSinceTimestamp(task.waitingSince ?? task.updatedAt, app.today)}d
                    </span>
                  {/if}
                  {#if task.employeeId}<span class="badge">{app.employeeName(task.employeeId)}</span>{/if}
                  {#if task.projectId}<span class="badge">{app.projectName(task.projectId)}</span>{/if}
                  <span class="badge">{categoryLabel(task.category)}</span>
                  {#if checklistProgress(task.id)}<span class="badge">☑ {checklistProgress(task.id)}</span>{/if}
                  {#if task.sourceSystem && task.sourceSystem !== "None"}<span class="badge">{task.sourceSystem}</span>{/if}
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
                      }}>◀</button
                    >
                    <button
                      type="button"
                      title="Move right"
                      aria-label="Move to next column"
                      onclick={(e) => {
                        e.stopPropagation();
                        void moveByOffset(task, 1);
                      }}>▶</button
                    >
                    <button
                      type="button"
                      title="Complete"
                      aria-label="Complete task"
                      onclick={(e) => {
                        e.stopPropagation();
                        void completeCard(task);
                      }}>✓</button
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
  .board-page { max-width: none; }
  .columns {
    display: flex;
    gap: .7rem;
    align-items: flex-start;
    overflow-x: auto;
    padding-bottom: 1rem;
  }
  .column {
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    min-width: 15rem;
    width: 15rem;
    flex-shrink: 0;
    max-height: calc(100vh - 14rem);
    display: flex;
    flex-direction: column;
  }
  .column header {
    display: flex;
    justify-content: space-between;
    padding: .5rem .7rem;
    font-weight: 700;
    font-size: .82rem;
    text-transform: uppercase;
    letter-spacing: .04em;
    color: var(--text-muted);
  }
  .column .count {
    background: var(--surface);
    border-radius: 999px;
    padding: 0 .5rem;
    font-weight: 600;
  }
  .cards { padding: 0 .45rem .5rem; overflow-y: auto; flex: 1; }
  .task-card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    box-shadow: var(--shadow);
    padding: .5rem .6rem .4rem;
    margin-bottom: .45rem;
    cursor: grab;
    position: relative;
  }
  .task-card.dragging { opacity: .4; }
  .card-title { font-weight: 600; margin-bottom: .3rem; overflow-wrap: anywhere; }
  .card-meta { display: flex; flex-wrap: wrap; gap: .25rem; }
  .card-actions {
    display: none;
    position: absolute;
    top: .25rem;
    right: .25rem;
    gap: .15rem;
  }
  .task-card:hover .card-actions,
  .task-card:focus-within .card-actions,
  .task-card:focus .card-actions { display: flex; }
  .card-actions button { padding: 0 .35rem; font-size: .75rem; }
  .placeholder {
    height: 2.4rem;
    border: 2px dashed var(--accent);
    border-radius: var(--radius);
    margin-bottom: .45rem;
    background: transparent;
  }
  .check-inline { display: flex; align-items: center; gap: .35rem; font-weight: 400; margin: 0; }
</style>
