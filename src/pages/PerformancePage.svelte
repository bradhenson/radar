<script lang="ts">
  import { app } from "../stores/app.svelte";
  import { ui } from "../stores/ui.svelte";
  import EmptyState from "../components/common/EmptyState.svelte";
  import RichTextView from "../components/common/RichTextView.svelte";
  import { daysBetween, formatDate } from "../utils/dates";
  import { downloadText, backupFilename } from "../utils/download";
  import { richTextToPlainText } from "../utils/richText";

  type ViewMode = "inputs" | "employees" | "coverage";
  type SortMode = "newest" | "oldest" | "employee";

  let viewMode = $state<ViewMode>("inputs");
  let search = $state("");
  let filterEmployee = $state("");
  let filterStatus = $state("");
  let filterMissing = $state("");
  let sortMode = $state<SortMode>("newest");
  let selectedId = $state("");

  function includes(value: string | undefined, needle: string): boolean {
    return Boolean(value?.toLowerCase().includes(needle));
  }

  function statusText(value: string): string {
    return value.replaceAll("_", " ");
  }

  // List rows are single-line summaries, so flatten any rich-text formatting
  // to plain text rather than showing raw markers. The detail panel renders
  // the full formatting via RichTextView.
  function summaryText(value: string | undefined): string {
    return richTextToPlainText(value).replace(/\s*\n\s*/g, " ");
  }

  let inputs = $derived.by(() => {
    const needle = search.trim().toLowerCase();
    return app.performanceInputs
      .filter((p) => {
        if (p.isArchived) return false;
        if (filterEmployee && p.employeeId !== filterEmployee) return false;
        if (filterStatus && p.inputStatus !== filterStatus) return false;
        if (filterMissing === "result" && p.result) return false;
        if (!needle) return true;
        return (
          includes(app.employeeName(p.employeeId), needle) ||
          includes(app.projectName(p.projectId), needle) ||
          includes(richTextToPlainText(p.situationOrContext), needle) ||
          includes(richTextToPlainText(p.actionOrAccomplishment), needle) ||
          includes(richTextToPlainText(p.result), needle)
        );
      })
      .sort((a, b) => {
        if (sortMode === "employee") {
          const employee = app.employeeName(a.employeeId).localeCompare(app.employeeName(b.employeeId));
          if (employee !== 0) return employee;
        }
        const date = a.inputDate.localeCompare(b.inputDate);
        return sortMode === "oldest" ? date : -date;
      });
  });

  let byEmployee = $derived.by(() => {
    const groups = new Map<string, typeof inputs>();
    for (const input of inputs) {
      const list = groups.get(input.employeeId) ?? [];
      list.push(input);
      groups.set(input.employeeId, list);
    }
    return [...groups.entries()]
      .map(([employeeId, list]) => ({ employeeId, name: app.employeeName(employeeId), list }))
      .sort((a, b) => a.name.localeCompare(b.name));
  });

  let selectedInput = $derived(inputs.find((input) => input.id === selectedId) ?? inputs[0]);

  // Coverage is informational and never an employee ranking.
  let coverage = $derived.by(() => {
    const needle = search.trim().toLowerCase();
    return app.activeEmployees
      .filter((employee) => !filterEmployee || employee.id === filterEmployee)
      .filter((employee) => !needle || employee.displayName.toLowerCase().includes(needle))
      .map((employee) => {
        const list = app.performanceInputs.filter((p) => p.employeeId === employee.id && !p.isArchived);
        const last = list.map((p) => p.inputDate).sort().at(-1);
        return {
          employee,
          count: list.length,
          last,
          age: last ? daysBetween(last, app.today) : undefined,
          missingResult: list.filter((p) => !p.result).length
        };
      })
      .sort((a, b) => a.employee.displayName.localeCompare(b.employee.displayName));
  });

  async function exportText() {
    const lines: string[] = ["RADAR - PERFORMANCE INPUT EXPORT", `Generated: ${formatDate(app.today)}`, ""];
    for (const group of byEmployee) {
      lines.push("=".repeat(60), group.name.toUpperCase(), "=".repeat(60), "");
      for (const p of group.list) {
        lines.push(`Date: ${formatDate(p.inputDate)}`);
        if (p.projectId) lines.push(`Project: ${app.projectName(p.projectId)}`);
        if (p.situationOrContext) lines.push(`Context: ${richTextToPlainText(p.situationOrContext)}`);
        lines.push(`Action: ${richTextToPlainText(p.actionOrAccomplishment)}`);
        if (p.result) lines.push(`Result / Impact: ${richTextToPlainText(p.result)}`);
        lines.push(`Status: ${p.inputStatus}`, "");
      }
    }
    try {
      await downloadText(backupFilename("RADAR_Performance", "txt"), lines.join("\r\n"), "text/plain");
    } catch {
      app.toast("Performance export failed", "error");
    }
  }

  async function setStatus(id: string, inputStatus: string) {
    const input = app.performanceInputs.find((item) => item.id === id);
    if (!input) return;
    await app.putRecord("performanceInputs", {
      ...input,
      inputStatus: inputStatus as typeof input.inputStatus,
      updatedAt: new Date().toISOString()
    });
  }
