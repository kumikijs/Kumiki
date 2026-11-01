import { type Expr, numberLiteral } from "./ast.ts";
import { type BindStep, bindTarget } from "./bind-target.ts";
import { isUnwrapStep, UNWRAP_SEGMENT } from "./codegen/path-segment.ts";

/** An index's key is a literal, so the path is known at compile time. */
export type FieldSegment = string | { get: true } | { at: string | number | boolean };

/**
 * The checker reports a step this cannot lower, and the lowering emits the path
 * it returns, so the two cannot disagree about what a field names.
 */
export type ErrorField = {
  root: Expr;
  steps: BindStep[];
  /** `null` once a step is one an error tile cannot name. */
  path: FieldSegment[] | null;
};

export function errorField(value: Expr): ErrorField {
  const { root, steps } = bindTarget(value);
  const path: FieldSegment[] = [];
  for (const step of steps) {
    const segment = fieldSegment(step);
    if (segment === null) return { root, steps, path: null };
    path.push(segment);
  }
  return { root, steps, path };
}

/** `null` for a step an error tile cannot name: a call, or an index whose key is not a literal. */
export function fieldSegment(step: BindStep): FieldSegment | null {
  switch (step.kind) {
    case "FieldAccess":
      return isUnwrapStep(step.field, step.accessKind) ? UNWRAP_SEGMENT : step.field;
    case "Index": {
      const key = step.index;
      const n = numberLiteral(key);
      if (n) return { at: n.value };
      return key.kind === "Str" || key.kind === "Bool" ? { at: key.value } : null;
    }
    case "MethodCall":
      return null;
  }
}
