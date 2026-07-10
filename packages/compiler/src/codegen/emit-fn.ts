import type { FnDef } from "../ast.ts";
import { type GenCtx, jsName, makeEvalCtx } from "./context.ts";
import { jsOfExpr } from "./expr.ts";

export function genFn(fn: FnDef, gen: GenCtx): string {
  const params = fn.params.map((p) => p.name).join(", ");
  const ctx = makeEvalCtx(gen, new Set([...fn.params.map((p) => p.name), "$1", "$2"]));
  return `function ${jsName(fn.name)}(${params}) { return ${jsOfExpr(fn.body, ctx)}; }`;
}
