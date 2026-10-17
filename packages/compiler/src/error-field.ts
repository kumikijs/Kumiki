import type { Expr } from "./ast.ts";
import { type BindStep, bindTarget } from "./bind-target.ts";
import { type BindSegment, isUnwrapStep, UNWRAP_SEGMENT } from "./codegen/path-segment.ts";

/** An index's key is a literal, so the path is known at compile time. */
export type FieldSegment = BindSegment | { at: string | number | boolean };

/**
 * The checker reports a step this cannot lower, and the lowering emits the path
 * it returns, so the two cannot disagree about what a field names.
 */
export type ErrorField = {
  root: Expr;
  steps: BindStep[];
  /** `null` for a step that names no place: a call, or an index whose key is not a literal. */
  segments: (FieldSegment | null)[];
};

export function errorField(value: Expr): ErrorField {
  const { root, steps } = bindTarget(value);
  return { root, steps, segments: steps.map(fieldSegment) };
}

function fieldSegment(step: BindStep): FieldSegment | null {
  switch (step.kind) {
    case "FieldAccess":
      return isUnwrapStep(step.field, step.accessKind) ? UNWRAP_SEGMENT : step.field;
    case "Index": {
      const key = step.index;
      return key.kind === "Str" || key.kind === "Num" || key.kind === "Bool"
        ? { at: key.value }
        : null;
    }
    case "MethodCall":
      return null;
  }
}

export function fieldPath(field: ErrorField): FieldSegment[] | null {
  const path: FieldSegment[] = [];
  for (const segment of field.segments) {
    if (segment === null) return null;
    path.push(segment);
  }
  return path;
}
