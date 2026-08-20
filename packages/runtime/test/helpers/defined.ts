/**
 * The value a test has just asserted must be there.
 *
 * `noUncheckedIndexedAccess` types `list[0]` and `querySelector` as possibly
 * absent, which is right: a selector that matches nothing is a test failure,
 * not a reason to reach for `!`. This narrows and says which lookup came back
 * empty when it does.
 */
export function defined<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new Error(`expected ${what}, found none`);
  return value;
}
