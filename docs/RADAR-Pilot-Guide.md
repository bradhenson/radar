# RADAR — what it is, and where your data actually lives

RADAR is a supervisor's tool: one place to track what you owe people, what people owe you,
and the things that quietly come due — training, agreements, nominations, travel paperwork,
award deadlines. It opens to a dashboard of what needs attention today and why.

It is delivered as a single file: **`radar.html`**. Double-click it, or open it in Microsoft
Edge with File → Open. There is nothing to install, no administrator rights required, no
account to create, no password, and nothing to configure first.

Read the next two sections before entering anything real. They describe the one way RADAR
differs from every other application that looks like this, and the habit that difference
requires.

---

## There is no server and no backend database

RADAR looks like a web application, so the reasonable assumption is that it is talking to a
database somewhere. It is not. There is no server, no cloud service, no hosted database, and
no network connection of any kind. The entire application — every screen, every button — is
contained in that one HTML file, and it runs entirely inside the browser on the local
workstation.

This is a deliberate design decision, and on a government computer it is the whole point.

**Nothing is transmitted anywhere.** RADAR makes no network requests. It loads no fonts,
scripts, icons, or images from the internet; it sends no analytics or telemetry; it does not
check for updates. The build process fails if any external reference is found anywhere in the
code. The application runs identically with the network cable unplugged, and there is no
vendor, no service, and no third party on the other end of anything — because there is no
other end.

**Information entered into RADAR never leaves the boundary of the machine it was typed on.**
Whatever protections already apply to that workstation — disk encryption, logon controls,
endpoint policy, physical security, the accreditation of the system itself — are the
protections that apply to RADAR's data, because the data never goes anywhere else. RADAR adds
no new system to the picture: no server to stand up, no service to accredit, no account
provisioning, no data processor to review, no external attack surface.

**What that does not mean.** RADAR being local does not, by itself, authorize anything. It
provides no encryption of its own beyond what the workstation provides, no user
authentication, no access control, and no CUI marking or banner. Anyone with access to an
unlocked session and that browser profile can open the file and read everything in it. The
practical rule is straightforward: **information in RADAR carries exactly the same handling
requirements it carried before it was typed in.** If a category of information requires
protection, marking, or specific storage locations, it still does inside RADAR and inside
RADAR's backup files. And whether a locally-run HTML application is permitted on a given
system at all is a question for that organization's own policy, not something this document
can answer.

---

## The mental model: a very elaborate front end over a JSON text file

The most accurate way to think about RADAR is as a document-based application — closer to a
spreadsheet than to a web service. There is a working copy and there is a file, and the file
is what matters.

- **The working copy** lives in the browser's own local storage (IndexedDB) — a real
  database, but one running inside the browser rather than on a server. It is tied to the
  Windows user profile, the specific browser, and the location of the `radar.html` file.
- **The file** is a JSON backup exported from Settings. Plain text, human-readable,
  containing every record in the application. It can be opened in Notepad, and doing that
  once is worthwhile — it makes the whole architecture obvious and confirms the file holds
  the expected data and nothing else.

Everything about how RADAR behaves follows from that split.

**The working copy is convenient, not durable.** Because it is tied to a browser profile and
a file location:

- **Nothing syncs.** Opening RADAR on a different computer, or in a different browser on the
  same computer, produces an empty application.
- **Moving or renaming the file or its folder can present an empty application**, because the
  browser keys the storage to where the file sits. Export a backup before moving anything.
- **Clearing browsing data erases it.** Clearing "cookies and site data," an IT-driven profile
  reset, or a machine replacement takes the working copy with it.
- **Do not use an InPrivate window.** Everything entered disappears when it closes.
- **One window at a time.** Opening RADAR twice is safe: the second window reports that
  another window is the active editor rather than letting both write and corrupt each other.
