// Core entity model. See PRODUCT_PLAN.txt section 27.
// Calendar dates are ISO date strings (YYYY-MM-DD); timestamps are UTC ISO strings.

export type Id = string;
export type IsoDate = string;
export type IsoTimestamp = string;

export interface Competency {
  id: Id;
  code: string;
  name?: string;
  active: boolean;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}

export type EmployeeActiveStatus = "active" | "temporary_inactive" | "departed" | "archived";

export interface Employee {
  id: Id;
  displayName: string;
  preferredName?: string;
  sortName?: string;
  competencyId: Id;
  workEmail?: string;
  positionTitle?: string;
  role?: string;
  team?: string;
  startDate?: IsoDate;
  evaluationCycleId?: Id;
  activeStatus: EmployeeActiveStatus;
  lastCheckInDate?: IsoDate;
  tags: string[];
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
  isArchived: boolean;
}

export type ProjectStatus = "proposed" | "active" | "on_hold" | "complete" | "cancelled" | "archived";

export interface Project {
  id: Id;
  name: string;
  shortName?: string;
  description?: string;
  status: ProjectStatus;
  startDate?: IsoDate;
  targetEndDate?: IsoDate;
  leadEmployeeId?: Id;
  competencyId?: Id;
  sourceSystem?: string;
  sourceReference?: string;
  lastVerifiedDate?: IsoDate;
  tags: string[];
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
  isArchived: boolean;
}

export type TaskStatus =
  | "inbox"
  | "planned"
  | "in_progress"
  | "waiting"
  | "needs_review"
  | "complete"
  | "cancelled";

export type TaskPriority = "low" | "normal" | "high" | "critical";

export type TaskCategory =
  | "project"
  | "personnel"
  | "performance"
  | "training"
  | "leave"
  | "telework"
  | "award"
  | "timekeeping"
  | "meeting"
  | "administrative"
  | "general";

export type VerificationStatus = "not_required" | "unverified" | "verified" | "needs_recheck";

export interface Task {
  id: Id;
  title: string;
  description?: string;
  status: TaskStatus;
  priority: TaskPriority;
  category: TaskCategory;
  employeeId?: Id;
  projectId?: Id;
  competencyId?: Id;
  startDate?: IsoDate;
  dueDate?: IsoDate;
  reminderDate?: IsoDate;
  followUpDate?: IsoDate;
  completedDate?: IsoDate;
  sourceSystem?: string;
  sourceReference?: string;
  lastVerifiedDate?: IsoDate;
  verificationStatus?: VerificationStatus;
  waitingReason?: string;
  waitingOn?: string;
  waitingSince?: IsoTimestamp;
  recurrenceTemplateId?: Id;
  recurrenceInstanceKey?: string;
  performanceInputCreated: boolean;
  tags: string[];
  boardOrder: number;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
  isArchived: boolean;
}

export type NoteType = "general" | "status" | "decision" | "completion" | "verification";

export interface TaskNote {
  id: Id;
  taskId: Id;
  body: string;
  noteType: NoteType;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}

export interface ChecklistItem {
  id: Id;
  taskId: Id;
  title: string;
  isComplete: boolean;
  completedAt?: IsoTimestamp;
  order: number;
}

export interface PerformanceElement {
  id: Id;
  name: string;
  description?: string;
  active: boolean;
}

export interface EvaluationCycle {
  id: Id;
  name: string;
  startDate: IsoDate;
  endDate: IsoDate;
  midyearDate?: IsoDate;
  active: boolean;
}

export type PerformanceInputStatus = "draft" | "ready" | "used_midyear" | "used_annual" | "archived";

export interface PerformanceInput {
  id: Id;
  employeeId: Id;
  inputDate: IsoDate;
  situationOrContext?: string;
  actionOrAccomplishment: string;
  result?: string;
  impact?: string;
  performanceElementId?: Id;
  projectId?: Id;
  relatedTaskId?: Id;
  evaluationCycleId?: Id;
  source?: string;
  inputStatus: PerformanceInputStatus;
  recognitionPotential: boolean;
  notes?: string;
  tags: string[];
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
  isArchived: boolean;
}

export interface TrainingRequirement {
  id: Id;
  name: string;
  description?: string;
  category?: string;
  recurrenceType?: "none" | "days" | "months" | "annual";
  recurrenceInterval?: number;
  warningDays: number[];
  sourceSystem?: string;
  sourceReference?: string;
  active: boolean;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}

export type TrainingRecordStatus = "assigned" | "complete" | "not_applicable" | "waived" | "unknown";

export interface EmployeeTrainingRecord {
  id: Id;
  employeeId: Id;
  trainingRequirementId: Id;
  assignedDate?: IsoDate;
  dueDate?: IsoDate;
  completedDate?: IsoDate;
  expirationDate?: IsoDate;
  status: TrainingRecordStatus;
  evidenceReference?: string;
  sourceSystem?: string;
  sourceReference?: string;
  lastVerifiedDate?: IsoDate;
  notes?: string;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}

export type LeaveStatus = "planned" | "requested" | "approved" | "changed" | "cancelled" | "complete" | "unknown";

export interface LeaveRecord {
  id: Id;
  employeeId: Id;
  leaveType?: string;
  startDate: IsoDate;
  endDate: IsoDate;
  partialDay?: string;
  status: LeaveStatus;
  sourceSystem?: string;
  sourceReference?: string;
  lastVerifiedDate?: IsoDate;
  workloadImpactNote?: string;
  relatedTaskId?: Id;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}

