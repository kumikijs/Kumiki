import { refinementsOf } from "../assignable.ts";
import type { Refinement, TypeExpr } from "../ast.ts";
import { refinementBodyJs, refinementToJs } from "../refinements.ts";
import type { GenCtx } from "./context.ts";

export type GenDescData = { t: string; [k: string]: unknown };

/**
 * Translate a type into a property-test generation descriptor (spec §8.3.2).
 *
 * The type's own chain — the names it is declared through, and the `nominal`s
 * and `where`s on the way — is followed in a loop, since nothing bounds how
 * long it is, and the refinements met on it are folded into the descriptor of
 * the type it ends at, base outward.
 */
export function typeToGenDesc(t: TypeExpr, gen: GenCtx, seen: Set<string>): GenDescData {
  const outermostFirst: Refinement[] = [];
  let names = seen;
  let cur = t;
  for (;;) {
    if (cur.kind === "TypeNominal" || cur.kind === "TypeRefinement") {
      if (cur.refinement) outermostFirst.push(cur.refinement);
      cur = cur.inner;
      continue;
    }
    const def =
      cur.kind === "TypeRef" && !names.has(cur.name) ? gen.types.get(cur.name) : undefined;
    if (!def) break;
    if (names === seen) names = new Set(seen);
    names.add(def.name);
    cur = def.body;
  }
  let desc = endGenDesc(cur, gen, names);
  for (const r of outermostFirst.reverse()) desc = applyRefine(desc, r);
  return desc;
}

/** {@link typeToGenDesc} of the type a chain ends at, which is no wrapper. */
function endGenDesc(
  t: Exclude<TypeExpr, { kind: "TypeNominal" | "TypeRefinement" }>,
  gen: GenCtx,
  seen: Set<string>,
): GenDescData {
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
    // A name the chain has already entered, or one nothing declares.
    case "TypeRef":
      return { t: "Unknown" };
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
      // Strictly above zero, because `positive` is `v > 0` and a generator
      // bounded at 0 can hand the check the one value it refuses. `EPSILON`
      // rather than `MIN_VALUE` (the smallest Float above zero): the bound is
      // the low end of a range the generator then samples, and a denormal one
      // buys nothing a representable gap does not.
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
  // One statement per predicate, in chain order, rather than one `&&` chain
  // of them: a chain of definitions carries as many predicates as the program
  // gives it, and Rollup and rolldown both walk a `&&` chain by recursion and
  // fail on one a few thousand terms long — the module would load in Node and
  // break the first bundler it reached.
  return `(v) => { ${bodies.map((b) => `if (!(${b})) return false;`).join(" ")} return true; }`;
}

/**
 * One predicate's test, for the per-predicate entries the `error` tile reads.
 * `undefined` for a predicate with no lowering, as above.
 */
export { refinementToJs };
