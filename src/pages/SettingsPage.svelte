<script lang="ts">
  // Settings, backup/restore, data maintenance (plan 12.13, 26, 31).
  import { app } from "../stores/app.svelte";
  import Dialog from "../components/common/Dialog.svelte";
  import ConfirmDialog from "../components/common/ConfirmDialog.svelte";
  import { APPLICATION_VERSION, parseAndValidateBackup, type BackupValidationResult } from "../data/backup";
  import { backupFilename, downloadJson } from "../utils/download";
  import { formatTimestamp } from "../utils/dates";

  let importResult = $state<BackupValidationResult | undefined>(undefined);
  let importFileName = $state("");
  let confirmReplace = $state(false);
  let confirmReset = $state(false);
  let confirmSample = $state(false);
  let fileInput: HTMLInputElement | undefined = $state();

  // Local editable copy of settings; saved on change.
  async function updateSetting<K extends keyof typeof app.settings>(key: K, value: (typeof app.settings)[K]) {
    await app.saveSettings({ ...app.settings, [key]: value });
  }

  function numberInput(key: keyof typeof app.settings) {
    return (e: Event) => {
      const v = parseInt((e.currentTarget as HTMLInputElement).value, 10);
      if (Number.isFinite(v) && v >= 0) void updateSetting(key, v as never);
    };
  }

  async function exportBackup() {
    try {
      const pkg = await app.buildBackup();
      downloadJson(backupFilename("SupervisorAssistant_Backup", "json"), pkg);
      app.toast("Backup exported", "success");
    } catch (e) {
      app.toast(`Backup failed: ${e instanceof Error ? e.message : String(e)}`, "error");
    }
  }

  function onImportFile(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    importFileName = file.name;
    const reader = new FileReader();
    reader.onload = () => {
      importResult = parseAndValidateBackup(String(reader.result));
    };
    reader.onerror = () => {
      app.toast("Could not read the selected file", "error");
    };
    reader.readAsText(file);
    input.value = "";
  }

  async function doReplace() {
    if (!importResult?.package) return;
    try {
      await app.replaceDatabase(importResult.package);
      app.toast("Database replaced from backup", "success");
      importResult = undefined;
      confirmReplace = false;
    } catch (e) {
      app.toast(`Import failed: ${e instanceof Error ? e.message : String(e)}`, "error");
    }
  }

  async function backupThenReplace() {
    await exportBackup();
    confirmReplace = true;
  }

  let counts = $derived(app.recordCounts());

  // Health check (plan 26.6).
  let health = $derived.by(() => {
    const empIds = new Set(app.employees.map((e) => e.id));
    const projIds = new Set(app.projects.map((p) => p.id));
    const taskIds = new Set(app.tasks.map((t) => t.id));
    return {
      orphanTaskEmployee: app.tasks.filter((t) => t.employeeId && !empIds.has(t.employeeId)).length,
      orphanTaskProject: app.tasks.filter((t) => t.projectId && !projIds.has(t.projectId)).length,
      orphanNotes: app.taskNotes.filter((n) => !taskIds.has(n.taskId)).length,
      orphanChecklist: app.checklistItems.filter((c) => !taskIds.has(c.taskId)).length,
      orphanTraining: app.employeeTrainingRecords.filter((r) => !empIds.has(r.employeeId)).length
    };
  });
  let healthIssues = $derived(Object.values(health).reduce((a, b) => a + b, 0));
</script>

