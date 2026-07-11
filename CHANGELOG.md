# Changelog

## Unreleased

### Changed

- Visual polish pass (decorative only; all motion respects reduced-motion preferences):
  - The board now fills the window exactly — no permanent window scrollbar; long lanes scroll
    their own cards internally.
  - Hovering a row in any data table (Today, Employees, Training, Leave, …) slides a small
    accent tick into the row's leading edge as a second, non-color cue that the row is clickable.
  - The brand tile shows a slow rotating radar sweep behind the icon.
  - Board column headers carry a soft wash of their own status color, and the header status dot
    gets a matching glow.
  - Every dialog carries a thin accent gradient hairline across its top edge.
  - Empty-state panels show an animated radar "ping" (steady accent dot with expanding rings).

- Removed the task-level **Waiting on**, **Waiting reason**, and **Follow-up date** fields and the
  follow-up-date alert. Existing values are removed when the app starts or an older backup is
  imported; the Waiting status and its age-based attention alert remain.

### Fixed

- Editing an imported or previously detailed project, award, leave, telework, or travel record no
  longer clears fields that its quick form does not expose.
- Employee-deletion confirmation now lists travel records and every linked record that will be
  retained but unlinked (tasks, meeting attendance, project leadership, and training assignment).
- Record writes, activity history, backup-change metadata, and cascading deletions now commit as a
  single transaction. A failed cascade leaves both memory and storage unchanged.
- Backup export no longer clears the backup reminder until the user confirms the downloaded file
  exists. Replacing data after an export is impossible until that confirmation succeeds.
- Backup import now has versioned format migration, checksum/count verification, strict record and
  settings validation, duplicate-ID and duplicate-training-record detection, and import limits.
- Travel and telework month views now render all weeks in six-row months. Telework agreement alerts
  and travel/award alerts open the relevant record instead of a generic, filtered list.
- Default Waiting and Complete board lanes now synchronize task status, including completion moving
  a card to the Complete lane.
- CSV exports neutralize spreadsheet formula prefixes, and employee CSV exports default to a
  minimal operational column set; sensitive columns require an explicit choice.

### Added

- Title-first **Quick Add** task dialog (`Q`) for rapid capture without opening the full task editor.
- Attention severity/summary filters, collapsible top-N groups, Travel and Award lookahead items,
  privacy-aware employee export selection, responsive compact navigation, and accessible employee
  tabs/navigation state.
- Single-writer IndexedDB protection, safe takeover/retry screens, and a coherent point-in-time
  snapshot for backup export.
- `npm run verify` and stricter single-file build checks that fail if JavaScript or CSS is not
  successfully inlined for `file://` operation, plus `npm run smoke:file` for an Edge-based
  first-run/reload persistence probe of the actual artifact.

### Changed

- Board remains RADAR's default cockpit. Today is enhanced as an action queue but is not the startup
  page.
- Dialogs now restore focus, begin at the first useful field, avoid disabled controls in the focus
  trap, and warn before accidental backdrop/Escape dismissal of changed forms.
- Unmodified single-key shortcuts can be disabled in Settings.

### Fixed
- Dialog footers with a Delete button (Leave, Situational Telework, Projects) no longer show an
  uneven gap next to Delete. The layout spacer only pushed content apart inside toolbars, so in
  those footers it collapsed and merely doubled the gap beside Delete; it now separates Delete to
  the far left consistently, matching the Awards dialog.

### Changed
- Browser storage is now treated more explicitly as RADAR's working copy, not the durable copy:
  backup reminders default to daily after changed records (or 10 changed records), legacy default
  settings migrate to that posture, and the backup attention item stays quiet when nothing has
  changed since the last export.
- Meeting notes now auto-save when you dismiss the dialog (click outside it, press Escape, or use
  the ✕) instead of discarding your edits, as long as a title is present and something changed. If
  the title is still empty the dialog stays open with the "Title is required" message so nothing is
  lost. The **Cancel** button remains the explicit way to discard changes.
- Row and dialog action buttons for Edit, Delete, Archive, Restore, and Remove are now icon
  buttons (pencil / trash / archive box / restore) instead of text, for a cleaner, more compact
  look. Each keeps an accessible label and a hover tooltip, and the destructive ones stay neutral
  until hovered so lists aren't a wall of red. Labelled "Add …" actions remain text buttons.

### Added
- A compact top-bar **Export JSON** button now sits beside the save-status chip, so full backups
  can be exported without opening Settings.
- The app shell now shows a recovery banner when no RADAR records are found in the browser, with a
  direct path to Settings -> Import backup for cases where managed browser storage was cleared.
- Settings now reports browser persistent-storage status, storage estimate availability, and offers
  a "Request persistent storage" action when the browser exposes that API. The page also makes clear
  that enterprise cleanup or profile policy can still remove browser data.
