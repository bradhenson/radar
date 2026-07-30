<script lang="ts">
  import Dialog from "../common/Dialog.svelte";
  import RichTextEditor from "../common/RichTextEditor.svelte";
  import { app } from "../../stores/app.svelte";
  import type { QuickNote } from "../../domain/models";
  import { quickNoteTitle } from "../../domain/rules/quickNotes";
  import { nowTimestamp } from "../../utils/dates";
  import { newId } from "../../utils/ids";

  let {
    note,
    onclose
  }: { note?: QuickNote; onclose: () => void } = $props();

  function initialNoteBody(): string {
    return note?.body ?? "";
  }

  const initialBody = initialNoteBody();
  let body = $state(initialBody);
  let saving = $state(false);
  let error = $state("");
  let isDirty = $derived(body !== initialBody);

  async function save() {
    const trimmed = body.trim();
    if (!trimmed) {
      error = "Write something before saving the note.";
      return;
    }
    saving = true;
    error = "";
    const now = nowTimestamp();
    const record: QuickNote = {
      id: note?.id ?? newId(),
      body: trimmed,
      // Preserve legacy metadata when editing so simplifying the interface
      // never discards information stored by earlier RADAR versions.
      purpose: note?.purpose ?? "scratch",
      employeeId: note?.employeeId,
      projectId: note?.projectId,
      taskId: note?.taskId,
      isPinned: note?.isPinned ?? false,
      reviewedAt: note?.reviewedAt,
      createdAt: note?.createdAt ?? now,
      updatedAt: now,
      isArchived: note?.isArchived ?? false
    };
    try {
      await app.putRecord("quickNotes", record, {
        actionType: note ? "updated" : "created",
        summary: `${note ? "Updated" : "Captured"} note "${quickNoteTitle(record.body, 60)}"`
      });
      app.toast(note ? "Note updated" : "Note saved", "success");
      onclose();
    } catch (e) {
      error = `Save failed: ${e instanceof Error ? e.message : String(e)}`;
    } finally {
      saving = false;
    }
  }
</script>

<Dialog title={note ? "Edit note" : "New note"} {onclose} wide unsavedGuard={() => isDirty}>
  <form onsubmit={(event) => { event.preventDefault(); void save(); }}>
    <label for="qn-body">Note <span class="req">*</span></label>
    <RichTextEditor
      id="qn-body"
      bind:value={body}
      rows={7}
      maxlength={10000}
      placeholder="Part number, web address, a few steps, or anything else…"
      ariaLabel="Note"
    />
    <div class="field-hint">Use the toolbar for headings, lists, or a checklist when useful.</div>
    {#if error}<div class="field-error" role="alert">{error}</div>{/if}

    <div class="actions">
      <button type="button" onclick={onclose}>Cancel</button>
      <button type="submit" class="primary" disabled={saving}>{saving ? "Saving…" : "Save note"}</button>
    </div>
  </form>
</Dialog>

<style>
  .actions { display: flex; justify-content: flex-end; gap: .5rem; margin-top: 1rem; }
</style>
