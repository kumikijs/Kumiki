import { assertNever, type Refinement, type TypeExpr } from "../ast.ts";
import { refinementBodyJs, refinementToJs } from "../refinements.ts";
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
 * Every refinement a type carries, base outward.
 *
 * A type may be written with more than one `where` (spec/language.md §1.3.1),
 * and the predicates conjoin. The parser folds the first onto a `nominal` node
 * as a property and wraps each one after it, so the predicates sit on nested
 * nodes rather than in a list — and a named type reached through a `TypeRef`
 * hides its own underneath that. Reading exactly one layer, which is what this
 * module used to do, emitted the outermost predicate and dropped every other
 * (#353): `nominal Text where len-gt(3) where nonempty` accepted `"ab"`.
 *
 * The order is the one the chain the type denotes is read in, from the base
 * outward (§1.3.6, inv. 1). Inside a single type expression that is the order
 * the predicates are written in; across names it is not, and it does not depend
 * on which definition was declared first — on `type Handle = nominal Short
 * where len-gt(3)` over `type Short = Text where len-lt(9)`, `len-lt` comes
 * first wherever the two definitions sit in the file, because `Short` is what
 * `Handle` is declared over. It is the order a failed predicate is named in.
 *
 * The edges are an alias, a `nominal` wrapper and a `where`, and the walk stops
 * at a structural type: nothing written inside a record, a union or a container
 * is a refinement of the type itself. It is **not** yet every edge normalization
 * follows — a generic that hands a parameter back (`type NonEmpty(T) = T where
 * nonempty`) is one, and its refinement is still dropped here (#439). `seen` is
 * what makes a name written in terms of itself terminate; the cycle is E0009's
 * to report, and this walk still has to end on the way there.
 */
export function refinementsOf(
  t: TypeExpr,
  gen: GenCtx,
  seen: ReadonlySet<string> = new Set(),
): Refinement[] {
  switch (t.kind) {
    case "TypeRef": {
      if (seen.has(t.name)) return [];
      const def = gen.types.get(t.name);
      if (!def) return [];
      const next = new Set(seen);
      next.add(t.name);
      return refinementsOf(def.body, gen, next);
    }
    case "TypeNominal":
    case "TypeRefinement": {
      const inner = refinementsOf(t.inner, gen, seen);
      return t.refinement ? [...inner, t.refinement] : inner;
    }
    // A type in its own right, or (`TypeApp`) an edge this walk does not follow
    // yet. Listed rather than defaulted so `assertNever` reports the next node
    // kind added to `TypeExpr` instead of silently losing its refinements.
    case "TypePrim":
    case "TypeApp":
    case "TypeRecord":
    case "TypeUnion":
      return [];
    default:
      assertNever(t);
      return [];
  }
}

/**
 * The runtime test for a slot's type: every predicate it carries, conjoined.
 * `undefined` when the type carries none — the slot then has no `refine` at
 * all, which is what the runtime reads to mean "unrefined".
 */
export function refinementJs(t: TypeExpr, gen: GenCtx): string | undefined {
  const rs = refinementsOf(t, gen);
  if (rs.length === 0) return undefined;
  const bodies = rs.map(refinementBodyJs).filter((b): b is string => b !== undefined);
  // Every predicate this type carries is one the table has no lowering for —
  // which E0803 has already reported, because the parser accepts exactly the
  // names that table holds and every one of them lowers (#352). Emitting
  // nothing rather than the `(_v) => true` that used to stand here is the
  // point: a slot with no `refine` is one the runtime does not gate, where a
  // `refine` that answers `true` to every value reads as a gate and is not one.
  if (bodies.length === 0) return undefined;
  if (bodies.length === 1) return `(v) => ${bodies[0]}`;
  return `(v) => ${bodies.map((b) => `(${b})`).join(" && ")}`;
}

/**
 * One predicate's test, for the per-predicate entries the `error` tile reads.
 * `undefined` for a predicate with no lowering, as above.
 */
export { refinementToJs };
