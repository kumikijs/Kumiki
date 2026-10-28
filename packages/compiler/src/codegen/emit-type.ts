import { refinementsOf } from "../assignable.ts";
import type { TypeExpr } from "../ast.ts";
import { refinementBodyJs, refinementToJs } from "../refinements.ts";
import type { GenCtx } from "./context.ts";

export function refinementJs(t: TypeExpr, gen: GenCtx): string | undefined {
  const rs = refinementsOf(t, gen);
  if (rs.length === 0) return undefined;
  const bodies = rs.map(refinementBodyJs).filter((b): b is string => b !== undefined);
  if (bodies.length === 0) return undefined;
  if (bodies.length === 1) return `(v) => ${bodies[0]}`;
  // One statement per predicate, in chain order, rather than one `&&` chain
  // of them: a chain of definitions carries as many predicates as the program
  // gives it, and Rollup and rolldown both walk a `&&` chain by recursion and
  // fail on one a few thousand terms long — the module would load in Node and
  // break the first bundler it reached.
  return `(v) => { ${bodies.map((b) => `if (!(${b})) return false;`).join(" ")} return true; }`;
}

export { refinementToJs };
