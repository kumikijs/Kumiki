import type { FnDef, TypeExpr } from "./ast.ts";

export interface FnScopeBind {
  name: string;
  type: TypeExpr;
  param: string;
}

export function fnScope(fn: Pick<FnDef, "params">): FnScopeBind[] {
  return [
    ...fn.params.map((p) => ({ name: p.name, type: p.type, param: p.name })),
    ...fn.params.map((p, i) => ({ name: `$${i + 1}`, type: p.type, param: p.name })),
  ];
}
