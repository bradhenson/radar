// Automatic backup rules (pure). The desktop shell writes the file
// (desktop/autobackup.go); these decide what it is called and when one is due.

import type { IsoDate } from "../models";

export const AUTO_BACKUP_MIN_KEEP_DAYS = 1;
export const AUTO_BACKUP_MAX_KEEP_DAYS = 365;
export const AUTO_BACKUP_DEFAULT_KEEP_DAYS = 14;

/** How often a running app checks whether changes need backing up. */
export const AUTO_BACKUP_INTERVAL_MINUTES = 30;

/**
 * One file per database per day: `RADAR_AutoBackup_<id fragment>_<date>.json`.
 * The fragment keeps two databases that share a folder from overwriting each
 * other. The shape must match autoBackupNamePattern in desktop/autobackup.go,
 * which refuses anything else.
 */
export function autoBackupFilename(databaseId: string, today: IsoDate): string {
  const fragment = databaseId.replace(/[^A-Za-z0-9]/g, "").slice(0, 8) || "db";
  return `RADAR_AutoBackup_${fragment}_${today}.json`;
}

export function clampAutoBackupKeepDays(value: number): number {
  if (!Number.isFinite(value)) return AUTO_BACKUP_DEFAULT_KEEP_DAYS;
  return Math.min(AUTO_BACKUP_MAX_KEEP_DAYS, Math.max(AUTO_BACKUP_MIN_KEEP_DAYS, Math.floor(value)));
}

export interface AutoBackupState {
  enabled: boolean;
  /** False for a database with no records: there is nothing worth keeping. */
  hasData: boolean;
  changesSinceBackup: number;
  /** Automatic backup files already in the folder, when known. */
  existingFiles: number | undefined;
}

/**
 * Whether to save an automatic backup now. While the app runs, only unsaved
 * changes trigger one. At startup a database that has records but no
 * automatic backup at all also gets its first file, so turning the feature on
 * (or pointing it at a new folder) is covered straight away rather than only
 * after the next edit.
 */
export function autoBackupDue(state: AutoBackupState, trigger: "startup" | "interval"): boolean {
  if (!state.enabled || !state.hasData) return false;
  if (state.changesSinceBackup > 0) return true;
  return trigger === "startup" && state.existingFiles === 0;
}

/**
 * The change counter after a backup lands. Edits made while the backup was
 * being built are not in the file, so they stay counted.
 */
export function changesAfterBackup(changesNow: number, changesWhenBuilt: number): number {
  return Math.max(0, changesNow - changesWhenBuilt);
}
