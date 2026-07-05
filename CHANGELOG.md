# Changelog

## Unreleased

### Changed
- Competencies are now configurable in Settings instead of being seeded as fixed first-run values.
  Active competencies appear in employee forms and training bulk-selection shortcuts; inactive
  competencies remain attached to existing records and can be reactivated.
- Meeting note linked employees now use an add picker with removable selected employees instead
  of rendering every active employee as a checkbox.
- Reports has been removed from the active navigation for now; the current page was not adding
  enough value compared with the focused Today, Employees, Performance, Training, and export views.
- Sample data now represents a larger supervisory workload: 40 fictional employees, 10 training
  requirements, mostly supervisor-owned task cards, and broader performance input, leave,
  telework, meeting, award, and check-in examples.
- Training redesign: due dates and assignment now live on the requirement instead of on each
  employee's record. An annual requirement holds one shared due date for everyone (move it
  forward when the next cycle starts and completions reset automatically); a "repeats after
  completion" schedule derives each person's expiration from their completion date. Requirements
  apply to all active employees by default (new hires inherit them automatically) or to a
  selected list of employees for one-off needs. The bulk-assign toolbar and the category field
  are gone.
- New per-requirement roster view (the "Track" button): employees sorted incomplete-first with
  one-click "Complete", multi-select + shared completion date for bulk entry, and Undo. The
  matrix is now an optional compact overview (symbol + color per cell, click to edit details);
  per-employee due-date overrides, waivers, and verification dates remain in the details dialog.
- Training matrix cells now show plain colored status marks instead of pill badges, and the
  employee-name column shrinks to fit the longest name so the requirement columns start closer
  to it. Cells remain clickable (with a hover highlight) to open the record editor.
- Situational telework tracking is simplified to the fields that matter: Employee, Status,
  Request received, Telework start, Telework end, and Notes. Status is now just Pending, Approved,
  Denied, or Cancelled (the earlier draft/pending-employee/pending-supervisor/pending-approval/
  active/expired workflow states are gone from this view). The schedule/coverage, email-record,
  and reviewed-on fields were removed from the form, list, and CSV export.
- Employee profiles and the Today page derive training status from the same shared
  rule, so an employee with no record still shows as due once a requirement applies to them.
- When many employees are due for the same requirement, the attention list shows one aggregated
  line (for example "Annual Cybersecurity Awareness — 12 employees") instead of one row per
  person.

### Added
- Calendar page (sidebar, between Board and Employees): a combined month view showing task due
  dates alongside leave days and situational telework days (matching the Telework page's
  calendar). Each layer — tasks, leave, telework — can be toggled independently (tasks on by
  default, leave and telework off), and the whole view can be filtered by employee.
- Drag a task chip to another day to reschedule it, or drop it on the "No due date" tray to
  clear the due date. Keyboard alternative: focus a chip and use `[` / `]` to move the due date
  by a day, `{` / `}` by a week (Enter opens the task detail, where the date can also be edited
  directly). Reschedules are recorded in the activity log.
- Each day has a hover/focus "+" button to create a task due that day; leave and telework chips
  link to their respective pages.
- Performance inputs can now be edited after creation: each input on the Performance page has an
  Edit button that reopens the full Context/Action/Result/Impact form (previously only the status
  could be changed).
- "Import from task" inside the performance input form (new and edit): pick any of the selected
  employee's tasks (or any task, if no employee is chosen) and pull its details into the form.
  The task title and completed checklist items become the Action, the description becomes the
  Context, completion notes become the Result, and the employee, project, and completion date
  carry over. Importing only fills fields that are still empty — text already typed is never
  overwritten, and a notice lists any fields that were kept.
- The existing task-to-input shortcuts (the prompt after completing a task, and the Today page's
  "→ Performance input" button) now use the same richer mapping, so they also prefill Context and
  Result from the task's description and completion notes.

- Color themes: Settings → Appearance now offers six accent palettes — Default (blue), Ocean,
  Forest, Violet, Sunset, and Graphite — each with matching light and dark variants. The choice
  is saved with settings and included in backups; older backups load with the Default theme.

