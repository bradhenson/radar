// Performance input cadence (pure). No DOM or store imports.
import type { IsoDate } from "../models";
import { addMonths } from "../../utils/dates";

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export interface MonthCount {
  /** "YYYY-MM" */
  month: string;
  /** "Apr 2026" */
  label: string;
  count: number;
}

/**
 * How many inputs fall in each of the last `months` calendar months, oldest
 * first and ending with the current month. Months are compared as YYYY-MM
 * strings, so no date ever passes through a timestamp.
 */
export function monthlyCounts(dates: IsoDate[], today: IsoDate, months = 6): MonthCount[] {
  const firstOfThisMonth = `${today.slice(0, 7)}-01`;
  const result: MonthCount[] = [];
  for (let offset = months - 1; offset >= 0; offset--) {
    const month = addMonths(firstOfThisMonth, -offset).slice(0, 7);
    const [year, m] = month.split("-").map(Number) as [number, number];
    result.push({ month, label: `${MONTH_ABBR[m - 1]} ${year}`, count: 0 });
  }
  const index = new Map(result.map((entry, i) => [entry.month, i]));
  for (const date of dates) {
    const i = index.get(date.slice(0, 7));
    if (i !== undefined) result[i]!.count += 1;
  }
  return result;
}
