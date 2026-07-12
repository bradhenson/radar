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
export type EmployeeProfileValue = string | boolean | string[];

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
  /** Values for organization-defined profile fields, keyed by stable field id. */
  profileValues?: Record<string, EmployeeProfileValue>;
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

export type TaskStatus = "open" | "waiting" | "complete" | "cancelled";

export type TaskPriority = "low" | "normal" | "high" | "critical";

export interface BoardColumnDefinition {
  id: Id;
  label: string;
  sortOrder: number;
  /**
   * Task status this lane implies. Dropping a card here also sets the task's
   * status, and completing a task moves its card to the complete-mapped lane,
   * so the board can never silently disagree with the domain rules. Columns
   * without a mapping (custom lanes) never change status.
   */
  mapsToStatus?: TaskStatus;
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
  employeeId?: Id;
  projectId?: Id;
  competencyId?: Id;
  startDate?: IsoDate;
  dueDate?: IsoDate;
  reminderDate?: IsoDate;
  completedDate?: IsoDate;
  sourceSystem?: string;
  sourceReference?: string;
  lastVerifiedDate?: IsoDate;
  verificationStatus?: VerificationStatus;
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

// Travel awareness (who is on travel, and the DTS paperwork state around it).
export type TravelIptConcurrence = "pending" | "concurred" | "not_required";
export type TravelDtsAuthStatus = "not_started" | "created" | "approved";

export interface TravelRecord {
  id: Id;
  employeeId: Id;
  destination: string;
  startDate: IsoDate;
  endDate: IsoDate;
  iptConcurrence: TravelIptConcurrence;
  dtsAuthorizationStatus: TravelDtsAuthStatus;
  dtsAuthorizationId?: string;
  // DTS voucher is due five days after the traveler returns (see
  // domain/rules/travel.ts). Stored so it can be overridden for special cases.
  voucherDueDate?: IsoDate;
  notes?: string;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
  isArchived?: boolean;
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
  /** Unmodified N/P/Q/T/B/E/M shortcuts; can be disabled for accessibility. */
  enableSingleKeyShortcuts: boolean;
  employeeProfileSections: EmployeeProfileSection[];
  employeeProfileFields: EmployeeProfileField[];
}

export type EmployeeProfileFieldType = "text" | "multiline" | "date" | "boolean" | "email" | "phone" | "url" | "choice" | "multi_choice";

export type BuiltInEmployeeProfileKey =
  | "positionTitle" | "series" | "edipi" | "pernr"
  | "locationBuilding" | "locationCube" | "workEmail" | "workPhone" | "workCellPhone" | "personalPhone" | "govPhone"
  | "team" | "iptLead" | "employeeProject" | "employeeProjectLead"
  | "computerAsset" | "clearance" | "cswfCode" | "cswfLevel" | "financialStatementRequired" | "drugTestRequired"
  | "teleworkAgreementValidThrough";

export interface EmployeeProfileSection {
  id: string;
  label: string;
  sortOrder: number;
  isArchived: boolean;
}

export interface EmployeeProfileChoice {
  value: string;
  label: string;
}

export interface EmployeeProfileField {
  id: string;
  sectionId: string;
  label: string;
  type: EmployeeProfileFieldType;
  sortOrder: number;
  options?: EmployeeProfileChoice[];
  builtInKey?: BuiltInEmployeeProfileKey;
  isArchived: boolean;
}

export type ColorTheme = "default" | "ocean" | "forest" | "violet" | "sunset" | "graphite";

const LEGACY_DEFAULT_APPLICATION_NAMES = new Set(["Supervisor Assistant"]);

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
  schemaVersion: 3,
  applicationName: "RADAR",
  dueSoonDays: 7,
  waitingStaleDays: 14,
  taskStaleDays: 30,
  performanceInputReminderDays: 90,
  checkInReminderDays: 30,
  completedVisibleDays: 7,
  backupReminderDays: 1,
  backupChangeThreshold: 10,
  trainingWarningDays: 30,
  leaveLookaheadDays: 14,
  theme: "dark",
  colorTheme: "default",
  enableSingleKeyShortcuts: true,
  employeeProfileSections: [
    { id: "identity", label: "Identity", sortOrder: 0, isArchived: false },
    { id: "contact", label: "Location and contact", sortOrder: 1, isArchived: false },
    { id: "organization", label: "Organization and project", sortOrder: 2, isArchived: false },
    { id: "requirements", label: "Assets and requirements", sortOrder: 3, isArchived: false }
  ],
  employeeProfileFields: [
    profileField("position-title", "identity", "Title", "text", 0, "positionTitle"),
    profileField("series", "identity", "Series", "text", 1, "series"),
    profileField("edipi", "identity", "EDIPI", "text", 2, "edipi"),
    profileField("pernr", "identity", "PERNR", "text", 3, "pernr"),
    profileField("building", "contact", "Building", "text", 0, "locationBuilding"),
    profileField("cube", "contact", "Cube", "text", 1, "locationCube"),
    profileField("work-email", "contact", "Work email", "email", 2, "workEmail"),
    profileField("work-phone", "contact", "Work phone", "phone", 3, "workPhone"),
    profileField("work-cell", "contact", "Work cell phone", "phone", 4, "workCellPhone"),
    profileField("personal-phone", "contact", "Personal cell phone", "phone", 5, "personalPhone"),
    profileField("gov-phone", "contact", "Government phone", "boolean", 6, "govPhone"),
    profileField("team", "organization", "Integrated Product Team", "text", 0, "team"),
    profileField("ipt-lead", "organization", "IPT Lead", "text", 1, "iptLead"),
    profileField("employee-project", "organization", "Project", "text", 2, "employeeProject"),
    profileField("employee-project-lead", "organization", "Project Lead", "text", 3, "employeeProjectLead"),
    profileChoiceField("computer-asset", "requirements", "Computer Asset", 0, "computerAsset", [
      { value: "rdte", label: "RDT&E" }, { value: "nmci", label: "NMCI" }
    ]),
    profileChoiceField("clearance", "requirements", "Clearance", 1, "clearance", [
      { value: "s", label: "Secret" }, { value: "ts", label: "Top Secret" }, { value: "ts_sci", label: "TS/SCI" }
    ]),
    profileField("cswf-code", "requirements", "CSWF Code", "text", 2, "cswfCode"),
    profileField("cswf-level", "requirements", "CSWF Level", "text", 3, "cswfLevel"),
    profileField("financial-statement", "requirements", "Financial Statement Required", "boolean", 4, "financialStatementRequired"),
    profileField("drug-test", "requirements", "Drug Test Required", "boolean", 5, "drugTestRequired"),
    profileField("telework-valid", "requirements", "Telework Agreement Valid Through", "date", 6, "teleworkAgreementValidThrough")
  ]
};

