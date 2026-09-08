# Workspace design preview

Branch: `codex/workspace-redesign`. This is a reviewable design iteration; it has not been merged into main.

The focus is Tasks, Telework, Travel, and Leave. The original Work, People, and System navigation order is preserved, the four pages share a header and action pattern, and the app uses quieter surfaces with a blue default accent. Existing palettes and the three appearance choices remain available.

On Tasks, try **Compact cards**, switch between Board and List, and open and close a task. Your filters, sort, density, and horizontal board position return during the same app session. Reloading starts a fresh presentation session; records remain persisted as before.

On Telework, Travel, and Leave, try the search field, employee filters, Clear filters, and List/Calendar controls. Search covers employee names and relevant visible record fields. Existing pay-period calculations, travel lifecycle groups, dialogs, exports, and task mutations remain in place.

## Try the build

- Browser: open `dist/radar.html` directly in Edge. No server is needed.
- Windows desktop: `desktop/build/bin/RADAR.exe`.
- Settings → Load sample data provides fictional records for an isolated test profile or database.

The data schema and backup format have not changed. No dependencies were added.

## Verification

`npm run check`, `npm test`, and `npm run build` check types, domain behavior, bundling, and offline references. `npm run smoke:file` verifies creation and persistence; `npm run smoke:workspace` covers the redesigned interactions and viewport sizes against the built file in system Edge.

For screenshots, run `RADAR_SCREENSHOTS=/tmp/radar-preview npm run smoke:workspace`.

The Windows executable cross-builds with the `error` WebView2 strategy. Go vet/tests pass. Its launch smoke timed out on the Linux development host; launch and persistence in Windows remain to be checked before a desktop release.
