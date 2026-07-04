// Attention engine (plan section 22). Pure functions: entities in,
// explainable attention items out. Every item carries a reason code,
// human-readable reason, severity, and suggested action.

import type {
  AppSettings,
  AttentionSnooze,
  Employee,
  EmployeeInteraction,
  EmployeeTrainingRecord,
  IsoDate,
  LeaveRecord,
  PerformanceInput,
  Task,
  TeleworkRecord,
  TrainingRequirement
} from "../models";
import { compareDates, daysBetween, daysSinceTimestamp, describeDueDistance, formatDate } from "../../utils/dates";

export type AttentionSeverity = "info" | "low" | "medium" | "high" | "critical";

export type AttentionEntityType = "task" | "employee" | "training" | "leave" | "telework" | "system";

export interface AttentionItem {
  entityType: AttentionEntityType;
  entityId: string;
  reasonCode: string;
  reasonText: string;
  severity: AttentionSeverity;
  sortScore: number;
  suggestedAction: string;
  title: string;
  employeeId?: string;
  dueDate?: IsoDate;
}

const SEVERITY_SCORE: Record<AttentionSeverity, number> = {
  critical: 10_000,
  high: 5_000,
  medium: 2_000,
  low: 500,
  info: 100
};

const PRIORITY_BONUS: Record<string, number> = { critical: 400, high: 200, normal: 0, low: -100 };

export function snoozeKey(item: Pick<AttentionItem, "entityType" | "entityId" | "reasonCode">): string {
  return `${item.entityType}:${item.entityId}:${item.reasonCode}`;
}

export interface AttentionContext {
  today: IsoDate;
  settings: AppSettings;
  tasks: Task[];
  employees: Employee[];
  performanceInputs: PerformanceInput[];
  interactions: EmployeeInteraction[];
  trainingRecords: EmployeeTrainingRecord[];
  trainingRequirements: TrainingRequirement[];
  leaveRecords: LeaveRecord[];
  teleworkRecords: TeleworkRecord[];
  lastBackupAt?: string;
  changesSinceBackup: number;
  snoozes: AttentionSnooze[];
}

export function computeAttention(ctx: AttentionContext): AttentionItem[] {
  const items = [
    ...taskAttention(ctx),
    ...employeeAttention(ctx),
    ...trainingAttention(ctx),
    ...leaveAttention(ctx),
    ...teleworkAttention(ctx),
    ...backupAttention(ctx)
  ];
  const activeSnoozes = new Map(
    ctx.snoozes.filter((s) => compareDates(s.snoozedUntil, ctx.today) > 0).map((s) => [s.id, s])
  );
  return items
    .filter((i) => !activeSnoozes.has(snoozeKey(i)))
    .sort((a, b) => b.sortScore - a.sortScore);
}

// ---------------------------------------------------------------------------
// Task rules (plan 22.3)

