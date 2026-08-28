/**
 * How a write path is encoded for the runtime's setter, shared by the two
 * places that build one: the assignment a reducer lowers to
 * (`emit-reducer.ts`) and a `bind=` target (`emit-tile.ts`). Both used to
 * carry their own copy of the rule and their own spelling of the datum, which
 * is how the two sides of `.get` came to disagree in the first place.
 *
 * The runtime's decoder is `PathSegment` / `_setPathHelper` in
 * `packages/runtime/src/core.ts`. The two declarations are checked against
 * each other in `@kumikijs/tests`, the one package that depends on both —
 * the compiler's browser-safe core does not import from the runtime.
 */
export type BindSegment = string | { get: true };

/** `.get`, as the setter reads it. */
export const UNWRAP_SEGMENT: { get: true } = { get: true };

/**
 * Whether a `.<field>` step is the polymorphic unwrap rather than a key. A
 * record's own field wins (stdlib.md §2.2); with no `accessKind` — codegen
 * running without `check()` — the name decides, as it does on the read side.
 */
export function isUnwrapStep(field: string, accessKind?: "field" | "shortcut"): boolean {
  return accessKind !== "field" && field === "get";
}
