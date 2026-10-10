import type { FnDef } from "../ast.ts";
import { fnScope } from "../fn-scope.ts";
import { bindRef, type GenCtx, jsBinding, makeEvalCtx } from "./context.ts";
import { jsOfExpr } from "./expr.ts";

export function genFn(fn: FnDef, gen: GenCtx): string {
  const ctx = makeEvalCtx(gen, new Map(fnScope(fn).map((b) => [b.name, jsBinding(b.param)])));
  const params = fn.params.map((p) => bindRef(ctx, p.name)).join(", ");
  return `function ${jsBinding(fn.name)}(${params}) { return ${jsOfExpr(fn.body, ctx)}; }`;
}