export function taskAttention(ctx: Pick<AttentionContext, "today" | "settings" | "tasks">): AttentionItem[] {
  const { today, settings } = ctx;
  const items: AttentionItem[] = [];

  for (const task of ctx.tasks) {
    if (task.isArchived || task.status === "complete" || task.status === "cancelled") continue;
    const base = {
      entityType: "task" as const,
      entityId: task.id,
      title: task.title,
      employeeId: task.employeeId,
      dueDate: task.dueDate
    };
    const priorityBonus = PRIORITY_BONUS[task.priority] ?? 0;

    if (task.dueDate) {
      const diff = daysBetween(today, task.dueDate);
      if (diff < 0) {
        items.push({
          ...base,
          reasonCode: "overdue",
          reasonText: `Overdue by ${-diff} day${diff === -1 ? "" : "s"}`,
          severity: -diff >= 7 ? "critical" : "high",
          sortScore: SEVERITY_SCORE[-diff >= 7 ? "critical" : "high"] + Math.min(-diff, 60) * 10 + priorityBonus,
          suggestedAction: "Complete, reschedule, or delegate this task"
        });
      } else if (diff === 0) {
        items.push({
          ...base,
          reasonCode: "due_today",
          reasonText: "Due today",
          severity: "high",
          sortScore: SEVERITY_SCORE.high + priorityBonus,
          suggestedAction: "Work this task today"
        });
      } else if (diff <= settings.dueSoonDays) {
        items.push({
          ...base,
          reasonCode: "due_soon",
          reasonText: `Due in ${diff} day${diff === 1 ? "" : "s"} (${formatDate(task.dueDate)})`,
          severity: "medium",
          sortScore: SEVERITY_SCORE.medium + (settings.dueSoonDays - diff) * 10 + priorityBonus,
          suggestedAction: "Plan time for this task"
        });
      }
    }

    if (task.reminderDate && compareDates(task.reminderDate, today) <= 0) {
      items.push({
        ...base,
        reasonCode: "reminder_reached",
        reasonText: `Reminder date reached (${formatDate(task.reminderDate)})`,
        severity: "medium",
        sortScore: SEVERITY_SCORE.medium + priorityBonus,
        suggestedAction: "Review this task"
      });
    }

    if (task.followUpDate && compareDates(task.followUpDate, today) <= 0) {
      items.push({
        ...base,
        reasonCode: "follow_up_reached",
        reasonText: `Follow-up date reached (${formatDate(task.followUpDate)})`,
        severity: "medium",
        sortScore: SEVERITY_SCORE.medium + 50 + priorityBonus,
        suggestedAction: task.waitingOn ? `Follow up with ${task.waitingOn}` : "Follow up on this task"
      });
    }

    if (task.status === "waiting") {
      const since = task.waitingSince ?? task.updatedAt;
      const waitingDays = daysSinceTimestamp(since, today);
      if (waitingDays >= settings.waitingStaleDays) {
        items.push({
          ...base,
          reasonCode: "waiting_too_long",
          reasonText: `Waiting for ${waitingDays} days${task.waitingOn ? ` on ${task.waitingOn}` : ""}`,
          severity: "medium",
          sortScore: SEVERITY_SCORE.medium + Math.min(waitingDays, 60) * 5 + priorityBonus,
          suggestedAction: "Check status with the blocking party"
        });
      }
    } else {
      const idleDays = daysSinceTimestamp(task.updatedAt, today);
      if (idleDays >= settings.taskStaleDays) {
        items.push({
          ...base,
          reasonCode: "stale",
          reasonText: `No activity for ${idleDays} days`,
          severity: "low",
          sortScore: SEVERITY_SCORE.low + Math.min(idleDays, 90) + priorityBonus,
          suggestedAction: "Update, reschedule, or archive this task"
        });
      }
    }
  }
  return items;
}

// ---------------------------------------------------------------------------
// Personnel rules (plan 22.4)

export function employeeAttention(
  ctx: Pick<AttentionContext, "today" | "settings" | "employees" | "performanceInputs" | "interactions" | "tasks">
): AttentionItem[] {
  const { today, settings } = ctx;
  const items: AttentionItem[] = [];

  for (const emp of ctx.employees) {
    if (emp.activeStatus !== "active" || emp.isArchived) continue;
    const base = { entityType: "employee" as const, entityId: emp.id, title: emp.displayName, employeeId: emp.id };

    const lastInput = latestDate(ctx.performanceInputs.filter((p) => p.employeeId === emp.id && !p.isArchived).map((p) => p.inputDate));
    const inputAge = lastInput ? daysBetween(lastInput, today) : Number.POSITIVE_INFINITY;
    if (inputAge >= settings.performanceInputReminderDays) {
      items.push({
        ...base,
        reasonCode: "no_recent_performance_input",
        reasonText: lastInput
          ? `No performance input in ${inputAge} days (last: ${formatDate(lastInput)})`
          : "No performance input recorded",
        severity: "low",
        sortScore: SEVERITY_SCORE.low + 40,
        suggestedAction: "Record a performance input for this employee"
      });
    }

    const lastCheckIn = latestDate([
      ...(emp.lastCheckInDate ? [emp.lastCheckInDate] : []),
      ...ctx.interactions.filter((i) => i.employeeId === emp.id).map((i) => i.interactionDate)
    ]);
    const checkInAge = lastCheckIn ? daysBetween(lastCheckIn, today) : Number.POSITIVE_INFINITY;
    if (checkInAge >= settings.checkInReminderDays) {
      items.push({
        ...base,
        reasonCode: "no_recent_check_in",
        reasonText: lastCheckIn
          ? `No check-in in ${checkInAge} days (last: ${formatDate(lastCheckIn)})`
          : "No check-in recorded",
        severity: "low",
        sortScore: SEVERITY_SCORE.low + 30,
        suggestedAction: "Schedule or record a check-in"
      });
    }

    const overdueCount = ctx.tasks.filter(
      (t) =>
        t.employeeId === emp.id &&
        !t.isArchived &&
        t.status !== "complete" &&
        t.status !== "cancelled" &&
        t.dueDate &&
        compareDates(t.dueDate, today) < 0
    ).length;
    if (overdueCount >= 3) {
      items.push({
        ...base,
        reasonCode: "multiple_overdue",
        reasonText: `${overdueCount} overdue tasks`,
        severity: "medium",
        sortScore: SEVERITY_SCORE.medium + overdueCount * 20,
        suggestedAction: "Review this employee's workload"
      });
    }
  }
  return items;
}

