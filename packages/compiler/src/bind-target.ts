import type { Expr } from "./ast.ts";
import { isUnwrapStep, type PathStep, UNWRAP_SEGMENT } from "./codegen/path-segment.ts";

export type BindStep = Expr & { kind: "FieldAccess" | "Index" | "MethodCall" };

export type BindTarget = {
  root: Expr;
  steps: BindStep[];
  /** `null` when a step is a call, which names no place. */
  path: PathStep[] | null;
};

/**
 * The checker and the lowering both read a target through `bindTarget`, so the
 * root and steps the checker judges are the ones the lowering emits, for a
 * `bind=` target and an `error(field=…)` path alike.
 */
export function bindTarget(value: Expr): BindTarget {
  const steps: BindStep[] = [];
  let cur = value;
  while (cur.kind === "FieldAccess" || cur.kind === "Index" || cur.kind === "MethodCall") {
    steps.unshift(cur);
    cur = cur.kind === "MethodCall" ? cur.receiver : cur.base;
  }
  const path: PathStep[] = [];
  for (const step of steps) {
    if (step.kind === "MethodCall") return { root: cur, steps, path: null };
    if (step.kind === "Index") path.push({ at: step.index });
    else path.push(isUnwrapStep(step.field, step.accessKind) ? UNWRAP_SEGMENT : step.field);
  }
  return { root: cur, steps, path };
}
