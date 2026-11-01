import type { FnDef, TypeExpr } from "../ast.ts";
import { fnScope } from "../fn-scope.ts";
import { checkAgainst } from "./against.ts";
import type { Ctx, KumikiError, SymbolTable } from "./context.ts";
import { checkExpr } from "./expr.ts";
import { inferType } from "./infer.ts";
import { resolveType } from "./types.ts";

export function currentFnName(ctx: Ctx): string {
  return (ctx as Ctx & { fnName?: string }).fnName ?? "<fn>";
}

// Shared by the check of the body and by `fnResultType`, so the type a call answers is the type
// the body has where it is checked.
function fnBodyScope(fn: FnDef): Ctx {
  const scope = fnScope(fn);
  const ctx: Ctx = {
    kind: "fn",
    localBinds: new Set(scope.map((b) => b.name)),
    localTypes: new Map(scope.map((b) => [b.name, b.type])),
    localBinders: new Map(),
    routeBind: "no-payload",
  };
  (ctx as Ctx & { fnName?: string }).fnName = fn.name;
  return ctx;
}

export function checkFn(fn: FnDef, sym: SymbolTable, errors: KumikiError[]): void {
  const ctx = fnBodyScope(fn);
  for (const p of fn.params) resolveType(p.type, sym, errors);
  if (fn.ret) resolveType(fn.ret, sym, errors);
  checkExpr(fn.body, sym, errors, ctx);
  checkAgainst(fn.body, fn.ret ?? null, sym, errors, ctx);
}

/**
 * What a call to the `fn` named `name` answers: its `->`, and without one the type of its body.
 * A `fn` that can reach itself (E0006) has no type to stop at, so every `fn` on a loop answers
 * `null` unless it declares `->`, whichever of them is asked first.
 */
export function fnResultType(name: string, sym: SymbolTable): TypeExpr | null {
  const fn = sym.fns.get(name);
  if (!fn) return null;
  if (fn.ret) return fn.ret;
  if (sym.fnLoops.has(name)) return null;
  const known = sym.fnResults.get(name);
  if (known !== undefined) return known;
  // Answered before the body is read, so a call back that the loop check does not see ends here.
  sym.fnResults.set(name, null);
  const answer = inferType(fn.body, sym, fnBodyScope(fn));
  sym.fnResults.set(name, answer);
  return answer;
}
