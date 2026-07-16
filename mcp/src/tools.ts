// Tool implementations for the RADAR MCP server, kept separate from the
// protocol wiring in server.ts so they can be unit-tested directly against a
// temporary database (tests/unit/mcpTools.test.ts).
//
// Every write goes through RadarDb.putRecord, which mirrors the app's own
// service layer: record + ActivityEntry + backup counter in one transaction,
// with the external-write signal that makes a running desktop window re-read.

import type { RadarDb } from "./db";
import { resolveEmployee, resolveProject } from "./resolve";
import type {
  BoardColumnDefinition,
  Employee,
  EmployeeNote,
  EmployeeProfileField,
  EmployeeProfileValue,
  Task,
  TaskPriority,
  TaskStatus
} from "../../src/domain/models";
import { normalizeTaskStatus, statusLabel } from "../../src/domain/models";
import {
  activeProfileFields,
  applyEmployeeProfileValues,
  formattedProfileValue
} from "../../src/domain/employeeProfile";
import { computeAttention } from "../../src/domain/rules/attention";
import { orderForAppend } from "../../src/domain/rules/boardOrder";
import { laneForStatus, statusChangeForLaneMove } from "../../src/domain/rules/laneStatus";
import { richTextToPlainText } from "../../src/utils/richText";
import { isValidIsoDate, nowTimestamp, todayIso } from "../../src/utils/dates";
import { newId } from "../../src/utils/ids";

export const TASK_PRIORITIES: TaskPriority[] = ["low", "normal", "high", "critical"];
/** Statuses a caller may set. "cancelled" is deliberately excluded: it is an
 *  explicit human decision the board never overrides (see laneStatus.ts). */
export const SETTABLE_STATUSES: TaskStatus[] = ["open", "waiting", "complete"];

/** Board columns in display order (mirrors app.svelte.ts boardColumnList). */
function activeColumns(db: RadarDb): BoardColumnDefinition[] {
  return db.readAll("boardColumns").sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
}

/** Mirrors app.svelte.ts taskBoardColumnId: legacy tasks derive their lane. */
function taskColumnId(task: Task, columns: BoardColumnDefinition[]): string {
  if (task.boardColumnId && columns.some((c) => c.id === task.boardColumnId)) return task.boardColumnId;
  return laneForStatus(columns, task.status)?.id ?? columns[0]?.id ?? "inbox";
}

function resolveColumn(columns: BoardColumnDefinition[], term: string): BoardColumnDefinition {
  const needle = term.trim().toLowerCase();
  const match =
    columns.find((c) => c.id === term) ??
    columns.find((c) => c.label.toLowerCase() === needle) ??
    columns.find((c) => c.label.toLowerCase().includes(needle));
  if (!match) {
    throw new Error(`No board column matches "${term}". Available: ${columns.map((c) => c.label).join(", ")}`);
  }
  return match;
}

function employeeLabel(employees: Employee[], id: string | undefined): string | undefined {
  return id ? employees.find((e) => e.id === id)?.displayName : undefined;
}

function taskView(task: Task, employees: Employee[], columns: BoardColumnDefinition[], projectName?: string) {
  return {
    id: task.id,
    title: task.title,
    status: statusLabel(task.status),
    column: columns.find((c) => c.id === taskColumnId(task, columns))?.label,
    priority: task.priority,
    assignee: employeeLabel(employees, task.employeeId),
    project: projectName,
    dueDate: task.dueDate,
    startDate: task.startDate,
    waitingSince: task.waitingSince,
    tags: task.tags.length ? task.tags : undefined
  };
}

// ---- read tools -------------------------------------------------------------

export function listEmployees(db: RadarDb, args: { search?: string; includeArchived?: boolean }) {
  const competencies = db.readAll("competencies");
  let employees = db.readAll("employees");
  if (!args.includeArchived) employees = employees.filter((e) => !e.isArchived);
  if (args.search) {
    const needle = args.search.toLowerCase();
    employees = employees.filter((e) =>
      [e.displayName, e.preferredName, e.positionTitle, e.role, e.team].some((v) => v?.toLowerCase().includes(needle))
    );
  }
  return employees.map((e) => ({
    id: e.id,
    name: e.displayName,
    title: e.positionTitle || e.role,
    team: e.team,
    competency: competencies.find((c) => c.id === e.competencyId)?.code,
    activeStatus: e.activeStatus,
    isArchived: e.isArchived || undefined
  }));
}

