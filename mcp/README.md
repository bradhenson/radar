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
stale, missing check-ins, training and leave alerts), and `get_recent_activity`
(the activity log — also your audit trail of what the assistant did).

**Write:** `create_task`, `update_task` (including archive/restore),
`update_employee`, `add_employee_note`, `record_check_in`.

`update_employee` edits profile fields by the same labels the profile tab
shows — Title, Building, Cube, phones, Clearance, Telework Agreement Valid
Through, and any organization-defined fields from Settings. Yes/no fields
accept "yes"/"no", dates are YYYY-MM-DD, choice fields accept the option label
("Top Secret" stores the same value the profile form would).

Writes go through the same contract as the app's own service layer: the record,
its activity-history entry, and the backup-change counter commit in one
transaction (reads included, so a concurrent edit in the app is never reverted
from a stale read), board column and status stay in sync via the shared domain
rules, and nothing is ever hard-deleted — archiving is the delete.

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

Verify it connected (then start a **new** session — tools load at session start):

```sh
claude mcp list
# radar: npx tsx mcp/src/server.ts - ✓ Connected
```

### Using it with a ChatGPT subscription (Codex CLI)

The server is a standard stdio MCP server, so OpenAI's **Codex CLI** — which
signs in with a ChatGPT account — can drive it the same way Claude Code does:

```sh
codex mcp add radar -- npx tsx "C:\Users\henso\source\repos\RADAR\mcp\src\server.ts"
```

or in `~/.codex/config.toml`:

```toml
[mcp_servers.radar]
command = "npx"
args = ["tsx", "C:\\Users\\henso\\source\\repos\\RADAR\\mcp\\src\\server.ts"]
```

Use the **absolute** path: Codex may launch the server from a different working
directory than this repo. If Codex on Windows fails to spawn `npx`, wrap it:
`command = "cmd"`, `args = ["/c", "npx", "tsx", "..."]`.

The ChatGPT desktop/web app itself is a different story: its connectors run
from OpenAI's servers and need an internet-reachable MCP endpoint, so it cannot
reach a server on your machine — and exposing radar.db to the internet is
exactly what this design avoids. For ChatGPT, use Codex CLI.

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

## Tool reference

You normally never call these directly — the client picks them from your plain-language
request — but this is what it has to work with. Optional arguments in *italics*.

### Read

| Tool | Arguments | Example ask |
| --- | --- | --- |
| `list_employees` | *search*, *includeArchived* | "Who's on Team Delta?" |
| `get_employee` | employee (id, name, or fragment) | "Give me the full picture on Dana." |
| `search_tasks` | *employee*, *status* (open/waiting/complete), *project*, *priority*, *text*, *overdueOnly*, *includeArchived*, *limit* | "What's overdue?" · "Show Dana's waiting items." |
| `list_projects` | *includeArchived* | "How many open tasks per project?" |
| `get_attention` | *limit* | "What needs my attention today?" |
| `get_recent_activity` | *limit*, *since* (YYYY-MM-DD) | "What changed this week?" · "What did you do just now?" |

### Write

| Tool | Arguments | Example ask |
| --- | --- | --- |
| `create_task` | title, *employee*, *project*, *column*, *priority*, *dueDate*, *startDate*, *description* | "Task for Dana: audit evidence by Friday, high priority." |
| `update_task` | taskId, *title*, *description*, *employee*, *project*, *column*, *status*, *priority*, *dueDate* (null clears), *archived* | "Move the cutover checklist to Waiting." · "Archive that old report task." |
| `update_employee` | employee, updates (field label → value; null clears) | "Update Dana's cube to C-204 and set Government phone to yes." |
| `add_employee_note` | employee, note | "Note on Dana: prefers written summaries." |
| `record_check_in` | employee, *summary*, *type*, *followUpRequired* | "Log that I checked in with Dana about the cutover." |

Defaults match the app's own behavior: a bare `create_task` lands in Inbox at
normal priority; moving a task's column updates its status and vice versa
(dropping into Waiting starts the waiting clock; Complete stamps the completion
date); `update_employee` field names are the labels from Settings → Employee
profile fields, and an unknown label errors with the full list.

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
