// The rule for a number that counts something: a property-test's `count`, a
// motion's `duration` and `iteration`. The parser holds a written `count` to
// it, the checker a motion's fields, and the property-test runner the `count`
// it is handed, because a test definition built without the parser reaches the
// runner unchecked. It lives here because this is the package below both, so
// the compiler and the runner ask one rule rather than two copies of it.
//
// Pure — no DOM, no Node, and reachable on its own through the
// `@kumikijs/runtime/positive-int` subpath, so the compiler does not evaluate
// the whole runtime module graph to reach one predicate.

/** A whole number, 1 or more: no 0, no negative, no fraction. */
export const isPositiveInt = (v: unknown): boolean =>
  typeof v === "number" && Number.isInteger(v) && v > 0;
