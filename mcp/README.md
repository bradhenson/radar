# RADAR MCP server

Points an LLM client — Claude Code, Codex, Claude Desktop — at your RADAR
database so you can ask it to summarize, search, and record work in plain
language. It uses your existing LLM subscription: this server holds **no API
key and makes no network calls of its own**. It only reads and writes
`radar.db` on this machine.

This is a **development-machine tool**. It is not part of the browser artifact
or the desktop executable, and it does not change RADAR's offline guarantees:
`dist/radar.html` still opens from `file://` with no network access.

## What it can do

**Read:** `list_employees`, `get_employee`, `search_tasks`, `list_projects`,
`get_attention` (runs RADAR's own attention engine — overdue, waiting too long,
stale, missing check-ins, training and leave alerts).

**Write:** `create_task`, `update_task`, `add_employee_note`, `record_check_in`.

Writes go through the same contract as the app's own service layer: the record,
its activity-history entry, and the backup-change counter commit in one
transaction, board column and status stay in sync via the shared domain rules,
and nothing is ever hard-deleted.

## Requirements

- **Node 22.5+** (uses the built-in `node:sqlite`; Node 24 recommended). SQLite
  is still flagged experimental in Node, so it prints a warning on stderr —
  harmless, and invisible to the MCP client.
- The desktop build, or any `radar.db`. The browser (IndexedDB) build stores
  data inside the browser profile, which this server cannot reach.

## Which database it opens

In order: an explicit path argument, `RADAR_DB`, the location saved by the
desktop app's Settings (`%LOCALAPPDATA%\RADAR\database-location.json`), then
`%LOCALAPPDATA%\RADAR\radar.db`. It refuses to open a file that is not a RADAR
database. The path it chose is printed to stderr at startup.

## Register it

Claude Code, from the repo root:

```sh
claude mcp add radar -- npx tsx mcp/src/server.ts
```

Or against a specific database:

```sh
claude mcp add radar -- npx tsx mcp/src/server.ts "C:\path\to\radar.db"
```

Codex and Claude Desktop take the same command in their own MCP config; the
server is client-agnostic.

Run it directly (it will wait on stdio — that is normal):

```sh
npm run mcp
```

## Using it

Just talk to your client:

> What needs my attention today?
> Create a task for Dana to follow up on the audit evidence by Friday, high priority.
> Move the migration checklist to Waiting and add a note that the vendor slipped.

Names resolve by fragment: "dana" finds Dana Whitfield. An ambiguous name is an
**error listing the candidates**, never a guess — this server writes to real
records, so picking the wrong person silently is not an acceptable outcome.

Your MCP client asks permission before it runs a tool; that is the confirm step
for writes, so RADAR does not add a second one.

## Running RADAR at the same time

Supported, and the reason `desktop/dbwatch.go` exists. RADAR keeps every record
in memory, so it would otherwise neither show this server's writes nor avoid
overwriting them from stale state. Each write here stamps
`app_meta.external_write_at`; the desktop app polls that key and reloads within
about 1.5 seconds, showing a toast. RADAR's own writes never touch the key, so
there is no reload loop.

Both processes use SQLite locking with a 5-second busy timeout, so simultaneous
writes wait for each other rather than failing or corrupting.

## Privacy

The server is local, but **your LLM client is not**. Anything a tool returns —
employee names, notes, task titles — is sent to whichever provider your client
uses, as part of that conversation. RADAR itself still makes no network calls;
this is a separate tool you run deliberately. Decide whether that is acceptable
for your data before registering it.

## Layout

| File | Purpose |
| --- | --- |
| `src/server.ts` | MCP protocol wiring and tool schemas (stdio transport) |
| `src/tools.ts` | Tool behavior — unit-tested in `tests/unit/mcpTools.test.ts` |
| `src/db.ts` | SQLite access and the transactional write path |
| `src/resolve.ts` | Database-path resolution and name → record matching |

Types, validation, and domain rules are imported from `src/` rather than
redefined, so this tool cannot drift from the app's model. `npm run check`
type-checks it alongside the app.