function profileField(
  id: string, sectionId: string, label: string, type: EmployeeProfileFieldType, sortOrder: number,
  builtInKey: BuiltInEmployeeProfileKey
): EmployeeProfileField {
  return { id, sectionId, label, type, sortOrder, builtInKey, isArchived: false };
}

function profileChoiceField(
  id: string, sectionId: string, label: string, sortOrder: number, builtInKey: BuiltInEmployeeProfileKey,
  options: EmployeeProfileChoice[]
): EmployeeProfileField {
  return { ...profileField(id, sectionId, label, "choice", sortOrder, builtInKey), options };
}

export const EMPLOYEE_PROFILE_FIELD_TYPES: { value: EmployeeProfileFieldType; label: string }[] = [
  { value: "text", label: "Short text" },
  { value: "multiline", label: "Long text" },
  { value: "date", label: "Date" },
  { value: "boolean", label: "Yes / No" },
  { value: "email", label: "Email" },
  { value: "phone", label: "Phone" },
  { value: "url", label: "Web link" },
  { value: "choice", label: "Single choice" },
  { value: "multi_choice", label: "Multiple choice" }
];

const PROFILE_TYPES = new Set(EMPLOYEE_PROFILE_FIELD_TYPES.map((item) => item.value));
const BUILT_IN_PROFILE_KEYS = new Set<BuiltInEmployeeProfileKey>([
  "positionTitle", "series", "edipi", "pernr", "locationBuilding", "locationCube", "workEmail", "workPhone",
  "workCellPhone", "personalPhone", "govPhone", "team", "iptLead", "employeeProject", "employeeProjectLead",
  "computerAsset", "clearance", "cswfCode", "cswfLevel", "financialStatementRequired", "drugTestRequired",
  "teleworkAgreementValidThrough"
]);

