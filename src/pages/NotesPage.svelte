<script lang="ts">
  import ConfirmDialog from "../components/common/ConfirmDialog.svelte";
  import EmptyState from "../components/common/EmptyState.svelte";
  import Icon from "../components/common/Icon.svelte";
  import RichTextEditor from "../components/common/RichTextEditor.svelte";
  import RichTextView from "../components/common/RichTextView.svelte";
  import { app } from "../stores/app.svelte";
  import { router } from "../app/router.svelte";
  import type { QuickNote } from "../domain/models";
  import { quickNoteTitle } from "../domain/rules/quickNotes";
  import { formatTimestamp, nowTimestamp } from "../utils/dates";
  import { newId } from "../utils/ids";
  import {
    emptyRichText,
    isRichTextEmpty,
    normalizeRichText,
    richTextDocToPlainText,
    type RichTextValue
  } from "../utils/richTextDoc";

  let draft = $state<RichTextValue>(emptyRichText());
  let saving = $state(false);
  let search = $state("");
  let editingId = $state<string | undefined>(undefined);
  let pendingDelete = $state<QuickNote | undefined>(undefined);

  let activeNotes = $derived(app.quickNotes.filter((note) => !note.isArchived));
  let matching = $derived(
    activeNotes
      .filter((note) => {
        const needle = search.trim().toLowerCase();
        return !needle || richTextDocToPlainText(note.body).toLowerCase().includes(needle);
      })
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  );

  $effect(() => {
    const id = router.current.page === "notes" ? router.current.param : undefined;
    if (!id) return;
    const note = app.quickNotes.find((item) => item.id === id && !item.isArchived);
    if (note) startEditing(note);
    router.go("notes");
  });

  function focusComposer() {
    requestAnimationFrame(() => document.getElementById("notes-composer")?.focus());
  }

  function startEditing(note: QuickNote) {
    editingId = note.id;
    // Legacy notation is converted here, so opening an old note for editing is
    // what migrates it; saving writes the document back in the new format.
    draft = normalizeRichText(note.body);
    focusComposer();
  }

  // The whole card is a mouse target for editing. Clicks that mean something
  // else are left alone: the Edit and Archive buttons, a link inside the note,
  // and a click that ends a text selection the user made to copy.
  function editFromCard(note: QuickNote, event: MouseEvent) {
    if ((event.target as HTMLElement | null)?.closest("a, button")) return;
    if (window.getSelection()?.toString()) return;
    startEditing(note);
  }

  function cancelEditing() {
    editingId = undefined;
    draft = emptyRichText();
    focusComposer();
  }

  async function saveComposer() {
    if (isRichTextEmpty(draft) || saving) return;
    const body = draft;
    const now = nowTimestamp();
    const existing = editingId ? app.quickNotes.find((note) => note.id === editingId) : undefined;
    const note: QuickNote = existing
      ? { ...existing, body, updatedAt: now }
      : {
          id: newId(),
          body,
          // Keep the legacy storage fields at neutral values so old backups and
          // desktop databases remain compatible with the simplified interface.
          purpose: "scratch",
          isPinned: false,
          createdAt: now,
          updatedAt: now,
          isArchived: false
        };
    saving = true;
    try {
      await app.putRecord("quickNotes", note, {
        actionType: existing ? "updated" : "created",
        summary: `${existing ? "Updated" : "Captured"} note "${quickNoteTitle(body, 60)}"`
      });
      draft = emptyRichText();
      editingId = undefined;
      app.toast(existing ? "Note updated" : "Note saved", "success");
      focusComposer();
    } finally {
      saving = false;
    }
  }

  async function archive(note: QuickNote) {
    if (editingId === note.id) cancelEditing();
    await app.putRecord(
      "quickNotes",
      { ...note, isArchived: true, updatedAt: nowTimestamp() },
      { actionType: "archived", summary: `Archived note "${quickNoteTitle(note.body, 60)}"` }
    );
    app.toast("Note archived", "success", async () => {
      const current = app.quickNotes.find((item) => item.id === note.id);
      if (current) {
        await app.putRecord(
          "quickNotes",
          { ...current, isArchived: false, updatedAt: nowTimestamp() },
          { actionType: "restored", summary: `Restored note "${quickNoteTitle(current.body, 60)}"` }
        );
      }
    });
  }

  async function deleteNote(note: QuickNote) {
    if (editingId === note.id) cancelEditing();
    await app.deleteRecord("quickNotes", note.id, `Deleted note "${quickNoteTitle(note.body, 60)}"`);
    pendingDelete = undefined;
    app.toast("Note deleted", "success");
  }
</script>

