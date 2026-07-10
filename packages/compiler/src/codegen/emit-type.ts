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

/** Resolve a slot/type's refinement (through a TypeRef), for the `error` tile. */
export function slotRefinement(t: TypeExpr, gen: GenCtx): Refinement | undefined {
  let target = t;
  if (t.kind === "TypeRef") {
    const def = gen.types.get(t.name);
    if (!def) return undefined;
    target = def.body;
  }
  if (target.kind === "TypeNominal" || target.kind === "TypeRefinement") {
    return (target as { refinement?: Refinement }).refinement;
  }
  return undefined;
}

export function refinementJs(t: TypeExpr, gen: GenCtx): string | undefined {
  let target = t;
  if (t.kind === "TypeRef") {
    const def = gen.types.get(t.name);
    if (!def) return undefined;
    target = def.body;
  }
  if (target.kind === "TypeNominal" || target.kind === "TypeRefinement") {
    const r = (target as { refinement?: Refinement }).refinement;
    if (r) return refinementToJs(r);
  }
  return undefined;
}

export function refinementToJs(r: Refinement): string | undefined {
  switch (r.pred) {
    case "between": {
      const a = r.args[0] as number;
      const b = r.args[1] as number;
      return `(v) => typeof v === "number" && v >= ${a} && v <= ${b}`;
    }
    case "nonempty":
      return `(v) => typeof v === "string" && v.length > 0`;
    case "len-lt":
      return `(v) => typeof v === "string" && v.length < ${r.args[0] as number}`;
    case "len-gt":
      return `(v) => typeof v === "string" && v.length > ${r.args[0] as number}`;
    case "len-eq":
      return `(v) => typeof v === "string" && v.length === ${r.args[0] as number}`;
    default:
      return `(_v) => true`;
  }
}
