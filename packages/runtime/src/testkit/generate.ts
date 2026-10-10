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
  | { t: "List"; elem: GenDesc }
  | { t: "Set"; elem: GenDesc }
  | { t: "Map"; key: GenDesc; val: GenDesc }
  | { t: "Option"; inner: GenDesc }
  | { t: "Result"; ok: GenDesc; err: GenDesc }
  | { t: "Record"; fields: { name: string; desc: GenDesc }[] }
  | { t: "Union"; variants: { name: string; payloads: GenDesc[] }[] }
  | { t: "Unknown" };

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

export function genValue(desc: GenDesc, rng: () => number): unknown {
  // `one-of` names the whole domain, whatever the base type is, so it is answered ahead of the type it refines.
  if ("oneOf" in desc && desc.oneOf && desc.oneOf.length > 0) {
    return desc.oneOf[Math.floor(rng() * desc.oneOf.length)];
  }
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
    case "List": {
      const n = Math.floor(rng() * 11);
      const a: unknown[] = [];
      for (let i = 0; i < n; i++) a.push(genValue(desc.elem, rng));
      return a;
    }
    case "Set": {
      const n = Math.floor(rng() * 11);
      const o: Record<string, true> = {};
      for (let i = 0; i < n; i++) o[String(genValue(desc.elem, rng))] = true;
      return o;
    }
    case "Map": {
      const n = Math.floor(rng() * 11);
      const o: Record<string, unknown> = {};
      for (let i = 0; i < n; i++) o[String(genValue(desc.key, rng))] = genValue(desc.val, rng);
      return o;
    }
    case "Option":
      return rng() < 0.5 ? { _tag: "None" } : { _tag: "Some", _0: genValue(desc.inner, rng) };
    case "Result":
      return rng() < 0.5
        ? { _tag: "Ok", _0: genValue(desc.ok, rng) }
        : { _tag: "Err", _0: genValue(desc.err, rng) };
    case "Record": {
      const o: Record<string, unknown> = {};
      for (const f of desc.fields) o[f.name] = genValue(f.desc, rng);
      return o;
    }
    case "Union": {
      const v = desc.variants[Math.floor(rng() * desc.variants.length)];
      if (!v) return null;
      const node: Record<string, unknown> = { _tag: v.name };
      v.payloads.forEach((p, i) => {
        node[`_${i}`] = genValue(p, rng);
      });
      return node;
    }
    default:
      return null;
  }
}

/** Candidate values "simpler" than `v`, for shrinking a counterexample. */
function _shrink(v: unknown): unknown[] {
  if (typeof v === "number") {
    if (v === 0) return [];
    const half = Math.trunc(v / 2);
    return half === 0 ? [0] : [0, half];
  }
  if (typeof v === "string") {
    if (v === "") return [];
    return ["", v.slice(0, Math.floor(v.length / 2))];
  }
  if (Array.isArray(v)) {
    if (v.length === 0) return [];
    const out: unknown[] = [[]];
    for (let i = 0; i < v.length; i++) out.push([...v.slice(0, i), ...v.slice(i + 1)]);
    return out;
  }
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    if ("_tag" in o) return o._tag === "Some" ? [{ _tag: "None" }] : [];
    const keys = Object.keys(o);
    if (keys.length === 0) return [];
    const out: unknown[] = [{}];
    for (const k of keys) {
      const cp = { ...o };
      delete cp[k];
      out.push(cp);
    }
    return out;
  }
  return [];
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
      for (const cand of _shrink(cur[k])) {
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
