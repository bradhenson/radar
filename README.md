# Supervisor Assistant

A single-user, **local-first** supervisory cockpit: kanban board, attention dashboard, employee
profiles, performance-input capture, and training/leave/telework tracking — with **no server, no
telemetry, and no runtime network access**. Built from the specification in
`NIWC_Supervisor_Assistant_Project_Plan.txt`.

> **Boundary:** this is a software project, not an authorization to store government information in
> an unapproved application. Use invented or sanitized data until storage rules are confirmed.

## Quick start (development machine)

```
npm install
npm run dev        # dev server
npm test           # unit tests (domain rules, dates, backup round-trip)
npm run check      # svelte-check / TypeScript strict
npm run build      # production build + single-file inline + no-network scan
```

## Production artifact

`npm run build` produces, in `dist/`:

- `index.html` — **self-contained** (all JS/CSS inlined). Opens directly from a local file path
  with no server. `supervisor-assistant.html` is an identical copy with a friendlier name.
- The build fails if any external network reference is detected (`scripts/verify-no-network.mjs`).

To deploy to the operational machine, transfer `dist/supervisor-assistant.html` through an
authorized process and open it in the managed browser.

## Phase 0 — environment test (run this on NMCI first)

`environment-test/index.html` is a standalone page (no build step) that verifies what the managed
browser allows: JavaScript from a local file, IndexedDB create/write/read, **persistence across a
full browser restart**, JSON download/import, drag-and-drop, clipboard, and storage quota. It
exports a diagnostic report. Run it on the NMCI machine **before** trusting the main app with real
tracking data, and choose the storage posture accordingly (plan section 9.5):

- IndexedDB persists → use the app normally; export backups weekly.
- IndexedDB works but does not persist → treat every session as memory-only; export on exit,
  import on start (the app shows a "Memory-only storage" warning when IndexedDB is unavailable).
- JavaScript/local files blocked → this architecture is not viable there; see plan section 9.5-D.

## Data safety

- **Backups are first-class.** Settings → Export backup produces a JSON package with record
  counts; import validates everything, shows a preview, and never silently overwrites (it offers
  to export current data first and requires explicit confirmation to replace).
- All persistence goes through the `DataStore` interface (`src/data/DataStore.ts`);
  `IndexedDbDataStore` is the working store, `InMemoryDataStore` the fallback and test double.
- "Reset all data" requires typing a confirmation phrase.
- Backup reminders surface on the Today dashboard after 7 days or 50 changes (configurable).

## What's implemented (v0.1.0)

Plan phases 0–6 plus a simple awards list:

- **Today**: explainable attention items (overdue / due today / due soon / reminder / waiting too
  long / stale / training / telework / leave / backup), snooze, 14-day lookahead, recently
  completed with one-click performance-input conversion.
- **Board**: editable visual columns, drag-and-drop card movement, draggable column reordering,
  keyboard card movement (`[`, `]`, `C`, `Enter`), filters, gap-based ordering. Board columns
  organize cards visually; task progress is tracked separately by each task's status.
- **Tasks**: detailed creation/edit dialog from the start, auto-save on close, status and board
  column fields, editable categories, notes, checklists, tags, waiting metadata, activity history
  with concise changed-field summaries, archive/restore.
- **Employees**: directory with workload columns, CSV export, 360° profile (tasks, performance,
  training, leave, telework, awards, activity), check-in recording.
- **Performance**: Context/Action/Result/Impact capture, completion-to-input conversion prompt,
  coverage table, text export for evaluation preparation.
- **Training**: requirements, bulk assignment (all/by competency), employee × requirement matrix,
  completion with expiration calculation, due warnings.
- **Leave / Telework**: broad availability records with verification dates, overlap warnings,
  expiration/pending-action attention.
- **Reports**, **Archive**, **Settings** (thresholds, theme, editable board columns, editable task
  categories, health check, sample data).

Not yet implemented (later phases): recurring-task templates (Phase 7), saved views, global
search, bulk actions, merge-on-import, print views. See `CHANGELOG.md`.

## Keyboard shortcuts

`N` new task · `P` new performance input · `T` Today · `B` Board · `E` Employees ·
on a focused card: `[`/`]` move, `C` complete, `Enter` open · `Esc` closes dialogs.

## Repository rules

See `CLAUDE.md` for the working rules every change must follow (no network dependencies, DataStore
abstraction, strict TypeScript, no real personnel data anywhere, etc.).