export function getEmployee(db: RadarDb, args: { employee: string }) {
  const employees = db.readAll("employees");
  const employee = resolveEmployee(employees, args.employee);
  const columns = activeColumns(db);
  const projects = db.readAll("projects");
  const tasks = db
    .readAll("tasks")
    .filter((t) => t.employeeId === employee.id && !t.isArchived && t.status !== "complete" && t.status !== "cancelled");
  const notes = db
    .readAll("employeeNotes")
    .filter((n) => n.employeeId === employee.id && !n.isArchived)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, 8);
  const interactions = db
    .readAll("employeeInteractions")
    .filter((i) => i.employeeId === employee.id)
    .sort((a, b) => (a.interactionDate < b.interactionDate ? 1 : -1))
    .slice(0, 5);

  return {
    id: employee.id,
    name: employee.displayName,
    title: employee.positionTitle || employee.role,
    team: employee.team,
    activeStatus: employee.activeStatus,
    lastCheckInDate: employee.lastCheckInDate,
    openTasks: tasks.map((t) =>
      taskView(t, employees, columns, projects.find((p) => p.id === t.projectId)?.name)
    ),
    recentNotes: notes.map((n) => ({ createdAt: n.createdAt, text: richTextToPlainText(n.noteText) })),
    recentCheckIns: interactions.map((i) => ({
      date: i.interactionDate,
      type: i.interactionType,
      summary: i.summary
    }))
  };
}

export function searchTasks(
  db: RadarDb,
  args: {
    employee?: string;
    status?: string;
    project?: string;
    priority?: string;
    text?: string;
    overdueOnly?: boolean;
    includeArchived?: boolean;
    limit?: number;
  }
) {
  const employees = db.readAll("employees");
  const projects = db.readAll("projects");
  const columns = activeColumns(db);
  let tasks = db.readAll("tasks");

  if (!args.includeArchived) tasks = tasks.filter((t) => !t.isArchived);
  if (args.employee) {
    const employee = resolveEmployee(employees, args.employee);
    tasks = tasks.filter((t) => t.employeeId === employee.id);
  }
  if (args.project) {
    const project = resolveProject(projects, args.project);
    tasks = tasks.filter((t) => t.projectId === project.id);
  }
  if (args.status) {
    const status = normalizeTaskStatus(args.status);
    tasks = tasks.filter((t) => t.status === status);
  }
  if (args.priority) tasks = tasks.filter((t) => t.priority === args.priority);
  if (args.text) {
    const needle = args.text.toLowerCase();
    tasks = tasks.filter(
      (t) => t.title.toLowerCase().includes(needle) || richTextToPlainText(t.description).toLowerCase().includes(needle)
    );
  }
  if (args.overdueOnly) {
    const today = todayIso();
    tasks = tasks.filter((t) => t.dueDate && t.dueDate < today && t.status !== "complete" && t.status !== "cancelled");
  }

  tasks.sort((a, b) => (a.dueDate ?? "9999-99-99").localeCompare(b.dueDate ?? "9999-99-99"));
  return tasks
    .slice(0, args.limit ?? 50)
    .map((t) => taskView(t, employees, columns, projects.find((p) => p.id === t.projectId)?.name));
}

export function listProjects(db: RadarDb, args: { includeArchived?: boolean }) {
  const employees = db.readAll("employees");
  const tasks = db.readAll("tasks").filter((t) => !t.isArchived);
  return db
    .readAll("projects")
    .filter((p) => args.includeArchived || !p.isArchived)
    .map((p) => ({
      id: p.id,
      name: p.name,
      status: p.status,
      lead: employeeLabel(employees, p.leadEmployeeId),
      targetEndDate: p.targetEndDate,
      openTaskCount: tasks.filter((t) => t.projectId === p.id && t.status !== "complete" && t.status !== "cancelled").length
    }));
}

