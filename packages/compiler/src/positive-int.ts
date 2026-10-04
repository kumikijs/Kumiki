/**
 * A whole number, 1 or more: no 0, no negative, no fraction. The one rule for
 * every literal the spec holds to a positive Int — a motion's `duration` (ms)
 * and `iteration`, and a property-test's `count`.
 */
export const isPositiveInt = (v: unknown): boolean =>
  typeof v === "number" && Number.isInteger(v) && v > 0;
