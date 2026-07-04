// Storage abstraction (plan section 8.6). UI and services never touch
// IndexedDB directly; they call a DataStore. Implementations:
//   - IndexedDbDataStore: primary working storage.
//   - InMemoryDataStore: fallback when IndexedDB is unavailable, and tests.

import type {
  ActivityEntry,
  AppSettings,
  AttentionSnooze,
  AwardRecord,
  ChecklistItem,
  Competency,
  Employee,
  EmployeeInteraction,
  EmployeeTrainingRecord,
  EvaluationCycle,
  LeaveRecord,
  PerformanceElement,
  PerformanceInput,
  Project,
  Task,
  TaskNote,
  TeleworkRecord,
  TrainingRequirement
} from "../domain/models";

export interface CollectionTypes {
  competencies: Competency;
  employees: Employee;
  projects: Project;
  tasks: Task;
  taskNotes: TaskNote;
  checklistItems: ChecklistItem;
  performanceElements: PerformanceElement;
  evaluationCycles: EvaluationCycle;
  performanceInputs: PerformanceInput;
  trainingRequirements: TrainingRequirement;
  employeeTrainingRecords: EmployeeTrainingRecord;
  leaveRecords: LeaveRecord;
  teleworkRecords: TeleworkRecord;
  awardRecords: AwardRecord;
  employeeInteractions: EmployeeInteraction;
  activityEntries: ActivityEntry;
  attentionSnoozes: AttentionSnooze;
}

export type CollectionName = keyof CollectionTypes;

export const COLLECTION_NAMES: CollectionName[] = [
  "competencies",
  "employees",
  "projects",
  "tasks",
  "taskNotes",
  "checklistItems",
  "performanceElements",
  "evaluationCycles",
  "performanceInputs",
  "trainingRequirements",
  "employeeTrainingRecords",
  "leaveRecords",
  "teleworkRecords",
  "awardRecords",
  "employeeInteractions",
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

export interface DataStore {
  readonly kind: "indexeddb" | "memory";
  initialize(): Promise<void>;
  getAll<K extends CollectionName>(name: K): Promise<CollectionTypes[K][]>;
  put<K extends CollectionName>(name: K, record: CollectionTypes[K]): Promise<void>;
  bulkPut<K extends CollectionName>(name: K, records: CollectionTypes[K][]): Promise<void>;
  delete(name: CollectionName, id: string): Promise<void>;
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
