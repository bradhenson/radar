# RADAR

**Reporting, Administration, Delegation, Analytics & Review**: a single-user, **local-first**
supervisory cockpit with a kanban board, attention dashboard, employee profiles,
calendar planning, performance-input capture/editing, meeting notes, and training/leave/telework
tracking — with **no server, no telemetry, and no runtime network access**. Built from the specification in
`NIWC_Supervisor_Assistant_Project_Plan.txt`.

RADAR is intended to run in an environment authorized for the employee profile information tracked
by the application. Repository fixtures, tests, screenshots, and sample data remain synthetic.

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
  with no server. `radar.html` is an identical copy with a friendlier name; the build also keeps
  a legacy `supervisor-assistant.html` copy for compatibility.
- The build fails if any external network reference is detected (`scripts/verify-no-network.mjs`).

To deploy to the operational machine, transfer `dist/radar.html` through an authorized process and
open it in the managed browser.

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

## What's implemented

Plan phases 0–6, plus calendar planning, meetings, color themes, and a simple awards list:

- **Today**: explainable attention items (overdue / due today / due soon / reminder / waiting too
  long / stale / training / telework / leave / backup), snooze, 14-day lookahead, recently
  completed with one-click performance-input conversion. Summary cards and attention tables use
  fixed alignment so the dashboard scans cleanly.
- **Kanban Board**: editable visual columns, drag-and-drop card movement, draggable column
  reordering, keyboard card movement (`[`, `]`, `C`, `Enter`), filters, gap-based ordering, and
  hover/focus card highlighting. Board columns organize cards visually; task progress is tracked
  separately by each task's status.
- **Calendar**: month view for task due dates, leave, and situational telework. Layers can be
  toggled independently and filtered by employee. Tasks can be rescheduled by drag-and-drop, moved
  by keyboard, cleared into a "No due date" tray, or created directly on a day.
- **Tasks**: detailed creation/edit dialog from the start, auto-save on close, status and board
  column fields, editable categories, notes, checklists, tags, waiting metadata, activity history
  with concise changed-field summaries, archive/restore.
- **Employees**: directory with workload columns, configurable competencies, CSV export, 360°
  profile (tasks, performance, meeting notes, training, leave, telework, awards, activity),
  check-in recording.
- **Performance**: Context/Action/Result/Impact capture, edit existing inputs, import from tasks,
  completion-to-input conversion prompt, coverage table, text export for evaluation preparation.
- **Meetings**: product-team meeting note capture with linked employees/projects, discussion
  notes, action items, CSV export, archive/restore, and follow-up task creation.
- **Training**: requirements, bulk assignment (all/by competency), employee × requirement matrix,
  completion with expiration calculation, due warnings.
- **Leave / Telework**: leave availability records plus situational telework request tracking,
  request calendar, email-reference fields, CSV export, and pending-action attention.
- **Archive**, **Settings** (thresholds, light/dark/system theme, accent color palettes,
  editable competencies, editable board columns, editable task categories, health check, sample
  data).

Not yet implemented (later phases): recurring-task templates (Phase 7), saved views, global
search, bulk actions, merge-on-import, useful reporting/print views. See `CHANGELOG.md`.

## Keyboard shortcuts

`N` new task · `P` new performance input · `T` Today · `B` Board · `E` Employees · `M` Meetings ·
on a focused board card: `[`/`]` move, `C` complete, `Enter` open · on a focused calendar task:
`[`/`]` moves by day and `{`/`}` moves by week · `Esc` closes dialogs.

## Repository rules

See `CLAUDE.md` for the working rules every change must follow (no network dependencies, DataStore
abstraction, strict TypeScript, no real personnel data anywhere, etc.).
