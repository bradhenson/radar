# RADAR

**Reporting, Administration, Delegation, Analytics & Review**: a single-user, **local-first**
supervisory cockpit with a kanban board, attention dashboard, employee profiles,
calendar planning, performance-input capture/editing, meeting notes, and training/leave/telework
tracking — with **no server, no telemetry, and no runtime network access**. Built from the specification in
`Project_Plan.txt`.

RADAR is intended to run in an environment authorized for the employee profile information tracked
by the application. Repository fixtures, tests, screenshots, and sample data remain synthetic.

## Quick start (development machine)

```
npm ci
npm run dev        # dev server
npm run verify     # strict check + unit tests + production build
```

RADAR requires Node `^20.19.0 || >=22.12.0`. `npm run check`, `npm test`, and
`npm run build` remain available separately when iterating on a focused change.
After a build, `npm run smoke:file` opens the generated artifact in system Edge,
checks the Board default route, performs Quick Add, reloads, and rejects any
network request or console error.

## Production artifact

`npm run build` produces, in `dist/`:

- `index.html` — **self-contained** (all JS/CSS inlined). Opens directly from a local file path
  with no server. `radar.html` is an identical copy with a friendlier name; the build also keeps
  a legacy `supervisor-assistant.html` copy for compatibility.
- The build fails if any external network reference is detected (`scripts/verify-no-network.mjs`).

To deploy to the operational machine, transfer `dist/radar.html` through an authorized process and
open it in the managed browser.

## Optional Windows desktop artifact

RADAR can also be packaged as a Wails v2 desktop executable backed by SQLite. This is an optional
distribution; the self-contained browser artifact above remains supported and unchanged.

Prerequisites on the development machine are Go 1.25+, Wails CLI 2.13.x, Node/npm, and the normal
Windows Wails toolchain. Build and test it with:

```
npm ci
npm run build:desktop
cd desktop && go vet ./... && go test ./...
cd .. && npm run smoke:desktop
```

`npm run build:desktop` creates `desktop/build/bin/RADAR.exe`, embeds the same single-file frontend,
and uses Wails' `error` WebView2 strategy so the executable never downloads a runtime. The target
machine must already have WebView2. By default data is stored in
`%LOCALAPPDATA%\RADAR\radar.db`; placing an existing `radar.db` beside `RADAR.exe` selects portable
mode. The desktop store uses single-file rollback journaling so committed records remain in that
file without a separate `-wal` companion. Settings shows the active database path and size. JSON
backups remain the canonical portable copy, and desktop exports use the native Windows save dialog.
Desktop Settings can open an existing validated RADAR `.db`, create a new database at an exact
filename and location, remember that file for future launches, or open its folder in File Explorer.

The desktop smoke launches the packaged executable with an isolated portable database, verifies
that the frontend crossed the Wails bridge and initialized SQLite, then relaunches and confirms the
same database lineage remains. UI workflows should also be checked in the real executable for
release changes.

## Optional MCP server (LLM assistant over your data)

