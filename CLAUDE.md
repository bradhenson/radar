# Supervisor Assistant — coding agent working rules

Read `Project_Plan.txt` before architectural changes. These rules come
from plan section 38 and are binding for every change.

## Hard constraints
1. **No runtime network dependency.** No CDN scripts, fonts, icons, analytics, telemetry, remote
   logging, or update checks. `npm run build` runs `scripts/verify-no-network.mjs` and must pass.
2. **No backend.** The production build must open from a local file path (`file://`) with no
   server, no service workers, no Node on the operational machine. Keep asset paths relative.
   Module scripts are inlined post-build (`scripts/build-single-file.mjs`) because external
   module scripts do not load over `file://`.
3. **All persistence goes through the `DataStore` interface** (`src/data/DataStore.ts`). Never
   call IndexedDB from UI components or pages.
4. **No real employee names or sensitive information** in code, tests, fixtures, screenshots,
   or docs. Sample data is fictional (`src/data/seed.ts`).
5. TypeScript strict mode; `npm run check` must report 0 errors.
6. Treat imported data as untrusted: validate structurally (`src/data/backup.ts`) and always
   render user text as text (Svelte default escaping — never `{@html}` with user content).
7. Never silently delete or overwrite records. Destructive actions need confirmation (typed
   phrase for full reset) and/or an Undo toast. Prefer `isArchived` over deletion.
8. Date-only fields are `YYYY-MM-DD` strings compared with date-only logic (`src/utils/dates.ts`).
   Never convert calendar dates through midnight timestamps.
9. Important mutations record an `ActivityEntry` (handled by `app.putRecord`'s activity option).
10. Keyboard accessibility: every drag interaction has a keyboard alternative; dialogs trap focus
    and close on Escape; color is never the only status indicator.

## Before considering any task complete
Run all of:
```
npm run check   # 0 errors required
npm test        # all tests pass
npm run build   # includes single-file inline + no-network verification
```
Add unit tests for new domain rules (`tests/unit/`). Update `CHANGELOG.md` for user-visible
changes. Do not add dependencies without explaining why; keep them dev-only and pinned via the
lockfile.

## Layout
- `src/domain/` — models and pure rules (attention engine, due states, board ordering). Keep pure
  and unit-tested; no DOM or store imports.
- `src/data/` — DataStore interface/implementations, backup, seed.
- `src/stores/app.svelte.ts` — reactive state + service layer; all mutations flow through here.
- `src/pages/`, `src/components/` — Svelte 5 (runes) UI.
- `environment-test/` — standalone Phase 0 capability probe; keep it dependency-free.

## Verification tip
A full end-to-end smoke test of the built file over `file://` can be run with Playwright against
system Edge (`channel: "msedge"` — no browser download). See git history / scratchpad `smoke.mjs`
pattern: boot → load sample data → board → quick add → reload persistence → backup download.
