// Sidebar count badges (pure). Each badge answers "how many things on that
// page are waiting on the supervisor", so the signal is visible from whatever
// page is open. Counts reuse the attention engine's reason codes wherever one
// exists, which keeps a badge and the Today page from ever disagreeing and
// lets a snoozed item drop off the badge too. Training is the exception: the
// attention engine folds a requirement's many overdue people into one line,
// so the caller passes the real number of overdue records instead.

import type { IsoDate, LeaveRecord, TravelRecord } from "../models";
import type { AttentionItem } from "./attention";
import { compareDates } from "../../utils/dates";
import { travelActionLevel } from "./travel";

/** `alert` is something already late; `notice` is a decision or step still open. */
export type NavBadgeTone = "alert" | "notice";

export interface NavBadge {
  count: number;
  tone: NavBadgeTone;
  /** Words for the tooltip and screen readers, e.g. "2 requests awaiting your decision". */
  description: string;
}

/** Page ids match the `page` values of the main navigation. */
export type NavBadgePage = "board" | "training" | "leave" | "telework" | "travel" | "awards";

export interface NavBadgeContext {
  today: IsoDate;
  attention: Pick<AttentionItem, "entityType" | "entityId" | "reasonCode">[];
  leaveRecords: Pick<LeaveRecord, "status" | "endDate" | "startDate">[];
  travelRecords: TravelRecord[];
  /** Overdue or expired training records, counted per employee and requirement. */
  trainingOverdue: number;
}

interface BadgePart {
  count: number;
  tone: NavBadgeTone;
  /** [singular, plural] phrase that follows the count. */
  phrase: [string, string];
}

function badgeFrom(parts: BadgePart[]): NavBadge | undefined {
  const present = parts.filter((p) => p.count > 0);
  if (present.length === 0) return undefined;
  return {
    count: present.reduce((sum, p) => sum + p.count, 0),
    tone: present.some((p) => p.tone === "alert") ? "alert" : "notice",
    description: present.map((p) => `${p.count} ${p.count === 1 ? p.phrase[0] : p.phrase[1]}`).join(", ")
  };
}

export function navBadges(ctx: NavBadgeContext): Partial<Record<NavBadgePage, NavBadge>> {
  const countOf = (...codes: string[]) => ctx.attention.filter((i) => codes.includes(i.reasonCode)).length;

  // Leave has no attention rule for an unanswered request, so count the
  // records directly: requested leave that has not already ended.
  const leaveRequested = ctx.leaveRecords.filter((l) => {
    const end = compareDates(l.endDate, l.startDate) < 0 ? l.startDate : l.endDate;
    return l.status === "requested" && compareDates(end, ctx.today) >= 0;
  }).length;

  // Travel: a trip counts once however many of its steps need attention. The
  // tracker's own rules (late paperwork, voucher owed) are joined with the
  // attention engine's "leaving within a week with paperwork open".
  const late = new Set<string>();
  const open = new Set<string>();
  for (const trip of ctx.travelRecords) {
    if (trip.isArchived) continue;
    const level = travelActionLevel(trip, ctx.today);
    if (level === "late") late.add(trip.id);
    else if (level === "due") open.add(trip.id);
  }
  for (const item of ctx.attention) {
    if (item.reasonCode === "travel_paperwork_incomplete" && !late.has(item.entityId)) open.add(item.entityId);
  }

  const badges: Partial<Record<NavBadgePage, NavBadge>> = {};
  const set = (page: NavBadgePage, parts: BadgePart[]) => {
    const badge = badgeFrom(parts);
    if (badge) badges[page] = badge;
  };

  set("board", [{ count: countOf("overdue"), tone: "alert", phrase: ["overdue task", "overdue tasks"] }]);
  set("training", [
    { count: ctx.trainingOverdue, tone: "alert", phrase: ["training record overdue", "training records overdue"] }
  ]);
  set("leave", [
    { count: leaveRequested, tone: "notice", phrase: ["leave request awaiting approval", "leave requests awaiting approval"] }
  ]);
  set("telework", [
    {
      count: countOf("telework_pending_action"),
      tone: "notice",
      phrase: ["request awaiting your decision", "requests awaiting your decision"]
    },
    { count: countOf("telework_expired"), tone: "alert", phrase: ["agreement expired", "agreements expired"] }
  ]);
  set("travel", [
    { count: late.size, tone: "alert", phrase: ["trip with a late step", "trips with a late step"] },
    { count: open.size, tone: "notice", phrase: ["trip with paperwork open", "trips with paperwork open"] }
  ]);
  set("awards", [
    { count: countOf("award_nomination_overdue"), tone: "alert", phrase: ["nomination overdue", "nominations overdue"] }
  ]);
  return badges;
}
