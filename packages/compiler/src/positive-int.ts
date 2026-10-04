/** A whole number, 1 or more: no 0, no negative, no fraction. */
export const isPositiveInt = (v: unknown): boolean =>
  typeof v === "number" && Number.isInteger(v) && v > 0;
