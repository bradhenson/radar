// Activity log grouping (plan 25). The audit trail grows without bound, so the
// viewer shows it in dated buckets — Today, Yesterday, the current week, last
// week, then one bucket per calendar month — rather than as one long list.
// Pure: entries in, groups out.

import type { ActivityEntry, IsoDate } from "../models";
import { addDays, startOfWeek, timestampToLocalDate } from "../../utils/dates";

export interface ActivityGroup {
  key: string;
  title: string;
  entries: ActivityEntry[];
}

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December"
];

/** "2026-07" → "July 2026". Falls back to the raw key if it is not a month. */
export function monthLabel(key: string): string {
  const [year, month] = key.split("-");
  return `${MONTH_NAMES[Number(month) - 1] ?? key} ${year}`;
}

/**
 * Bucket entries by when they happened, measured against local today. Entries
 * are assumed to arrive newest-first; each group keeps that order. Empty
 * groups are dropped, so a quiet week produces no heading.
 */
export function groupActivityEntries(entries: ActivityEntry[], today: IsoDate): ActivityGroup[] {
  const yesterday = addDays(today, -1);
  const weekStart = startOfWeek(today);
  const lastWeekStart = addDays(weekStart, -7);

  const recent = new Map<string, ActivityEntry[]>();
  const months = new Map<string, ActivityEntry[]>();
  const push = (map: Map<string, ActivityEntry[]>, key: string, entry: ActivityEntry) => {
    const bucket = map.get(key);
    if (bucket) bucket.push(entry);
    else map.set(key, [entry]);
  };

  for (const entry of entries) {
    const day = timestampToLocalDate(entry.timestamp);
    // A clock skew or an imported entry can be dated ahead of today; those
    // belong at the top with today's work rather than in a future month.
    if (day >= today) push(recent, "today", entry);
    else if (day === yesterday) push(recent, "yesterday", entry);
    else if (day >= weekStart) push(recent, "this-week", entry);
    else if (day >= lastWeekStart) push(recent, "last-week", entry);
    else push(months, day.slice(0, 7), entry);
  }

  const groups: ActivityGroup[] = [
    { key: "today", title: "Today", entries: recent.get("today") ?? [] },
    { key: "yesterday", title: "Yesterday", entries: recent.get("yesterday") ?? [] },
    { key: "this-week", title: "Earlier this week", entries: recent.get("this-week") ?? [] },
    { key: "last-week", title: "Last week", entries: recent.get("last-week") ?? [] }
  ];
  for (const key of [...months.keys()].sort().reverse()) {
    groups.push({ key, title: monthLabel(key), entries: months.get(key) ?? [] });
  }
  return groups.filter((group) => group.entries.length > 0);
}
