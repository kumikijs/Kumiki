import { assertNever, type Refinement, type TypeExpr } from "../ast.ts";
import { refinementBodyJs, refinementToJs } from "../refinements.ts";
import type { GenCtx } from "./context.ts";

export type GenDescData = { t: string; [k: string]: unknown };

/** Translate a type into a property-test generation descriptor. */
export function typeToGenDesc(t: TypeExpr, gen: GenCtx, seen: Set<string>): GenDescData {
  switch (t.kind) {
    case "TypePrim":
      return primGenDesc(t.name);
    case "TypeApp": {
      const a = t.args;
      const d = (x: TypeExpr | undefined): GenDescData =>
        x ? typeToGenDesc(x, gen, seen) : { t: "Unknown" };
      if (t.name === "List") return { t: "List", elem: d(a[0]) };
      if (t.name === "Set") return { t: "Set", elem: d(a[0]) };
      if (t.name === "Map") return { t: "Map", key: d(a[0]), val: d(a[1]) };
      if (t.name === "Option") return { t: "Option", inner: d(a[0]) };
      if (t.name === "Result") return { t: "Result", ok: d(a[0]), err: d(a[1]) };
      return { t: "Unknown" };
    }
    case "TypeRef": {
      if (seen.has(t.name)) return { t: "Unknown" };
      const def = gen.types.get(t.name);
      if (!def) return { t: "Unknown" };
      const next = new Set(seen);
      next.add(t.name);
      return typeToGenDesc(def.body, gen, next);
    }
    case "TypeNominal":
    case "TypeRefinement":
      return applyRefine(typeToGenDesc(t.inner, gen, seen), t.refinement);
    case "TypeRecord":
      return {
        t: "Record",
        fields: t.fields.map((f) => ({ name: f.name, desc: typeToGenDesc(f.type, gen, seen) })),
      };
    case "TypeUnion":
      return {
        t: "Union",
        variants: t.variants.map((v) => ({
          name: v.name,
          payloads: v.payloads.map((p) => typeToGenDesc(p, gen, seen)),
        })),
      };
    default:
      return { t: "Unknown" };
  }
}

export function primGenDesc(name: string): GenDescData {
  if (name === "Int" || name === "Time") return { t: "Int" };
  if (name === "Float") return { t: "Float" };
  if (name === "Text" || name === "Bytes") return { t: "Text" };
  if (name === "Bool") return { t: "Bool" };
  return { t: "Unknown" };
}

export function applyRefine(desc: GenDescData, r: Refinement | undefined): GenDescData {
  if (!r) return desc;
  const num = (i: number): number => (typeof r.args[i] === "number" ? (r.args[i] as number) : 0);
  switch (r.pred) {
    case "between":
      return desc.t === "Int" || desc.t === "Float" ? { ...desc, min: num(0), max: num(1) } : desc;
    case "positive":
      if (desc.t === "Int") return { ...desc, min: 1 };
      if (desc.t === "Float") return { ...desc, min: Number.EPSILON };
      return desc;
    case "negative":
      if (desc.t === "Int") return { ...desc, max: -1 };
      if (desc.t === "Float") return { ...desc, max: -Number.EPSILON };
      return desc;
    case "nonempty":
      return desc.t === "Text" ? { ...desc, minLen: 1 } : desc;
    case "len-eq":
      return desc.t === "Text" ? { ...desc, minLen: num(0), maxLen: num(0) } : desc;
    case "len-gt":
      return desc.t === "Text" ? { ...desc, minLen: num(0) + 1 } : desc;
    case "len-lt":
      return desc.t === "Text" ? { ...desc, maxLen: Math.max(0, num(0) - 1) } : desc;
    case "email":
    case "url":
    case "uuid":
      // A shape rather than a length: the generator builds an instance of the
      // form, so the value passes the same check the runtime applies.
      return desc.t === "Text" ? { ...desc, form: r.pred } : desc;
    case "one-of":
      // Independent of the base type — the choices *are* the domain.
      return { ...desc, oneOf: [...r.args] };
    default:
      return desc;
  }
}

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
