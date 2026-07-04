# Changelog

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
- Reports (overdue by employee, open by category, training windows, verification aging) and
  task CSV export; employee CSV export.
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
