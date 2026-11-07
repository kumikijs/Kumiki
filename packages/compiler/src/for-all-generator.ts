import type { GenDesc } from "@kumikijs/runtime";
import {
  nestingGenericsIn,
  paramSubstitution,
  substituteType,
  type TypeEnv,
  typeToString,
} from "./assignable.ts";
import { assertNever, type Refinement, type TypeExpr } from "./ast.ts";
import { refinementHolds } from "./refinements.ts";
import type { PrimName } from "./stdlib-types.ts";

/** The runtime's generation recipe, as codegen emits it. */
export type GenDescData = GenDesc;

/**
 * The generation descriptor of a `for-all` type, or why it has none. The checker reports a
 * refusal as E0715 and codegen emits the descriptor, so a type the checker accepts is one the
 * runtime's generator builds in full.
 */
export function forAllGenerator(
  t: TypeExpr,
  env: TypeEnv,
): { desc: GenDesc } | { refused: string } {
  try {
    return { desc: boundRecursion(new Walk(env).describe(t, new Map()), new Map()) };
  } catch (e) {
    if (e instanceof NoGenerator) return { refused: e.message };
    throw e;
  }
}

export function noGeneratorMessage(variable: string, reason: string): string {
  return `No generator for \`for-all\` "${variable}": ${reason}`;
}

class NoGenerator extends Error {}

/** An instantiation being expanded: the generic it applies, how it reads, and its `Fix` name. */
type Opened = { readonly generic: string; readonly shown: string; readonly id: string };

/** The instantiations being expanded, by key. Meeting one again is a step back into it (`Rec`). */
type Open = ReadonlyMap<string, Opened>;

// One instantiation is told from another by its arguments, refinements included.
const keyOf = (name: string, args: readonly TypeExpr[]): string =>
  args.length === 0
    ? name
    : `${name}${JSON.stringify(args, (k, v) => (k === "pos" ? undefined : v))}`;

class Walk {
  private readonly ids = new Map<string, string>();
  private readonly taken = new Set<string>();

  constructor(private readonly env: TypeEnv) {}

  /**
   * Wrappers and named types are walked as a loop, not a recursion, so a chain of thousands of
   * definitions that each refine the one before is no deeper on the stack than one.
   */
  describe(t: TypeExpr, open: Open): GenDesc {
    const outermostFirst: Refinement[] = [];
    const entered: string[] = [];
    // Copied once, on the first name the chain enters, and added to from there on.
    let opened: Map<string, Opened> | undefined;
    let cur = t;
    for (;;) {
      if (cur.kind === "TypeNominal" || cur.kind === "TypeRefinement") {
        if (cur.refinement) outermostFirst.push(cur.refinement);
        cur = cur.inner;
        continue;
      }
      if (cur.kind !== "TypeRef" && cur.kind !== "TypeApp") break;
      const def = this.env.types.get(cur.name);
      if (!def) break;
      const args = cur.kind === "TypeApp" ? cur.args : [];
      const key = keyOf(def.name, args);
      if ((opened ?? open).has(key)) break;
      if (args.length !== def.params.length) {
        throw new NoGenerator(`"${def.name}" takes ${def.params.length} type argument(s)`);
      }
      const shown = typeToString(cur);
      if (args.length > 0) this.refuseNesting(def.name, shown, opened ?? open);
      opened ??= new Map(open);
      const id = this.idFor(key, shown);
      opened.set(key, { generic: def.name, shown, id });
      entered.push(id);
      cur = substituteType(def.body, paramSubstitution(def.params, args));
    }
    let desc = this.end(cur, opened ?? open);
    if (outermostFirst.length > 0) desc = refined(desc, outermostFirst.reverse(), typeToString(t));
    for (const id of entered.reverse()) {
      if (stepsInto(desc, id)) desc = { t: "Fix", name: id, body: desc };
    }
    return desc;
  }

  /** The type a chain ends at: no wrapper, and no named type it has not already entered. */
  private end(t: TypeExpr, open: Open): GenDesc {
    const describe = (p: TypeExpr): GenDesc => this.describe(p, open);
    switch (t.kind) {
      case "TypePrim":
        return primDesc(t.name);
      case "TypeRef":
      case "TypeApp": {
        const args = t.kind === "TypeApp" ? t.args : [];
        const back = open.get(keyOf(t.name, args));
        if (back) return { t: "Rec", name: back.id };
        return builtinDesc(t.name, args.map(describe));
      }
      case "TypeRecord":
        return {
          t: "Record",
          fields: t.fields.map((f) => ({ name: f.name, desc: describe(f.type) })),
        };
      case "TypeUnion":
        return {
          t: "Union",
          variants: t.variants.map((v) => ({ name: v.name, payloads: v.payloads.map(describe) })),
        };
      case "TypeNominal":
      case "TypeRefinement":
        return describe(t);
      default:
        assertNever(t);
        throw new NoGenerator("the type is not one the generator knows");
    }
  }

