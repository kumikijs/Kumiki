// What a `bind=` target names (forms.md §5.1): the expression its chain of
// steps starts from, and the path those steps take. The checker and the
// lowering both read a target through `bindTarget`, so the root the checker
// asks to be a slot is the one the lowering writes, and a step the checker
// refuses is one the lowering would drop.

import type { Expr } from "./ast.ts";
import { isUnwrapStep, type PathStep, UNWRAP_SEGMENT } from "./codegen/path-segment.ts";

/**
 * A step of a bind target: a field (`.title`, the unwrap `.get`), an index
 * (`[k]`), or a call (`.get()`).
 */
export type BindStep = Expr & { kind: "FieldAccess" | "Index" | "MethodCall" };

export type BindTarget = {
  /**
   * What the chain starts from. A target that names a place starts from a
   * name (a `Ref`), and the control writes to the slot of that name. Whether
   * the name is a slot where the target is written is the checker's question
   * (E0229); anything other than a name — a literal, a call, an operator —
   * names no place.
   */
  root: Expr;
  /** The steps from `root` to the target, root first. */
  steps: BindStep[];
  /**
   * `steps` as the setter's path (`path-segment.ts`) — the steps `:=` writes
   * through, an index carrying the expression of its key — or `null` when one
   * of them is a call, which names no place (E0602).
   */
  path: PathStep[] | null;
};

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
