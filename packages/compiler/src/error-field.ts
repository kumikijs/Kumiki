// What an `error(field=…)` names (forms.md §5.7.1): a slot, or a path into
// one. Its root and steps are read as a `bind=` target's are (`bindTarget`),
// and each step is lowered here to the segment the runtime follows it by. The
// checker reports a step this cannot lower, and the lowering emits the path
// this returns, so the two cannot disagree about what a field names.

import type { Expr } from "./ast.ts";
import { type BindStep, bindTarget } from "./bind-target.ts";
import { type BindSegment, isUnwrapStep, UNWRAP_SEGMENT } from "./codegen/path-segment.ts";

/**
 * A step of a field's path as the runtime's `PathSegment` spells it: a field,
 * the unwrap `.get`, or `{at: key}` — an index, whose key is a literal.
 */
export type FieldSegment = BindSegment | { at: string | number | boolean };

export type ErrorField = {
  /**
   * What the path starts from. A field names a place when this is a slot's
   * name; whether it is one where the tile is written is the checker's
   * question (E0230).
   */
  root: Expr;
  /** The steps from `root` to the field, root first. */
  steps: BindStep[];
  /**
   * Each step's segment, in step order, or `null` for a step that names no
   * place: a call, or an index whose key is not a literal.
   */
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

/** The path of a field every step of which names a place, or `null`. */
export function fieldPath(field: ErrorField): FieldSegment[] | null {
  const path: FieldSegment[] = [];
  for (const segment of field.segments) {
    if (segment === null) return null;
    path.push(segment);
  }
  return path;
}