  // `type Grow(T) = Stop | Deeper(Grow(List(T)))`: each step is a different type, so there is no
  // one body to step back into. A generic that only swaps or rotates its parameters reaches
  // finitely many instantiations, each of which is stepped back into.
  private refuseNesting(generic: string, shown: string, open: Open): void {
    if (!nestingGenericsIn(this.env).has(generic)) return;
    const outer = [...open.values()].find((o) => o.generic === generic);
    if (outer) {
      throw new NoGenerator(
        `"${generic}" nests a parameter deeper at every step: "${shown}" inside "${outer.shown}"`,
      );
    }
  }

  // Two instantiations that read alike but differ in a refinement still need names apart.
  private idFor(key: string, shown: string): string {
    const known = this.ids.get(key);
    if (known !== undefined) return known;
    let id = shown;
    for (let n = 2; this.taken.has(id); n++) id = `${shown}#${n}`;
    this.ids.set(key, id);
    this.taken.add(id);
    return id;
  }
}

function primDesc(name: PrimName): GenDesc {
  switch (name) {
    case "Int":
    case "Time":
      return { t: "Int" };
    case "Float":
      return { t: "Float" };
    case "Text":
    case "Bytes":
      return { t: "Text" };
    case "Bool":
      return { t: "Bool" };
    case "Unit":
      return { t: "Unit" };
    // A `File` comes from the platform and an `EffectId` from `emit`.
    case "File":
    case "EffectId":
      throw new NoGenerator(`"${name}" has none`);
    default:
      assertNever(name);
      throw new NoGenerator(`"${String(name)}" has none`);
  }
}

function builtinDesc(name: string, args: GenDesc[]): GenDesc {
  const arg = (i: number): GenDesc => {
    const a = args[i];
    if (!a) throw new NoGenerator(`"${name}" is missing an argument`);
    return a;
  };
  switch (name) {
    case "List":
    case "Set":
      return { t: name, elem: arg(0) };
    case "Map":
      return { t: "Map", key: arg(0), val: arg(1) };
    case "Option":
      return { t: "Option", inner: arg(0) };
    case "Result":
      return { t: "Result", ok: arg(0), err: arg(1) };
    case "Tuple":
      return { t: "Tuple", items: args };
    default:
      throw new NoGenerator(`"${name}" names no type`);
  }
}

/** The parts a descriptor is built from. */
function partsOf(d: GenDesc): GenDesc[] {
  switch (d.t) {
    case "List":
    case "Set":
      return [d.elem];
    case "Map":
      return [d.key, d.val];
    case "Option":
      return [d.inner];
    case "Result":
      return [d.ok, d.err];
    case "Record":
      return d.fields.map((f) => f.desc);
    case "Tuple":
      return d.items;
    case "Union":
      return d.variants.flatMap((v) => v.payloads);
    case "Fix":
      return [d.body];
    case "Int":
    case "Float":
    case "Text":
    case "Bool":
    case "Unit":
    case "Rec":
      return [];
    default:
      assertNever(d);
      return [];
  }
}

function stepsInto(d: GenDesc, id: string): boolean {
  return (d.t === "Rec" && d.name === id) || partsOf(d).some((p) => stepsInto(p, id));
}

type Ranks = ReadonlyMap<string, number>;

/** How many steps back into a recursive type the shortest value of `d` takes; `Infinity` when none is finite. */
function rank(d: GenDesc, ranks: Ranks): number {
  switch (d.t) {
    case "Rec":
      return 1 + (ranks.get(d.name) ?? Number.POSITIVE_INFINITY);
    case "Fix":
      return fixRank(d, ranks);
    case "Result":
      return Math.min(rank(d.ok, ranks), rank(d.err, ranks));
    case "Union":
      return Math.min(...d.variants.map((v) => deepest(v.payloads, ranks)));
    case "Record":
    case "Tuple":
      return deepest(partsOf(d), ranks);
    // An empty collection and `None` end at once.
    case "List":
    case "Set":
    case "Map":
    case "Option":
    case "Int":
    case "Float":
    case "Text":
    case "Bool":
    case "Unit":
      return 0;
    default:
      assertNever(d);
      return 0;
  }
}

