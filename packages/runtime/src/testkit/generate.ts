import { entryKey } from "../core.ts";
import { _jsonStr } from "./expect.ts";

/** A type's generation recipe, emitted by codegen from the `for-all` types. */
export type GenDesc =
  | { t: "Int"; min?: number; max?: number; oneOf?: (number | string)[] }
  | { t: "Float"; min?: number; max?: number; oneOf?: (number | string)[] }
  | {
      t: "Text";
      minLen?: number;
      maxLen?: number;
      /** A refined shape to build an instance of, rather than free text. */
      form?: "email" | "url" | "uuid";
      oneOf?: (number | string)[];
    }
  | { t: "Bool" }
  | { t: "Unit" }
  | { t: "List"; elem: GenDesc }
  | { t: "Set"; elem: GenDesc }
  | { t: "Map"; key: GenDesc; val: GenDesc }
  | { t: "Option"; inner: GenDesc }
  /** `base`: the outcomes to take past the recursion depth bound ({@link GEN_DEPTH}). */
  | { t: "Result"; ok: GenDesc; err: GenDesc; base?: ("Ok" | "Err")[] }
  | { t: "Record"; fields: { name: string; desc: GenDesc }[] }
  | { t: "Tuple"; items: GenDesc[] }
  /** `base`: the variants (by index) to take past the recursion depth bound. */
  | { t: "Union"; variants: { name: string; payloads: GenDesc[] }[]; base?: number[] }
  /** A recursive type: inside `body`, `{t: "Rec", name}` is a step back into it. */
  | { t: "Fix"; name: string; body: GenDesc }
  | { t: "Rec"; name: string };

/** Deterministic PRNG (mulberry32) so a failing property reproduces exactly. */
export function _rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function _hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const _GEN_ASCII = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 ";

/** A value of one of the shapes `email` / `url` / `uuid` refine to. */
function genForm(form: "email" | "url" | "uuid", rng: () => number): string {
  const hex = (n: number): string => {
    let s = "";
    for (let i = 0; i < n; i++) s += "0123456789abcdef"[Math.floor(rng() * 16)];
    return s;
  };
  const word = (n: number): string => {
    let s = "";
    for (let i = 0; i < n; i++) s += "abcdefghijklmnopqrstuvwxyz"[Math.floor(rng() * 26)];
    return s;
  };
  if (form === "uuid") return `${hex(8)}-${hex(4)}-${hex(4)}-${hex(4)}-${hex(12)}`;
  if (form === "email") return `${word(6)}@${word(6)}.example.com`;
  return `https://${word(6)}.example.com/${word(4)}`;
}

// Every value in a shape passes the runtime's own check for the form, so a shrunk form stays one.
const FORM_SHAPES: Record<"email" | "url" | "uuid", RegExp> = {
  email: /^[a-z]+@[a-z]+\.example\.com$/,
  url: /^https:\/\/[a-z]+\.example\.com\/[a-z]+$/,
  uuid: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
};

// `one-of` names the whole domain, whatever the base type is, so it is answered ahead of the type it refines.
function choicesOf(desc: GenDesc): (number | string)[] | undefined {
  return "oneOf" in desc && desc.oneOf && desc.oneOf.length > 0 ? desc.oneOf : undefined;
}

type ScalarDesc = Extract<GenDesc, { t: "Int" | "Float" | "Text" }>;

/**
 * Whether `v` is in the domain `desc` declares, read from the fields generation builds to. The
 * spans an unbounded type is sampled from (±1000, 50 characters) are not part of the domain.
 */
function admits(desc: ScalarDesc, v: unknown): boolean {
  const choices = choicesOf(desc);
  if (choices) return choices.includes(v as number | string);
  if (desc.t === "Text") {
    return (
      typeof v === "string" &&
      v.length >= (desc.minLen ?? 0) &&
      v.length <= (desc.maxLen ?? Number.POSITIVE_INFINITY) &&
      (desc.form === undefined || FORM_SHAPES[desc.form].test(v))
    );
  }
  return (
    typeof v === "number" &&
    (desc.t === "Float" || Number.isInteger(v)) &&
    v >= (desc.min ?? Number.NEGATIVE_INFINITY) &&
    v <= (desc.max ?? Number.POSITIVE_INFINITY)
  );
}

