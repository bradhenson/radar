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
export type ComputerAsset = "rdte" | "nmci";
export type ClearanceLevel = "s" | "ts" | "ts_sci";

export interface Employee {
  id: Id;
  displayName: string;
  preferredName?: string;
  sortName?: string;
  competencyId?: Id;
  edipi?: string;
  pernr?: string;
  series?: string;
  workEmail?: string;
  positionTitle?: string;
  role?: string;
  /** Integrated Product Team; legacy backups may still think of this as "team". */
  team?: string;
  locationBuilding?: string;
  locationCube?: string;
  workPhone?: string;
  workCellPhone?: string;
  personalPhone?: string;
  iptLead?: string;
  employeeProject?: string;
  employeeProjectLead?: string;
  computerAsset?: ComputerAsset;
  govPhone?: boolean;
  cswfCode?: string;
  cswfLevel?: string;
  financialStatementRequired?: boolean;
  drugTestRequired?: boolean;
  teleworkAgreementValidThrough?: IsoDate;
  clearance?: ClearanceLevel;
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

export type TaskCategory = string;

export interface TaskCategoryDefinition {
  id: Id;
  label: string;
  sortOrder: number;
  isArchived: boolean;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}

export interface BoardColumnDefinition {
  id: Id;
  label: string;
  sortOrder: number;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}

export type VerificationStatus = "not_required" | "unverified" | "verified" | "needs_recheck";

export interface Task {
  id: Id;
  title: string;
  description?: string;
  status: TaskStatus;
  boardColumnId?: Id;
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
  /** Planner-style preview: show the description or the checklist on the board card. */
  showOnCard?: "description" | "checklist";
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

export type TrainingAssignmentScope = "all" | "selected";

export interface TrainingRequirement {
  id: Id;
  name: string;
  description?: string;
  category?: string; // legacy field, no longer surfaced in the UI
  recurrenceType?: "none" | "days" | "months" | "annual";
  recurrenceInterval?: number;
  // Fixed due date shared by every assigned employee (annual and one-time
  // requirements). Rolling requirements derive due from each completion.
  dueDate?: IsoDate;
  // Missing scope means "all" — annual requirements apply to everyone,
  // including employees added later, without per-employee assignment.
  assignmentScope?: TrainingAssignmentScope;
  assignedEmployeeIds?: Id[];
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
  | "pending"
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

/**
 * Standing supervisor note about an employee — durable context to remember
 * (preferences, goals, constraints). Dated events belong in
 * EmployeeInteraction instead.
 */
export interface EmployeeNote {
  id: Id;
  employeeId: Id;
  noteText: string;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
  isArchived: boolean;
}

export interface MeetingNote {
  id: Id;
  meetingDate: IsoDate;
  title: string;
  meetingType: string;
  projectId?: Id;
  attendeeEmployeeIds: Id[];
  notes?: string;
  actionItems?: string;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
  isArchived: boolean;
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
  colorTheme: ColorTheme;
}

export type ColorTheme = "default" | "ocean" | "forest" | "violet" | "sunset" | "graphite";

/** Selectable accent palettes. Swatches are the light/dark accent colors (for pickers). */
export const COLOR_THEMES: { value: ColorTheme; label: string; swatch: string; swatchDark: string }[] = [
  { value: "default", label: "Default", swatch: "#3661e4", swatchDark: "#4daafc" },
  { value: "ocean", label: "Ocean", swatch: "#0d7489", swatchDark: "#4cc3dd" },
  { value: "forest", label: "Forest", swatch: "#1f7a44", swatchDark: "#63c992" },
  { value: "violet", label: "Violet", swatch: "#6d3ac4", swatchDark: "#b39cf2" },
  { value: "sunset", label: "Sunset", swatch: "#b45309", swatchDark: "#e8a558" },
  { value: "graphite", label: "Graphite", swatch: "#47525f", swatchDark: "#a6b2c0" }
];

export const DEFAULT_SETTINGS: AppSettings = {
  schemaVersion: 1,
  applicationName: "RADAR",
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
  theme: "system",
  colorTheme: "default"
};

export const TASK_STATUSES: { value: TaskStatus; label: string }[] = [
  { value: "inbox", label: "Not Started" },
  { value: "planned", label: "Planned" },
  { value: "in_progress", label: "In Progress" },
  { value: "waiting", label: "Waiting" },
  { value: "needs_review", label: "Needs Review" },
  { value: "complete", label: "Complete" }
];

export const BOARD_STATUSES: TaskStatus[] = TASK_STATUSES.map((s) => s.value);

export const DEFAULT_BOARD_COLUMN_SEEDS: { id: Id; label: string; sortOrder: number }[] = [
  { id: "inbox", label: "Inbox", sortOrder: 10 },
  { id: "planned", label: "Planned", sortOrder: 20 },
  { id: "in_progress", label: "In Progress", sortOrder: 30 },
  { id: "waiting", label: "Waiting", sortOrder: 40 },
  { id: "needs_review", label: "Needs Review", sortOrder: 50 },
  { id: "complete", label: "Complete", sortOrder: 60 }
];

export const TASK_PRIORITIES: { value: TaskPriority; label: string }[] = [
  { value: "low", label: "Low" },
  { value: "normal", label: "Normal" },
  { value: "high", label: "High" },
  { value: "critical", label: "Critical" }
];

export const DEFAULT_TASK_CATEGORY_SEEDS: { id: TaskCategory; label: string; sortOrder: number }[] = [
  { id: "general", label: "General", sortOrder: 10 },
  { id: "project", label: "Project Work", sortOrder: 20 },
  { id: "personnel", label: "Personnel", sortOrder: 30 },
  { id: "performance", label: "Performance", sortOrder: 40 },
  { id: "training", label: "Training", sortOrder: 50 },
  { id: "administrative", label: "Administrative", sortOrder: 60 }
];

export const TASK_CATEGORIES = DEFAULT_TASK_CATEGORY_SEEDS.map((c) => ({ value: c.id, label: c.label }));

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

export const MEETING_TYPES = ["Product team", "Project", "Staff", "Customer", "One-on-one", "Other"];

export const LEAVE_TYPES = ["Annual", "Sick", "Comp Time", "Credit Hours", "Administrative", "Other", "Not specified"];

export const TELEWORK_RECORD_TYPES = ["Agreement", "Routine request", "Situational request", "Renewal", "Modification", "Other"];

export const COMPUTER_ASSET_OPTIONS: { value: ComputerAsset; label: string }[] = [
  { value: "rdte", label: "RDT&E" },
  { value: "nmci", label: "NMCI" }
];

export const CLEARANCE_OPTIONS: { value: ClearanceLevel; label: string }[] = [
  { value: "s", label: "S" },
  { value: "ts", label: "TS" },
  { value: "ts_sci", label: "TS/SCI" }
];

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