### Changed
- Dark mode now uses flat neutral greys (in the style of VS Code's dark theme) instead of the
  previous blue-tinted dark palette.
- Task dialog: the Notes section now sits below the Checklist section (previously side by side),
  so both get the dialog's full width.

### Fixed
- Restore from backup ("Replace Database") failed with "Import failed: Failed to execute 'put'
  on 'IDBObjectStore': #<Object> could not be cloned". The parsed backup was held in Svelte
  `$state` (a Proxy), which IndexedDB's structured clone rejects; the package is now unwrapped
  with `$state.snapshot` before being written, matching every other persistence path.

## 0.1.2 — 2026-07-04

### Changed
- Cleaner, Planner-style board cards: tags no longer appear on cards, and the redundant status
  badge was removed (the column already conveys it). Cards show only the category label, title,
  project, relevant date/priority/waiting chips, and assignee.
- New "Show on card" option (task detail): choose to preview either the description (3-line
  clamp) or the checklist directly on the card, Planner-style. Checklist items shown on a card
  can be checked off in place without opening the task; progress (for example "2/3") moves to
  the card footer while the preview is visible.
- Sample data now demonstrates both previews.

## 0.1.1 — 2026-07-04

### Changed
- Full visual redesign: refreshed design tokens (cool neutral palette, larger radii, layered
  shadows, refined dark theme), modern data tables with row hover, gradient primary buttons,
  accent-striped stat tiles, restyled empty states.
- App shell: icon-based side navigation (bundled inline SVG, no external icon fonts), pill-style
  save-status chip, quick light/dark theme toggle in the top bar, backup age moved to the
  sidebar footer.
- Board (building on the Planner-style pass): retained bucket colors, category label chips,
  assignee avatars, inline per-column task add.
- Dialogs and toasts: elevated surfaces, larger radii, subtle open animations (disabled under
  reduced-motion preference).
- Removed backdrop-filter frosted-glass effects in favor of solid surfaces for reliability on
  managed enterprise browsers.

## 0.1.0 — 2026-07-04

Initial implementation from the project plan (phases 0–6, plus a basic awards list).

### Added
- Phase 0 environment test page (`environment-test/index.html`): standalone browser-capability
  probe with persistence-across-restart procedure and exportable diagnostic report.
- Svelte 5 + TypeScript (strict) + Vite application skeleton; hash routing that works from
  `file://`; light/dark/system theme; persistent data-classification footer notice.
- `DataStore` abstraction with `IndexedDbDataStore` (working storage) and `InMemoryDataStore`
  (fallback + tests). Automatic fallback with a visible "Memory-only storage" warning.
- Task model with notes, checklists, tags, source-system references, waiting metadata, and
  activity history. Quick Add (title-only, <15s capture) and full task detail dialog.
- Kanban board: six default columns, HTML5 drag-and-drop with placeholder and Escape cancel,
  keyboard movement alternative, gap-based ordering with renormalization support, filters
  (search/employee/competency/project/category/priority), completed-cards visibility window.
- Attention engine (pure, tested): overdue, due today, due soon, reminder reached, follow-up
  reached, waiting too long, stale; employee rules (no recent input/check-in, multiple overdue);
  training due/expiring; leave begins soon; telework pending/expiring/expired; backup age and
  change-count rules. Every item carries reason text, severity, and suggested action. Snooze
  with persisted expiry.
- Today dashboard: summary counts, grouped attention queue, 14-day lookahead strip, recently
  completed with performance-input conversion.
- Employee directory + 360° profile with tabs and check-in (EmployeeInteraction) recording.
- Projects directory with inline task lists.
- Performance inputs: CARI structured capture, completion conversion prompt, coverage table,
  grouped review, plain-text export.
- Training requirements, bulk assignment, matrix view, completion with expiration calculation.
- Leave and telework tracking with verification dates and advisory overlap warnings.
- Employee CSV export.
- Backup: full JSON export package with record counts; import with validation, preview,
  export-current-first option, and confirmed replace. Typed-phrase "reset all data".
  Database health check (orphan references, record counts).
- Sample (fictional) seed data.
- 48 unit tests (dates/boundaries, due states, attention rules, board ordering, backup
  round-trip and rejection cases).
- Build pipeline: relative-path build, post-build inlining to a self-contained
  `supervisor-assistant.html`, and a no-network verification scan that fails the build on any
  external reference.

### Known gaps (planned for later phases)
- Recurring task templates (Phase 7), saved views, global search, bulk actions, import merge
  mode, print-friendly report views, employee merge tool, evaluation cycles UI.