// ---------------------------------------------------------------------------
// Training rules (plan 22.5)

export function trainingAttention(
  ctx: Pick<AttentionContext, "today" | "settings" | "trainingRecords" | "trainingRequirements" | "employees">
): AttentionItem[] {
  const { today } = ctx;
  const items: AttentionItem[] = [];
  const reqById = new Map(ctx.trainingRequirements.map((r) => [r.id, r]));
  const empById = new Map(ctx.employees.map((e) => [e.id, e]));

  for (const rec of ctx.trainingRecords) {
    if (rec.status === "not_applicable" || rec.status === "waived") continue;
    const emp = empById.get(rec.employeeId);
    if (!emp || emp.activeStatus !== "active") continue;
    const req = reqById.get(rec.trainingRequirementId);
    const name = req?.name ?? "Training";
    // A completed record still matters if its completion expires.
    const effectiveDue = rec.status === "complete" ? rec.expirationDate : rec.dueDate;
    if (!effectiveDue) continue;

    const warnDays = Math.max(ctx.settings.trainingWarningDays, ...(req?.warningDays ?? []));
    const diff = daysBetween(today, effectiveDue);
    const base = {
      entityType: "training" as const,
      entityId: rec.id,
      title: `${name} — ${emp.displayName}`,
      employeeId: emp.id,
      dueDate: effectiveDue
    };

    if (diff < 0) {
      items.push({
        ...base,
        reasonCode: rec.status === "complete" ? "training_expired" : "training_overdue",
        reasonText: rec.status === "complete" ? `Training expired ${-diff} days ago` : `Training overdue by ${-diff} days`,
        severity: "high",
        sortScore: SEVERITY_SCORE.high + Math.min(-diff, 60) * 5,
        suggestedAction: "Follow up on this training with the employee"
      });
    } else if (diff <= warnDays) {
      items.push({
        ...base,
        reasonCode: rec.status === "complete" ? "training_expiring" : "training_due_soon",
        reasonText: rec.status === "complete" ? `Training expires in ${diff} days` : `Training ${describeDueDistance(effectiveDue, today)}`,
        severity: diff <= 7 ? "medium" : "low",
        sortScore: SEVERITY_SCORE[diff <= 7 ? "medium" : "low"] + (warnDays - diff),
        suggestedAction: "Remind the employee to complete this training"
      });
    }
  }
  return items;
}

// ---------------------------------------------------------------------------
// Leave rules (plan 22.6)

export function leaveAttention(
  ctx: Pick<AttentionContext, "today" | "settings" | "leaveRecords" | "employees">
): AttentionItem[] {
  const { today, settings } = ctx;
  const items: AttentionItem[] = [];
  const empById = new Map(ctx.employees.map((e) => [e.id, e]));

  for (const leave of ctx.leaveRecords) {
    if (leave.status === "cancelled" || leave.status === "complete") continue;
    const emp = empById.get(leave.employeeId);
    if (!emp) continue;
    const diff = daysBetween(today, leave.startDate);
    if (diff >= 0 && diff <= settings.leaveLookaheadDays) {
      items.push({
        entityType: "leave",
        entityId: leave.id,
        title: `${emp.displayName} leave ${formatDate(leave.startDate)} – ${formatDate(leave.endDate)}`,
        employeeId: emp.id,
        dueDate: leave.startDate,
        reasonCode: "leave_begins_soon",
        reasonText: diff === 0 ? "Leave begins today" : `Leave begins in ${diff} day${diff === 1 ? "" : "s"}`,
        severity: "info",
        sortScore: SEVERITY_SCORE.info + (settings.leaveLookaheadDays - diff),
        suggestedAction: "Check project coverage during this absence"
      });
    }
  }
  return items;
}

