// Pasted training completions (pure). Text copied from a spreadsheet or a
// report ("Avery Brooks  7/14/2026", one person per line) is turned into a
// list of who completed a requirement and when, with every line that cannot
// be used explained rather than guessed at. Pasted text is untrusted input:
// nothing here is applied until the user has seen this preview.

import type { Employee, IsoDate } from "../models";
import { compareDates, isValidIsoDate } from "../../utils/dates";

export interface CompletionLine {
  /** 1-based line in the pasted text. */
  lineNumber: number;
  /** The name as written, with the date and separators removed. */
  name: string;
  /** The completion date to record; the default date when the line has none. */
  date: IsoDate;
  /** True when the date came from the line rather than the default. */
  dateFromLine: boolean;
  employeeId?: string;
  employeeName?: string;
  /** Why this line will be skipped. Absent when the line is ready to apply. */
  problem?: string;
}

export interface CompletionPasteContext {
  employees: Pick<Employee, "id" | "displayName" | "preferredName" | "sortName">[];
  /** Employees the requirement applies to. */
  applicableIds: ReadonlySet<string>;
  /** Used for lines that carry no date. */
  defaultDate: IsoDate;
  today: IsoDate;
}

const ISO_DATE = /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/;
const US_DATE = /\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})\b/;
const HEADER_WORDS = new Set(["name", "employee", "employee name", "full name", "trainee", "learner"]);

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** Finds a date in a line. Returns the date (possibly invalid, e.g. 2/30) and the text it occupied. */
function findDate(line: string): { date: string; text: string } | undefined {
  const iso = ISO_DATE.exec(line);
  if (iso) return { date: `${iso[1]}-${pad(Number(iso[2]))}-${pad(Number(iso[3]))}`, text: iso[0] };
  const us = US_DATE.exec(line);
  if (us) {
    const year = us[3]!.length === 2 ? 2000 + Number(us[3]) : Number(us[3]);
    return { date: `${year}-${pad(Number(us[1]))}-${pad(Number(us[2]))}`, text: us[0] };
  }
  return undefined;
}

/** Lowercase, no punctuation, single spaces: "O'Brien,  Pat" → "obrien pat". */
function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** The spellings a pasted name is compared under: as written, and "Last, First" turned around. */
function nameForms(name: string): string[] {
  const forms = [normalize(name)];
  const comma = name.indexOf(",");
  if (comma > 0) forms.push(normalize(`${name.slice(comma + 1)} ${name.slice(0, comma)}`));
  return forms.filter(Boolean);
}

/**
 * Parses pasted completions. A name must match one employee exactly (ignoring
 * case, punctuation, and "Last, First" order); a near miss is reported, never
 * guessed. Blank lines and a header row are ignored.
 */
export function parseCompletionPaste(text: string, ctx: CompletionPasteContext): CompletionLine[] {
  const known = new Map<string, Set<string>>();
  for (const employee of ctx.employees) {
    for (const value of [employee.displayName, employee.preferredName, employee.sortName]) {
      if (!value) continue;
      for (const form of nameForms(value)) {
        const ids = known.get(form) ?? new Set<string>();
        ids.add(employee.id);
        known.set(form, ids);
      }
    }
  }
  const displayName = new Map(ctx.employees.map((e) => [e.id, e.displayName]));

  const lines: CompletionLine[] = [];
  const seen = new Set<string>();
  text.split(/\r\n|\r|\n/).forEach((raw, index) => {
    if (!raw.trim()) return;
    const found = findDate(raw);
    const name = (found ? raw.replace(found.text, " ") : raw)
      .replace(/["\t;|]+/g, " ")
      .replace(/\s+/g, " ")
      .replace(/^[\s,]+|[\s,]+$/g, "")
      .trim();
    if (!found && HEADER_WORDS.has(normalize(name))) return;
    if (/^(name|employee)\b/i.test(name) && /date|complet/i.test(raw) && !found) return;

    const line: CompletionLine = {
      lineNumber: index + 1,
      name,
      date: found?.date ?? ctx.defaultDate,
      dateFromLine: Boolean(found)
    };
    lines.push(line);

    if (!name) {
      line.problem = "No name on this line.";
      return;
    }
    if (!isValidIsoDate(line.date)) {
      line.problem = `"${found?.text ?? line.date}" is not a real date.`;
      return;
    }
    if (compareDates(line.date, ctx.today) > 0) {
      line.problem = "The completion date is in the future.";
      return;
    }
    const matches = new Set<string>();
    for (const form of nameForms(name)) for (const id of known.get(form) ?? []) matches.add(id);
    if (matches.size === 0) {
      line.problem = "No employee has this name.";
      return;
    }
    if (matches.size > 1) {
      line.problem = "More than one employee has this name.";
      return;
    }
    const id = [...matches][0]!;
    line.employeeId = id;
    line.employeeName = displayName.get(id);
    if (!ctx.applicableIds.has(id)) {
      line.problem = "This requirement does not apply to this employee.";
      return;
    }
    if (seen.has(id)) {
      line.problem = "Listed more than once; the first line is used.";
      return;
    }
    seen.add(id);
  });
  return lines;
}

/** The lines that will be applied. */
export function readyCompletions(lines: CompletionLine[]): (CompletionLine & { employeeId: string })[] {
  return lines.filter((line): line is CompletionLine & { employeeId: string } => !line.problem && Boolean(line.employeeId));
}