function deepest(parts: GenDesc[], ranks: Ranks): number {
  return Math.max(0, ...parts.map((p) => rank(p, ranks)));
}

// Re-reading the body under the last answer, starting from "no finite value", can only lower it.
function fixRank(fix: { name: string; body: GenDesc }, ranks: Ranks): number {
  let r = Number.POSITIVE_INFINITY;
  for (;;) {
    const next = rank(fix.body, new Map(ranks).set(fix.name, r));
    if (next >= r) return r;
    r = next;
  }
}

/**
 * Past its depth bound the runtime's generator takes, at each union or `Result`, a choice marked
 * `base` (one of least rank), so the value ends. A choice node is marked only when its choices
 * differ in rank, so a type with no recursion keeps the descriptor it always had.
 */
function boundRecursion(d: GenDesc, ranks: Ranks): GenDesc {
  const bound = (p: GenDesc): GenDesc => boundRecursion(p, ranks);
  switch (d.t) {
    case "Fix": {
      const r = fixRank(d, ranks);
      if (r === Number.POSITIVE_INFINITY) throw new NoGenerator(`"${d.name}" has no finite value`);
      return { ...d, body: boundRecursion(d.body, new Map(ranks).set(d.name, r)) };
    }
    case "Union": {
      const variants = d.variants.map((v) => ({ ...v, payloads: v.payloads.map(bound) }));
      const base = cheapest(d.variants.map((v) => deepest(v.payloads, ranks)));
      return base ? { ...d, variants, base } : { ...d, variants };
    }
    case "Result": {
      const base = cheapest([rank(d.ok, ranks), rank(d.err, ranks)]);
      const tags = base?.map((i): "Ok" | "Err" => (i === 0 ? "Ok" : "Err"));
      const parts = { ok: bound(d.ok), err: bound(d.err) };
      return tags ? { ...d, ...parts, base: tags } : { ...d, ...parts };
    }
    case "List":
    case "Set":
      return { ...d, elem: bound(d.elem) };
    case "Map":
      return { ...d, key: bound(d.key), val: bound(d.val) };
    case "Option":
      return { ...d, inner: bound(d.inner) };
    case "Record":
      return { ...d, fields: d.fields.map((f) => ({ ...f, desc: bound(f.desc) })) };
    case "Tuple":
      return { ...d, items: d.items.map(bound) };
    case "Rec":
    case "Int":
    case "Float":
    case "Text":
    case "Bool":
    case "Unit":
      return d;
    default:
      assertNever(d);
      return d;
  }
}

/** The indices of the least ranks, or `undefined` when every rank is the same. */
function cheapest(ranks: number[]): number[] | undefined {
  const least = Math.min(...ranks);
  if (ranks.every((r) => r === least)) return undefined;
  return ranks.flatMap((r, i) => (r === least ? [i] : []));
}

type Scalar = Extract<GenDesc, { t: "Int" | "Float" | "Text" }>;

/**
 * `desc` under `base` first refinements, each narrowing what the ones before it left: a bound is
 * the tighter of the two, and a `one-of` keeps only the values every refinement passes. What
 * leaves no value is refused rather than generated outside the type.
 */
function refined(desc: GenDesc, baseFirst: readonly Refinement[], shown: string): GenDesc {
  const empty = (why: string): never => {
    throw new NoGenerator(`the refinements of "${shown}" leave no value: ${why}`);
  };
  const [form, other] = [...new Set(baseFirst.map((r) => r.pred).filter(isForm))];
  if (form !== undefined && other !== undefined) {
    empty(`none is both ${FORMS[form].article} ${form} and ${FORMS[other].article} ${other}`);
  }
  let d = desc;
  for (const r of baseFirst) d = applyRefine(d, r);
  if (d.t !== "Int" && d.t !== "Float" && d.t !== "Text") return d;
  const problem = emptiness(d);
  if (problem) empty(problem);
  if (d.oneOf === undefined) return d;
  const oneOf = d.oneOf.filter((v) => baseFirst.every((r) => refinementHolds(r, v)));
  if (oneOf.length === 0) empty("no value its `one-of` lists passes the rest");
  return { ...d, oneOf };
}

type Form = NonNullable<Extract<GenDesc, { t: "Text" }>["form"]>;

