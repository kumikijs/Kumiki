import type { Expr } from "../ast.ts";

export type BindSegment = string | { get: true } | { at: unknown };

/** `.get`, as the setter reads it. */
export const UNWRAP_SEGMENT: { get: true } = { get: true };

/**
 * A step holds the key's expression because the key is evaluated where the path
 * is: in the reducer for `xs[i] := v`, on every render of the control for `bind=xs[i]`.
 */
export type PathStep = string | { get: true } | { at: Expr };

export function isUnwrapStep(field: string, accessKind?: "field" | "shortcut"): boolean {
  return accessKind !== "field" && field === "get";
}

export function indexSegmentJs(keyJs: string): string {
  return `{ at: ${keyJs} }`;
}

/** `step` as the JS that evaluates to its segment, its key lowered by `keyJs`. */
export function segmentJs(step: PathStep, keyJs: (key: Expr) => string): string {
  if (typeof step === "string") return JSON.stringify(step);
  return "at" in step ? indexSegmentJs(keyJs(step.at)) : JSON.stringify(UNWRAP_SEGMENT);
}
