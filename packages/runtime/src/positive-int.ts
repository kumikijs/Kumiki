// In the runtime so the parser, the checker and the property-test runner share one rule: a test
// definition built without the parser reaches the runner unchecked. A subpath of its own, so the
// compiler does not evaluate the whole runtime to reach one predicate.
export const isPositiveInt = (v: unknown): boolean =>
  typeof v === "number" && Number.isInteger(v) && v > 0;
