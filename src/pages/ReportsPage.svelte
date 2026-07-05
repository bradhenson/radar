<script lang="ts">
  // Interactive report views (plan 12.11, 32) with CSV export for tasks.
  import { app } from "../stores/app.svelte";
  import { statusLabel } from "../domain/models";
  import { addDays, compareDates, formatDate } from "../utils/dates";
  import { toCsv } from "../utils/csv";
  import { backupFilename, downloadText } from "../utils/download";

  let openTasks = $derived(
    app.tasks.filter((t) => !t.isArchived && t.status !== "complete" && t.status !== "cancelled")
  );

  let overdueByEmployee = $derived.by(() => {
    const counts = new Map<string, number>();
    for (const t of openTasks) {
      if (t.dueDate && compareDates(t.dueDate, app.today) < 0) {
        const key = t.employeeId ?? "";
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
    return [...counts.entries()]
      .map(([id, count]) => ({ name: id ? app.employeeName(id) : "(unassigned)", count }))
      .sort((a, b) => b.count - a.count);
  });

  let byCategory = $derived.by(() => {
    const counts = new Map<string, number>();
    for (const task of openTasks) counts.set(task.category, (counts.get(task.category) ?? 0) + 1);
    return [...counts.entries()]
      .map(([id, count]) => ({ id, label: app.taskCategoryLabel(id), count }))
      .sort((a, b) => a.label.localeCompare(b.label));
  });

  let trainingWindows = $derived.by(() => {
    return [30, 60, 90].map((days) => {
      const horizon = addDays(app.today, days);
      const due = app.employeeTrainingRecords.filter((r) => {
        if (["not_applicable", "waived"].includes(r.status)) return false;
        const d = r.status === "complete" ? r.expirationDate : r.dueDate;
        return Boolean(d && d >= app.today && d <= horizon);
      });
      return { days, count: due.length };
    });
  });

  let unverified = $derived.by(() => {
    const stale = addDays(app.today, -60);
    const results: { kind: string; label: string; verified?: string }[] = [];
    for (const l of app.leaveRecords) {
      if (["cancelled", "complete"].includes(l.status)) continue;
      if (!l.lastVerifiedDate || l.lastVerifiedDate < stale)
        results.push({ kind: "Leave", label: `${app.employeeName(l.employeeId)} ${formatDate(l.startDate)}`, verified: l.lastVerifiedDate });
    }
    for (const t of app.teleworkRecords) {
      if (["expired", "denied", "cancelled"].includes(t.status)) continue;
      if (!t.lastVerifiedDate || t.lastVerifiedDate < stale)
        results.push({ kind: "Telework", label: `${t.recordType} — ${app.employeeName(t.employeeId)}`, verified: t.lastVerifiedDate });
    }
    for (const r of app.employeeTrainingRecords) {
      if (["not_applicable", "waived"].includes(r.status)) continue;
      if (!r.lastVerifiedDate || r.lastVerifiedDate < stale) {
        const req = app.trainingRequirements.find((q) => q.id === r.trainingRequirementId);
        results.push({ kind: "Training", label: `${req?.name ?? "Training"} — ${app.employeeName(r.employeeId)}`, verified: r.lastVerifiedDate });
      }
    }
    return results;
  });

  function exportTaskCsv() {
    const csv = toCsv(
      ["Task ID", "Title", "Status", "Priority", "Category", "Employee", "Competency", "Project", "Created", "Due", "Completed", "Last verified", "Tags"],
      app.tasks.map((t) => [
        t.id,
        t.title,
        statusLabel(t.status),
        t.priority,
        app.taskCategoryLabel(t.category),
        app.employeeName(t.employeeId),
        app.competencyCode(t.competencyId),
        app.projectName(t.projectId),
        t.createdAt.slice(0, 10),
        t.dueDate,
        t.completedDate,
        t.lastVerifiedDate,
        t.tags.join("; ")
      ])
    );
    downloadText(backupFilename("SupervisorAssistant_Tasks", "csv"), csv, "text/csv");
  }
</script>

<div class="page">
  <div class="page-header">
    <h1>Reports</h1>
    <span class="spacer" style="flex:1"></span>
    <button type="button" onclick={exportTaskCsv}>Export all tasks (CSV)</button>
  </div>

  <div class="report-grid">
    <section class="card">
      <h2>Overdue tasks by employee</h2>
      {#if overdueByEmployee.length === 0}
        <p class="muted">No overdue tasks.</p>
      {:else}
        <table class="data">
          <tbody>
            {#each overdueByEmployee as r, i (i)}<tr><td>{r.name}</td><td>{r.count}</td></tr>{/each}
          </tbody>
        </table>
      {/if}
    </section>

    <section class="card">
      <h2>Open tasks by category</h2>
      {#if byCategory.length === 0}
        <p class="muted">No open tasks.</p>
      {:else}
        <table class="data">
          <tbody>
            {#each byCategory as r (r.label)}<tr><td>{r.label}</td><td>{r.count}</td></tr>{/each}
          </tbody>
        </table>
      {/if}
    </section>

    <section class="card">
      <h2>Training due</h2>
      <table class="data">
        <tbody>
          {#each trainingWindows as w (w.days)}<tr><td>Next {w.days} days</td><td>{w.count}</td></tr>{/each}
        </tbody>
      </table>
    </section>

    <section class="card">
      <h2>Verification needed <span class="muted small">(never verified or &gt;60 days)</span></h2>
      {#if unverified.length === 0}
        <p class="muted">All tracked records recently verified.</p>
      {:else}
        <table class="data">
          <tbody>
            {#each unverified.slice(0, 20) as r, i (i)}
              <tr><td><span class="badge">{r.kind}</span></td><td>{r.label}</td><td>{r.verified ? formatDate(r.verified) : "never"}</td></tr>
            {/each}
          </tbody>
        </table>
        {#if unverified.length > 20}<p class="muted small">…and {unverified.length - 20} more.</p>{/if}
      {/if}
    </section>
  </div>
</div>

<style>
  .report-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
  @media (max-width: 1000px) { .report-grid { grid-template-columns: 1fr; } }
</style>
