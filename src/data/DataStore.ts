// Storage abstraction (plan section 8.6). UI and services never touch
// IndexedDB directly; they call a DataStore. Implementations:
//   - IndexedDbDataStore: primary working storage.
//   - InMemoryDataStore: fallback when IndexedDB is unavailable, and tests.

import type {
  ActivityEntry,
  AppSettings,
  AttentionSnooze,
  AwardRecord,
  BoardColumnDefinition,
  ChecklistItem,
  Competency,
  Employee,
  EmployeeInteraction,
  EmployeeNote,
  EmployeeTrainingRecord,
  EvaluationCycle,
  LeaveRecord,
  MeetingNote,
  PerformanceElement,
  PerformanceInput,
  Project,
  Task,
  TaskNote,
  TeleworkRecord,
  TravelRecord,
  TrainingRequirement
} from "../domain/models";

export interface CollectionTypes {
  competencies: Competency;
  employees: Employee;
  projects: Project;
  tasks: Task;
  boardColumns: BoardColumnDefinition;
  taskNotes: TaskNote;
  checklistItems: ChecklistItem;
  performanceElements: PerformanceElement;
  evaluationCycles: EvaluationCycle;
  performanceInputs: PerformanceInput;
  trainingRequirements: TrainingRequirement;
  employeeTrainingRecords: EmployeeTrainingRecord;
  leaveRecords: LeaveRecord;
  teleworkRecords: TeleworkRecord;
  travelRecords: TravelRecord;
  awardRecords: AwardRecord;
  employeeInteractions: EmployeeInteraction;
  employeeNotes: EmployeeNote;
  meetingNotes: MeetingNote;
  activityEntries: ActivityEntry;
  attentionSnoozes: AttentionSnooze;
}

export type CollectionName = keyof CollectionTypes;

export const COLLECTION_NAMES: CollectionName[] = [
  "competencies",
  "employees",
  "projects",
  "tasks",
  "boardColumns",
  "taskNotes",
  "checklistItems",
  "performanceElements",
  "evaluationCycles",
  "performanceInputs",
  "trainingRequirements",
  "employeeTrainingRecords",
  "leaveRecords",
  "teleworkRecords",
  "travelRecords",
  "awardRecords",
  "employeeInteractions",
  "employeeNotes",
  "meetingNotes",
  "activityEntries",
  "attentionSnoozes"
];

/** Non-entity metadata persisted alongside the data. */
export interface StoreMeta {
  databaseId: string;
  lastBackupAt?: string;
  changesSinceBackup: number;
}

export interface DatabaseSnapshot {
  collections: { [K in CollectionName]: CollectionTypes[K][] };
  settings: AppSettings;
  meta: StoreMeta;
}

/**
 * One step of an atomic unit of work. A batch of ops passed to
 * DataStore.mutate() commits together or not at all, so a record write, its
 * activity entry, and the backup-change counter can never diverge, and a
 * cascading deletion cannot stop halfway.
 */
export type MutationOp =
  | { kind: "put"; collection: CollectionName; record: CollectionTypes[CollectionName] }
  | { kind: "delete"; collection: CollectionName; id: string }
  | { kind: "saveSettings"; settings: AppSettings }
  | { kind: "saveMeta"; meta: StoreMeta };

export function putOp<K extends CollectionName>(collection: K, record: CollectionTypes[K]): MutationOp {
  return { kind: "put", collection, record };
}

export function deleteOp(collection: CollectionName, id: string): MutationOp {
  return { kind: "delete", collection, id };
}

export interface DataStore {
  readonly kind: "indexeddb" | "memory";
  initialize(): Promise<void>;
  getAll<K extends CollectionName>(name: K): Promise<CollectionTypes[K][]>;
  put<K extends CollectionName>(name: K, record: CollectionTypes[K]): Promise<void>;
  bulkPut<K extends CollectionName>(name: K, records: CollectionTypes[K][]): Promise<void>;
  delete(name: CollectionName, id: string): Promise<void>;
  /** Apply every op atomically (single transaction); see MutationOp. */
  mutate(ops: MutationOp[]): Promise<void>;
  getSettings(): Promise<AppSettings | undefined>;
  saveSettings(settings: AppSettings): Promise<void>;
  getMeta(): Promise<StoreMeta>;
  saveMeta(meta: StoreMeta): Promise<void>;
  /** Full snapshot for backup export. */
  exportSnapshot(): Promise<DatabaseSnapshot>;
  /** Replace the entire database with a snapshot (backup import "replace"). */
  replaceAll(snapshot: DatabaseSnapshot): Promise<void>;
  /** Delete every record. Used by "reset all data" after confirmation. */
  clearAll(): Promise<void>;
}

export function emptyCollections(): DatabaseSnapshot["collections"] {
  return Object.fromEntries(COLLECTION_NAMES.map((n) => [n, []])) as unknown as DatabaseSnapshot["collections"];
}
