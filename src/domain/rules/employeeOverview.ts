// What a supervisor needs before a 1:1 (pure). The employee page opens on
// this: what is current for the person, then what changed since the last
// check-in. Inputs are plain arrays already scoped to the employee.

import type {
  AwardRecord,
  EmployeeInteraction,
  EmployeeNote,
  IsoDate,
  LeaveRecord,
  MeetingNote,
  PerformanceInput,
  Task,
  TeleworkRecord,
  TravelRecord
} from "../models";
import { addDays, compareDates, daysBetween, timestampToLocalDate } from "../../utils/dates";
import { AWARD_PIPELINE } from "./awards";
import { isPendingRequest, isSituationalRequest, requestEndDate } from "./telework";
import { isTripCancelled } from "./travel";
import type { TrainingStatus } from "./training";

export const OVERVIEW_TASK_LIMIT = 5;

export interface OverviewAbsence {
  kind: "leave" | "telework" | "travel";
  id: string;
  start: IsoDate;
  end: IsoDate;
  /** "Annual leave", "Telework", "Travel to Norfolk". */
  label: string;
  /** Awaiting a decision (requested leave, pending telework). */
  pending: boolean;
  /** Under way today. */
  current: boolean;
}

export interface OverviewTraining {
  requirementId: string;
  name: string;
  status: TrainingStatus;
}

export interface EmployeeOverview {
  /** Open tasks, overdue first, then by due date; at most OVERVIEW_TASK_LIMIT. */
  openTasks: Task[];
  openTaskCount: number;
  overdueTaskCount: number;
  /** Leave, telework, and travel under way or starting within the lookahead. */
  absences: OverviewAbsence[];
  /** Training that needs action now (overdue, expired, or inside the warning window). */
  training: OverviewTraining[];
  /** Nominations still being worked (before Submitted). */
  awardsInProgress: AwardRecord[];
  lastInput?: { input: PerformanceInput; daysAgo: number; stale: boolean };
  lastCheckIn?: EmployeeInteraction;
  /**
   * What happened since the last check-in (the later of the recorded check-ins
   * and the employee's last check-in date), up to today; everything up to today
   * when there has been none.
   */
  since: {
    from?: IsoDate;
    tasksCompleted: Task[];
    tasksAdded: Task[];
    meetings: MeetingNote[];
    notes: EmployeeNote[];
    inputs: PerformanceInput[];
  };
  /** The last recorded check-in asked for a follow-up. */
  followUpOpen: boolean;
}

export interface EmployeeOverviewInput {
  today: IsoDate;
  lookaheadDays: number;
  inputReminderDays: number;
  /** The employee record's last check-in date, which can be later than any recorded check-in. */
  lastCheckInDate?: IsoDate;
  /** Every task linked to the person, archived ones included (completions live there). */
  tasks: Task[];
  leave: LeaveRecord[];
  telework: TeleworkRecord[];
  travel: TravelRecord[];
  training: { requirementId: string; name: string; status: TrainingStatus }[];
  awards: AwardRecord[];
  inputs: PerformanceInput[];
  checkIns: EmployeeInteraction[];
  meetings: MeetingNote[];
  notes: EmployeeNote[];
}

const CLOSED_LEAVE = new Set(["cancelled", "unknown"]);
const CLOSED_TELEWORK = new Set(["denied", "cancelled", "draft"]);
const IN_PROGRESS_AWARD = new Set<string>(AWARD_PIPELINE.slice(0, -1));

function isOpenTask(task: Task): boolean {
  return !task.isArchived && task.status !== "complete" && task.status !== "cancelled";
}

/** Overdue first, then soonest due, then undated; ties by board order. */
function byUrgency(today: IsoDate) {
  return (a: Task, b: Task): number => {
    const aOver = a.dueDate !== undefined && compareDates(a.dueDate, today) < 0;
    const bOver = b.dueDate !== undefined && compareDates(b.dueDate, today) < 0;
    if (aOver !== bOver) return aOver ? -1 : 1;
    if (a.dueDate && b.dueDate && a.dueDate !== b.dueDate) return compareDates(a.dueDate, b.dueDate);
    if (Boolean(a.dueDate) !== Boolean(b.dueDate)) return a.dueDate ? -1 : 1;
    return a.boardOrder - b.boardOrder;
  };
}

/** True when [start, end] overlaps [today, horizon]. */
function inWindow(start: IsoDate, end: IsoDate, today: IsoDate, horizon: IsoDate): boolean {
  return compareDates(end, today) >= 0 && compareDates(start, horizon) <= 0;
}

