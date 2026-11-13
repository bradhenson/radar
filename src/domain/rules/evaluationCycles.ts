// Evaluation cycle rules (pure). A cycle is a named date range (a rating
// year), optionally with a mid-year date. A performance input belongs to the
// cycle its date falls in; nothing has to be assigned by hand, so inputs
// recorded before a cycle was defined are placed correctly once it is.

import type { EvaluationCycle, IsoDate, PerformanceInput } from "../models";
import { compareDates, formatDate, formatDateRange, isValidIsoDate } from "../../utils/dates";

type CycleRange = Pick<EvaluationCycle, "startDate" | "endDate">;

export function cycleContains(cycle: CycleRange, date: IsoDate): boolean {
  return compareDates(date, cycle.startDate) >= 0 && compareDates(date, cycle.endDate) <= 0;
}

/** Cycles newest first, which is the order every menu lists them in. */
export function sortedCycles<T extends EvaluationCycle>(cycles: T[]): T[] {
  return [...cycles].sort((a, b) => compareDates(b.startDate, a.startDate) || a.name.localeCompare(b.name));
}

/** The cycle a date falls in. Cycles cannot overlap, so there is at most one. */
export function cycleForDate<T extends EvaluationCycle>(cycles: T[], date: IsoDate): T | undefined {
  return sortedCycles(cycles).find((cycle) => cycleContains(cycle, date));
}

export function inputsInCycle<T extends Pick<PerformanceInput, "inputDate">>(inputs: T[], cycle: CycleRange | undefined): T[] {
  return cycle ? inputs.filter((input) => cycleContains(cycle, input.inputDate)) : inputs;
}

/** "FY2026 (Oct 1, 2025 – Sep 30, 2026)". */
export function cycleLabel(cycle: EvaluationCycle): string {
  return `${cycle.name} (${formatDateRange(cycle.startDate, cycle.endDate)})`;
}

/**
 * Where today sits in a cycle: before it starts, in its first or second half
 * (split at the mid-year date when there is one), or after it ends.
 */
export function cyclePhase(cycle: EvaluationCycle, today: IsoDate): "upcoming" | "first_half" | "second_half" | "ended" {
  if (compareDates(today, cycle.startDate) < 0) return "upcoming";
  if (compareDates(today, cycle.endDate) > 0) return "ended";
  return cycle.midyearDate && compareDates(today, cycle.midyearDate) >= 0 ? "second_half" : "first_half";
}

/** Why a cycle cannot be saved, or undefined when it is valid. */
export function evaluationCycleError(
  draft: Pick<EvaluationCycle, "id" | "name" | "startDate" | "endDate" | "midyearDate">,
  existing: EvaluationCycle[]
): string | undefined {
  const name = draft.name.trim();
  if (!name) return "Name is required.";
  if (!isValidIsoDate(draft.startDate) || !isValidIsoDate(draft.endDate)) return "Start and end dates are required and must be valid.";
  if (compareDates(draft.endDate, draft.startDate) < 0) return "End date must be on or after the start date.";
  if (draft.midyearDate) {
    if (!isValidIsoDate(draft.midyearDate)) return "Mid-year date is not valid.";
    if (!cycleContains(draft, draft.midyearDate)) return "Mid-year date must fall inside the cycle.";
  }
  const others = existing.filter((cycle) => cycle.id !== draft.id);
  if (others.some((cycle) => cycle.name.trim().toLowerCase() === name.toLowerCase())) {
    return `A cycle named "${name}" already exists.`;
  }
  const overlap = others.find(
    (cycle) => compareDates(draft.startDate, cycle.endDate) <= 0 && compareDates(draft.endDate, cycle.startDate) >= 0
  );
  if (overlap) return `These dates overlap ${cycleLabel(overlap)}. Each date can belong to only one cycle.`;
  return undefined;
}