// ---------------------------------------------------------------------------
// Telework rules (plan 22.7)

export function teleworkAttention(
  ctx: Pick<AttentionContext, "today" | "settings" | "teleworkRecords" | "employees">
): AttentionItem[] {
  const { today } = ctx;
  const items: AttentionItem[] = [];
  const empById = new Map(ctx.employees.map((e) => [e.id, e]));

  for (const tw of ctx.teleworkRecords) {
    const emp = empById.get(tw.employeeId);
    if (!emp || emp.activeStatus !== "active") continue;
    const base = {
      entityType: "telework" as const,
      entityId: tw.id,
      title: `${tw.recordType} — ${emp.displayName}`,
      employeeId: emp.id
    };

    if (tw.status === "pending_supervisor") {
      items.push({
        ...base,
        reasonCode: "telework_pending_action",
        reasonText: "Telework request pending your action",
        severity: "high",
        sortScore: SEVERITY_SCORE.high + 100,
        suggestedAction: "Review and act on this telework request"
      });
    }

    if ((tw.status === "active" || tw.status === "approved") && tw.expirationDate) {
      const diff = daysBetween(today, tw.expirationDate);
      if (diff < 0) {
        items.push({
          ...base,
          reasonCode: "telework_expired",
          reasonText: `Telework agreement expired ${-diff} days ago`,
          severity: "high",
          sortScore: SEVERITY_SCORE.high + Math.min(-diff, 60) * 5,
          suggestedAction: "Initiate renewal or close out the agreement",
          dueDate: tw.expirationDate
        });
      } else if (diff <= 30) {
        items.push({
          ...base,
          reasonCode: "telework_expiring",
          reasonText: `Telework agreement expires in ${diff} day${diff === 1 ? "" : "s"} (${formatDate(tw.expirationDate)})`,
          severity: diff <= 7 ? "medium" : "low",
          sortScore: SEVERITY_SCORE[diff <= 7 ? "medium" : "low"] + (30 - diff),
          suggestedAction: "Start the renewal process",
          dueDate: tw.expirationDate
        });
      }
    }
  }
  return items;
}

// ---------------------------------------------------------------------------
// Backup rules (plan 22.8)

export function backupAttention(
  ctx: Pick<AttentionContext, "today" | "settings" | "lastBackupAt" | "changesSinceBackup">
): AttentionItem[] {
  const { settings } = ctx;
  const items: AttentionItem[] = [];
  const base = {
    entityType: "system" as const,
    entityId: "backup",
    title: "Backup",
    suggestedAction: "Export a backup from Settings"
  };

  if (!ctx.lastBackupAt) {
    if (ctx.changesSinceBackup > 0) {
      items.push({
        ...base,
        reasonCode: "backup_never",
        reasonText: "No backup has ever been exported",
        severity: "medium",
        sortScore: SEVERITY_SCORE.medium + 200
      });
    }
    return items;
  }

  const age = daysSinceTimestamp(ctx.lastBackupAt, ctx.today);
  if (age >= settings.backupReminderDays) {
    items.push({
      ...base,
      reasonCode: "backup_overdue",
      reasonText: `Last backup was ${age} days ago`,
      severity: "medium",
      sortScore: SEVERITY_SCORE.medium + Math.min(age, 60) * 3
    });
  } else if (ctx.changesSinceBackup >= settings.backupChangeThreshold) {
    items.push({
      ...base,
      reasonCode: "backup_change_threshold",
      reasonText: `${ctx.changesSinceBackup} changes since the last backup`,
      severity: "medium",
      sortScore: SEVERITY_SCORE.medium + 150
    });
  }
  return items;
}

function latestDate(dates: IsoDate[]): IsoDate | undefined {
  return dates.length ? dates.reduce((a, b) => (compareDates(a, b) >= 0 ? a : b)) : undefined;
}
