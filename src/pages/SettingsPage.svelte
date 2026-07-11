<script lang="ts">
  // Settings, backup/restore, data maintenance (plan 12.13, 26, 31).
  import { app } from "../stores/app.svelte";
  import Dialog from "../components/common/Dialog.svelte";
  import ConfirmDialog from "../components/common/ConfirmDialog.svelte";
  import Icon from "../components/common/Icon.svelte";
  import {
    APPLICATION_VERSION,
    MAX_BACKUP_CHARS,
    parseAndValidateBackup,
    type BackupValidationResult
  } from "../data/backup";
  import { COLOR_THEMES } from "../domain/models";
  import { backupFilename, downloadJson } from "../utils/download";
  import { formatTimestamp } from "../utils/dates";

  let importResult = $state<BackupValidationResult | undefined>(undefined);
  let importFileName = $state("");
  let confirmReplace = $state(false);
  let confirmReset = $state(false);
  let confirmSample = $state(false);
  let fileInput: HTMLInputElement | undefined = $state();
  let newCompetencyCode = $state("");
  let newCompetencyName = $state("");
  let competencyError = $state("");
  let newBoardColumnName = $state("");
  let boardColumnError = $state("");

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

  async function addCompetency() {
    try {
      await app.createCompetency(newCompetencyCode, newCompetencyName);
      newCompetencyCode = "";
      newCompetencyName = "";
      competencyError = "";
      app.toast("Competency added", "success");
    } catch (e) {
      competencyError = e instanceof Error ? e.message : String(e);
    }
  }

  async function updateCompetency(id: string, code: string, name: string) {
    try {
      await app.updateCompetency(id, code, name);
      competencyError = "";
    } catch (e) {
      competencyError = e instanceof Error ? e.message : String(e);
    }
  }

  async function setCompetencyActive(id: string, active: boolean) {
    try {
      await app.setCompetencyActive(id, active);
      competencyError = "";
    } catch (e) {
      competencyError = e instanceof Error ? e.message : String(e);
    }
  }

  async function addBoardColumn() {
    try {
      await app.createBoardColumn(newBoardColumnName);
      newBoardColumnName = "";
      boardColumnError = "";
      app.toast("Board column added", "success");
    } catch (e) {
      boardColumnError = e instanceof Error ? e.message : String(e);
    }
  }

  async function renameBoardColumn(id: string, value: string) {
    try {
      await app.renameBoardColumn(id, value);
      boardColumnError = "";
    } catch (e) {
      boardColumnError = e instanceof Error ? e.message : String(e);
    }
  }

  async function deleteBoardColumn(id: string) {
    try {
      await app.deleteBoardColumn(id);
      boardColumnError = "";
    } catch (e) {
      boardColumnError = e instanceof Error ? e.message : String(e);
    }
  }

  async function moveBoardColumn(id: string, offset: -1 | 1) {
    try {
      await app.moveBoardColumn(id, offset);
      boardColumnError = "";
    } catch (e) {
      boardColumnError = e instanceof Error ? e.message : String(e);
    }
  }

  async function setBoardColumnMapping(id: string, value: string) {
    try {
      await app.setBoardColumnStatusMapping(id, (value || undefined) as "open" | "waiting" | "complete" | undefined);
      boardColumnError = "";
    } catch (e) {
      boardColumnError = e instanceof Error ? e.message : String(e);
    }
  }

  // Record the backup after the save is accepted (browser download handed
  // off, or native save dialog confirmed in the desktop shell). Errors and
  // cancels still prevent a requested database replacement from continuing.
  async function exportBackup(forReplace = false) {
    try {
      const pkg = await app.buildBackup();
      const filename = backupFilename("RADAR_Backup", "json");
      const saved = await downloadJson(filename, pkg);
      if (!saved) {
        app.toast("Backup export cancelled", "info");
        return false;
      }
      await app.markBackupCompleted(pkg);
      app.toast(`Backup saved: ${filename}`, "success");
      if (forReplace) confirmReplace = true;
      return true;
    } catch (e) {
      app.toast(`Backup failed: ${e instanceof Error ? e.message : String(e)}`, "error");
      return false;
    }
  }

  function onImportFile(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    if (file.size > MAX_BACKUP_CHARS) {
      app.toast(`File is too large to import (${Math.round(file.size / 1024 / 1024)} MB).`, "error");
      input.value = "";
      return;
    }
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

  // "Export current data, then replace" only reaches the replace confirmation
  // after the download request and backup metadata update both succeed.
  async function backupThenReplace() {
    await exportBackup(true);
  }

  let counts = $derived(app.recordCounts());

  // Health check (plan 26.6).
  let health = $derived.by(() => {
    const empIds = new Set(app.employees.map((e) => e.id));
    const projIds = new Set(app.projects.map((p) => p.id));
    const competencyIds = new Set(app.competencies.map((c) => c.id));
    const boardColumnIds = new Set(app.boardColumns.map((c) => c.id));
    const taskIds = new Set(app.tasks.map((t) => t.id));
    return {
      orphanEmployeeCompetency: app.employees.filter((e) => e.competencyId && !competencyIds.has(e.competencyId)).length,
      orphanProjectCompetency: app.projects.filter((p) => p.competencyId && !competencyIds.has(p.competencyId)).length,
      orphanTaskCompetency: app.tasks.filter((t) => t.competencyId && !competencyIds.has(t.competencyId)).length,
      orphanTaskEmployee: app.tasks.filter((t) => t.employeeId && !empIds.has(t.employeeId)).length,
      orphanTaskProject: app.tasks.filter((t) => t.projectId && !projIds.has(t.projectId)).length,
      orphanTaskBoardColumn: app.tasks.filter((t) => t.boardColumnId && !boardColumnIds.has(t.boardColumnId)).length,
      orphanNotes: app.taskNotes.filter((n) => !taskIds.has(n.taskId)).length,
      orphanChecklist: app.checklistItems.filter((c) => !taskIds.has(c.taskId)).length,
      orphanTraining: app.employeeTrainingRecords.filter((r) => !empIds.has(r.employeeId)).length,
      orphanMeetingEmployees: app.meetingNotes.reduce(
        (count, note) => count + note.attendeeEmployeeIds.filter((id) => !empIds.has(id)).length,
        0
      ),
      orphanMeetingProjects: app.meetingNotes.filter((note) => note.projectId && !projIds.has(note.projectId)).length
    };
  });
  let healthIssues = $derived(Object.values(health).reduce((a, b) => a + b, 0));

  function formatBytes(value: number | undefined): string {
    if (value === undefined) return "unknown";
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
    return `${Math.round(value / (1024 * 1024))} MB`;
  }

  let persistenceLabel = $derived.by(() => {
    const status = app.storagePersistence;
    if (!status.supported) return "Storage Manager API unavailable";
    if (status.error) return `Unknown (${status.error})`;
    if (status.persisted === true) return "persistent storage granted";
    if (status.persisted === false) return "best-effort storage";
    return "unknown";
  });

  let storageEstimate = $derived.by(() => {
    const status = app.storagePersistence;
    if (!status.estimateAvailable) return "storage estimate unavailable";
    return `${formatBytes(status.usageBytes)} used of ${formatBytes(status.quotaBytes)} available`;
  });
</script>

<div class="page">
  <div class="page-header"><h1>Settings</h1></div>

  <section class="card" style="margin-bottom:1rem">
    <h2>Backup and restore</h2>
    <p class="small muted">
      {#if app.storageKind === "sqlite"}
        Your data lives in a local SQLite database file. Exported JSON backups remain the canonical portable copy.
        Export at the end of any day when records changed and store the file in an approved location.
      {:else}
        Browser storage can be cleared by policy or profile changes. Exported JSON backups are the canonical copy of
        your data. Export at the end of any day when records changed and store the file in an approved location.
      {/if}
    </p>
    <p>
      <strong>Storage:</strong>
      {app.storageKind === "sqlite"
        ? "SQLite database file (desktop app)"
        : app.storageKind === "indexeddb"
          ? "IndexedDB (browser working storage)"
          : "In-memory only - data will NOT survive closing this tab"}
      · <strong>Last backup:</strong> {app.meta.lastBackupAt ? formatTimestamp(app.meta.lastBackupAt) : "never"}
      · <strong>Changes since backup:</strong> {app.meta.changesSinceBackup}
    </p>
    {#if app.storageKind === "sqlite"}
      <p class="small muted">
        <strong>Database file:</strong> {app.desktopInfo?.path ?? "unknown"}
        · <strong>Size:</strong> {formatBytes(app.desktopInfo?.sizeBytes)}
      </p>
      <p class="small muted">
        Advanced database controls change which SQLite file RADAR is actively using. Opening another database
        immediately replaces the fields shown in the app with that file's data; it does not copy, merge, or delete
        records in either database. Create a new database to start with an empty dataset at an exact location. RADAR
        remembers the selected file for the next launch. Export a JSON backup before switching if you need a portable
        recovery copy.
      </p>
    {:else}
      <p class="small muted">
        <strong>Browser persistence:</strong> {persistenceLabel}. {storageEstimate}. Persistent storage can reduce normal
        browser eviction, but enterprise cleanup or profile policy can still remove site data.
      </p>
    {/if}
    <div style="display:flex; gap:.5rem; flex-wrap:wrap">
      <button type="button" class="primary" onclick={() => void exportBackup()}>Export backup (JSON)</button>
      <button type="button" onclick={() => fileInput?.click()}>Import backup...</button>
      {#if app.storageKind === "sqlite"}
        <button type="button" onclick={() => void app.openDesktopDatabaseFile()}>Open existing database...</button>
        <button type="button" onclick={() => void app.createDesktopDatabaseFile()}>Create new database...</button>
        <button type="button" onclick={() => void app.openDesktopDatabaseFolder()}>Open containing folder</button>
      {/if}
      {#if app.storageKind !== "sqlite"}
        <button
          type="button"
          onclick={() => void app.requestPersistentStorage()}
          disabled={!app.storagePersistence.persistAvailable || app.storagePersistence.persisted === true}
        >
          {app.storagePersistence.persisted === true ? "Persistent storage granted" : "Request persistent storage"}
        </button>
      {/if}
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
      <label>Backup reminder after changes (days)
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

    <label class="shortcut-toggle">
      <input
        type="checkbox"
        checked={app.settings.enableSingleKeyShortcuts}
        onchange={(e) => void updateSetting("enableSingleKeyShortcuts", (e.currentTarget as HTMLInputElement).checked)}
      />
      Single-key shortcuts (N new task, Q quick add, P performance input, T/B/E/M navigation)
    </label>

    <div class="palette-label" id="set-color-theme">Color theme</div>
    <div class="palette-row" role="group" aria-labelledby="set-color-theme">
      {#each COLOR_THEMES as t (t.value)}
        <button
          type="button"
          class="palette-btn"
          class:selected={(app.settings.colorTheme ?? "default") === t.value}
          aria-pressed={(app.settings.colorTheme ?? "default") === t.value}
          onclick={() => void updateSetting("colorTheme", t.value)}
        >
          <span class="palette-dot" style={`--dot-light:${t.swatch}; --dot-dark:${t.swatchDark}`} aria-hidden="true"></span>
          {t.label}
          {#if (app.settings.colorTheme ?? "default") === t.value}<span aria-hidden="true">✓</span>{/if}
        </button>
      {/each}
    </div>
  </section>

  <section class="card" style="margin-bottom:1rem">
    <h2>Competencies</h2>
    <p class="small muted">
      Active competencies appear in employee forms and training bulk-selection shortcuts. Deactivated competencies stay
      attached to existing records and can be reactivated later.
    </p>
    <form
      class="settings-add competency-add"
      onsubmit={(e) => {
        e.preventDefault();
        void addCompetency();
      }}
    >
      <input
        type="text"
        bind:value={newCompetencyCode}
        maxlength="40"
        placeholder="Code"
        aria-label="New competency code"
      />
      <input
        type="text"
        bind:value={newCompetencyName}
        maxlength="120"
        placeholder="Name"
        aria-label="New competency name"
      />
      <button type="submit" class="primary">Add competency</button>
    </form>
    {#if competencyError}<div class="field-error" role="alert">{competencyError}</div>{/if}
    {#if app.competencyList.length === 0}
      <p class="small muted">No competencies are configured yet. Add one before creating employees.</p>
    {:else}
      <table class="data settings-table competency-table">
        <thead>
          <tr><th>Code</th><th>Name</th><th>Employees</th><th>Status</th><th></th></tr>
        </thead>
        <tbody>
          {#each app.competencyList as competency (competency.id)}
            <tr class:inactive={!competency.active}>
              <td>
                <input
                  type="text"
                  value={competency.code}
                  maxlength="40"
                  aria-label={`Competency code ${competency.code}`}
                  onchange={(e) => void updateCompetency(competency.id, (e.currentTarget as HTMLInputElement).value, competency.name ?? "")}
                />
              </td>
              <td>
                <input
                  type="text"
                  value={competency.name ?? ""}
                  maxlength="120"
                  aria-label={`Competency name ${competency.code}`}
                  onchange={(e) => void updateCompetency(competency.id, competency.code, (e.currentTarget as HTMLInputElement).value)}
                />
              </td>
              <td>{app.competencyEmployeeCount(competency.id)}</td>
              <td>
                {#if competency.active}
                  <span class="badge success">Active</span>
                {:else}
                  <span class="badge">Inactive</span>
                {/if}
              </td>
              <td>
                {#if competency.active}
                  <button type="button" onclick={() => void setCompetencyActive(competency.id, false)}>Deactivate</button>
                {:else}
                  <button type="button" onclick={() => void setCompetencyActive(competency.id, true)}>Reactivate</button>
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </section>

  <section class="card" style="margin-bottom:1rem">
    <h2>Board columns</h2>
    <p class="small muted">
      Board columns organize cards visually. A column can also mark tasks with a status when cards are dropped
      into it (and completed tasks move to the column marked Complete). Columns set to "No status change" only
      organize cards.
    </p>
    <form
      class="settings-add"
      onsubmit={(e) => {
        e.preventDefault();
        void addBoardColumn();
      }}
    >
      <input
        type="text"
        bind:value={newBoardColumnName}
        maxlength="80"
        placeholder="New board column"
        aria-label="New board column name"
      />
      <button type="submit" class="primary">Add column</button>
    </form>
    {#if boardColumnError}<div class="field-error" role="alert">{boardColumnError}</div>{/if}
    <table class="data settings-table">
      <thead>
        <tr><th>Name</th><th>Marks tasks as</th><th>Tasks</th><th>Order</th><th></th></tr>
      </thead>
      <tbody>
        {#each app.boardColumnList as column, i (column.id)}
          <tr>
            <td>
              <input
                type="text"
                value={column.label}
                maxlength="80"
                aria-label={`Board column name ${column.label}`}
                onchange={(e) => void renameBoardColumn(column.id, (e.currentTarget as HTMLInputElement).value)}
              />
            </td>
            <td>
              <select
                aria-label={`Status mapping for board column ${column.label}`}
                value={column.mapsToStatus ?? ""}
                onchange={(e) =>
                  void setBoardColumnMapping(column.id, (e.currentTarget as HTMLSelectElement).value)}
              >
                <option value="">No status change</option>
                <option value="open">Open</option>
                <option value="waiting">Waiting</option>
                <option value="complete">Complete</option>
              </select>
            </td>
            <td>{app.boardColumnTaskCount(column.id)}</td>
            <td>
              <div class="settings-actions">
                <button type="button" onclick={() => void moveBoardColumn(column.id, -1)} disabled={i === 0}>Up</button>
                <button type="button" onclick={() => void moveBoardColumn(column.id, 1)} disabled={i === app.boardColumnList.length - 1}>Down</button>
              </div>
            </td>
            <td>
              <button
                type="button"
                class="icon-btn danger"
                aria-label="Delete column"
                onclick={() => void deleteBoardColumn(column.id)}
                disabled={app.boardColumnTaskCount(column.id) > 0 || app.activeBoardColumns.length <= 1}
                title={app.boardColumnTaskCount(column.id) > 0 ? "Move all tasks out of this column before deleting it" : "Delete column"}
              ><Icon name="trash" size={16} /></button>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
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
        {#if health.orphanEmployeeCompetency}<li>{health.orphanEmployeeCompetency} employee(s) reference a missing competency</li>{/if}
        {#if health.orphanProjectCompetency}<li>{health.orphanProjectCompetency} project(s) reference a missing competency</li>{/if}
        {#if health.orphanTaskCompetency}<li>{health.orphanTaskCompetency} task(s) reference a missing competency</li>{/if}
        {#if health.orphanTaskEmployee}<li>{health.orphanTaskEmployee} task(s) reference a missing employee</li>{/if}
        {#if health.orphanTaskProject}<li>{health.orphanTaskProject} task(s) reference a missing project</li>{/if}
        {#if health.orphanTaskBoardColumn}<li>{health.orphanTaskBoardColumn} task(s) reference a missing board column</li>{/if}
        {#if health.orphanNotes}<li>{health.orphanNotes} note(s) reference a missing task</li>{/if}
        {#if health.orphanChecklist}<li>{health.orphanChecklist} checklist item(s) reference a missing task</li>{/if}
        {#if health.orphanTraining}<li>{health.orphanTraining} training record(s) reference a missing employee</li>{/if}
        {#if health.orphanMeetingEmployees}<li>{health.orphanMeetingEmployees} meeting attendee link(s) reference a missing employee</li>{/if}
        {#if health.orphanMeetingProjects}<li>{health.orphanMeetingProjects} meeting note(s) reference a missing project</li>{/if}
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
      RADAR v{APPLICATION_VERSION} — Reporting, Administration, Delegation, Analytics & Review. No server, no
      telemetry, no network access. All data stays in this browser and in backups you export.
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
    message="This replaces the current database with fictional sample data (40 employees, 10 training requirements, and sample tasks, performance inputs, leave, telework, meetings, and awards). Continue?"
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
  .palette-label {
    font-weight: 600;
    margin: .65rem 0 .2rem;
    font-size: .85rem;
  }
  .shortcut-toggle {
    display: flex;
    align-items: center;
    gap: .45rem;
    font-weight: 400;
    margin-top: .65rem;
  }
  .palette-row {
    display: flex;
    flex-wrap: wrap;
    gap: .5rem;
  }
  .palette-btn {
    display: inline-flex;
    align-items: center;
    gap: .45rem;
    font-weight: 600;
  }
  .palette-btn.selected {
    border-color: var(--accent);
    background: var(--accent-soft);
    box-shadow: 0 0 0 1px var(--accent);
  }
  .palette-dot {
    width: .9rem;
    height: .9rem;
    border-radius: 50%;
    background: var(--dot-light);
    border: 1px solid rgba(0, 0, 0, .15);
    flex: none;
  }
  :global([data-theme="dark"]) .palette-dot {
    background: var(--dot-dark);
    border-color: rgba(255, 255, 255, .2);
  }

  .settings-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr));
    gap: .3rem .8rem;
  }
  .settings-grid label { font-weight: 400; }
  .settings-grid input { width: 6rem; display: block; }
  .settings-add {
    display: flex;
    gap: .5rem;
    flex-wrap: wrap;
    margin: .7rem 0;
  }
  .settings-add input {
    min-width: min(100%, 18rem);
  }
  .settings-table input {
    width: 100%;
    min-width: 12rem;
  }
  .competency-table .inactive {
    opacity: .72;
  }
  .settings-actions {
    display: flex;
    gap: .35rem;
    flex-wrap: wrap;
  }
</style>
