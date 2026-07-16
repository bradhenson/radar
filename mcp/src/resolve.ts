// Locating radar.db and resolving human names to records.
//
// Path resolution mirrors desktop/dbpath.go so this server opens the same
// database the desktop app is using, including after the user switches
// databases from Settings (which writes database-location.json).

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Employee, Project } from "../../src/domain/models";

function localDataDirectory(): string {
  const base = process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local");
  return join(base, "RADAR");
}

/** Explicit path wins, then the app's saved preference, then the default. */
export function resolveDbPath(explicit?: string): string {
  const fromArg = explicit ?? process.env.RADAR_DB;
  if (fromArg) return fromArg;

  const preferenceFile = join(localDataDirectory(), "database-location.json");
  if (existsSync(preferenceFile)) {
    try {
      const preference = JSON.parse(readFileSync(preferenceFile, "utf8")) as {
        databasePath?: string;
        directory?: string;
      };
      if (preference.databasePath) return preference.databasePath;
      // Migrate the folder-based preference, as dbpath.go does.
      if (preference.directory) return join(preference.directory, "radar.db");
    } catch {
      // Unreadable preference: fall through to the default location.
    }
  }
  return join(localDataDirectory(), "radar.db");
}

export class AmbiguousMatchError extends Error {
  constructor(term: string, candidates: string[]) {
    super(`"${term}" matches ${candidates.length} people: ${candidates.join(", ")}. Use a fuller name or the id.`);
    this.name = "AmbiguousMatchError";
  }
}

export class NoMatchError extends Error {
  constructor(kind: string, term: string) {
    super(`No ${kind} matches "${term}".`);
    this.name = "NoMatchError";
  }
}

/**
 * Resolves an id, a full name, or a fragment ("dana") to exactly one employee.
 * Ambiguity is an error rather than a guess: this server writes to real
 * records, so picking the wrong person silently is not an acceptable outcome.
 */
export function resolveEmployee(employees: Employee[], term: string): Employee {
  const needle = term.trim().toLowerCase();
  if (!needle) throw new NoMatchError("employee", term);

  const byId = employees.find((e) => e.id === term);
  if (byId) return byId;

  const names = (e: Employee) => [e.displayName, e.preferredName, e.sortName].filter(Boolean).map((n) => n!.toLowerCase());
  const exact = employees.filter((e) => names(e).some((n) => n === needle));
  if (exact.length === 1) return exact[0]!;
  if (exact.length > 1) throw new AmbiguousMatchError(term, exact.map((e) => e.displayName));

  const partial = employees.filter((e) => names(e).some((n) => n.includes(needle)));
  if (partial.length === 1) return partial[0]!;
  if (partial.length > 1) throw new AmbiguousMatchError(term, partial.map((e) => e.displayName));
  throw new NoMatchError("employee", term);
}

export function resolveProject(projects: Project[], term: string): Project {
  const needle = term.trim().toLowerCase();
  const byId = projects.find((p) => p.id === term);
  if (byId) return byId;
  const names = (p: Project) => [p.name, p.shortName].filter(Boolean).map((n) => n!.toLowerCase());
  const exact = projects.filter((p) => names(p).some((n) => n === needle));
  if (exact.length === 1) return exact[0]!;
  const partial = projects.filter((p) => names(p).some((n) => n.includes(needle)));
  if (partial.length === 1) return partial[0]!;
  if (partial.length > 1) throw new AmbiguousMatchError(term, partial.map((p) => p.name));
  throw new NoMatchError("project", term);
}
