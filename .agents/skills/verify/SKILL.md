---
name: verify
description: Build and drive the RADAR single-file app end-to-end over file:// in system Edge to verify a change at its real surface.
---

# Verifying RADAR changes

The production surface is `dist/index.html` opened over `file://` — always verify against the
built file, never the dev server (module inlining and no-network behavior only exist post-build).

## Recipe

1. `npm run build` (includes single-file inline + no-network verification).
2. Write a Playwright script (ESM, in the scratchpad) and run it with `node`:
   - Resolve Playwright from this repo:
     `createRequire("c:/.../SupervisorAssistant/package.json")("playwright")`.
   - `chromium.launch({ channel: "msedge", headless: true })` — system Edge, no browser download.
   - Navigate with hash routes: `file:///.../dist/index.html#/settings`, `#/board`,
     `#/performance`, etc. `page.reload()` preserves IndexedDB, so it tests persistence.
3. First step is always: Settings → "Load sample data" → confirm in the dialog (the confirm
   button has the same label; scope to `getByRole("dialog")`).

## Gotchas

- Toasts live in a `[role="status"]` container and stack for 8s; identical toasts from repeated
  saves collide with `getByText(...)` — use `.last()`, and scope other status reads (e.g.
  `.import-box [role="status"]`).
- Dialogs are real `role="dialog"` elements with accessible names from their titles; when two can
  be open (form over prompt), scope button clicks to the named dialog.
- Form controls have stable ids (`#pi-emp`, `#pi-action`, ...); prefer those over labels inside
  dense forms.
- Seed data (`src/data/seed.ts`) has NO completed tasks; to test completed-task flows, complete
  one first (open a board card → "Complete" button), which also exercises the
  "Create performance input?" prompt.
- Watch `page.on("pageerror")` — Svelte runtime errors otherwise fail silently over `file://`.
