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
 * A body that reaches itself (E0006) has no type to stop at, so every `fn` on the loop answers
 * `null`, whichever of them is asked first.
 */
export function fnResultType(name: string, sym: SymbolTable): TypeExpr | null {
  const fn = sym.fns.get(name);
  if (!fn) return null;
  if (fn.ret) return fn.ret;
  const memo = sym.fnResults;
  const known = memo.answers.get(name);
  if (known !== undefined) return known;
  const at = memo.reading.indexOf(name);
  if (at >= 0) {
    for (const on of memo.reading.slice(at)) memo.onLoop.add(on);
    return null;
  }
  memo.reading.push(name);
  const body = inferType(fn.body, sym, fnBodyScope(fn));
  memo.reading.pop();
  const answer = memo.onLoop.has(name) ? null : body;
  memo.answers.set(name, answer);
  return answer;
}