<div class="page">
  <div class="page-header"><h1>Settings</h1></div>

  <section class="card" style="margin-bottom:1rem">
    <h2>Backup and restore</h2>
    <p class="small muted">
      Browser storage can be cleared by policy or profile changes. Exported JSON backups are the canonical copy of
      your data — export regularly and store the file in an approved location.
    </p>
    <p>
      <strong>Storage:</strong>
      {app.storageKind === "indexeddb" ? "IndexedDB (persistent browser storage)" : "In-memory only — data will NOT survive closing this tab"}
      · <strong>Last backup:</strong> {app.meta.lastBackupAt ? formatTimestamp(app.meta.lastBackupAt) : "never"}
      · <strong>Changes since backup:</strong> {app.meta.changesSinceBackup}
    </p>
    <div style="display:flex; gap:.5rem; flex-wrap:wrap">
      <button type="button" class="primary" onclick={() => void exportBackup()}>Export backup (JSON)</button>
      <button type="button" onclick={() => fileInput?.click()}>Import backup…</button>
      <input type="file" accept=".json,application/json" style="display:none" bind:this={fileInput} onchange={onImportFile} />
    </div>
  </section>

  <section class="card" style="margin-bottom:1rem">
    <h2>Attention rule thresholds</h2>
    <div class="settings-grid">
      <label>Due soon (days)
        <input type="number" min="1" value={app.settings.dueSoonDays} onchange={numberInput("dueSoonDays")} /></label>
      <label>Waiting too long (days)
        <input type="number" min="1" value={app.settings.waitingStaleDays} onchange={numberInput("waitingStaleDays")} /></label>
      <label>Stale task (days)
        <input type="number" min="1" value={app.settings.taskStaleDays} onchange={numberInput("taskStaleDays")} /></label>
      <label>No performance input (days)
        <input type="number" min="1" value={app.settings.performanceInputReminderDays} onchange={numberInput("performanceInputReminderDays")} /></label>
      <label>No check-in (days)
        <input type="number" min="1" value={app.settings.checkInReminderDays} onchange={numberInput("checkInReminderDays")} /></label>
      <label>Training warning (days)
        <input type="number" min="1" value={app.settings.trainingWarningDays} onchange={numberInput("trainingWarningDays")} /></label>
      <label>Leave lookahead (days)
        <input type="number" min="1" value={app.settings.leaveLookaheadDays} onchange={numberInput("leaveLookaheadDays")} /></label>
      <label>Completed cards visible (days)
        <input type="number" min="0" value={app.settings.completedVisibleDays} onchange={numberInput("completedVisibleDays")} /></label>
      <label>Backup reminder (days)
        <input type="number" min="1" value={app.settings.backupReminderDays} onchange={numberInput("backupReminderDays")} /></label>
      <label>Backup change threshold
        <input type="number" min="1" value={app.settings.backupChangeThreshold} onchange={numberInput("backupChangeThreshold")} /></label>
    </div>
  </section>

  <section class="card" style="margin-bottom:1rem">
    <h2>Appearance</h2>
    <label for="set-theme">Theme</label>
    <select
      id="set-theme"
      value={app.settings.theme}
      onchange={(e) => void updateSetting("theme", (e.currentTarget as HTMLSelectElement).value as "light" | "dark" | "system")}
    >
      <option value="system">System</option>
      <option value="light">Light</option>
      <option value="dark">Dark</option>
    </select>
  </section>

  <section class="card" style="margin-bottom:1rem">
    <h2>Database health</h2>
    <p>
      {#if healthIssues === 0}
        <span class="badge success">No integrity issues found</span>
      {:else}
        <span class="badge warning">{healthIssues} potential issue(s)</span>
      {/if}
    </p>
    {#if healthIssues > 0}
      <ul class="small">
        {#if health.orphanTaskEmployee}<li>{health.orphanTaskEmployee} task(s) reference a missing employee</li>{/if}
        {#if health.orphanTaskProject}<li>{health.orphanTaskProject} task(s) reference a missing project</li>{/if}
        {#if health.orphanNotes}<li>{health.orphanNotes} note(s) reference a missing task</li>{/if}
        {#if health.orphanChecklist}<li>{health.orphanChecklist} checklist item(s) reference a missing task</li>{/if}
        {#if health.orphanTraining}<li>{health.orphanTraining} training record(s) reference a missing employee</li>{/if}
      </ul>
      <p class="small muted">Export a backup before attempting any manual repair.</p>
    {/if}
    <details>
      <summary>Record counts</summary>
      <ul class="small">
        {#each Object.entries(counts) as [name, count] (name)}
          <li>{name}: {count}</li>
        {/each}
      </ul>
    </details>
  </section>

  <section class="card" style="margin-bottom:1rem">
    <h2>Data maintenance</h2>
    <div style="display:flex; gap:.5rem; flex-wrap:wrap">
      <button type="button" onclick={() => (confirmSample = true)}>Load sample data</button>
      <button type="button" class="danger" onclick={() => (confirmReset = true)}>Reset all data…</button>
    </div>
    <p class="small muted">Loading sample data replaces the current database. Both actions offer/require safeguards.</p>
  </section>

  <section class="card">
    <h2>About</h2>
    <p>
      Supervisor Assistant v{APPLICATION_VERSION} — a local-first supervisory cockpit. No server, no telemetry, no
      network access. All data stays in this browser and in backups you export.
    </p>
    <p class="small muted">
      Use only for information authorized for local supervisory tracking. Do not enter classified information,
      credentials, medical details, Social Security numbers, or unnecessary personal information.
    </p>
  </section>
</div>

{#if importResult}
  <Dialog title="Import backup" onclose={() => (importResult = undefined)}>
    {#if !importResult.valid}
      <p class="field-error"><strong>This file cannot be imported.</strong></p>
      <ul class="small">
        {#each importResult.errors.slice(0, 15) as err, i (i)}<li>{err}</li>{/each}
      </ul>
      {#if importResult.errors.length > 15}<p class="small muted">…and {importResult.errors.length - 15} more errors.</p>{/if}
      <div style="display:flex; justify-content:flex-end"><button type="button" onclick={() => (importResult = undefined)}>Close</button></div>
    {:else}
      <p><strong>{importFileName}</strong> is a valid backup.</p>
      <ul class="small">
        <li>Exported: {importResult.exportedAt ? formatTimestamp(importResult.exportedAt) : "unknown"}</li>
        <li>Application version: {importResult.applicationVersion ?? "unknown"}</li>
        <li>Database ID: {importResult.databaseId ?? "unknown"}</li>
        <li>Records: {Object.entries(importResult.recordCounts).filter(([, c]) => c > 0).map(([n, c]) => `${n}: ${c}`).join(", ") || "none"}</li>
      </ul>
      {#if importResult.warnings.length}
        <p class="small" style="color:var(--warning)"><strong>Warnings:</strong> {importResult.warnings.join(" ")}</p>
      {/if}
      <p>
        Replacing the database <strong>removes all current data</strong> and loads this backup instead. Export a
        backup of the current data first.
      </p>
      <div style="display:flex; gap:.5rem; justify-content:flex-end; flex-wrap:wrap">
        <button type="button" onclick={() => (importResult = undefined)}>Cancel</button>
        <button type="button" onclick={() => void backupThenReplace()}>Export current data, then replace…</button>
        <button type="button" class="danger" onclick={() => (confirmReplace = true)}>Replace without exporting…</button>
      </div>
    {/if}
  </Dialog>
{/if}

{#if confirmReplace}
  <ConfirmDialog
    title="Replace database"
    message="All current data will be replaced with the contents of the imported backup. This cannot be undone unless you exported a backup of the current data."
    confirmLabel="Replace database"
    danger
    onconfirm={() => void doReplace()}
    oncancel={() => (confirmReplace = false)}
  />
{/if}

{#if confirmSample}
  <ConfirmDialog
    title="Load sample data"
    message="This replaces the current database with fictional sample data (4 employees, 4 projects, sample tasks). Continue?"
    confirmLabel="Load sample data"
    danger
    onconfirm={async () => {
      await app.loadSampleData();
      confirmSample = false;
      app.toast("Sample data loaded", "success");
    }}
    oncancel={() => (confirmSample = false)}
  />
{/if}

{#if confirmReset}
  <ConfirmDialog
    title="Reset all data"
    message="This permanently deletes every record in the local database. Export a backup first if you may need this data again."
    confirmLabel="Delete everything"
    danger
    typedPhrase="DELETE ALL DATA"
    onconfirm={async () => {
      await app.resetAllData();
      confirmReset = false;
      app.toast("All data deleted", "info");
    }}
    oncancel={() => (confirmReset = false)}
  />
{/if}

<style>
  .settings-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr));
    gap: .3rem .8rem;
  }
  .settings-grid label { font-weight: 400; }
  .settings-grid input { width: 6rem; display: block; }
</style>