`mcp/` contains a development-machine [MCP](https://modelcontextprotocol.io) server that points an
LLM client you already use — Claude Code, Codex CLI (ChatGPT subscription), Claude Desktop — at
your `radar.db`, so you can ask in plain language for summaries ("what needs my attention?") and
record work ("create a task for … by Friday", "update their cube number"). It uses your existing
LLM subscription, holds no API key, and makes no network calls of its own; the shipped browser and
desktop artifacts are unchanged. Writes are transactional, recorded in activity history, and an
open desktop window reloads automatically when the server commits. Setup, the full tool reference,
and the privacy caveat (tool results do go to your LLM provider) are in **`mcp/README.md`**.

## Phase 0 — environment test (run this in a managed environment first)

`environment-test/index.html` is a standalone page (no build step) that verifies what the managed
browser allows: JavaScript from a local file, IndexedDB create/write/read, **persistence across a
full browser restart**, JSON download/import, drag-and-drop, clipboard, and storage quota. It
exports a diagnostic report. Run it on the managed workstation **before** trusting the main app with real
tracking data, and choose the storage posture accordingly (plan section 9.5):

- IndexedDB persists → use the app normally; export backups weekly.
- IndexedDB works but does not persist → treat every session as memory-only; export on exit,
  import on start (the app shows a "Memory-only storage" warning when IndexedDB is unavailable).
- JavaScript/local files blocked → this architecture is not viable there; see plan section 9.5-D.

## Data safety

- **Backups are first-class.** Settings → Export backup produces a JSON package with record
  counts and a checksum. The backup reminder is cleared only after the user confirms that the
  download exists. Import validates the package structure, field types, enums, dates, timestamps,
  duplicate IDs, training-record uniqueness, counts, and checksum before it can replace data.
- **Edits are transactional.** A record change, its activity entry, and the backup-change count
  commit together. Cascading deletes either complete as one operation or leave the database intact.
- All persistence goes through the `DataStore` interface (`src/data/DataStore.ts`);
  `IndexedDbDataStore` is the browser working store, `WailsDataStore` uses SQLite in the desktop
  shell, and `InMemoryDataStore` is the browser fallback and test double.
- Only one RADAR window may edit a database at a time. A second window offers a safe retry or an
  explicit takeover rather than silently allowing stale writes.
- "Reset all data" requires typing a confirmation phrase.
- Backup reminders surface on the Today dashboard after 7 days or 50 changes (configurable).

## What's implemented

Plan phases 0–6, plus calendar planning, meetings, color themes, and a simple awards list:

- **Board**: RADAR opens to the Board by default. Editable columns support drag-and-drop,
  keyboard card movement (`[`, `]`, `C`, `Enter`, `Alt`+arrow), and gap-based ordering. Default
  Waiting and Complete lanes update task status; custom lanes can remain visual-only.
- **Today**: explainable attention items, severity and summary filters, top-N/collapsible groups,
  snooze, direct record links, and a 14-day lookahead that includes travel and award deadlines.
- **Calendar**: dynamically sized month view for task due dates, leave, situational telework,
  travel, and award deadlines. Layers can be toggled independently and filtered by employee.
- **Tasks**: title-first Quick Add plus a detailed editor with notes, checklists, tags, waiting
  metadata, activity history, and archive/restore.
- **Employees**: directory with workload columns, sortable/sticky wide-table behavior, configurable
  competencies, privacy-aware CSV export, and a 360° profile (tasks, performance, meetings,
  training, leave, telework, travel, awards, activity).
- **Performance**: Context/Action/Result & Impact capture, edit existing inputs, import from tasks,
  completion-to-input conversion prompt, coverage table, text export for evaluation preparation.
- **Meetings**: product-team meeting note capture with linked employees/projects, discussion
  notes, action items, CSV export, archive/restore, and follow-up task creation.
- **Training**: requirements, employee × requirement matrix, completion with expiration
  calculation, and due warnings.
- **Leave / Telework / Travel / Awards**: calendar/list tracking, CSV export, direct links from
  attention items, agreement expiry, voucher, paperwork, and nomination-deadline attention.
- **Archive**, **Settings** (thresholds, light/dark/system theme, accent palettes, editable
  competencies and board columns, data-health checks, sample data, backup import/export).

Not yet implemented (later phases): recurring-task templates (Phase 7), saved views, global
search, bulk actions, merge-on-import, useful reporting/print views. See `CHANGELOG.md`.

## Keyboard shortcuts

`N` new task · `Q` quick add · `P` new performance input · `T` Today · `B` Board · `E` Employees ·
`M` Meetings · on a focused board card: `[`/`]` move, `C` complete, `Enter` open, `Alt`+arrow
reorders · on a focused calendar task:
`[`/`]` moves by day and `{`/`}` moves by week · `Esc` closes dialogs.

Single-key shortcuts can be disabled in Settings for assistive-technology compatibility.

## Repository rules

See `AGENTS.md` for the working rules every change must follow (no network dependencies, DataStore
abstraction, strict TypeScript, no real personnel data anywhere, etc.).
