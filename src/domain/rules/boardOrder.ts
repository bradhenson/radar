// Gap-based board ordering (plan section 13.5). Cards get order values with
// large gaps so an insert between neighbors rarely forces a column rewrite.

export const ORDER_GAP = 1000;
const MIN_GAP = 1e-6;

/** Order value for appending after the current last card (or first in empty column). */
export function orderForAppend(existingOrders: number[]): number {
  if (existingOrders.length === 0) return ORDER_GAP;
  return Math.max(...existingOrders) + ORDER_GAP;
}

/**
 * Order value for inserting between two neighbors. Either side may be
 * undefined (insert at top / bottom).
 */
export function orderBetween(before: number | undefined, after: number | undefined): number {
  if (before === undefined && after === undefined) return ORDER_GAP;
  if (before === undefined) return (after as number) - ORDER_GAP;
  if (after === undefined) return before + ORDER_GAP;
  return (before + after) / 2;
}

/** True when the gaps in a column have collapsed and orders should be rewritten. */
export function needsRenormalize(sortedOrders: number[]): boolean {
  for (let i = 1; i < sortedOrders.length; i++) {
    if (sortedOrders[i]! - sortedOrders[i - 1]! < MIN_GAP) return true;
  }
  return false;
}

/** Fresh evenly spaced order values for `count` cards. */
export function renormalizedOrders(count: number): number[] {
  return Array.from({ length: count }, (_, i) => (i + 1) * ORDER_GAP);
}
