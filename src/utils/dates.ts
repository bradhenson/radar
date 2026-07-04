// Date-only utilities. Calendar dates (due dates, leave dates, training dates)
// are YYYY-MM-DD strings compared with local-date logic, never converted
// through midnight timestamps. See plan sections 8.8 and 28.3.

import type { IsoDate, IsoTimestamp } from "../domain/models";

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidIsoDate(value: string): boolean {
  if (!ISO_DATE_RE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number) as [number, number, number];
  if (m < 1 || m > 12) return false;
  return d >= 1 && d <= daysInMonth(y, m);
}

function daysInMonth(year: number, month: number): number {
  return [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ?? 0;
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** Today as a local calendar date. */
export function todayIso(): IsoDate {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function nowTimestamp(): IsoTimestamp {
  return new Date().toISOString();
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** Lexicographic comparison is chronologically correct for ISO dates. */
export function compareDates(a: IsoDate, b: IsoDate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function addDays(date: IsoDate, days: number): IsoDate {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  // Date.UTC used purely as day arithmetic; never exposed as a timestamp.
  const utc = new Date(Date.UTC(y, m - 1, d + days));
  return `${utc.getUTCFullYear()}-${pad(utc.getUTCMonth() + 1)}-${pad(utc.getUTCDate())}`;
}

export function addMonths(date: IsoDate, months: number): IsoDate {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const totalMonths = y * 12 + (m - 1) + months;
  const ny = Math.floor(totalMonths / 12);
  const nm = (totalMonths % 12) + 1;
  const nd = Math.min(d, daysInMonth(ny, nm));
  return `${ny}-${pad(nm)}-${pad(nd)}`;
}

/** Whole days from `a` to `b`; positive when b is after a. */
export function daysBetween(a: IsoDate, b: IsoDate): number {
  const [ay, am, ad] = a.split("-").map(Number) as [number, number, number];
  const [by, bm, bd] = b.split("-").map(Number) as [number, number, number];
  const ms = Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad);
  return Math.round(ms / 86_400_000);
}

/** Days since a UTC timestamp, measured against local today. */
export function daysSinceTimestamp(ts: IsoTimestamp, today: IsoDate): number {
  const then = new Date(ts);
  const thenDate = `${then.getFullYear()}-${pad(then.getMonth() + 1)}-${pad(then.getDate())}`;
  return daysBetween(thenDate, today);
}

/** Display formatting, e.g. "Jul 4, 2026". Falls back to raw value if invalid. */
export function formatDate(date: IsoDate | undefined): string {
  if (!date) return "";
  if (!isValidIsoDate(date)) return date;
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[m - 1]} ${d}, ${y}`;
}

export function formatTimestamp(ts: IsoTimestamp | undefined): string {
  if (!ts) return "";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/** Relative wording for dashboards: "overdue by 4 days", "due today", "due in 3 days". */
export function describeDueDistance(dueDate: IsoDate, today: IsoDate): string {
  const diff = daysBetween(today, dueDate);
  if (diff < 0) return `overdue by ${-diff} day${diff === -1 ? "" : "s"}`;
  if (diff === 0) return "due today";
  return `due in ${diff} day${diff === 1 ? "" : "s"}`;
}
