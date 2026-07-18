<script lang="ts">
  import { app } from "../stores/app.svelte";
  import { ui } from "../stores/ui.svelte";
  import { router } from "../app/router.svelte";
  import EmptyState from "../components/common/EmptyState.svelte";
  import Icon from "../components/common/Icon.svelte";
  import RichTextView from "../components/common/RichTextView.svelte";
  import type { PerformanceInput } from "../domain/models";
  import { daysBetween, formatDate } from "../utils/dates";
  import { downloadText, backupFilename } from "../utils/download";
  import { richTextToPlainText } from "../utils/richText";

  type ViewMode = "inputs" | "employees" | "coverage";
  type SortMode = "newest" | "oldest" | "employee";

  const INPUT_STATUSES = ["draft", "ready", "used_midyear", "used_annual", "archived"];

  let viewMode = $state<ViewMode>("inputs");
  let search = $state("");
  let filterEmployee = $state("");
  let filterStatus = $state("");
  let filterMissing = $state("");
  let sortMode = $state<SortMode>("newest");
  let expanded = $state<Record<string, boolean>>({});

  function includes(value: string | undefined, needle: string): boolean {
    return Boolean(value?.toLowerCase().includes(needle));
  }

  function statusText(value: string): string {
    return value.replaceAll("_", " ");
  }

  // Table rows are short summaries, so flatten any rich-text formatting to
  // plain text rather than showing raw markers. The expanded detail renders
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

  function toggleRow(id: string) {
    expanded[id] = !expanded[id];
  }

  // Deep link (global search): #/performance/<id> switches to All Inputs,
  // clears the filters, expands that input, and scrolls to it. One-shot.
  $effect(() => {
    const id = router.current.param;
    if (!id || !app.performanceInputs.some((p) => p.id === id && !p.isArchived)) return;
    viewMode = "inputs";
    search = "";
    filterEmployee = "";
    filterStatus = "";
    filterMissing = "";
    expanded[id] = true;
    router.go("performance");
    requestAnimationFrame(() => {
      document.getElementById(`input-row-${id}`)?.scrollIntoView({ block: "center" });
    });
  });

  function toggleFromRow(id: string) {
    // Don't hijack a click the user made to select and copy text.
    if (window.getSelection()?.toString()) return;
    toggleRow(id);
  }

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

{#snippet inputRow(input: PerformanceInput, showEmployee: boolean)}
  {@const open = Boolean(expanded[input.id])}
  <!-- Row click toggles the inline detail; the chevron is the keyboard control. -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <tr class="row-clickable" class:row-open={open} id={"input-row-" + input.id} onclick={() => toggleFromRow(input.id)}>
    <td class="date-cell">
      <button
        type="button"
        class="disclosure"
        class:open
        aria-expanded={open}
        aria-label={open ? `Hide performance input details` : `Show performance input details`}
        onclick={(ev) => {
          ev.stopPropagation();
          toggleRow(input.id);
        }}><Icon name="chevron" size={13} /></button>
      {formatDate(input.inputDate)}
    </td>
    {#if showEmployee}
      <td class="employee-cell">{app.employeeName(input.employeeId)}</td>
    {/if}
    <td class="summary-cell"><span class="clamp2">{summaryText(input.actionOrAccomplishment)}</span></td>
    <td>{#if input.projectId}{app.projectName(input.projectId)}{:else}<span class="muted">—</span>{/if}</td>
    <td>{#if input.result}<span class="muted">Yes</span>{:else}<span class="badge warning">Missing</span>{/if}</td>
    <td><span class="badge">{statusText(input.inputStatus)}</span></td>
  </tr>
  {#if open}
    <tr class="detail-row">
      <td colspan={showEmployee ? 6 : 5}>
        <div class="detail" aria-label={`Performance input for ${app.employeeName(input.employeeId)}`}>
          {#if input.recognitionPotential}
            <div><span class="badge success">Recognition potential</span></div>
          {/if}
          <div class="input-sections">
            <section>
              <h3>Context</h3>
              <RichTextView value={input.situationOrContext} emptyText="No context recorded." />
            </section>
            <section>
              <h3>Action / Accomplishment</h3>
              <RichTextView value={input.actionOrAccomplishment} />
            </section>
            <section class:missing={!input.result}>
              <h3>Result / Impact</h3>
              <RichTextView value={input.result} emptyText="Result / impact not recorded." />
            </section>
          </div>
          <div class="detail-footer">
            <label class="status-control">
              Status
              <select value={input.inputStatus} onchange={(event) => void setStatus(input.id, (event.currentTarget as HTMLSelectElement).value)}>
                {#each INPUT_STATUSES as status (status)}
                  <option value={status}>{statusText(status)}</option>
                {/each}
              </select>
            </label>
            <span class="spacer"></span>
            <button type="button" onclick={() => (ui.performanceFormInput = input)}>Edit input</button>
          </div>
        </div>
      </td>
    </tr>
  {/if}
{/snippet}

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
        {#each INPUT_STATUSES as status (status)}
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
      <div class="table-wrap">
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
    <div class="table-wrap">
      <table class="data input-table">
        <thead>
          <tr>
            <th>Date</th>
            {#if viewMode === "inputs"}<th>Employee</th>{/if}
            <th>Action / Accomplishment</th>
            <th>Project</th>
            <th>Result</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {#if viewMode === "employees"}
            {#each byEmployee as group (group.employeeId)}
              <tr class="group-row"><td colspan="5">{group.name} <span>({group.list.length})</span></td></tr>
              {#each group.list as input (input.id)}
                {@render inputRow(input, false)}
              {/each}
            {/each}
          {:else}
            {#each inputs as input (input.id)}
              {@render inputRow(input, true)}
            {/each}
          {/if}
        </tbody>
      </table>
    </div>
  {/if}
</div>

<style>
  .view-tabs { display: inline-flex; gap: .25rem; padding: .25rem; margin-bottom: .8rem; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); }
  .view-tabs button { min-height: 1.9rem; border: 0; background: transparent; color: var(--text-muted); }
  .view-tabs button.active { background: var(--accent-soft); color: var(--accent); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 35%, transparent); }
  .filter-toolbar { position: sticky; top: 0; z-index: 3; padding: .5rem 0; background: var(--bg); }
  .filter-toolbar input[type="search"] { min-width: 15rem; flex: 1; }
  .employee-cell { white-space: nowrap; }
  .summary-cell { min-width: 16rem; }
  .summary-cell .clamp2 {
    display: -webkit-box;
    overflow: hidden;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    line-height: 1.35;
  }
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
  .input-table tbody .group-row:hover td:first-child { box-shadow: none; }
  .input-sections {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));
    gap: .8rem;
  }
  .input-sections section { padding: .9rem; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); white-space: pre-wrap; }
  .input-sections section.missing { border-left: 3px solid var(--warning); }
  .input-sections h3 { margin: 0 0 .25rem; color: var(--text-muted); font-size: .78rem; text-transform: uppercase; letter-spacing: .05em; }
  .status-control { display: flex; align-items: center; gap: .6rem; margin: 0; color: var(--text-muted); }
  .status-control select { min-width: 10rem; }
  .coverage-table td:last-child { text-align: right; }
  .coverage-table td:last-child button { white-space: nowrap; }
</style>