<div class="page notes-page">
  <div class="page-header">
    <div>
      <h1>Notes</h1>
    </div>
  </div>

  <section class="capture-card" aria-labelledby="capture-heading">
    <div class="capture-topline">
      <h2 id="capture-heading">{editingId ? "Edit note" : "What do you want to remember?"}</h2>
      <span class="capture-date">{new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}</span>
    </div>
    <RichTextEditor
      id="notes-composer"
      bind:value={draft}
      rows={5}
      maxlength={10000}
      placeholder="Part number, web address, a few steps, or anything else…"
      ariaLabel={editingId ? "Edit note" : "New note"}
      onSaveShortcut={() => void saveComposer()}
    />
    <div class="capture-footer">
      <span class="muted small">Ctrl+Enter to save</span>
      <span class="spacer"></span>
      {#if editingId}
        <button type="button" onclick={cancelEditing} disabled={saving}>Cancel</button>
      {/if}
      <button type="button" class="primary" onclick={() => void saveComposer()} disabled={isRichTextEmpty(draft) || saving}>
        {saving ? "Saving…" : editingId ? "Save changes" : "Save note"}
      </button>
    </div>
  </section>

  <div class="notes-toolbar">
    <span class="muted small">{activeNotes.length} {activeNotes.length === 1 ? "note" : "notes"}</span>
    <span class="spacer"></span>
    <input type="search" bind:value={search} placeholder="Search notes" aria-label="Search notes" />
  </div>

  {#if matching.length === 0}
    <EmptyState message="No notes match this view." hint="Save a note above or clear the search." />
  {:else}
    <main class="note-grid" aria-label="Notes cards">
      {#each matching as note (note.id)}
        <!-- Card click is a mouse convenience; the Edit button is the keyboard path. -->
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
        <article
          class="note-card"
          class:editing={editingId === note.id}
          onclick={(ev) => editFromCard(note, ev)}
        >
          <div class="note-meta">
            <span class="spacer"></span>
            <time datetime={note.createdAt}>{formatTimestamp(note.createdAt)}</time>
          </div>
          <div class="note-body"><RichTextView value={note.body} /></div>
          <div class="note-actions">
            <button type="button" class="link" aria-pressed={editingId === note.id} onclick={() => startEditing(note)}>Edit</button>
            <span class="spacer"></span>
            <button type="button" class="icon-btn" aria-label="Archive note" title="Archive" onclick={() => void archive(note)}><Icon name="archive" size={15} /></button>
            <button type="button" class="icon-btn danger" aria-label="Delete note" title="Delete" onclick={() => (pendingDelete = note)}><Icon name="trash" size={15} /></button>
          </div>
        </article>
      {/each}
    </main>
  {/if}
</div>

{#if pendingDelete}
  <ConfirmDialog
    title="Delete note"
    message={`Permanently delete "${quickNoteTitle(pendingDelete.body, 80)}"?`}
    confirmLabel="Delete note"
    danger
    onconfirm={() => void deleteNote(pendingDelete!)}
    oncancel={() => (pendingDelete = undefined)}
  />
{/if}

<style>
  .notes-page { max-width: 1240px; }
  .page-header { align-items: flex-end; margin-bottom: 1.2rem; }
  .page-header h1 { font-size: 1.9rem; letter-spacing: -.025em; }

  .capture-card { padding: 1.2rem 1.3rem 1.1rem; border: 1px solid color-mix(in srgb, var(--accent) 28%, var(--border)); border-radius: calc(var(--radius-lg) + 2px); background: linear-gradient(135deg, color-mix(in srgb, var(--accent-soft) 58%, var(--surface)) 0%, var(--surface) 58%); box-shadow: var(--shadow); }
  .capture-topline { display: flex; gap: 1rem; align-items: flex-start; margin-bottom: .75rem; }
  .capture-topline h2 { margin: 0; font-size: 1.12rem; }
  .capture-date { margin-left: auto; color: var(--text-muted); font-size: .78rem; }
  .capture-footer { display: flex; align-items: center; gap: .65rem; margin-top: .65rem; }

  .notes-toolbar { display: flex; align-items: center; gap: .55rem; flex-wrap: wrap; margin: 1.35rem 0 1rem; }
  .notes-toolbar input { min-width: 13rem; }
  .note-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: .85rem; align-items: stretch; }

  .note-card { cursor: pointer; display: flex; flex-direction: column; min-height: 10rem; padding: .8rem .9rem .5rem; border: 1px solid var(--border); border-top: 3px solid color-mix(in srgb, var(--accent) 58%, var(--border)); border-radius: var(--radius-lg); background: linear-gradient(145deg, color-mix(in srgb, var(--accent-soft) 22%, var(--surface)) 0%, var(--surface) 46%); box-shadow: var(--shadow-xs); transition: border-color .15s ease, box-shadow .15s ease, transform .15s ease; }
  .note-card:hover { border-color: color-mix(in srgb, var(--accent) 28%, var(--border)); box-shadow: var(--shadow); }
  .note-card.editing { border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent-soft); }
  .note-meta { display: flex; align-items: center; min-height: 1.3rem; }
  .note-meta time { color: var(--text-muted); font-size: .68rem; }
  .note-body { flex: 1; padding: .55rem .1rem .8rem; line-height: 1.5; overflow-wrap: anywhere; }
  .note-actions { display: flex; align-items: center; gap: .1rem; padding-top: .38rem; border-top: 1px solid color-mix(in srgb, var(--border) 72%, transparent); opacity: .72; transition: opacity .12s ease; }
  .note-card:hover .note-actions, .note-card:focus-within .note-actions { opacity: 1; }
  .note-actions .link { font-size: .72rem; }
  .note-actions .icon-btn { width: 1.8rem; height: 1.8rem; min-height: 1.8rem; }

  @media (max-width: 980px) {
    .note-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  }
  @media (max-width: 650px) {
    .notes-page { padding-left: 1rem; padding-right: 1rem; }
    .capture-card { padding: 1rem; }
    .capture-topline { display: block; }
    .capture-date { display: block; margin-top: .4rem; }
    .capture-footer { align-items: stretch; flex-wrap: wrap; }
    .capture-footer .spacer { display: none; }
    .capture-footer button { margin-left: auto; }
    .notes-toolbar input { flex: 1 1 100%; }
    .note-grid { grid-template-columns: 1fr; }
  }
</style>
