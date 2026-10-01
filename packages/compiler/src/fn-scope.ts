import type { FnDef, TypeExpr } from "./ast.ts";

/**
 * One name a `fn` body can read an argument by: `name` is what the body writes
 * (`a`, or `$1`), `type` is the parameter's declared type, and `param` is the
 * parameter it stands for, whose identifier codegen emits for either spelling.
 */
export interface FnScopeBind {
  name: string;
  type: TypeExpr;
  param: string;
}

/**
 * The names a `fn` body reads its arguments by, each with the parameter it
 * stands for: every parameter under its own name, and — language.md §1.6.5,
 * "within a `fn`, the argument order" — under its position, `$1` for the
 * first, `$2` for the second, and so on. One position per parameter and no
 * more, so a positional past the arity is an undefined name like any other.
 *
 * The checker types the body from this list and codegen aliases each
 * positional to its parameter's identifier from the same list, so the two
 * cannot disagree about which names a body has. A fragment inside the body —
 * `xs.map($1 * 2)` — declares its own `$1` / `$2` over these, as any nested
 * scope does.
 */
export function fnScope(fn: Pick<FnDef, "params">): FnScopeBind[] {
  return [
    ...fn.params.map((p) => ({ name: p.name, type: p.type, param: p.name })),
    ...fn.params.map((p, i) => ({ name: `$${i + 1}`, type: p.type, param: p.name })),
  ];
}
