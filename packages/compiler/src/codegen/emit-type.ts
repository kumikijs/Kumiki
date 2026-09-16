import type { Refinement, TypeExpr } from "../ast.ts";
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

/** Fold a refinement into a base descriptor so generation respects it (§8.3.2). */
export function applyRefine(desc: GenDescData, r: Refinement | undefined): GenDescData {
  if (!r) return desc;
  const num = (i: number): number => (typeof r.args[i] === "number" ? (r.args[i] as number) : 0);
  switch (r.pred) {
    case "between":
      return desc.t === "Int" || desc.t === "Float" ? { ...desc, min: num(0), max: num(1) } : desc;
    case "positive":
      if (desc.t === "Int") return { ...desc, min: 1 };
      if (desc.t === "Float") return { ...desc, min: 0 };
      return desc;
    case "nonempty":
      return desc.t === "Text" ? { ...desc, minLen: 1 } : desc;
    case "len-eq":
      return desc.t === "Text" ? { ...desc, minLen: num(0), maxLen: num(0) } : desc;
    case "len-gt":
      return desc.t === "Text" ? { ...desc, minLen: num(0) + 1 } : desc;
    case "len-lt":
      return desc.t === "Text" ? { ...desc, maxLen: Math.max(0, num(0) - 1) } : desc;
    default:
      return desc;
  }
}

/**
 * Every refinement a type carries, in source order.
 *
 * A type may be written with more than one `where` (spec/language.md §1.3.1),
 * and the predicates conjoin. The parser folds the first onto a `nominal` node
 * as a property and wraps each one after it, so the predicates sit on nested
 * nodes rather than in a list — and a named type reached through a `TypeRef`
 * hides its own underneath that. Reading exactly one layer, which is what this
 * module used to do, emitted the outermost predicate and dropped every other
 * (#353): `nominal Text where len-gt(3) where nonempty` accepted `"ab"`.
 *
 * The walk follows the same edges normalization does — an alias, a `nominal`
 * wrapper, a `where` — and stops where it stops: nothing written inside a
 * record, a union or a container is a refinement of the type itself. `seen`
 * is what makes a name written in terms of itself terminate; the cycle is
 * E0009's to report, and this walk still has to end on the way there.
 *
 * Inner layers come first because that is the order they are written in, which
 * is the order the runtime names a failed predicate in.
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
      const own = (t as { refinement?: Refinement }).refinement;
      return own ? [...inner, own] : inner;
    }
    default:
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
  // Every predicate is unenforced (`email` / `uuid` / `url` / `regex` /
  // `one-of` / `positive` / `negative`, spec/testing.md §8.3). The type still
  // carries a refinement, so the descriptor still gets one — the `error` tile
  // renders a message from a predicate whether or not it has a test.
  if (bodies.length === 0) return `(_v) => true`;
  if (bodies.length === 1) return `(v) => ${bodies[0]}`;
  return `(v) => ${bodies.map((b) => `(${b})`).join(" && ")}`;
}

/** One predicate's test, for the per-predicate entries the `error` tile reads. */
export function refinementToJs(r: Refinement): string {
  const body = refinementBodyJs(r);
  return body === undefined ? `(_v) => true` : `(v) => ${body}`;
}

/**
 * A predicate's condition over `v`, or `undefined` for one with no runtime
 * test. Kept separate from the arrow around it so predicates can be conjoined
 * without nesting a call per layer.
 */
function refinementBodyJs(r: Refinement): string | undefined {
  switch (r.pred) {
    case "between": {
      const a = r.args[0] as number;
      const b = r.args[1] as number;
      return `typeof v === "number" && v >= ${a} && v <= ${b}`;
    }
    case "nonempty":
      return `typeof v === "string" && v.length > 0`;
    case "len-lt":
      return `typeof v === "string" && v.length < ${r.args[0] as number}`;
    case "len-gt":
      return `typeof v === "string" && v.length > ${r.args[0] as number}`;
    case "len-eq":
      return `typeof v === "string" && v.length === ${r.args[0] as number}`;
    default:
      return undefined;
  }
}