/** The date falls after the check-in and has already happened (not a future-dated record). */
function between(from: IsoDate | undefined, date: IsoDate | undefined, today: IsoDate): boolean {
  if (!date || compareDates(date, today) > 0) return false;
  return from === undefined || compareDates(date, from) > 0;
}

export function employeeOverview(input: EmployeeOverviewInput): EmployeeOverview {
  const { today } = input;
  const horizon = addDays(today, Math.max(input.lookaheadDays, 0));

  const open = input.tasks.filter(isOpenTask).sort(byUrgency(today));
  const overdueTaskCount = open.filter((t) => t.dueDate !== undefined && compareDates(t.dueDate, today) < 0).length;

  const absences: OverviewAbsence[] = [];
  for (const l of input.leave) {
    if (CLOSED_LEAVE.has(l.status)) continue;
    const end = compareDates(l.endDate, l.startDate) < 0 ? l.startDate : l.endDate;
    if (!inWindow(l.startDate, end, today, horizon)) continue;
    absences.push({
      kind: "leave",
      id: l.id,
      start: l.startDate,
      end,
      label: l.leaveType || "Leave",
      pending: l.status === "requested" || l.status === "planned",
      current: compareDates(l.startDate, today) <= 0
    });
  }
  for (const t of input.telework) {
    if (!isSituationalRequest(t) || CLOSED_TELEWORK.has(t.status) || !t.effectiveDate) continue;
    const end = requestEndDate(t) ?? t.effectiveDate;
    if (!inWindow(t.effectiveDate, end, today, horizon)) continue;
    absences.push({
      kind: "telework",
      id: t.id,
      start: t.effectiveDate,
      end,
      label: "Telework",
      pending: isPendingRequest(t),
      current: compareDates(t.effectiveDate, today) <= 0
    });
  }
  for (const trip of input.travel) {
    if (trip.isArchived || isTripCancelled(trip)) continue;
    if (!inWindow(trip.startDate, trip.endDate, today, horizon)) continue;
    absences.push({
      kind: "travel",
      id: trip.id,
      start: trip.startDate,
      end: trip.endDate,
      label: trip.destination ? `Travel to ${trip.destination}` : "Travel",
      pending: false,
      current: compareDates(trip.startDate, today) <= 0
    });
  }
  absences.sort((a, b) => compareDates(a.start, b.start) || a.kind.localeCompare(b.kind));

  const training = input.training
    .filter((row) => row.status.needsAction)
    .sort((a, b) => compareDates(a.status.dueDate ?? "9999-12-31", b.status.dueDate ?? "9999-12-31"));

  const awardsInProgress = input.awards.filter((a) => IN_PROGRESS_AWARD.has(a.status));

  const liveInputs = input.inputs.filter((p) => !p.isArchived).sort((a, b) => compareDates(b.inputDate, a.inputDate));
  const latestInput = liveInputs[0];
  const lastInput = latestInput
    ? (() => {
        const daysAgo = daysBetween(latestInput.inputDate, today);
        return { input: latestInput, daysAgo, stale: daysAgo > input.inputReminderDays };
      })()
    : undefined;

  const lastCheckIn = [...input.checkIns].sort(
    (a, b) => compareDates(b.interactionDate, a.interactionDate) || (a.createdAt < b.createdAt ? 1 : -1)
  )[0];
  const recorded = lastCheckIn?.interactionDate;
  const from =
    recorded && input.lastCheckInDate
      ? (compareDates(recorded, input.lastCheckInDate) >= 0 ? recorded : input.lastCheckInDate)
      : recorded ?? input.lastCheckInDate;
  const after = (date: IsoDate | undefined) => between(from, date, today);

  return {
    openTasks: open.slice(0, OVERVIEW_TASK_LIMIT),
    openTaskCount: open.length,
    overdueTaskCount,
    absences,
    training,
    awardsInProgress,
    lastInput,
    lastCheckIn,
    since: {
      from,
      tasksCompleted: input.tasks
        .filter((t) => t.status === "complete" && after(t.completedDate))
        .sort((a, b) => compareDates(b.completedDate!, a.completedDate!)),
      tasksAdded: input.tasks
        .filter((t) => after(timestampToLocalDate(t.createdAt)) && t.status !== "cancelled")
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
      meetings: input.meetings
        .filter((m) => !m.isArchived && after(m.meetingDate))
        .sort((a, b) => compareDates(b.meetingDate, a.meetingDate)),
      notes: input.notes
        .filter((n) => !n.isArchived && after(timestampToLocalDate(n.createdAt)))
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
      inputs: liveInputs.filter((p) => after(p.inputDate))
    },
    followUpOpen: lastCheckIn?.followUpRequired ?? false
  };
}
