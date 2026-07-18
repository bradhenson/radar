// Activity log retention (plan 25): the audit trail is bounded so a
// daily-driver database never accumulates years of entries that all load
// into memory at startup. Pure rule; the store applies the deletions.

import type { ActivityEntry, IsoDate } from "../models";
import { addDays } from "../../utils/dates";

/**
 * Ids of activity entries older than the retention window. Entries carry UTC
 * ISO timestamps; the leading YYYY-MM-DD is compared as a date-only value.
 * A non-positive retention disables pruning.
 */
export function expiredActivityEntryIds(entries: ActivityEntry[], today: IsoDate, retentionDays: number): string[] {
  if (retentionDays <= 0) return [];
  const cutoff = addDays(today, -retentionDays);
  return entries.filter((entry) => entry.timestamp.slice(0, 10) < cutoff).map((entry) => entry.id);
}