function defaultProfileSections(): EmployeeProfileSection[] {
  return DEFAULT_SETTINGS.employeeProfileSections.map((section) => ({ ...section }));
}

function defaultProfileFields(): EmployeeProfileField[] {
  return DEFAULT_SETTINGS.employeeProfileFields.map((field) => ({
    ...field,
    options: field.options?.map((option) => ({ ...option }))
  }));
}

function normalizeProfileSections(raw: unknown): EmployeeProfileSection[] {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 50) return defaultProfileSections();
  const seen = new Set<string>();
  const sections: EmployeeProfileSection[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) return defaultProfileSections();
    const src = item as Record<string, unknown>;
    if (typeof src.id !== "string" || !src.id || seen.has(src.id) || typeof src.label !== "string" || !src.label.trim()) {
      return defaultProfileSections();
    }
    seen.add(src.id);
    sections.push({
      id: src.id.slice(0, 100),
      label: src.label.trim().slice(0, 100),
      sortOrder: typeof src.sortOrder === "number" && Number.isFinite(src.sortOrder) ? src.sortOrder : sections.length,
      isArchived: src.isArchived === true
    });
  }
  return sections;
}

function normalizeProfileFields(raw: unknown, sections: EmployeeProfileSection[]): EmployeeProfileField[] {
  if (!Array.isArray(raw) || raw.length > 200) return defaultProfileFields();
  const sectionIds = new Set(sections.map((section) => section.id));
  const seen = new Set<string>();
  const fields: EmployeeProfileField[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) return defaultProfileFields();
    const src = item as Record<string, unknown>;
    if (
      typeof src.id !== "string" || !src.id || seen.has(src.id) ||
      typeof src.sectionId !== "string" || !sectionIds.has(src.sectionId) ||
      typeof src.label !== "string" || !src.label.trim() ||
      typeof src.type !== "string" || !PROFILE_TYPES.has(src.type as EmployeeProfileFieldType)
    ) return defaultProfileFields();
    const builtInKey = typeof src.builtInKey === "string" && BUILT_IN_PROFILE_KEYS.has(src.builtInKey as BuiltInEmployeeProfileKey)
      ? src.builtInKey as BuiltInEmployeeProfileKey
      : undefined;
    const options = Array.isArray(src.options)
      ? src.options.flatMap((option) => {
          if (typeof option !== "object" || option === null || Array.isArray(option)) return [];
          const entry = option as Record<string, unknown>;
          if (typeof entry.value !== "string" || !entry.value || typeof entry.label !== "string" || !entry.label.trim()) return [];
          return [{ value: entry.value.slice(0, 100), label: entry.label.trim().slice(0, 100) }];
        }).slice(0, 50)
      : undefined;
    seen.add(src.id);
    fields.push({
      id: src.id.slice(0, 100),
      sectionId: src.sectionId,
      label: src.label.trim().slice(0, 100),
      type: src.type as EmployeeProfileFieldType,
      sortOrder: typeof src.sortOrder === "number" && Number.isFinite(src.sortOrder) ? src.sortOrder : fields.length,
      options,
      builtInKey,
      isArchived: src.isArchived === true
    });
  }
  return fields;
}

