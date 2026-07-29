<script lang="ts">
  import EmptyState from "../components/common/EmptyState.svelte";
  import Icon from "../components/common/Icon.svelte";
  import RichTextView from "../components/common/RichTextView.svelte";
  import QuickNoteForm from "../components/forms/QuickNoteForm.svelte";
  import { app } from "../stores/app.svelte";
  import { ui } from "../stores/ui.svelte";
  import { router } from "../app/router.svelte";
  import { QUICK_NOTE_PURPOSES, type QuickNote, type QuickNotePurpose } from "../domain/models";
  import { quickNotePurposeLabel, quickNoteTitle } from "../domain/rules/quickNotes";
  import { formatTimestamp, nowTimestamp } from "../utils/dates";
  import { newId } from "../utils/ids";
  import { richTextToPlainText } from "../utils/richText";

  type View = "all" | "review" | "pinned";
  type NoteGroup = { label: string; notes: QuickNote[] };

  let draft = $state("");
  let draftPurpose = $state<QuickNotePurpose>("scratch");
  let saving = $state(false);
  let search = $state("");
  let view = $state<View>("all");
  let purposeFilter = $state("");
  let editing = $state<QuickNote | undefined>(undefined);
  let composer: HTMLTextAreaElement | undefined = $state();

  let activeNotes = $derived(app.quickNotes.filter((note) => !note.isArchived));
  let needsReviewCount = $derived(activeNotes.filter((note) => !note.reviewedAt).length);
  let pinnedCount = $derived(activeNotes.filter((note) => note.isPinned).length);

  let matching = $derived(
    activeNotes
      .filter((note) => {
        if (view === "review" && note.reviewedAt) return false;
        if (view === "pinned" && !note.isPinned) return false;
        if (purposeFilter && note.purpose !== purposeFilter) return false;
        const needle = search.trim().toLowerCase();
        if (!needle) return true;
        return [richTextToPlainText(note.body), app.employeeName(note.employeeId), app.projectName(note.projectId)]
          .some((value) => value.toLowerCase().includes(needle));
      })
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  );

  let shelfNotes = $derived(matching.filter((note) => note.isPinned));
  let timelineNotes = $derived(view === "pinned" ? [] : matching.filter((note) => view === "review" || !note.isPinned));
  let groups = $derived.by<NoteGroup[]>(() => {
    const grouped = new Map<string, QuickNote[]>();
    for (const note of timelineNotes) {
      const label = dayLabel(note.createdAt);
      grouped.set(label, [...(grouped.get(label) ?? []), note]);
    }
    return [...grouped.entries()].map(([label, notes]) => ({ label, notes }));
  });

  $effect(() => {
    const id = router.current.page === "notes" ? router.current.param : undefined;
    if (!id) return;
    const note = app.quickNotes.find((item) => item.id === id && !item.isArchived);
    if (note) editing = note;
    router.go("notes");
  });

  function localDateKey(timestamp: string): string {
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return "";
    const pad = (value: number) => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function dayLabel(timestamp: string): string {
    const key = localDateKey(timestamp);
    if (key === app.today) return "Today";
    const date = new Date(timestamp);
    return Number.isNaN(date.getTime())
      ? "Earlier"
      : date.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  }

  async function capture() {
    const body = draft.trim();
    if (!body || saving) return;
    const now = nowTimestamp();
    const note: QuickNote = {
      id: newId(),
      body,
      purpose: draftPurpose,
      isPinned: false,
      createdAt: now,
      updatedAt: now,
      isArchived: false
    };
    saving = true;
    try {
      await app.putRecord("quickNotes", note, {
        actionType: "created",
        summary: `Captured note "${quickNoteTitle(body, 60)}"`
      });
      draft = "";
      draftPurpose = "scratch";
      app.toast("Note captured", "success");
      requestAnimationFrame(() => composer?.focus());
    } finally {
      saving = false;
    }
  }

  function composerKeydown(event: KeyboardEvent) {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      void capture();
    }
  }

  async function togglePin(note: QuickNote) {
    const next = !note.isPinned;
    await app.putRecord(
      "quickNotes",
      { ...note, isPinned: next, updatedAt: nowTimestamp() },
      { actionType: "updated", summary: `${next ? "Pinned" : "Unpinned"} note "${quickNoteTitle(note.body, 60)}"` }
    );
  }

  async function toggleReviewed(note: QuickNote) {
    const reviewedAt = note.reviewedAt ? undefined : nowTimestamp();
    await app.putRecord(
      "quickNotes",
      { ...note, reviewedAt, updatedAt: nowTimestamp() },
      { actionType: "updated", summary: `${reviewedAt ? "Reviewed" : "Reopened"} note "${quickNoteTitle(note.body, 60)}"` }
    );
    app.toast(reviewedAt ? "Marked reviewed" : "Returned to review", "success");
  }

  async function archive(note: QuickNote) {
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

  function createTask(note: QuickNote) {
    ui.openNewTask({
      title: quickNoteTitle(note.body, 120),
      description: richTextToPlainText(note.body),
      employeeId: note.employeeId,
      projectId: note.projectId
    });
  }

  function createPerformanceInput(note: QuickNote) {
    if (!note.employeeId) return;
    ui.performanceFormPrefill = {
      employeeId: note.employeeId,
      projectId: note.projectId,
      inputDate: app.today,
      actionOrAccomplishment: note.body,
      source: "Supervisor"
    };
  }

  function linkedTaskTitle(id: string | undefined): string {
    return id ? app.tasks.find((task) => task.id === id)?.title ?? "Linked task" : "";
  }
</script>

{#if editing}
  <QuickNoteForm note={editing} onclose={() => (editing = undefined)} />
{/if}

<div class="page notes-page">
  <div class="page-header">
    <div>
      <span class="eyebrow">Capture · Connect · Act</span>
      <h1>Notes Workbench</h1>
      <p class="muted intro">A place for thoughts that do not have a structured home yet.</p>
    </div>
    <span class="spacer"></span>
    <button type="button" onclick={() => (ui.quickNoteOpen = true)}>Detailed note</button>
  </div>

  <section class="capture-card" aria-labelledby="capture-heading">
    <div class="capture-topline">
      <div>
        <span class="capture-kicker">Right now</span>
        <h2 id="capture-heading">What do you want to remember?</h2>
      </div>
      <span class="capture-date">{new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}</span>
    </div>
    <textarea
      bind:this={composer}
      bind:value={draft}
      rows="4"
      maxlength="10000"
      placeholder="Jot down a thought, decision, question, or follow-up…"
      aria-label="New note"
      onkeydown={composerKeydown}
    ></textarea>
    <div class="capture-footer">
      <label for="note-purpose" class="sr-only">Purpose</label>
      <select id="note-purpose" bind:value={draftPurpose} aria-label="Note purpose">
        {#each QUICK_NOTE_PURPOSES as purpose (purpose)}
          <option value={purpose}>{quickNotePurposeLabel(purpose)}</option>
        {/each}
      </select>
      <span class="muted small">Ctrl+Enter to capture</span>
      <span class="spacer"></span>
      <button type="button" class="primary" onclick={() => void capture()} disabled={!draft.trim() || saving}>
        {saving ? "Capturing…" : "Capture note"}
      </button>
    </div>
  </section>

  <div class="workbench-toolbar">
    <div class="view-tabs" role="group" aria-label="Note views">
      <button type="button" class:active={view === "all"} aria-pressed={view === "all"} onclick={() => (view = "all")}>All <span>{activeNotes.length}</span></button>
      <button type="button" class:active={view === "review"} aria-pressed={view === "review"} onclick={() => (view = "review")}>Needs review <span>{needsReviewCount}</span></button>
      <button type="button" class:active={view === "pinned"} aria-pressed={view === "pinned"} onclick={() => (view = "pinned")}>Pinned <span>{pinnedCount}</span></button>
    </div>
    <span class="spacer"></span>
    <input type="search" bind:value={search} placeholder="Search this notebook" aria-label="Search notes" />
    <select bind:value={purposeFilter} aria-label="Filter by purpose">
      <option value="">All purposes</option>
      {#each QUICK_NOTE_PURPOSES as purpose (purpose)}
        <option value={purpose}>{quickNotePurposeLabel(purpose)}</option>
      {/each}
    </select>
  </div>

  {#if matching.length === 0}
    <EmptyState message="No notes match this view." hint="Capture a thought above or clear the filters." />
  {:else}
    <div class="workbench-grid" class:shelf-only={view === "pinned"}>
      {#if view !== "pinned"}
        <main class="timeline" aria-label="Notebook timeline">
          {#each groups as group (group.label)}
            <section class="day-group">
              <div class="day-divider"><h2>{group.label}</h2><span>{group.notes.length}</span></div>
              <div class="note-stack">
                {#each group.notes as note (note.id)}
                  {@render noteCard(note)}
                {/each}
              </div>
            </section>
          {/each}
        </main>
      {/if}

      {#if shelfNotes.length > 0 || view === "all" || view === "pinned"}
        <aside class="reference-shelf" aria-label="Pinned reference notes">
          <div class="shelf-heading"><Icon name="pin" size={16} /><div><span>Reference shelf</span><small>Kept close at hand</small></div></div>
          {#if shelfNotes.length === 0}
            <p class="muted small shelf-empty">Pin a durable reference note and it will stay here.</p>
          {:else}
            <div class="shelf-stack">
              {#each shelfNotes as note (note.id)}
                {@render noteCard(note, true)}
              {/each}
            </div>
          {/if}
        </aside>
      {/if}
    </div>
  {/if}
</div>

{#snippet noteCard(note: QuickNote, compact = false)}
  <article class="note-card" class:compact class:unreviewed={!note.reviewedAt}>
    <div class="note-meta">
      <span class="purpose purpose-{note.purpose}">{quickNotePurposeLabel(note.purpose)}</span>
      {#if !note.reviewedAt}<span class="review-dot"><span aria-hidden="true"></span>Needs review</span>{/if}
      <span class="spacer"></span>
      <time datetime={note.createdAt}>{formatTimestamp(note.createdAt)}</time>
    </div>
    <div class="note-body"><RichTextView value={note.body} /></div>
    {#if note.employeeId || note.projectId || note.taskId}
      <div class="context-row">
        {#if note.employeeId}<span><Icon name="employees" size={13} />{app.employeeName(note.employeeId)}</span>{/if}
        {#if note.projectId}<span><Icon name="projects" size={13} />{app.projectName(note.projectId)}</span>{/if}
        {#if note.taskId}<span><Icon name="board" size={13} />{linkedTaskTitle(note.taskId)}</span>{/if}
      </div>
    {/if}
    <div class="note-actions">
      <button type="button" class="link" onclick={() => (editing = note)}>Edit</button>
      <button type="button" class="link" onclick={() => createTask(note)}>Create task</button>
      {#if note.employeeId}<button type="button" class="link" onclick={() => createPerformanceInput(note)}>Performance input</button>{/if}
      <span class="spacer"></span>
      <button type="button" class="icon-btn" aria-label={note.reviewedAt ? "Return note to review" : "Mark note reviewed"} title={note.reviewedAt ? "Return to review" : "Mark reviewed"} onclick={() => void toggleReviewed(note)}><Icon name={note.reviewedAt ? "review" : "check"} size={15} /></button>
      <button type="button" class="icon-btn" class:pinned={note.isPinned} aria-label={note.isPinned ? "Unpin note" : "Pin note"} title={note.isPinned ? "Unpin" : "Pin"} onclick={() => void togglePin(note)}><Icon name="pin" size={15} /></button>
      <button type="button" class="icon-btn" aria-label="Archive note" title="Archive" onclick={() => void archive(note)}><Icon name="archive" size={15} /></button>
    </div>
  </article>
{/snippet}

<style>
  .notes-page { max-width: 1240px; }
  .page-header { align-items: flex-end; margin-bottom: 1.2rem; }
  .page-header h1 { font-size: 1.9rem; letter-spacing: -.025em; }
  .intro { margin: .3rem 0 0; }
  .eyebrow, .capture-kicker { display: block; color: var(--accent); font-size: .68rem; font-weight: 800; letter-spacing: .11em; text-transform: uppercase; margin-bottom: .25rem; }

  .capture-card { position: relative; overflow: hidden; padding: 1.2rem 1.3rem 1.1rem; border: 1px solid color-mix(in srgb, var(--accent) 28%, var(--border)); border-radius: calc(var(--radius-lg) + 2px); background: linear-gradient(135deg, color-mix(in srgb, var(--accent-soft) 58%, var(--surface)) 0%, var(--surface) 58%); box-shadow: var(--shadow); }
  .capture-card::before { content: ""; position: absolute; inset: 0 auto 0 0; width: 4px; background: var(--accent); }
  .capture-topline { display: flex; gap: 1rem; align-items: flex-start; margin-bottom: .75rem; }
  .capture-topline h2 { margin: 0; font-size: 1.12rem; }
  .capture-date { margin-left: auto; color: var(--text-muted); font-size: .78rem; }
  .capture-card textarea { width: 100%; min-height: 7rem; border-color: color-mix(in srgb, var(--accent) 20%, var(--border-strong)); background: color-mix(in srgb, var(--surface) 92%, transparent); box-shadow: inset 0 1px 2px rgba(0,0,0,.04); font-size: 1rem; padding: .8rem .9rem; }
  .capture-footer { display: flex; align-items: center; gap: .65rem; margin-top: .65rem; }
  .capture-footer select { min-width: 9rem; }

  .workbench-toolbar { display: flex; align-items: center; gap: .55rem; flex-wrap: wrap; margin: 1.35rem 0 1rem; }
  .view-tabs { display: inline-flex; gap: .2rem; padding: .22rem; border: 1px solid var(--border); border-radius: 999px; background: color-mix(in srgb, var(--surface-2) 58%, transparent); }
  .view-tabs button { border: 0; border-radius: 999px; background: transparent; box-shadow: none; min-height: 1.9rem; padding: .25rem .7rem; color: var(--text-muted); }
  .view-tabs button.active { background: var(--surface); color: var(--text); box-shadow: var(--shadow-xs); }
  .view-tabs button span { display: inline-grid; place-items: center; min-width: 1.25rem; height: 1.25rem; margin-left: .22rem; border-radius: 999px; background: var(--surface-2); font-size: .68rem; }
  .workbench-toolbar input { min-width: 13rem; }

  .workbench-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(16rem, 20rem); gap: 1.25rem; align-items: start; }
  .workbench-grid.shelf-only { grid-template-columns: minmax(0, 42rem); }
  .day-group + .day-group { margin-top: 1.25rem; }
  .day-divider { display: flex; align-items: center; gap: .55rem; margin: 0 0 .55rem; }
  .day-divider::after { content: ""; height: 1px; flex: 1; background: var(--border); }
  .day-divider h2 { margin: 0; font-size: .8rem; letter-spacing: .04em; text-transform: uppercase; color: var(--text-muted); }
  .day-divider span { order: 3; display: grid; place-items: center; width: 1.45rem; height: 1.45rem; border-radius: 999px; background: var(--surface-2); color: var(--text-muted); font-size: .68rem; }
  .note-stack, .shelf-stack { display: grid; gap: .7rem; }

  .note-card { position: relative; padding: .9rem 1rem .55rem; border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--surface); box-shadow: var(--shadow-xs); transition: border-color .15s ease, box-shadow .15s ease, transform .15s ease; }
  .note-card:hover { border-color: color-mix(in srgb, var(--accent) 28%, var(--border)); box-shadow: var(--shadow); }
  .note-card.unreviewed::before { content: ""; position: absolute; left: -.23rem; top: 1.05rem; width: .42rem; height: .42rem; border-radius: 999px; background: var(--accent); box-shadow: 0 0 0 3px var(--bg); }
  .note-card.compact { padding: .8rem .85rem .45rem; }
  .note-meta { display: flex; align-items: center; gap: .45rem; min-height: 1.3rem; }
  .note-meta time { color: var(--text-muted); font-size: .68rem; }
  .purpose { display: inline-flex; padding: .12rem .5rem; border-radius: 999px; background: var(--surface-2); color: var(--text-muted); font-weight: 750; font-size: .67rem; letter-spacing: .02em; }
  .purpose-decision { background: color-mix(in srgb, #7b61a8 16%, var(--surface)); color: color-mix(in srgb, #7b61a8 78%, var(--text)); }
  .purpose-follow_up { background: var(--duesoon-bg); color: var(--duesoon-fg); }
  .purpose-reference { background: var(--accent-soft); color: var(--accent); }
  .review-dot { display: inline-flex; align-items: center; gap: .3rem; color: var(--text-muted); font-size: .66rem; }
  .review-dot span { width: .35rem; height: .35rem; border-radius: 999px; background: var(--accent); }
  .note-body { padding: .75rem .1rem .55rem; line-height: 1.55; overflow-wrap: anywhere; }
  .compact .note-body { max-height: 12rem; overflow: auto; }
  .context-row { display: flex; flex-wrap: wrap; gap: .4rem; padding: .25rem 0 .55rem; }
  .context-row span { display: inline-flex; align-items: center; gap: .3rem; padding: .18rem .45rem; border-radius: .35rem; background: var(--surface-2); color: var(--text-muted); font-size: .7rem; }
  .note-actions { display: flex; align-items: center; gap: .1rem; padding-top: .38rem; border-top: 1px solid color-mix(in srgb, var(--border) 72%, transparent); opacity: .72; transition: opacity .12s ease; }
  .note-card:hover .note-actions, .note-card:focus-within .note-actions { opacity: 1; }
  .note-actions .link { font-size: .72rem; }
  .note-actions .icon-btn { width: 1.8rem; height: 1.8rem; min-height: 1.8rem; }
  .note-actions .pinned { color: var(--accent); background: var(--accent-soft); }

  .reference-shelf { position: sticky; top: 1rem; padding: .8rem; border: 1px solid var(--border); border-radius: var(--radius-lg); background: color-mix(in srgb, var(--surface-2) 55%, transparent); }
  .shelf-heading { display: flex; gap: .6rem; align-items: center; padding: .2rem .2rem .7rem; color: var(--accent); }
  .shelf-heading div { display: grid; }
  .shelf-heading span { color: var(--text); font-weight: 750; font-size: .83rem; }
  .shelf-heading small { color: var(--text-muted); font-size: .68rem; }
  .shelf-empty { padding: .7rem .35rem; margin: 0; }

  .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }
  @media (max-width: 900px) {
    .workbench-grid { grid-template-columns: 1fr; }
    .reference-shelf { position: static; grid-row: 1; }
    .shelf-stack { grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr)); }
  }
  @media (max-width: 650px) {
    .notes-page { padding-left: 1rem; padding-right: 1rem; }
    .capture-card { padding: 1rem; }
    .capture-topline { display: block; }
    .capture-date { display: block; margin-top: .4rem; }
    .capture-footer { align-items: stretch; flex-wrap: wrap; }
    .capture-footer .spacer { display: none; }
    .capture-footer button { margin-left: auto; }
    .workbench-toolbar input, .workbench-toolbar select { flex: 1 1 100%; }
  }
</style>
