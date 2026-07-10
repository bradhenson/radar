// Attention engine (plan section 22). Pure functions: entities in,
// explainable attention items out. Every item carries a reason code,
// human-readable reason, severity, and suggested action.

import type {
  AppSettings,
  AttentionSnooze,
  AwardRecord,
  Employee,
  EmployeeInteraction,
  EmployeeTrainingRecord,
  IsoDate,
  LeaveRecord,
  PerformanceInput,
  Task,
  TeleworkRecord,
  TrainingRequirement,
  TravelRecord
} from "../models";
import { compareDates, daysBetween, daysSinceTimestamp, describeDueDistance, formatDate } from "../../utils/dates";
import { AWARD_FINAL_STATUSES } from "./calendar";
import { requirementAppliesTo, trainingStatus } from "./training";

export type AttentionSeverity = "info" | "low" | "medium" | "high" | "critical";

export type AttentionEntityType = "task" | "employee" | "training" | "leave" | "telework" | "travel" | "award" | "system";

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
  travelRecords: TravelRecord[];
  awardRecords: AwardRecord[];
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
    ...travelAttention(ctx),
    ...awardAttention(ctx),
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

    if (task.status === "waiting") {
      const since = task.waitingSince ?? task.updatedAt;
      const waitingDays = daysSinceTimestamp(since, today);
      if (waitingDays >= settings.waitingStaleDays) {
        items.push({
          ...base,
          reasonCode: "waiting_too_long",
          reasonText: `Waiting for ${waitingDays} days`,
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

// How many employees can share a requirement + urgency before their items
// collapse into one aggregated line. With ~40 employees a fiscal-year
// deadline would otherwise flood the Today page with 40 identical rows.
const TRAINING_AGGREGATE_THRESHOLD = 4;

export function trainingAttention(
  ctx: Pick<AttentionContext, "today" | "settings" | "trainingRecords" | "trainingRequirements" | "employees">
): AttentionItem[] {
  const { today } = ctx;
  const items: AttentionItem[] = [];
  const recByKey = new Map(ctx.trainingRecords.map((r) => [`${r.employeeId}|${r.trainingRequirementId}`, r]));

  for (const req of ctx.trainingRequirements) {
    if (!req.active) continue;
    const warnDays = Math.max(ctx.settings.trainingWarningDays, ...(req.warningDays ?? []));
    const candidates: AttentionItem[] = [];

    for (const emp of ctx.employees) {
      if (!requirementAppliesTo(req, emp)) continue;
      const rec = recByKey.get(`${emp.id}|${req.id}`);
      const status = trainingStatus(req, rec, today, warnDays);
      if (!status.needsAction || !status.dueDate) continue;

      const diff = daysBetween(today, status.dueDate);
      const base = {
        entityType: "training" as const,
        entityId: rec?.id ?? `${req.id}:${emp.id}`,
        title: `${req.name} — ${emp.displayName}`,
        employeeId: emp.id,
        dueDate: status.dueDate
      };
      if (status.state === "overdue" || status.state === "expired") {
        candidates.push({
          ...base,
          reasonCode: status.state === "expired" ? "training_expired" : "training_overdue",
          reasonText: status.state === "expired" ? `Training expired ${-diff} days ago` : `Training overdue by ${-diff} days`,
          severity: "high",
          sortScore: SEVERITY_SCORE.high + Math.min(-diff, 60) * 5,
          suggestedAction: "Follow up on this training with the employee"
        });
      } else {
        candidates.push({
          ...base,
          reasonCode: status.state === "expiring" ? "training_expiring" : "training_due_soon",
          reasonText: status.state === "expiring" ? `Training expires in ${diff} days` : `Training ${describeDueDistance(status.dueDate, today)}`,
          severity: diff <= 7 ? "medium" : "low",
          sortScore: SEVERITY_SCORE[diff <= 7 ? "medium" : "low"] + (warnDays - diff),
          suggestedAction: "Remind the employee to complete this training"
        });
      }
    }

    items.push(...aggregateTrainingItems(req.id, req.name, candidates));
  }
  return items;
}

// Collapse large groups of identical per-employee items into a single
// requirement-level item so one deadline never dominates the attention list.
function aggregateTrainingItems(reqId: string, reqName: string, candidates: AttentionItem[]): AttentionItem[] {
  const out: AttentionItem[] = [];
  const byReason = new Map<string, AttentionItem[]>();
  for (const item of candidates) {
    const group = byReason.get(item.reasonCode);
    if (group) group.push(item);
    else byReason.set(item.reasonCode, [item]);
  }
  for (const [reasonCode, group] of byReason) {
    if (group.length < TRAINING_AGGREGATE_THRESHOLD) {
      out.push(...group);
      continue;
    }
    const worst = group.reduce((a, b) => (b.sortScore > a.sortScore ? b : a));
    const verb =
      reasonCode === "training_overdue" ? "overdue" : reasonCode === "training_expired" ? "expired" : reasonCode === "training_expiring" ? "expiring" : "due soon";
    out.push({
      ...worst,
      entityId: reqId,
      title: `${reqName} — ${group.length} employees`,
      employeeId: undefined,
      reasonText: `Training ${verb} for ${group.length} employees`,
      suggestedAction: "Open the Training page and work the roster for this requirement"
    });
  }
  return out;
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

    if (tw.status === "pending" || tw.status === "pending_supervisor") {
      items.push({
        ...base,
        reasonCode: "telework_pending_action",
        reasonText: "Telework request pending your action",
        severity: "high",
        sortScore: SEVERITY_SCORE.high + 100,
        suggestedAction: "Review and act on this telework request"
      });
    }

    if (isTeleworkAgreementRecord(tw.recordType) && (tw.status === "active" || tw.status === "approved") && tw.expirationDate) {
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

function isTeleworkAgreementRecord(recordType: string): boolean {
  const normalized = recordType.toLowerCase();
  return normalized.includes("agreement") || normalized.includes("renewal") || normalized.includes("modification");
}

// ---------------------------------------------------------------------------
// Travel rules: DTS paperwork before departure, voucher after return.

export function travelAttention(
  ctx: Pick<AttentionContext, "today" | "settings" | "travelRecords" | "employees">
): AttentionItem[] {
  const { today, settings } = ctx;
  const items: AttentionItem[] = [];
  const empById = new Map(ctx.employees.map((e) => [e.id, e]));

  for (const trip of ctx.travelRecords) {
    if (trip.isArchived) continue;
    const emp = empById.get(trip.employeeId);
    if (!emp) continue;
    const base = {
      entityType: "travel" as const,
      entityId: trip.id,
      title: `${emp.displayName} — ${trip.destination}`,
      employeeId: emp.id
    };

    // Voucher due 5 days after return; overdue vouchers are a hard deadline.
    if (trip.voucherDueDate) {
      const diff = daysBetween(today, trip.voucherDueDate);
      if (diff < 0) {
        items.push({
          ...base,
          reasonCode: "travel_voucher_overdue",
          reasonText: `Travel voucher overdue by ${-diff} day${diff === -1 ? "" : "s"}`,
          severity: "high",
          sortScore: SEVERITY_SCORE.high + Math.min(-diff, 60) * 5,
          suggestedAction: "Have the traveler submit the DTS voucher now",
          dueDate: trip.voucherDueDate
        });
      } else if (diff <= 5 && compareDates(trip.endDate, today) <= 0) {
        items.push({
          ...base,
          reasonCode: "travel_voucher_due",
          reasonText: diff === 0 ? "Travel voucher due today" : `Travel voucher due in ${diff} day${diff === 1 ? "" : "s"}`,
          severity: "medium",
          sortScore: SEVERITY_SCORE.medium + (5 - diff) * 10,
          suggestedAction: "Remind the traveler to submit the DTS voucher",
          dueDate: trip.voucherDueDate
        });
      }
    }

    // Departure approaching with paperwork incomplete.
    const untilStart = daysBetween(today, trip.startDate);
    const paperworkGaps: string[] = [];
    if (trip.iptConcurrence === "pending") paperworkGaps.push("IPT concurrence pending");
    if (trip.dtsAuthorizationStatus !== "approved") paperworkGaps.push("DTS authorization not approved");
    if (paperworkGaps.length && untilStart >= 0 && untilStart <= 7 && compareDates(trip.endDate, today) >= 0) {
      items.push({
        ...base,
        reasonCode: "travel_paperwork_incomplete",
        reasonText: `${untilStart === 0 ? "Travel starts today" : `Travel starts in ${untilStart} day${untilStart === 1 ? "" : "s"}`}: ${paperworkGaps.join(", ")}`,
        severity: untilStart <= 2 ? "high" : "medium",
        sortScore: SEVERITY_SCORE[untilStart <= 2 ? "high" : "medium"] + (7 - untilStart) * 10,
        suggestedAction: "Complete the trip's IPT concurrence and DTS authorization",
        dueDate: trip.startDate
      });
    } else if (untilStart >= 0 && untilStart <= settings.leaveLookaheadDays) {
      // Awareness item, mirroring the leave lookahead.
      items.push({
        ...base,
        reasonCode: "travel_begins_soon",
        reasonText:
          untilStart === 0
            ? "Travel begins today"
            : `Travel begins in ${untilStart} day${untilStart === 1 ? "" : "s"} (${formatDate(trip.startDate)} – ${formatDate(trip.endDate)})`,
        severity: "info",
        sortScore: SEVERITY_SCORE.info + (settings.leaveLookaheadDays - untilStart),
        suggestedAction: "Check coverage while this employee is on travel",
        dueDate: trip.startDate
      });
    }
  }
  return items;
}

// ---------------------------------------------------------------------------
// Award rules: nomination deadlines for awards still being worked.

export function awardAttention(
  ctx: Pick<AttentionContext, "today" | "awardRecords" | "employees">
): AttentionItem[] {
  const { today } = ctx;
  const items: AttentionItem[] = [];
  const empById = new Map(ctx.employees.map((e) => [e.id, e]));

  for (const award of ctx.awardRecords) {
    if (!award.nominationDueDate || AWARD_FINAL_STATUSES.has(award.status)) continue;
    const emp = empById.get(award.employeeId);
    const base = {
      entityType: "award" as const,
      entityId: award.id,
      title: `${award.title}${emp ? ` — ${emp.displayName}` : ""}`,
      employeeId: award.employeeId,
      dueDate: award.nominationDueDate
    };
    const diff = daysBetween(today, award.nominationDueDate);
    if (diff < 0) {
      items.push({
        ...base,
        reasonCode: "award_nomination_overdue",
        reasonText: `Award nomination overdue by ${-diff} day${diff === -1 ? "" : "s"} (status: ${award.status})`,
        severity: "high",
        sortScore: SEVERITY_SCORE.high + Math.min(-diff, 60) * 5,
        suggestedAction: "Submit the nomination or update the award status"
      });
    } else if (diff <= 14) {
      items.push({
        ...base,
        reasonCode: "award_nomination_due_soon",
        reasonText: diff === 0 ? "Award nomination due today" : `Award nomination due in ${diff} day${diff === 1 ? "" : "s"}`,
        severity: diff <= 3 ? "high" : "medium",
        sortScore: SEVERITY_SCORE[diff <= 3 ? "high" : "medium"] + (14 - diff) * 5,
        suggestedAction: "Finish drafting and submit the nomination"
      });
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
  if (ctx.changesSinceBackup > 0 && age >= settings.backupReminderDays) {
    items.push({
      ...base,
      reasonCode: "backup_overdue",
      reasonText: `Last backup was ${age} days ago with ${ctx.changesSinceBackup} unsaved change${ctx.changesSinceBackup === 1 ? "" : "s"}`,
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