/**
 * How many steps into a recursive type generation takes freely. Past it every choice takes the way
 * that ends soonest (a `base` choice, `None`, an empty collection), so the value ends.
 */
const GEN_DEPTH = 4;

/** The recursive types entered on the way to a descriptor, by name, and how many steps deep. */
type GenScope = { types: ReadonlyMap<string, GenDesc>; depth: number };

const GEN_TOP: GenScope = { types: new Map(), depth: 0 };

export function genValue(desc: GenDesc, rng: () => number, scope: GenScope = GEN_TOP): unknown {
  const choices = choicesOf(desc);
  if (choices) return choices[Math.floor(rng() * choices.length)];
  const gen = (d: GenDesc): unknown => genValue(d, rng, scope);
  const ending = scope.depth >= GEN_DEPTH;
  switch (desc.t) {
    case "Int": {
      const lo = desc.min ?? -1000;
      const hi = desc.max ?? 1000;
      return lo + Math.floor(rng() * (hi - lo + 1));
    }
    case "Float": {
      const lo = desc.min ?? -1000;
      const hi = desc.max ?? 1000;
      return lo + rng() * (hi - lo);
    }
    case "Text": {
      if (desc.form) return genForm(desc.form, rng);
      const minLen = desc.minLen ?? 0;
      const maxLen = desc.maxLen ?? 50;
      const len = minLen + Math.floor(rng() * (maxLen - minLen + 1));
      let s = "";
      for (let i = 0; i < len; i++) s += _GEN_ASCII[Math.floor(rng() * _GEN_ASCII.length)];
      return s;
    }
    case "Bool":
      return rng() < 0.5;
    case "Unit":
      return null;
    case "List": {
      const n = ending ? 0 : Math.floor(rng() * 11);
      const a: unknown[] = [];
      for (let i = 0; i < n; i++) a.push(gen(desc.elem));
      return a;
    }
    // Keyed the way `add` / `insert` key a member, so a lookup in the program under test finds it.
    case "Set": {
      const n = ending ? 0 : Math.floor(rng() * 11);
      const o: Record<string, true> = {};
      for (let i = 0; i < n; i++) o[entryKey(gen(desc.elem))] = true;
      return o;
    }
    case "Map": {
      const n = ending ? 0 : Math.floor(rng() * 11);
      const o: Record<string, unknown> = {};
      for (let i = 0; i < n; i++) o[entryKey(gen(desc.key))] = gen(desc.val);
      return o;
    }
    case "Option":
      return ending || rng() < 0.5 ? { _tag: "None" } : { _tag: "Some", _0: gen(desc.inner) };
    case "Result": {
      const tag =
        ending && desc.base
          ? desc.base[Math.floor(rng() * desc.base.length)]
          : rng() < 0.5
            ? "Ok"
            : "Err";
      return tag === "Ok" ? { _tag: "Ok", _0: gen(desc.ok) } : { _tag: "Err", _0: gen(desc.err) };
    }
    case "Record": {
      const o: Record<string, unknown> = {};
      for (const f of desc.fields) o[f.name] = gen(f.desc);
      return o;
    }
    case "Tuple":
      return desc.items.map(gen);
    case "Union": {
      const choices = ending && desc.base ? desc.base.map((i) => desc.variants[i]) : desc.variants;
      const v = choices[Math.floor(rng() * choices.length)];
      if (!v) throw new Error("no generator for a union with no variant to take");
      const node: Record<string, unknown> = { _tag: v.name };
      v.payloads.forEach((p, i) => {
        node[`_${i}`] = gen(p);
      });
      return node;
    }
    case "Fix":
      return genValue(desc.body, rng, {
        types: new Map(scope.types).set(desc.name, desc.body),
        depth: scope.depth,
      });
    case "Rec": {
      const body = scope.types.get(desc.name);
      if (!body) {
        throw new Error(
          `no generator for "${desc.name}": no recursive type of that name encloses it`,
        );
      }
      return genValue(body, rng, { types: scope.types, depth: scope.depth + 1 });
    }
    default:
      throw new Error(`no generator for the descriptor ${_jsonStr(desc)}`);
  }
}