- New **Travel** section (under People) for tracking who is on travel: destination, travel dates,
  IPT concurrence, DTS authorization status and ID, and the DTS voucher due date (which defaults to
  5 days after the return date but can be overridden). Includes list and calendar views, add/edit/
  delete, per-employee filtering, a "show past travel" toggle, voucher due-soon/overdue badges, and
  CSV export. Travel records are removed with their employee like other people records.
- Projects can now be deleted, from either the row Delete button or the Edit Project dialog. A
  confirmation dialog lists how many tasks, meeting notes, and performance inputs reference the
  project; those records are kept but unlinked from the project so nothing points at a project
  that no longer exists.

### Changed
- Leave list is simpler: the advisory "Warnings" column and the ERP "Verified" column (and the
  "Mark verified" action) are gone, and the Add/Edit Leave dialog no longer has a "Verified against
  ERP on" field. Existing verification data on records is preserved but no longer shown or edited.
  The Leave and Situational Telework list views now use the standard page width (matching the
  Training and Awards tables) instead of stretching edge to edge; each page's calendar view still
  spans full width.
- Performance inputs are now edited by clicking the card itself instead of a separate Edit
  button. The date acts as the keyboard/screen-reader handle, the inline Status dropdown still
  works without opening the editor, and selecting text to copy no longer triggers an edit.
- The Leave, Situational Telework, Awards, Training requirements, and Projects lists now open the
  editor when you click a row, replacing the per-row Edit button. The first cell (employee name,
  award title, requirement, or project name) stays a focusable link as the keyboard/screen-reader
  path; Delete, Track, Add task, and Mark-verified remain explicit buttons; and selecting text to
  copy no longer triggers an edit. On Projects, a disclosure caret next to the name expands the
  task list (previously the name itself toggled it).
- Row-title links in data tables are now styled as ordinary text that reveals the accent color on
  hover, rather than always-on blue links.
- Employee directory refresh: summary tiles at the top (overdue tasks, training due, employees
  with no performance input in 30+ days, on leave now — all reflecting the current filters),
  sortable columns (Name, Competency, Open, Overdue, Training due, Last input; numeric columns
  sort worst-first on first click), status shown as a badge, an "On leave" badge when leave is
  in progress, stale or missing performance-input dates highlighted, right-aligned numeric
  columns, em-dashes for empty cells, and click-anywhere rows to open the employee detail page
  (the name link remains the keyboard path). CSV export follows the on-screen sort order.
- Task categories have been removed: the category field on tasks, the colored category chip on
  board cards, the board's category filter, and the Task categories section in Settings are all
  gone. Board columns and tags cover the same organizing needs with less bookkeeping. Existing
  data and old backups still import cleanly; the stored category value is simply ignored.
- Task status is simplified to Open, Waiting, and Complete (Cancelled is still recognized in
  imported data). The old workflow-stage statuses — Not Started, Planned, In Progress, Needs
  Review — duplicated the customizable board columns and are now collapsed into "Open"
  automatically when existing data or a backup is loaded. Board column placement is unchanged.
- Employee creation is now lighter-weight: competency is optional, and title/contact/IPT-style
  details live in the employee profile instead of the initial add dialog.
- Employee directory and CSV export now use "Title" and "Integrated Product Team" terminology;
  the CSV export includes the new employee profile fields.
- Removed the persistent data-use caution footer and matching About-page caution text.
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
- Completing the performance-input loop: after saving a new performance input created from a
  completed task, the app now offers to archive that task (Undo available). Together with the
  existing completion prompt, the flow is complete task → create prefilled performance input →
  archive the task, each step confirmed and skippable.
- Employees can now be permanently deleted, from the employee page header or from the inactive
  employees list in the Archive. Deletion asks for confirmation with an exact count of what goes
  with it: the employee's performance inputs, training records, leave, telework, awards,
  check-ins, and notes are deleted; tasks and meeting notes are kept but unlinked, and project
  lead / training assignments are cleared. Marking an employee inactive remains the
  recommendation when history might still be needed.
- Employee notes: the Overview tab of each employee now has a Notes section for standing
  things to remember about the person (preferences, goals, constraints) — distinct from dated
  check-ins. Notes can be added, edited, and removed inline; removal archives the note with an
  Undo toast, and all changes appear in the employee's activity log. Notes are included in
  backup export/import and in the sample data.
- Employee profiles now include a Profile tab for administrative and contact details: EDIPI,
  PERNR, series, location, phones, employee-specific project and project lead, IPT lead,
  computer asset, gov phone, CSWF data, financial statement/drug test flags, telework agreement
  valid-through date, and clearance.
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