/** The shortest instance of each shape, and the longest where there is one. */
const FORMS: Record<Form, { least: number; most?: number; article: string }> = {
  email: { least: 5, article: "an" },
  url: { least: 5, article: "a" },
  uuid: { least: 36, most: 36, article: "a" },
};

const isForm = (pred: string): pred is Form => Object.hasOwn(FORMS, pred);

function emptiness(d: Scalar): string | undefined {
  if (d.t !== "Text") {
    if (d.min !== undefined && d.max !== undefined && d.min > d.max) {
      return `none is at least ${d.min} and at most ${d.max}`;
    }
    return undefined;
  }
  if (d.minLen !== undefined && d.maxLen !== undefined && d.minLen > d.maxLen) {
    return `none is at least ${d.minLen} and at most ${d.maxLen} characters long`;
  }
  if (d.form === undefined) return undefined;
  const form = FORMS[d.form];
  const fits =
    (d.maxLen === undefined || d.maxLen >= form.least) &&
    (form.most === undefined || d.minLen === undefined || d.minLen <= form.most);
  if (fits) return undefined;
  const length = form.most === form.least ? `${form.least}` : `at least ${form.least}`;
  return `${form.article} ${d.form} is ${length} characters long`;
}

/** `desc` narrowed by one more refinement. A refinement that does not test it is refused. */
export function applyRefine(desc: GenDesc, r: Refinement): GenDesc {
  const n = (i: number): number => Number(r.args[i]);
  switch (r.pred) {
    case "between":
      return bounded(desc, r, n(0), n(1));
    case "positive":
      return bounded(desc, r, desc.t === "Int" ? 1 : Number.EPSILON, undefined);
    case "negative":
      return bounded(desc, r, undefined, desc.t === "Int" ? -1 : -Number.EPSILON);
    case "nonempty":
      return lengths(desc, r, 1, undefined);
    case "len-eq":
      return lengths(desc, r, n(0), n(0));
    case "len-gt":
      return lengths(desc, r, n(0) + 1, undefined);
    case "len-lt":
      return lengths(desc, r, undefined, n(0) - 1);
    case "email":
    case "url":
    case "uuid":
      return { ...textOf(desc, r), form: r.pred };
    case "one-of": {
      const choice = scalarOf(desc, r);
      const oneOf = choice.oneOf?.filter((v) => r.args.includes(v)) ?? [...r.args];
      return { ...choice, oneOf };
    }
    // A pattern has no instance the generator builds; a `one-of` beside it is still filtered by it.
    case "regex":
      return textOf(desc, r);
    default:
      throw new NoGenerator(`"${r.pred}" is not a refinement the generator knows`);
  }
}

function scalarOf(desc: GenDesc, r: Refinement): Scalar {
  if (desc.t === "Int" || desc.t === "Float" || desc.t === "Text") return desc;
  throw new NoGenerator(`"${r.pred}" does not refine a ${desc.t}`);
}

function textOf(desc: GenDesc, r: Refinement): Extract<GenDesc, { t: "Text" }> {
  const d = scalarOf(desc, r);
  if (d.t === "Text") return d;
  throw new NoGenerator(`"${r.pred}" does not refine a ${d.t}`);
}

// An `Int` holds whole numbers only, so its bounds are the whole numbers inside them.
function bounded(
  desc: GenDesc,
  r: Refinement,
  min: number | undefined,
  max: number | undefined,
): GenDesc {
  const d = scalarOf(desc, r);
  if (d.t === "Text") throw new NoGenerator(`"${r.pred}" does not refine a Text`);
  const whole = d.t === "Int";
  const lo = min === undefined ? undefined : whole ? Math.ceil(min) : min;
  const hi = max === undefined ? undefined : whole ? Math.floor(max) : max;
  return {
    ...d,
    ...(lo !== undefined && { min: d.min === undefined ? lo : Math.max(d.min, lo) }),
    ...(hi !== undefined && { max: d.max === undefined ? hi : Math.min(d.max, hi) }),
  };
}

function lengths(
  desc: GenDesc,
  r: Refinement,
  min: number | undefined,
  max: number | undefined,
): GenDesc {
  const d = textOf(desc, r);
  return {
    ...d,
    ...(min !== undefined && { minLen: d.minLen === undefined ? min : Math.max(d.minLen, min) }),
    ...(max !== undefined && { maxLen: d.maxLen === undefined ? max : Math.min(d.maxLen, max) }),
  };
}
