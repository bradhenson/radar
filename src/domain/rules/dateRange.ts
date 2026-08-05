// Date-window filtering for long, date-ordered lists (meeting notes first).
// Pure date-only logic: every bound is a YYYY-MM-DD string compared
// lexicographically, never a timestamp.

import type { IsoDate } from "../models";
import { addDays, addMonths, isValidIsoDate } from "../../utils/dates";

export type DateRangePreset = "all" | "last30" | "last90" | "last12m" | "thisYear" | "custom";

export const DATE_RANGE_OPTIONS: { value: DateRangePreset; label: string }[] = [
  { value: "last30", label: "Last 30 days" },
  { value: "last90", label: "Last 90 days" },
  { value: "last12m", label: "Last 12 months" },
  { value: "thisYear", label: "This year" },
  { value: "all", label: "All dates" },
  { value: "custom", label: "Custom range" }
];

/** Inclusive bounds. An absent bound means "unbounded on that side". */
export interface DateRange {
  from?: IsoDate;
  to?: IsoDate;
}

export interface CustomDateRange {
  from?: string;
  to?: string;
}

/**
 * Turn a preset into concrete bounds. The rolling presets deliberately leave
 * the upper bound open so a meeting scheduled for next week never disappears
 * from a "last 90 days" view; only a custom range can close both ends.
 * Invalid or empty custom bounds are treated as unbounded.
 */
export function resolveDateRange(
  preset: DateRangePreset,
  today: IsoDate,
  custom: CustomDateRange = {}
): DateRange {
  switch (preset) {
    case "last30":
      return { from: addDays(today, -30) };
    case "last90":
      return { from: addDays(today, -90) };
    case "last12m":
      return { from: addMonths(today, -12) };
    case "thisYear":
      return { from: `${today.slice(0, 4)}-01-01` };
    case "custom":
      return {
        from: custom.from && isValidIsoDate(custom.from) ? custom.from : undefined,
        to: custom.to && isValidIsoDate(custom.to) ? custom.to : undefined
      };
    default:
      return {};
  }
}

export function isWithinDateRange(date: IsoDate, range: DateRange): boolean {
  if (range.from && date < range.from) return false;
  if (range.to && date > range.to) return false;
  return true;
}