/** What RADAR itself would flag today, via the app's own attention engine. */
export function getAttention(db: RadarDb, args: { limit?: number }) {
  const employees = db.readAll("employees");
  const meta = db.getMeta();
  const items = computeAttention({
    today: todayIso(),
    settings: db.getSettings(),
    tasks: db.readAll("tasks"),
    employees,
    performanceInputs: db.readAll("performanceInputs"),
    interactions: db.readAll("employeeInteractions"),
    trainingRecords: db.readAll("employeeTrainingRecords"),
    trainingRequirements: db.readAll("trainingRequirements"),
    leaveRecords: db.readAll("leaveRecords"),
    teleworkRecords: db.readAll("teleworkRecords"),
    travelRecords: db.readAll("travelRecords"),
    awardRecords: db.readAll("awardRecords"),
    lastBackupAt: meta.lastBackupAt,
    changesSinceBackup: meta.changesSinceBackup,
    snoozes: db.readAll("attentionSnoozes")
  });
  return items.slice(0, args.limit ?? 40).map((item) => ({
    severity: item.severity,
    reason: item.reasonCode,
    reasonText: item.reasonText,
    suggestedAction: item.suggestedAction,
    entityType: item.entityType,
    entityId: item.entityId,
    title: item.title,
    assignee: employeeLabel(employees, item.employeeId),
    dueDate: item.dueDate
  }));
}

// ---- write tools ------------------------------------------------------------

export function createTask(
  db: RadarDb,
  args: {
    title: string;
    employee?: string;
    project?: string;
    column?: string;
    priority?: TaskPriority;
    dueDate?: string;
    startDate?: string;
    description?: string;
  }
) {
  // One transaction around read + write: the boardOrder append reads sibling
  // cards, and the desktop app may be writing concurrently.
  return db.transaction(() => createTaskInTx(db, args));
}

function createTaskInTx(db: RadarDb, args: Parameters<typeof createTask>[1]) {
  const title = args.title.trim();
  if (!title) throw new Error("title is required");

  const employees = db.readAll("employees");
  const projects = db.readAll("projects");
  const columns = activeColumns(db);
  const employee = args.employee ? resolveEmployee(employees, args.employee) : undefined;
  const project = args.project ? resolveProject(projects, args.project) : undefined;
  // Same default as the app: the Inbox lane, else the first active lane.
  const column = args.column
    ? resolveColumn(columns, args.column)
    : columns.find((c) => c.id === "inbox") ?? columns[0];
  if (!column) throw new Error("this database has no active board columns");

  const now = nowTimestamp();
  const existingOrders = db
    .readAll("tasks")
    .filter((t) => !t.isArchived && taskColumnId(t, columns) === column.id)
    .map((t) => t.boardOrder);

  const task: Task = {
    id: newId(),
    title,
    description: args.description?.trim() || undefined,
    status: column.mapsToStatus ?? "open",
    boardColumnId: column.id,
    priority: args.priority ?? "normal",
    employeeId: employee?.id,
    projectId: project?.id,
    dueDate: args.dueDate,
    startDate: args.startDate,
    performanceInputCreated: false,
    tags: [],
    boardOrder: orderForAppend(existingOrders),
    createdAt: now,
    updatedAt: now,
    isArchived: false
  };
  if (task.status === "waiting") task.waitingSince = now;
  if (task.status === "complete") task.completedDate = todayIso();

  db.putRecord("tasks", task, { actionType: "created", summary: `Created task "${task.title}"` });
  return taskView(task, employees, columns, project?.name);
}

export function updateTask(
  db: RadarDb,
  args: {
    taskId: string;
    title?: string;
    description?: string;
    employee?: string;
    project?: string;
    column?: string;
    status?: TaskStatus;
    priority?: TaskPriority;
    dueDate?: string | null;
    archived?: boolean;
  }
) {
  // Read-modify-write under one transaction, so a concurrent edit in the
  // desktop app cannot be silently reverted from a stale read.
  return db.transaction(() => updateTaskInTx(db, args));
}

