// RADAR MCP server — exposes radar.db to an MCP client (Claude Code, Codex,
// Claude Desktop) as a set of typed tools. Dev-only tool: it is never part of
// the shipped browser artifact or the desktop executable. See mcp/README.md.
//
// Transport is stdio, so stdout carries protocol frames only: never console.log
// here — diagnostics go to stderr.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { RadarDb } from "./db";
import { resolveDbPath } from "./resolve";
import {
  addEmployeeNote,
  createTask,
  getAttention,
  getEmployee,
  listEmployees,
  listProjects,
  recentActivity,
  recordCheckIn,
  searchTasks,
  updateEmployee,
  updateTask
} from "./tools";

const dbPath = resolveDbPath(process.argv[2]);
const db = new RadarDb(dbPath);
process.stderr.write(`radar-mcp: using ${dbPath}\n`);

const server = new McpServer({ name: "radar", version: "0.1.0" });

/** Wraps a tool so thrown errors come back as readable text, not a crash. */
function result(payload: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }] };
}

function tool<A>(run: (args: A) => unknown) {
  return async (args: A) => {
    try {
      return result(run(args));
    } catch (e) {
      return {
        content: [{ type: "text" as const, text: e instanceof Error ? e.message : String(e) }],
        isError: true
      };
    }
  };
}

// ---- read tools -------------------------------------------------------------

server.registerTool(
  "list_employees",
  {
    title: "List employees",
    description:
      "List the people this supervisor tracks, with title, team, and competency. Use this first to find the exact name or id for other tools.",
    inputSchema: {
      search: z.string().optional().describe("Filter by name, title, or team"),
      includeArchived: z.boolean().optional()
    }
  },
  tool((args: { search?: string; includeArchived?: boolean }) => listEmployees(db, args))
);

server.registerTool(
  "get_employee",
  {
    title: "Get one employee",
    description:
      "Full picture of one person: profile, open tasks, recent notes, and recent check-ins. Accepts an id, a full name, or a name fragment.",
    inputSchema: { employee: z.string().describe("Employee id, full name, or fragment") }
  },
  tool((args: { employee: string }) => getEmployee(db, args))
);

server.registerTool(
  "search_tasks",
  {
    title: "Search tasks",
    description:
      "Find tasks by assignee, status (open/waiting/complete), project, priority, free text, or overdue-only. Returns the board column each task sits in.",
    inputSchema: {
      employee: z.string().optional(),
      status: z.string().optional().describe("open | waiting | complete | cancelled"),
      project: z.string().optional(),
      priority: z.string().optional().describe("low | normal | high | critical"),
      text: z.string().optional().describe("Match against title and description"),
      overdueOnly: z.boolean().optional(),
      includeArchived: z.boolean().optional(),
      limit: z.number().int().positive().max(200).optional()
    }
  },
  tool((args: Parameters<typeof searchTasks>[1]) => searchTasks(db, args))
);

server.registerTool(
  "list_projects",
  {
    title: "List projects",
    description: "Projects with status, lead, target end date, and open task count.",
    inputSchema: { includeArchived: z.boolean().optional() }
  },
  tool((args: { includeArchived?: boolean }) => listProjects(db, args))
);

server.registerTool(
  "get_attention",
  {
    title: "What needs attention",
    description:
      "Run RADAR's own attention engine: overdue, due soon, waiting too long, stale tasks, missing check-ins, training and leave alerts. Each item has a severity, a reason, and a suggested action. Use this for 'what should I focus on' questions.",
    inputSchema: { limit: z.number().int().positive().max(200).optional() }
  },
  tool((args: { limit?: number }) => getAttention(db, args))
);

// ---- write tools ------------------------------------------------------------
// Writes commit immediately and are recorded in RADAR's activity history. A
// running desktop window reloads within ~1.5s (desktop/dbwatch.go).

