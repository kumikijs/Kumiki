import type { FnDef } from "../ast.ts";
import { type GenCtx, jsBinding, makeEvalCtx } from "./context.ts";
import { jsOfExpr } from "./expr.ts";

export function genFn(fn: FnDef, gen: GenCtx): string {
  // Parameters are binding positions, and so is every reference to them in the
  // body — both go through jsBinding so the two sides cannot drift apart.
  const params = fn.params.map((p) => jsBinding(p.name)).join(", ");
  const ctx = makeEvalCtx(gen, new Set([...fn.params.map((p) => p.name), "$1", "$2"]));
  return `function ${jsBinding(fn.name)}(${params}) { return ${jsOfExpr(fn.body, ctx)}; }`;
}
