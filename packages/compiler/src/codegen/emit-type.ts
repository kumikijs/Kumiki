import { assertNever, type Refinement, type TypeExpr } from "../ast.ts";
import { refinementBodyJs, refinementToJs } from "../refinements.ts";
import type { GenCtx } from "./context.ts";

export function refinementsOf(t: TypeExpr, gen: Pick<GenCtx, "types">): Refinement[] {
  return collectRefinements(t, gen, { seen: new Set(), params: new Map() });
}

type Scope = {
  seen: ReadonlySet<string>;
  params: ReadonlyMap<string, { arg: TypeExpr; scope: Scope } | undefined>;
};

function collectRefinements(t: TypeExpr, gen: Pick<GenCtx, "types">, scope: Scope): Refinement[] {
  switch (t.kind) {
    case "TypeRef":
    case "TypeApp": {
      if (t.kind === "TypeRef" && scope.params.has(t.name)) {
        const bound = scope.params.get(t.name);
        return bound ? collectRefinements(bound.arg, gen, bound.scope) : [];
      }
      if (scope.seen.has(t.name)) return [];
      const def = gen.types.get(t.name);
      if (!def) return [];
      const params = new Map<string, { arg: TypeExpr; scope: Scope } | undefined>();
      if (t.kind === "TypeApp") {
        def.params.forEach((p, i) => {
          const arg = t.args[i];
          params.set(p, arg ? { arg, scope } : undefined);
        });
      }
      return collectRefinements(def.body, gen, { seen: new Set([...scope.seen, t.name]), params });
    }
    case "TypeNominal":
    case "TypeRefinement": {
      const inner = collectRefinements(t.inner, gen, scope);
      return t.refinement ? [...inner, t.refinement] : inner;
    }
    case "TypePrim":
    case "TypeRecord":
    case "TypeUnion":
      return [];
    default:
      assertNever(t);
      return [];
  }
}

export function refinementJs(t: TypeExpr, gen: GenCtx): string | undefined {
  const rs = refinementsOf(t, gen);
  if (rs.length === 0) return undefined;
  const bodies = rs.map(refinementBodyJs).filter((b): b is string => b !== undefined);
  if (bodies.length === 0) return undefined;
  if (bodies.length === 1) return `(v) => ${bodies[0]}`;
  return `(v) => ${bodies.map((b) => `(${b})`).join(" && ")}`;
}

export { refinementToJs };