</script>

<div class="page">
  <div class="page-header">
    <h1>Performance</h1>
    <span class="muted">{viewMode === "coverage" ? `${coverage.length} employees shown` : `${inputs.length} inputs shown`}</span>
    <span class="spacer"></span>
    <button type="button" onclick={exportText} disabled={inputs.length === 0}>Export text</button>
    <button type="button" class="primary" onclick={() => (ui.performanceFormPrefill = { employeeId: filterEmployee || undefined })}>
      New Performance Input
    </button>
  </div>

  <div class="view-tabs" aria-label="Performance view">
    <button type="button" class:active={viewMode === "inputs"} aria-pressed={viewMode === "inputs"} onclick={() => (viewMode = "inputs")}>All Inputs</button>
    <button type="button" class:active={viewMode === "employees"} aria-pressed={viewMode === "employees"} onclick={() => (viewMode = "employees")}>By Employee</button>
    <button type="button" class:active={viewMode === "coverage"} aria-pressed={viewMode === "coverage"} onclick={() => (viewMode = "coverage")}>Coverage</button>
  </div>

  <div class="toolbar filter-toolbar">
    <input type="search" bind:value={search} placeholder={viewMode === "coverage" ? "Search employees" : "Search inputs"} aria-label="Search performance" />
    <select bind:value={filterEmployee} aria-label="Filter by employee">
      <option value="">All employees</option>
      {#each app.activeEmployees as employee (employee.id)}<option value={employee.id}>{employee.displayName}</option>{/each}
    </select>
    {#if viewMode !== "coverage"}
      <select bind:value={filterStatus} aria-label="Filter by status">
        <option value="">All statuses</option>
        {#each ["draft", "ready", "used_midyear", "used_annual", "archived"] as status (status)}
          <option value={status}>{statusText(status)}</option>
        {/each}
      </select>
      <select bind:value={filterMissing} aria-label="Filter by missing detail">
        <option value="">All inputs</option>
        <option value="result">Missing result / impact</option>
      </select>
      <select bind:value={sortMode} aria-label="Sort performance inputs">
        <option value="newest">Newest first</option>
        <option value="oldest">Oldest first</option>
        <option value="employee">Employee name</option>
      </select>
    {/if}
  </div>

  {#if viewMode === "coverage"}
    {#if coverage.length === 0}
      <EmptyState message="No employees match." hint="Clear the employee filter or search to review coverage." />
    {:else}
      <div class="coverage-wrap">
        <table class="data coverage-table">
          <thead><tr><th>Employee</th><th>Inputs</th><th>Most recent</th><th>Missing result / impact</th><th></th></tr></thead>
          <tbody>
            {#each coverage as row (row.employee.id)}
              <tr>
                <td><strong>{row.employee.displayName}</strong></td>
                <td>{row.count}</td>
                <td>
                  {#if row.last}
                    {formatDate(row.last)}
                    {#if row.age !== undefined && row.age >= app.settings.performanceInputReminderDays}
                      <span class="badge warning">{row.age}d ago</span>
                    {/if}
                  {:else}<span class="badge warning">none</span>{/if}
                </td>
                <td>{row.missingResult}</td>
                <td>
                  {#if row.count > 0}
                    <button type="button" onclick={() => { filterEmployee = row.employee.id; viewMode = "employees"; }}>View inputs</button>
                  {:else}
                    <button type="button" onclick={() => (ui.performanceFormPrefill = { employeeId: row.employee.id })}>Add input</button>
                  {/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  {:else if inputs.length === 0}
    <EmptyState message="No performance inputs match." hint="Capture accomplishments with New Performance Input, or adjust the filters." />
  {:else}
    <div class="performance-workspace">
      <section class="card input-list-panel" aria-label="Performance input list">
        <div class="panel-heading">
          <h2>{viewMode === "employees" ? "Inputs by employee" : "Inputs"}</h2>
          <span class="small muted">{inputs.length} total</span>
        </div>
        <div class="input-list">
          {#if viewMode === "employees"}
            {#each byEmployee as group (group.employeeId)}
              <div class="employee-group-label">{group.name} <span>({group.list.length})</span></div>
              {#each group.list as input (input.id)}
                <button type="button" class="input-list-item" class:active={selectedInput?.id === input.id} aria-pressed={selectedInput?.id === input.id} onclick={() => (selectedId = input.id)}>
                  <span class="input-row-meta"><span>{formatDate(input.inputDate)}</span><span class="badge">{statusText(input.inputStatus)}</span></span>
                  <strong>{summaryText(input.actionOrAccomplishment)}</strong>
                  <span class="input-context">{app.projectName(input.projectId) || (input.result ? "Result recorded" : "Result / impact missing")}</span>
                </button>
              {/each}
            {/each}
          {:else}
            {#each inputs as input (input.id)}
              <button type="button" class="input-list-item" class:active={selectedInput?.id === input.id} aria-pressed={selectedInput?.id === input.id} onclick={() => (selectedId = input.id)}>
                <span class="input-row-meta"><span>{formatDate(input.inputDate)}</span><span>{app.employeeName(input.employeeId)}</span><span class="badge">{statusText(input.inputStatus)}</span></span>
                <strong>{summaryText(input.actionOrAccomplishment)}</strong>
                <span class="input-context">{app.projectName(input.projectId) || (input.result ? "Result recorded" : "Result / impact missing")}</span>
              </button>
            {/each}
          {/if}
        </div>
      </section>

      {#if selectedInput}
        <article class="card input-detail" aria-label={`Performance input for ${app.employeeName(selectedInput.employeeId)}`}>
          <div class="detail-actions"><button type="button" onclick={() => (ui.performanceFormInput = selectedInput)}>Edit input</button></div>
          <div class="detail-kicker">
            <span>{formatDate(selectedInput.inputDate)}</span>
            {#if selectedInput.projectId}<span>· {app.projectName(selectedInput.projectId)}</span>{/if}
            {#if selectedInput.recognitionPotential}<span class="badge success">Recognition potential</span>{/if}
          </div>
          <h2 class="detail-title">{app.employeeName(selectedInput.employeeId)}</h2>
          <label class="status-control">
            Status
            <select value={selectedInput.inputStatus} onchange={(event) => void setStatus(selectedInput.id, (event.currentTarget as HTMLSelectElement).value)}>
              {#each ["draft", "ready", "used_midyear", "used_annual", "archived"] as status (status)}
                <option value={status}>{statusText(status)}</option>
              {/each}
            </select>
          </label>
          <div class="input-sections">
            <section>
              <h3>Context</h3>
              <RichTextView value={selectedInput.situationOrContext} emptyText="No context recorded." />
            </section>
            <section>
              <h3>Action / Accomplishment</h3>
              <RichTextView value={selectedInput.actionOrAccomplishment} />
            </section>
            <section class:missing={!selectedInput.result}>
              <h3>Result / Impact</h3>
              <RichTextView value={selectedInput.result} emptyText="Result / impact not recorded." />
            </section>
          </div>
        </article>
      {/if}
    </div>
  {/if}
</div>

<style>
  .view-tabs { display: inline-flex; gap: .25rem; padding: .25rem; margin-bottom: .8rem; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); }
  .view-tabs button { min-height: 1.9rem; border: 0; background: transparent; color: var(--text-muted); }
  .view-tabs button.active { background: var(--accent-soft); color: var(--accent); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 35%, transparent); }
  .filter-toolbar { position: sticky; top: 0; z-index: 3; padding: .5rem 0; background: var(--bg); }
  .filter-toolbar input[type="search"] { min-width: 15rem; flex: 1; }
  .performance-workspace { display: grid; grid-template-columns: minmax(21rem, 29rem) minmax(0, 1fr); gap: 1rem; align-items: start; }
  .input-list-panel { padding: 0; overflow: hidden; }
  .panel-heading { display: flex; align-items: baseline; justify-content: space-between; gap: 1rem; padding: .85rem 1rem; border-bottom: 1px solid var(--border); }
  .panel-heading h2 { margin: 0; }
  .input-list { display: grid; max-height: calc(100vh - 15rem); min-height: 28rem; overflow: auto; }
  .employee-group-label { position: sticky; top: 0; z-index: 1; padding: .45rem 1rem; border-bottom: 1px solid var(--border); background: var(--surface-2); color: var(--text-muted); font-size: .75rem; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; }
  .employee-group-label span { font-weight: 500; }
  .input-list-item { display: grid; gap: .25rem; width: 100%; min-height: 0; padding: .7rem 1rem; text-align: left; border: 0; border-bottom: 1px solid var(--border); border-radius: 0; background: transparent; }
  .input-list-item:hover { background: color-mix(in srgb, var(--accent-soft) 38%, transparent); }
  .input-list-item.active { background: var(--accent-soft); box-shadow: inset 3px 0 0 var(--accent); }
  .input-list-item strong { display: -webkit-box; overflow: hidden; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2; line-height: 1.35; }
  .input-row-meta { display: flex; align-items: center; gap: .45rem; color: var(--text-muted); font-size: .75rem; }
  .input-row-meta .badge { margin-left: auto; }
  .input-context { overflow: hidden; color: var(--text-muted); font-size: .77rem; text-overflow: ellipsis; white-space: nowrap; }
  .input-detail { position: sticky; top: 4rem; display: grid; gap: .8rem; min-height: 30rem; }
  .detail-actions { display: flex; justify-content: flex-end; }
  .detail-actions button { font-size: .78rem; }
  .detail-kicker { display: flex; align-items: center; flex-wrap: wrap; gap: .45rem; color: var(--text-muted); font-size: .82rem; }
  .detail-title { margin: -.15rem 0 0; font-size: 1.35rem; }
  .status-control { display: flex; align-items: center; gap: .6rem; margin: 0; padding-bottom: .8rem; border-bottom: 1px solid var(--border); color: var(--text-muted); }
  .status-control select { min-width: 10rem; }
  .input-sections { display: grid; gap: .8rem; }
  .input-sections section { padding: .9rem; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface-2); white-space: pre-wrap; }
  .input-sections section.missing { border-left: 3px solid var(--warning); }
  .input-sections h3 { margin: 0 0 .25rem; color: var(--text-muted); font-size: .78rem; text-transform: uppercase; letter-spacing: .05em; }
  .coverage-wrap { overflow-x: auto; }
  .coverage-table td:last-child { text-align: right; }
  .coverage-table td:last-child button { white-space: nowrap; }
  @media (max-width: 950px) {
    .performance-workspace { grid-template-columns: 1fr; }
    .input-list { max-height: 22rem; min-height: 0; }
    .input-detail { position: static; min-height: 0; }
  }
</style>
