import type { Refinement, TypeExpr } from "../ast.ts";
import { refinementToJs } from "../refinements.ts";
import type { GenCtx } from "./context.ts";

export type GenDescData = { t: string; [k: string]: unknown };

/** Translate a type into a property-test generation descriptor (spec §8.3.2). */
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

/**
 * Fold a refinement into a base descriptor so generation respects it (§8.3.2).
 *
 * Every predicate the runtime enforces belongs here, because the two answer
 * the same question from opposite ends: a generator that ignores a refinement
 * produces values the slot it is generating for would refuse, so the property
 * under test is run on states the app can never be in. While `email` / `url` /
 * `uuid` lowered to `(_v) => true` this was harmless and the descriptor
 * ignored them; enforcing them (#352) is what makes the omission visible.
 *
 * `regex` is the one predicate with no constraint to fold: generating from an
 * arbitrary pattern is a different problem from checking against one. §8.3.2
 * says so, and a `for-all` over a `regex`-refined type is a case to write by
 * hand.
 */
export function applyRefine(desc: GenDescData, r: Refinement | undefined): GenDescData {
  if (!r) return desc;
  const num = (i: number): number => (typeof r.args[i] === "number" ? (r.args[i] as number) : 0);
  switch (r.pred) {
    case "between":
      return desc.t === "Int" || desc.t === "Float" ? { ...desc, min: num(0), max: num(1) } : desc;
    case "positive":
      if (desc.t === "Int") return { ...desc, min: 1 };
      // The smallest Float above zero, because `positive` is `v > 0` and a
      // generator bounded at 0 can hand the check the one value it refuses.
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

/**
 * Follow `t` to the type expression that carries its refinement.
 *
 * Through names, not just one of them: `type Handle = Email` is the type it
 * names, so a slot declared with it is refined by `email` exactly as one
 * declared `Email` is. `gen.types` holds the standard library's definitions as
 * well as the program's (see `codegen`), which is what makes `Email`, `Url`,
 * `Uuid` and `HttpStatus` refine at all — they are synthesised in
 * `stdlib-types.ts` and a lookup that only saw the program's `type` definitions
 * returned `undefined` for every one of them (#352).
 *
 * The `seen` set is not defensive: `type A = A` and `type A = B; type B = A`
 * are reported by the checker (E0219) but still reach codegen in a `check`
 * that is not fatal, and a walk without it would not return.
 */
function refinedTarget(t: TypeExpr, gen: GenCtx): TypeExpr | undefined {
  let target = t;
  const seen = new Set<string>();
  while (target.kind === "TypeRef") {
    if (seen.has(target.name)) return undefined;
    seen.add(target.name);
    const def = gen.types.get(target.name);
    if (!def) return undefined;
    target = def.body;
  }
  return target;
}

/** Resolve a slot/type's refinement (through a TypeRef), for the `error` tile. */
export function slotRefinement(t: TypeExpr, gen: GenCtx): Refinement | undefined {
  const target = refinedTarget(t, gen);
  if (target?.kind === "TypeNominal" || target?.kind === "TypeRefinement") {
    return target.refinement;
  }
  return undefined;
}

/**
 * The JS predicate a slot of type `t` is checked by, or `undefined` when the
 * type carries no refinement — or carries one nothing lowers, which the
 * checker has already reported as E0803. Emitting nothing is the point: a
 * slot with no `refine` is one the runtime does not gate, where a `refine`
 * that answers `true` to everything reads as a gate and is not one.
 */
export function refinementJs(t: TypeExpr, gen: GenCtx): string | undefined {
  const r = slotRefinement(t, gen);
  return r ? refinementToJs(r) : undefined;
}
