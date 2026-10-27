import type { Expr } from "./ast.ts";
import { type BindSegment, isUnwrapStep, UNWRAP_SEGMENT } from "./codegen/path-segment.ts";

export type BindStep = Expr & { kind: "FieldAccess" | "Index" | "MethodCall" };

/**
 * The checker and the lowering both read a target through `bindTarget`, so the
 * root the checker asks to be a slot is the one the lowering writes.
 */
export type BindTarget = {
  root: Expr;
  steps: BindStep[];
  /** `null` when a step is an index or a call, which the lowering does not write through. */
  path: BindSegment[] | null;
};

export function bindTarget(value: Expr): BindTarget {
  const steps: BindStep[] = [];
  let cur = value;
  while (cur.kind === "FieldAccess" || cur.kind === "Index" || cur.kind === "MethodCall") {
    steps.unshift(cur);
    cur = cur.kind === "MethodCall" ? cur.receiver : cur.base;
  }
  const path: BindSegment[] = [];
  for (const step of steps) {
    if (step.kind !== "FieldAccess") return { root: cur, steps, path: null };
    path.push(isUnwrapStep(step.field, step.accessKind) ? UNWRAP_SEGMENT : step.field);
  }
  return { root: cur, steps, path };
}