/** Normalize persisted/imported settings and apply schema migrations. */
export function normalizeAppSettings(raw: unknown): AppSettings {
  const out: AppSettings = {
    ...DEFAULT_SETTINGS,
    employeeProfileSections: defaultProfileSections(),
    employeeProfileFields: defaultProfileFields()
  };
  if (typeof raw !== "object" || raw === null) return out;

  const src = raw as Record<string, unknown>;
  const priorSchema = typeof src.schemaVersion === "number" ? src.schemaVersion : 1;
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof AppSettings)[]) {
    const v = src[key];
    if (v !== undefined && typeof v === typeof DEFAULT_SETTINGS[key]) {
      (out as unknown as Record<string, unknown>)[key] = v;
    }
  }
  if (typeof src.userDisplayName === "string") out.userDisplayName = src.userDisplayName;
  out.employeeProfileSections = normalizeProfileSections(src.employeeProfileSections);
  out.employeeProfileFields = normalizeProfileFields(src.employeeProfileFields, out.employeeProfileSections);

  if (LEGACY_DEFAULT_APPLICATION_NAMES.has(out.applicationName)) {
    out.applicationName = DEFAULT_SETTINGS.applicationName;
  }

  if (priorSchema < 2) {
    if (src.backupReminderDays === undefined || src.backupReminderDays === 7) {
      out.backupReminderDays = DEFAULT_SETTINGS.backupReminderDays;
    }
    if (src.backupChangeThreshold === undefined || src.backupChangeThreshold === 50) {
      out.backupChangeThreshold = DEFAULT_SETTINGS.backupChangeThreshold;
    }
  }

  out.schemaVersion = DEFAULT_SETTINGS.schemaVersion;
  return out;
}

export const TASK_STATUSES: { value: TaskStatus; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "waiting", label: "Waiting" },
  { value: "complete", label: "Complete" }
];

/**
 * Collapse legacy workflow-stage statuses (inbox/planned/in_progress/needs_review) into
 * "open". Workflow stages belong to the user-defined board columns; status only carries
 * the states domain rules act on. Unknown values also normalize to "open" because every
 * rule already treated them as an open task.
 */
export function normalizeTaskStatus(value: string): TaskStatus {
  return value === "waiting" || value === "complete" || value === "cancelled" ? value : "open";
}

export const DEFAULT_BOARD_COLUMN_SEEDS: { id: Id; label: string; sortOrder: number; mapsToStatus?: TaskStatus }[] = [
  { id: "inbox", label: "Inbox", sortOrder: 10, mapsToStatus: "open" },
  { id: "in_progress", label: "In Progress", sortOrder: 20, mapsToStatus: "open" },
  { id: "waiting", label: "Waiting", sortOrder: 30, mapsToStatus: "waiting" },
  { id: "complete", label: "Complete", sortOrder: 40, mapsToStatus: "complete" }
];

export const TASK_PRIORITIES: { value: TaskPriority; label: string }[] = [
  { value: "low", label: "Low" },
  { value: "normal", label: "Normal" },
  { value: "high", label: "High" },
  { value: "critical", label: "Critical" }
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

export const MEETING_TYPES = ["Product team", "Project", "Staff", "Customer", "One-on-one", "Other"];

export const LEAVE_TYPES = ["Annual", "Sick", "Comp Time", "Credit Hours", "Administrative", "Other", "Not specified"];

export const TELEWORK_RECORD_TYPES = ["Agreement", "Routine request", "Situational request", "Renewal", "Modification", "Other"];

export const TRAVEL_IPT_CONCURRENCE_OPTIONS: { value: TravelIptConcurrence; label: string }[] = [
  { value: "pending", label: "Pending" },
  { value: "concurred", label: "Concurred" },
  { value: "not_required", label: "Not required" }
];

export const TRAVEL_DTS_AUTH_STATUS_OPTIONS: { value: TravelDtsAuthStatus; label: string }[] = [
  { value: "not_started", label: "Not started" },
  { value: "created", label: "Created" },
  { value: "approved", label: "Approved" }
];

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
  if (status === "cancelled") return "Cancelled";
  return TASK_STATUSES.find((s) => s.value === status)?.label ?? status;
}


export function priorityLabel(priority: TaskPriority): string {
  return TASK_PRIORITIES.find((p) => p.value === priority)?.label ?? priority;
}