/**
 * Values "simpler" than `v` that are still values of `desc`, simplest first. A candidate outside
 * the type would be one the generator never produces, which a slot may refuse, so the
 * counterexample reported would be one no generated trial was run on.
 */
function shrinkCandidates(
  v: unknown,
  desc: GenDesc,
  types: ReadonlyMap<string, GenDesc>,
): unknown[] {
  const choices = choicesOf(desc);
  if (choices) {
    const at = choices.indexOf(v as number | string);
    return at > 0 ? choices.slice(0, at) : [];
  }
  switch (desc.t) {
    case "Int":
    case "Float": {
      if (typeof v !== "number") return [];
      const target = Math.min(
        Math.max(0, desc.min ?? Number.NEGATIVE_INFINITY),
        desc.max ?? Number.POSITIVE_INFINITY,
      );
      if (v === target) return [];
      const half = target + Math.trunc((v - target) / 2);
      return (half === target ? [target] : [target, half]).filter((c) => admits(desc, c));
    }
    case "Text": {
      if (typeof v !== "string") return [];
      const out = new Set([
        v.slice(0, desc.minLen ?? 0),
        v.slice(0, Math.max(desc.minLen ?? 0, Math.floor(v.length / 2))),
      ]);
      // One character shorter is how a form shortens a word and keeps its literal parts.
      if (desc.form) for (let i = 0; i < v.length; i++) out.add(v.slice(0, i) + v.slice(i + 1));
      out.delete(v);
      return [...out].filter((c) => admits(desc, c));
    }
    case "List":
      if (!Array.isArray(v) || v.length === 0) return [];
      return [[], ...v.map((_, i) => [...v.slice(0, i), ...v.slice(i + 1)])];
    case "Set":
    case "Map": {
      if (!v || typeof v !== "object") return [];
      const o = v as Record<string, unknown>;
      const keys = Object.keys(o);
      if (keys.length === 0) return [];
      return [
        {},
        ...keys.map((k) => {
          const cp = { ...o };
          delete cp[k];
          return cp;
        }),
      ];
    }
    case "Option":
      return (v as { _tag?: unknown } | null)?._tag === "Some" ? [{ _tag: "None" }] : [];
    case "Record": {
      if (!v || typeof v !== "object") return [];
      const o = v as Record<string, unknown>;
      return desc.fields.flatMap((f) =>
        shrinkCandidates(o[f.name], f.desc, types).map((c) => ({ ...o, [f.name]: c })),
      );
    }
    case "Tuple":
      if (!Array.isArray(v)) return [];
      return desc.items.flatMap((d, i) =>
        shrinkCandidates(v[i], d, types).map((c) => v.map((x, j) => (j === i ? c : x))),
      );
    case "Fix":
      return shrinkCandidates(v, desc.body, new Map(types).set(desc.name, desc.body));
    case "Rec": {
      const body = types.get(desc.name);
      return body ? shrinkCandidates(v, body, types) : [];
    }
    default:
      return [];
  }
}

/** Greedily minimize a failing binding set, holding each var's failure. */
export function shrinkCounterexample(
  vars: Record<string, GenDesc>,
  fails: (b: Record<string, unknown>) => boolean,
  binds: Record<string, unknown>,
): Record<string, unknown> {
  let cur = { ...binds };
  let improved = true;
  let guard = 0;
  while (improved && guard++ < 1000) {
    improved = false;
    for (const k of Object.keys(vars)) {
      for (const cand of shrinkCandidates(cur[k], vars[k] as GenDesc, new Map())) {
        const next = { ...cur, [k]: cand };
        if (fails(next)) {
          cur = next;
          improved = true;
          break;
        }
      }
    }
  }
  return cur;
}