- **Use Edge or Chrome.** Firefox blocks local storage for files opened this way. If RADAR
  cannot obtain real storage it displays a red **"Memory-only storage"** badge at the top of
  the window — everything typed in that state is lost when the tab closes. Seeing that badge
  means: export a backup immediately and report it.

None of that is a defect to work around. It is the cost of having no server, and the JSON
backup is what pays it.

---

## The JSON backup is the real save file

**Settings → Export backup (JSON)**, or the backup indicator at the bottom of the left
sidebar (it moves to the header when the window is narrow). The result is a file named like
`RADAR_Backup_2026-08-04_1730.json`, saved to the Downloads folder — move it to an approved
location where files are actually kept and, if it holds controlled information, store and
mark it accordingly. It is an ordinary document from that point on.

That one file contains everything: every employee, task, note, performance input, meeting,
training record, and deadline.

- The backup indicator turns amber, and the Today page raises a reminder, once it has been
  **7 days or 50 changes** since the last export. Both thresholds are configurable.
- To restore, or to move to a different computer: **Settings → Import backup**. The file is
  validated thoroughly before anything is touched — structure, field types, dates, duplicate
  records, counts, and a checksum — and a preview is shown first.
- **Import replaces; it does not merge.** Importing swaps out everything currently held. Two
  people's data cannot be combined, and yesterday's backup cannot be layered onto today's
  work.
- Weekly is a reasonable rhythm. Before a long absence or a machine refresh, export regardless
  of when the last one was.

CSV export is also available on the employee, meeting, telework, and travel lists, and a text
export on Performance, for pasting into evaluations or reports.

---

## Start with the sample data

RADAR is difficult to evaluate while empty. **Settings → Load sample data** fills it with 40
fictional employees and their tasks, training records, leave, telework, meetings, performance
inputs, and awards already in progress — enough to see what every screen looks like in real
use, and to experiment freely.

Two cautions:

1. **Loading sample data replaces whatever is currently held.** Do it first, before entering
   anything real. A confirmation is required.
2. To clear it out and start for real, **Settings → Reset all data** requires typing a
   confirmation phrase. Nothing destructive in RADAR happens by accident; deletions elsewhere
   are confirmed or undoable, and most records are archived rather than removed.

All sample names and details are invented. No real personnel information appears anywhere in
the delivered application.

---

## What's in it

- **Today** — the core of the tool. What needs attention and *why*, with a 14-day lookahead.
  Every item explains its own reasoning and links directly to the underlying record.
- **Board** — a kanban board for tasks and delegations, with drag-and-drop and full keyboard
  equivalents.
- **Calendar** — a month view layering task due dates, leave, telework, travel, and award
  deadlines, each layer toggled independently and filterable by employee.
- **Employees** — the directory plus a complete profile per person: tasks, performance inputs,
  meetings, training, leave, telework, travel, awards, and history.
- **Performance** — Context / Action / Result & Impact captured as events happen, so
  evaluation season is not archaeology. Imports from completed tasks.
- **Meetings** and **Notes** — meeting notes with linked people and action items; rich-text
  notes with global quick capture and search.
- **Training / Leave / Telework / Travel / Awards** — tracking with expiration and deadline
  warnings that feed the Today page.
- **Settings** — reminder thresholds, light/dark theme, accent colors, custom board columns
  and competencies, sample data, and backup import/export.

Useful keys: `Q` quick add a task, `J` quick note, `T` Today, `B` Board, `E` Employees,
`Ctrl+K` search everything, `Esc` closes any dialog. Single-key shortcuts can be disabled in
Settings.

---

## Feedback that helps

- Does the **Today** page surface the right things, or is it noise? That question matters more
  than any other.
- What did you go looking for and fail to find?
- What is clunky enough that it would end up abandoned?
- Anything that appears wrong, breaks, or loses data — report it promptly, and include the
  JSON backup if the contents permit sharing it. That file is usually enough to reproduce the
  problem exactly.

This is a limited trial; please keep the file within the group it was issued to while it is
still changing.
