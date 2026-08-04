<script lang="ts">
  // Gate in front of the one-way rich-text conversion. The backup is not a
  // suggestion: the conversion only runs after a save is accepted, and a
  // cancelled or failed save leaves the database exactly as it was. Running the
  // save inside the button's click also keeps the browser's download gesture
  // requirement satisfied, which an automatic boot-time export would not.
  import Dialog from "./Dialog.svelte";
  import { app } from "../../stores/app.svelte";
  import { backupFilename, downloadJson } from "../../utils/download";
  import { describeMigrationReport, type RichTextMigrationReport } from "../../data/richTextMigration";

  const COLLECTION_LABELS: Record<string, string> = {
    tasks: "task descriptions",
    taskNotes: "task notes",
    quickNotes: "notes",
    employeeNotes: "employee notes",
    meetingNotes: "meeting notes",
    performanceInputs: "performance inputs",
    projects: "project descriptions",
    awardRecords: "award supporting notes",
    employeeInteractions: "check-in summaries"
  };

  let result = $state<RichTextMigrationReport | undefined>(undefined);
  let running = $state(false);
  let error = $state("");
  /**
   * Deferring is allowed: nothing is broken until the conversion runs, since
   * every reader still understands the old format. It is offered again next
   * time RADAR opens rather than nagging within this session.
   */
  let deferred = $state(false);
  let pending = $derived(deferred ? undefined : app.pendingRichTextMigration);

  function label(collection: string): string {
    return COLLECTION_LABELS[collection] ?? collection;
  }

  async function backUpAndConvert() {
    if (running) return;
    running = true;
    error = "";
    try {
      const pkg = await app.buildBackup();
      const filename = backupFilename("RADAR_Backup_before_rich_text_update", "json");
      const saved = await downloadJson(filename, pkg);
      if (!saved) {
        error = "The backup was cancelled, so nothing was changed. Save the backup to continue.";
        return;
      }
      await app.markBackupCompleted(pkg);
      result = await app.runRichTextMigration();
    } catch (e) {
      error = `Nothing was changed. The update failed: ${e instanceof Error ? e.message : String(e)}`;
    } finally {
      running = false;
    }
  }

  function done() {
    result = undefined;
    app.richTextMigrationResult = undefined;
  }
</script>

{#if result}
  <Dialog title="Notes updated" onclose={done}>
    <p>{describeMigrationReport(result)}</p>
    {#if Object.keys(result.byCollection).length}
      <ul class="breakdown">
        {#each Object.entries(result.byCollection) as [collection, count] (collection)}
          <li><strong>{count}</strong> in {label(collection)}</li>
        {/each}
      </ul>
    {/if}
    {#if result.checklistItems > 0}
      <p class="muted small">
        Checkboxes are no longer part of note text. Those items are now bulleted, marked ✓ when they were
        complete and ○ when they were not, so nothing was lost. A task's own checklist is unaffected.
      </p>
    {/if}
    <div class="actions">
      <button type="button" class="primary" onclick={done}>Done</button>
    </div>
  </Dialog>
{:else if pending}
  <Dialog title="Update how notes are stored" onclose={() => (deferred = true)}>
    <p>
      RADAR now stores formatted text in a new format. This database still holds
      <strong>{pending.values}</strong>
      {pending.values === 1 ? "field" : "fields"} in the old one, across
      <strong>{pending.records}</strong> {pending.records === 1 ? "record" : "records"}.
    </p>
    {#if Object.keys(pending.byCollection).length}
      <ul class="breakdown">
        {#each Object.entries(pending.byCollection) as [collection, count] (collection)}
          <li><strong>{count}</strong> in {label(collection)}</li>
        {/each}
      </ul>
    {/if}
    <p>
      Headings, lists, bold, italic, and underline are all preserved.
      {#if pending.checklistItems > 0}
        {pending.checklistItems} checklist {pending.checklistItems === 1 ? "item" : "items"} in note text will become
        bulleted {pending.checklistItems === 1 ? "item" : "items"} marked ✓ or ○ — checkboxes are no longer part of
        note text, but no item and no completion state is lost. A task's own checklist is unaffected.
      {/if}
    </p>
    <p class="muted small">
      A backup is saved before anything changes. If you cancel the save, nothing is changed and you will be
      asked again next time RADAR opens.
    </p>
    {#if error}<div class="field-error" role="alert">{error}</div>{/if}
    <div class="actions">
      <button type="button" disabled={running} onclick={() => (deferred = true)}>Not now</button>
      <button type="button" class="primary" disabled={running} onclick={() => void backUpAndConvert()}>
        {running ? "Working…" : "Save a backup and update"}
      </button>
    </div>
  </Dialog>
{/if}

<style>
  .breakdown { margin: .5rem 0 .85rem; padding-left: 1.35rem; }
  .breakdown li + li { margin-top: .2rem; }
  .actions { display: flex; justify-content: flex-end; gap: .6rem; margin-top: 1rem; }
</style>