export type TeleworkStatus =
  | "draft"
  | "pending_employee"
  | "pending_supervisor"
  | "pending_approval"
  | "approved"
  | "active"
  | "expired"
  | "denied"
  | "cancelled";

export interface TeleworkRecord {
  id: Id;
  employeeId: Id;
  recordType: string;
  requestDate?: IsoDate;
  effectiveDate?: IsoDate;
  expirationDate?: IsoDate;
  status: TeleworkStatus;
  scheduleSummary?: string;
  sourceSystem?: string;
  sourceReference?: string;
  lastVerifiedDate?: IsoDate;
  relatedTaskId?: Id;
  notes?: string;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}

export interface AwardRecord {
  id: Id;
  employeeId: Id;
  awardType?: string;
  title: string;
  accomplishmentPeriodStart?: IsoDate;
  accomplishmentPeriodEnd?: IsoDate;
  nominationDueDate?: IsoDate;
  submittedDate?: IsoDate;
  decisionDate?: IsoDate;
  status: string;
  citationDraft?: string;
  supportingNotes?: string;
  projectId?: Id;
  relatedPerformanceInputIds: Id[];
  sourceReference?: string;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}

export interface EmployeeInteraction {
  id: Id;
  employeeId: Id;
  interactionDate: IsoDate;
  interactionType: string;
  summary?: string;
  followUpRequired: boolean;
  relatedTaskId?: Id;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}

export interface ActivityEntry {
  id: Id;
  entityType: string;
  entityId: Id;
  actionType: string;
  timestamp: IsoTimestamp;
  summary: string;
  changedFields?: Record<string, unknown>;
  sessionId: string;
}

export interface AttentionSnooze {
  id: Id; // `${entityType}:${entityId}:${reasonCode}`
  snoozedUntil: IsoDate;
  snoozeReason?: string;
}

export interface AppSettings {
  schemaVersion: number;
  applicationName: string;
  userDisplayName?: string;
  dueSoonDays: number;
  waitingStaleDays: number;
  taskStaleDays: number;
  performanceInputReminderDays: number;
  checkInReminderDays: number;
  completedVisibleDays: number;
  backupReminderDays: number;
  backupChangeThreshold: number;
  trainingWarningDays: number;
  leaveLookaheadDays: number;
  theme: "light" | "dark" | "system";
}

export const DEFAULT_SETTINGS: AppSettings = {
  schemaVersion: 1,
  applicationName: "Supervisor Assistant",
  dueSoonDays: 7,
  waitingStaleDays: 14,
  taskStaleDays: 30,
  performanceInputReminderDays: 90,
  checkInReminderDays: 30,
  completedVisibleDays: 7,
  backupReminderDays: 7,
  backupChangeThreshold: 50,
  trainingWarningDays: 30,
  leaveLookaheadDays: 14,
  theme: "system"
};

export const TASK_STATUSES: { value: TaskStatus; label: string }[] = [
  { value: "inbox", label: "Inbox" },
  { value: "planned", label: "Planned" },
  { value: "in_progress", label: "In Progress" },
  { value: "waiting", label: "Waiting" },
  { value: "needs_review", label: "Needs Review" },
  { value: "complete", label: "Complete" }
];

export const BOARD_STATUSES: TaskStatus[] = TASK_STATUSES.map((s) => s.value);

export const TASK_PRIORITIES: { value: TaskPriority; label: string }[] = [
  { value: "low", label: "Low" },
  { value: "normal", label: "Normal" },
  { value: "high", label: "High" },
  { value: "critical", label: "Critical" }
];

export const TASK_CATEGORIES: { value: TaskCategory; label: string }[] = [
  { value: "project", label: "Project Work" },
  { value: "personnel", label: "Personnel Action" },
  { value: "performance", label: "Performance" },
  { value: "training", label: "Training" },
  { value: "leave", label: "Leave" },
  { value: "telework", label: "Telework" },
  { value: "award", label: "Award" },
  { value: "timekeeping", label: "Timekeeping" },
  { value: "meeting", label: "Meeting Follow-up" },
  { value: "administrative", label: "Administrative" },
  { value: "general", label: "General" }
];

export const SOURCE_SYSTEMS = ["None", "Planner", "ERP", "SWAT", "Email", "Meeting", "Supervisor", "Employee", "Other"];

export const INTERACTION_TYPES = [
  "One-on-one",
  "Informal check-in",
  "Counseling",
  "Career discussion",
  "Project discussion",
  "Training discussion",
  "Recognition",
  "Other"
];

export const LEAVE_TYPES = ["Annual", "Sick", "Comp Time", "Credit Hours", "Administrative", "Other", "Not specified"];

export const TELEWORK_RECORD_TYPES = ["Agreement", "Routine request", "Situational request", "Renewal", "Modification", "Other"];

export const AWARD_STATUSES = [
  "Idea",
  "Gathering input",
  "Drafting",
  "Ready for review",
  "Submitted",
  "Approved",
  "Not selected",
  "Complete",
  "Cancelled"
];

export function statusLabel(status: TaskStatus): string {
  return TASK_STATUSES.find((s) => s.value === status)?.label ?? status;
}

export function categoryLabel(category: TaskCategory): string {
  return TASK_CATEGORIES.find((c) => c.value === category)?.label ?? category;
}

export function priorityLabel(priority: TaskPriority): string {
  return TASK_PRIORITIES.find((p) => p.value === priority)?.label ?? priority;
}
