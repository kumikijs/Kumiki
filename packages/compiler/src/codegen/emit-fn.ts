import type { FnDef } from "../ast.ts";
import { bindRef, type GenCtx, jsBinding, makeEvalCtx } from "./context.ts";
import { jsOfExpr } from "./expr.ts";

export function genFn(fn: FnDef, gen: GenCtx): string {
  // Parameters are binding positions, and so is every reference to them in the
  // body — both read the identifier out of the same scope, so the two sides
  // cannot drift apart.
  const ctx = makeEvalCtx(gen, [...fn.params.map((p) => p.name), "$1", "$2"]);
  const params = fn.params.map((p) => bindRef(ctx, p.name)).join(", ");
  return `function ${jsBinding(fn.name)}(${params}) { return ${jsOfExpr(fn.body, ctx)}; }`;
}