server.registerTool(
  "create_task",
  {
    title: "Create a task",
    description:
      "Create a task. Only the title is required; it defaults to the Inbox column at normal priority, matching RADAR's own quick add. Dates are YYYY-MM-DD.",
    inputSchema: {
      title: z.string().min(1),
      employee: z.string().optional().describe("Assignee: id, name, or fragment"),
      project: z.string().optional(),
      column: z.string().optional().describe("Board column label, e.g. 'In Progress'"),
      priority: z.enum(["low", "normal", "high", "critical"]).optional(),
      dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      description: z.string().optional()
    },
    annotations: { destructiveHint: false }
  },
  tool((args: Parameters<typeof createTask>[1]) => createTask(db, args))
);

server.registerTool(
  "update_task",
  {
    title: "Update a task",
    description:
      "Change a task's title, description, assignee, project, priority, due date, board column, or status. Moving a column keeps status in sync and vice versa, exactly as the board does. Pass dueDate: null to clear it. Find the taskId with search_tasks first.",
    inputSchema: {
      taskId: z.string().describe("Task id from search_tasks"),
      title: z.string().optional(),
      description: z.string().optional(),
      employee: z.string().optional(),
      project: z.string().optional(),
      column: z.string().optional().describe("Board column label, e.g. 'Waiting'"),
      status: z.enum(["open", "waiting", "complete"]).optional(),
      priority: z.enum(["low", "normal", "high", "critical"]).optional(),
      dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
      archived: z.boolean().optional().describe("true archives the task (RADAR never hard-deletes); false restores it")
    }
  },
  tool((args: Parameters<typeof updateTask>[1]) => updateTask(db, args))
);

server.registerTool(
  "update_employee",
  {
    title: "Update employee profile fields",
    description:
      "Update a person's profile fields by their configured labels — the same fields the profile tab shows (Title, Building, Cube, phones, Clearance, Telework Agreement Valid Through, and any organization-defined fields). Pass a value of null or \"\" to clear a field. Yes/no fields accept yes/no, dates are YYYY-MM-DD, choice fields accept the option label. An unknown field name returns the list of available fields.",
    inputSchema: {
      employee: z.string().describe("Employee id, full name, or fragment"),
      updates: z
        .record(z.string(), z.string().nullable())
        .describe('Field label -> new value, e.g. {"Cube": "C-204", "Government phone": "yes"}')
    }
  },
  tool((args: { employee: string; updates: Record<string, string | null> }) => updateEmployee(db, args))
);

server.registerTool(
  "get_recent_activity",
  {
    title: "Recent activity history",
    description:
      "RADAR's activity log, newest first — what was created, updated, completed, or archived, by the app and by this server. Useful for 'what changed this week' summaries and for auditing what the assistant did.",
    inputSchema: {
      limit: z.number().int().positive().max(200).optional(),
      since: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Only entries on or after this date")
    }
  },
  tool((args: { limit?: number; since?: string }) => recentActivity(db, args))
);

server.registerTool(
  "add_employee_note",
  {
    title: "Add an employee note",
    description:
      "Append a note to a person's record — things to remember: preferences, goals, constraints, context from a conversation.",
    inputSchema: {
      employee: z.string(),
      note: z.string().min(1)
    }
  },
  tool((args: { employee: string; note: string }) => addEmployeeNote(db, args))
);

server.registerTool(
  "record_check_in",
  {
    title: "Record a check-in",
    description:
      "Log an interaction with a person today and update their last-check-in date, the same as RADAR's Record check-in action.",
    inputSchema: {
      employee: z.string(),
      summary: z.string().optional(),
      type: z.string().optional().describe("e.g. 'Informal check-in', 'One-on-one'"),
      followUpRequired: z.boolean().optional()
    }
  },
  tool((args: Parameters<typeof recordCheckIn>[1]) => recordCheckIn(db, args))
);

const transport = new StdioServerTransport();
await server.connect(transport);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    db.close();
    process.exit(0);
  });
}
