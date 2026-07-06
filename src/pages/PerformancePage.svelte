<script lang="ts">
  // Performance inputs review (plan 12.6, 17): filters, coverage, text export.
  import { app } from "../stores/app.svelte";
  import { ui } from "../stores/ui.svelte";
  import Dialog from "../components/common/Dialog.svelte";
  import EmptyState from "../components/common/EmptyState.svelte";
  import { daysBetween, formatDate } from "../utils/dates";
  import { downloadText, backupFilename } from "../utils/download";

  let filterEmployee = $state("");
  let filterStatus = $state("");
  let filterMissing = $state("");
  let coverageOpen = $state(false);

  let inputs = $derived(
    app.performanceInputs
      .filter((p) => {
        if (p.isArchived) return false;
        if (filterEmployee && p.employeeId !== filterEmployee) return false;
        if (filterStatus && p.inputStatus !== filterStatus) return false;
        if (filterMissing === "result" && p.result) return false;
        return true;
      })
      .sort((a, b) => (a.inputDate < b.inputDate ? 1 : -1))
  );

  let byEmployee = $derived.by(() => {
    const groups = new Map<string, typeof inputs>();
    for (const p of inputs) {
      const list = groups.get(p.employeeId) ?? [];
      list.push(p);
      groups.set(p.employeeId, list);
    }
    return [...groups.entries()]
      .map(([employeeId, list]) => ({ employeeId, name: app.employeeName(employeeId), list }))
      .sort((a, b) => a.name.localeCompare(b.name));
  });

  // Coverage indicator (plan 17.6) — informational, never a ranking.
  let coverage = $derived(
    app.activeEmployees
      .map((e) => {
        const list = app.performanceInputs.filter((p) => p.employeeId === e.id && !p.isArchived);
        const last = list.map((p) => p.inputDate).sort().at(-1);
        return {
          e,
          count: list.length,
          last,
          age: last ? daysBetween(last, app.today) : undefined,
          missingResult: list.filter((p) => !p.result).length
        };
      })
      .sort((a, b) => a.e.displayName.localeCompare(b.e.displayName))
  );

  function exportText() {
    const lines: string[] = ["RADAR - PERFORMANCE INPUT EXPORT", `Generated: ${formatDate(app.today)}`, ""];
    for (const group of byEmployee) {
      lines.push("=".repeat(60), group.name.toUpperCase(), "=".repeat(60), "");
      for (const p of group.list) {
        lines.push(`Date: ${formatDate(p.inputDate)}`);
        if (p.projectId) lines.push(`Project: ${app.projectName(p.projectId)}`);
        if (p.situationOrContext) lines.push(`Context: ${p.situationOrContext}`);
        lines.push(`Action: ${p.actionOrAccomplishment}`);
        if (p.result) lines.push(`Result / Impact: ${p.result}`);
        lines.push(`Status: ${p.inputStatus}`, "");
      }
    }
    downloadText(backupFilename("RADAR_Performance", "txt"), lines.join("\r\n"), "text/plain");
  }

  async function setStatus(id: string, inputStatus: string) {
    const p = app.performanceInputs.find((x) => x.id === id);
    if (!p) return;
    await app.putRecord("performanceInputs", {
      ...p,
      inputStatus: inputStatus as typeof p.inputStatus,
      updatedAt: new Date().toISOString()
    });
  }
</script>

<div class="page">
  <div class="page-header">
    <h1>Performance</h1>
    <span class="muted">{inputs.length} inputs shown</span>
  </div>

  <div class="toolbar">
    <select bind:value={filterEmployee} aria-label="Filter by employee">
      <option value="">All employees</option>
      {#each app.activeEmployees as e (e.id)}<option value={e.id}>{e.displayName}</option>{/each}
    </select>
    <select bind:value={filterStatus} aria-label="Filter by status">
      <option value="">All statuses</option>
      {#each ["draft", "ready", "used_midyear", "used_annual", "archived"] as s (s)}
        <option value={s}>{s.replace("_", " ")}</option>
      {/each}
    </select>
    <select bind:value={filterMissing} aria-label="Filter by missing detail">
      <option value="">All inputs</option>
      <option value="result">Missing result / impact</option>
    </select>
    <span class="spacer"></span>
    <button type="button" onclick={exportText} disabled={inputs.length === 0}>Export text</button>
    <button type="button" onclick={() => (coverageOpen = true)}>Coverage</button>
    <button type="button" class="primary" onclick={() => (ui.performanceFormPrefill = { employeeId: filterEmployee || undefined })}>
      New Performance Input
    </button>
  </div>

  <h2>Inputs by employee</h2>
  {#if byEmployee.length === 0}
    <EmptyState message="No performance inputs match." hint="Capture accomplishments with New Performance Input, or convert completed tasks." />
  {:else}
    {#each byEmployee as group (group.employeeId)}
      <h3 style="margin-top:1rem">{group.name} <span class="muted small">({group.list.length})</span></h3>
      {#each group.list as p (p.id)}
        <div class="card" style="margin-bottom:.5rem">
          <div class="small muted" style="display:flex; gap:.6rem; align-items:center; flex-wrap:wrap">
            <span>{formatDate(p.inputDate)}</span>
            {#if p.projectId}<span>· {app.projectName(p.projectId)}</span>{/if}
            {#if p.recognitionPotential}<span class="badge success">Recognition potential</span>{/if}
            <span class="spacer" style="flex:1"></span>
            <button type="button" onclick={() => (ui.performanceFormInput = p)}>Edit</button>
            <label style="margin:0; font-weight:400" class="small">
              Status:
              <select value={p.inputStatus} onchange={(e) => void setStatus(p.id, (e.currentTarget as HTMLSelectElement).value)}>
                {#each ["draft", "ready", "used_midyear", "used_annual", "archived"] as s (s)}
                  <option value={s}>{s.replace("_", " ")}</option>
                {/each}
              </select>
            </label>
          </div>
          {#if p.situationOrContext}<div><strong>Context:</strong> {p.situationOrContext}</div>{/if}
          <div><strong>Action:</strong> {p.actionOrAccomplishment}</div>
          {#if p.result}<div><strong>Result / Impact:</strong> {p.result}</div>{:else}<div class="muted small">Result / impact not recorded.</div>{/if}
        </div>
      {/each}
    {/each}
  {/if}
</div>

{#if coverageOpen}
  <Dialog title="Performance Coverage" wide onclose={() => (coverageOpen = false)}>
    <table class="data">
      <thead><tr><th>Employee</th><th>Inputs</th><th>Most recent</th><th>Missing result / impact</th></tr></thead>
      <tbody>
        {#each coverage as c (c.e.id)}
          <tr>
            <td>{c.e.displayName}</td>
            <td>{c.count}</td>
            <td>
              {#if c.last}
                {formatDate(c.last)}
                {#if c.age !== undefined && c.age >= app.settings.performanceInputReminderDays}
                  <span class="badge warning">{c.age}d ago</span>
                {/if}
              {:else}
                <span class="badge warning">none</span>
              {/if}
            </td>
            <td>{c.missingResult}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </Dialog>
{/if}
