import type { Expr } from "../ast.ts";

/**
 * How a write path is encoded for the runtime's setter, shared by the two
 * places that build one: the assignment a reducer lowers to
 * (`emit-reducer.ts`) and a `bind=` target (`bind-target.ts`). Both read
 * their steps into a {@link PathStep} and lower each through
 * {@link segmentJs}, so the two cannot spell the same step two ways.
 *
 * The runtime's decoder is `PathSegment` / `_setPathHelper` in
 * `packages/runtime/src/core.ts`. The two declarations are checked against
 * each other in `@kumikijs/tests`, the one package that depends on both —
 * the compiler's browser-safe core does not import from the runtime.
 */
export type BindSegment = string | { get: true } | { at: unknown };

/** `.get`, as the setter reads it. */
export const UNWRAP_SEGMENT: { get: true } = { get: true };

/**
 * A step of a write path before it is lowered: a field, the unwrap `.get`,
 * or an index with the expression of its key. The key is evaluated where the
 * path is — in the reducer for `xs[i] := v`, on every render of the control
 * for `bind=xs[i]` — so a step holds the expression, and the segment holds
 * the value it computes.
 */
export type PathStep = string | { get: true } | { at: Expr };

/**
 * Whether a `.<field>` step is the polymorphic unwrap rather than a key. A
 * record's own field wins (stdlib.md §2.2); with no `accessKind` — codegen
 * running without `check()` — the name decides, as it does on the read side.
 */
export function isUnwrapStep(field: string, accessKind?: "field" | "shortcut"): boolean {
  return accessKind !== "field" && field === "get";
}

/**
 * An index step (`xs[i]`, `m[k]`) of a write path, around the JS of its key:
 * `{at: key}`. Encoded apart from a field step because the two mean
 * different things where the place is absent — a record field missing from a
 * decoded value is a level to build, and a Map entry missing from the Map is
 * one `m[k].f := v` writes nothing through (language.md §1.6.3). A bare key
 * could not say which it was: both are a string once evaluated.
 */
export function indexSegmentJs(keyJs: string): string {
  return `{ at: ${keyJs} }`;
}

/** `step` as the JS that evaluates to its segment, its key lowered by `keyJs`. */
export function segmentJs(step: PathStep, keyJs: (key: Expr) => string): string {
  if (typeof step === "string") return JSON.stringify(step);
  return "at" in step ? indexSegmentJs(keyJs(step.at)) : JSON.stringify(UNWRAP_SEGMENT);
}