function updateTaskInTx(db: RadarDb, args: Parameters<typeof updateTask>[1]) {
  const existing = db.readOne("tasks", args.taskId);
  if (!existing) throw new Error(`No task with id ${args.taskId}. Use search_tasks to find it.`);

  const employees = db.readAll("employees");
  const projects = db.readAll("projects");
  const columns = activeColumns(db);
  const now = nowTimestamp();
  const today = todayIso();
  let next: Task = { ...existing, updatedAt: now };

  if (args.title !== undefined) {
    const title = args.title.trim();
    if (!title) throw new Error("title cannot be empty");
    next.title = title;
  }
  if (args.description !== undefined) next.description = args.description.trim() || undefined;
  if (args.priority !== undefined) next.priority = args.priority;
  // null clears the due date; undefined leaves it alone.
  if (args.dueDate !== undefined) next.dueDate = args.dueDate ?? undefined;
  if (args.employee !== undefined) next.employeeId = resolveEmployee(employees, args.employee).id;
  if (args.project !== undefined) next.projectId = resolveProject(projects, args.project).id;

  // Column and status are kept in sync by the same pure rules the board uses.
  if (args.column !== undefined) {
    const column = resolveColumn(columns, args.column);
    next.boardColumnId = column.id;
    const change = statusChangeForLaneMove(next, column, today, now);
    if (change) next = { ...next, ...change };
    next.boardOrder = orderForAppend(
      db
        .readAll("tasks")
        .filter((t) => t.id !== next.id && !t.isArchived && taskColumnId(t, columns) === column.id)
        .map((t) => t.boardOrder)
    );
  }
  if (args.status !== undefined && args.status !== next.status) {
    next.status = args.status;
    if (args.status === "complete") next.completedDate = today;
    if (args.status === "waiting") next.waitingSince = now;
    if (args.status === "open") {
      next.completedDate = undefined;
      next.waitingSince = undefined;
    }
    // Follow the status into its lane, unless the caller named a lane too.
    if (args.column === undefined) {
      const lane = laneForStatus(columns, args.status);
      if (lane) next.boardColumnId = lane.id;
    }
  }

  let actionType = args.status !== undefined || args.column !== undefined ? "status_changed" : "updated";
  let summary = `Updated task "${next.title}"`;
  // Archive instead of delete (working rule 7); restore is the inverse.
  if (args.archived !== undefined && args.archived !== existing.isArchived) {
    next.isArchived = args.archived;
    actionType = args.archived ? "archived" : "restored";
    summary = `${args.archived ? "Archived" : "Restored"} task "${next.title}"`;
  }
  db.putRecord("tasks", next, { actionType, summary });
  return taskView(next, employees, columns, projects.find((p) => p.id === next.projectId)?.name);
}

export function addEmployeeNote(db: RadarDb, args: { employee: string; note: string }) {
  const text = args.note.trim();
  if (!text) throw new Error("note cannot be empty");
  const employees = db.readAll("employees");
  const employee = resolveEmployee(employees, args.employee);
  const now = nowTimestamp();
  const note: EmployeeNote = {
    id: newId(),
    employeeId: employee.id,
    noteText: text,
    createdAt: now,
    updatedAt: now,
    isArchived: false
  };
  db.putRecord("employeeNotes", note, {
    actionType: "created",
    summary: `Added note for ${employee.displayName}`
  });
  return { id: note.id, employee: employee.displayName, createdAt: note.createdAt, text };
}

/**
 * Update employee profile fields by their configured labels — the same
 * sections and fields the Settings page defines and the profile tab shows,
 * covering built-in fields (Title, Building, phones, Clearance, …) and any
 * organization-defined ones. Value handling reuses the app's own
 * applyEmployeeProfileValues, so storage and normalization cannot drift.
 */
export function updateEmployee(db: RadarDb, args: { employee: string; updates: Record<string, string | null> }) {
  return db.transaction(() => {
    const employees = db.readAll("employees");
    const employee = resolveEmployee(employees, args.employee);
    const fields = activeProfileFields(db.getSettings());

    const entries = Object.entries(args.updates);
    if (entries.length === 0) throw new Error("updates is empty — pass at least one field");

    const resolved: EmployeeProfileField[] = [];
    const values: Record<string, EmployeeProfileValue | ""> = {};
    for (const [label, rawValue] of entries) {
      const field = resolveField(fields, label);
      resolved.push(field);
      values[field.id] = coerceFieldValue(field, rawValue);
    }

    const next = applyEmployeeProfileValues(employee, resolved, values);
    next.updatedAt = nowTimestamp();
    const labels = resolved.map((f) => f.label).join(", ");
    db.putRecord("employees", next, {
      actionType: "updated",
      summary: `Updated ${labels} for ${employee.displayName}`
    });
    return {
      employee: employee.displayName,
      changed: resolved.map((field) => ({
        field: field.label,
        value: formattedProfileValue(next, field) || "(cleared)"
      }))
    };
  });
}

