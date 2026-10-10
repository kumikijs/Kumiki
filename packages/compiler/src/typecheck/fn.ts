import type { FnDef } from "../ast.ts";
import { fnScope } from "../fn-scope.ts";
import { checkAgainst } from "./against.ts";
import type { Ctx, KumikiError, SymbolTable } from "./context.ts";
import { checkExpr } from "./expr.ts";
import { resolveType } from "./types.ts";

export function currentFnName(ctx: Ctx): string {
  return (ctx as Ctx & { fnName?: string }).fnName ?? "<fn>";
}

export function checkFn(fn: FnDef, sym: SymbolTable, errors: KumikiError[]): void {
  const scope = fnScope(fn);
  const ctx: Ctx = {
    kind: "fn",
    localBinds: new Set(scope.map((b) => b.name)),
    localTypes: new Map(scope.map((b) => [b.name, b.type])),
    routeBind: "no-payload",
    endedScopes: new Map(),
  };
  (ctx as Ctx & { fnName?: string }).fnName = fn.name;
  for (const p of fn.params) resolveType(p.type, sym, errors);
  if (fn.ret) resolveType(fn.ret, sym, errors);
  checkExpr(fn.body, sym, errors, ctx);
  checkAgainst(fn.body, fn.ret ?? null, sym, errors, ctx);
}