function resolveField(fields: EmployeeProfileField[], label: string): EmployeeProfileField {
  const needle = label.trim().toLowerCase();
  const exact = fields.filter((f) => f.label.toLowerCase() === needle);
  if (exact.length === 1) return exact[0]!;
  const partial = fields.filter((f) => f.label.toLowerCase().includes(needle));
  if (partial.length === 1) return partial[0]!;
  if (partial.length > 1) {
    throw new Error(`"${label}" matches several fields: ${partial.map((f) => f.label).join(", ")}. Use the full label.`);
  }
  throw new Error(`No profile field matches "${label}". Available fields: ${fields.map((f) => f.label).join(", ")}`);
}

/** Coerces the string the model sent into the field's typed value. null or "" clears. */
function coerceFieldValue(field: EmployeeProfileField, raw: string | null): EmployeeProfileValue | "" {
  const text = (raw ?? "").trim();
  if (!text) return ""; // applyEmployeeProfileValues clears empty values
  switch (field.type) {
    case "boolean": {
      if (/^(yes|y|true)$/i.test(text)) return true;
      if (/^(no|n|false)$/i.test(text)) return false;
      throw new Error(`"${field.label}" is a yes/no field; got "${raw}"`);
    }
    case "date": {
      if (!isValidIsoDate(text)) throw new Error(`"${field.label}" needs a YYYY-MM-DD date; got "${raw}"`);
      return text;
    }
    case "choice":
      return resolveChoice(field, text);
    case "multi_choice":
      return text.split(/[,;]/).map((part) => resolveChoice(field, part.trim()));
    default:
      return text;
  }
}

function resolveChoice(field: EmployeeProfileField, text: string): string {
  const needle = text.toLowerCase();
  const option = field.options?.find((o) => o.value.toLowerCase() === needle || o.label.toLowerCase() === needle);
  if (!option) {
    const available = field.options?.map((o) => o.label).join(", ") || "(none configured)";
    throw new Error(`"${text}" is not an option for "${field.label}". Options: ${available}`);
  }
  return option.value;
}

export function recentActivity(db: RadarDb, args: { limit?: number; since?: string }) {
  let entries = db.readAll("activityEntries");
  if (args.since) {
    if (!isValidIsoDate(args.since)) throw new Error(`since must be a YYYY-MM-DD date; got "${args.since}"`);
    entries = entries.filter((entry) => entry.timestamp >= args.since!);
  }
  return entries
    .sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1))
    .slice(0, args.limit ?? 30)
    .map((entry) => ({
      timestamp: entry.timestamp,
      action: entry.actionType,
      entityType: entry.entityType,
      summary: entry.summary
    }));
}

export function recordCheckIn(db: RadarDb, args: { employee: string; summary?: string; type?: string; followUpRequired?: boolean }) {
  // Two records change together (interaction + employee check-in date); one
  // transaction keeps them atomic and the read fresh.
  return db.transaction(() => recordCheckInInTx(db, args));
}

function recordCheckInInTx(db: RadarDb, args: Parameters<typeof recordCheckIn>[1]) {
  const employees = db.readAll("employees");
  const employee = resolveEmployee(employees, args.employee);
  const now = nowTimestamp();
  const today = todayIso();
  const interaction = {
    id: newId(),
    employeeId: employee.id,
    interactionDate: today,
    interactionType: args.type?.trim() || "Informal check-in",
    summary: args.summary?.trim() || undefined,
    followUpRequired: args.followUpRequired ?? false,
    createdAt: now,
    updatedAt: now
  };
  db.putRecord("employeeInteractions", interaction, {
    actionType: "created",
    summary: `Recorded ${interaction.interactionType} with ${employee.displayName}`
  });
  // The app updates the employee's check-in date alongside the interaction.
  db.putRecord("employees", { ...employee, lastCheckInDate: today, updatedAt: now }, {
    actionType: "updated",
    summary: `Updated last check-in for ${employee.displayName}`
  });
  return { employee: employee.displayName, date: today, type: interaction.interactionType };
}
