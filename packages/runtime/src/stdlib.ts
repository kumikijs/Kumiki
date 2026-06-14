// Kumiki stdlib (#71): the collection / value helpers that codegen lowers
// `_s.*` calls to (docs/spec/stdlib.md §2.2). This is the PRODUCTION slice —
// the reducer-test / property-test harness lives in `testkit.ts` and is merged
// into the classic `_stdlib` export by `index.ts`, so `kumiki build` output
// never ships the test runners.

import { KumikiPanic } from "./core.ts";

export const _stdlibCore = {
  mapSize(m: unknown): number {
    if (m instanceof Map) return m.size;
    if (m && typeof m === "object") return Object.keys(m as object).length;
    return 0;
  },
  mapKeys(m: Record<string, unknown> | undefined | null): string[] {
    return m ? Object.keys(m) : [];
  },
  mapValues(m: Record<string, unknown> | undefined | null): unknown[] {
    return m ? Object.values(m) : [];
  },
  mapEntries(m: Record<string, unknown> | undefined | null): unknown[] {
    return m ? Object.entries(m) : [];
  },
  mapGet(m: Record<string, unknown> | undefined | null, k: string): unknown {
    return m ? m[k] : undefined;
  },
  /** Polymorphic `.get-or(default)` for Option-like values. */
  getOr(v: unknown, fallback: unknown): unknown {
    if (v && typeof v === "object" && "_tag" in (v as Record<string, unknown>)) {
      const tagged = v as { _tag: string; _0?: unknown };
      if (tagged._tag === "Some" || tagged._tag === "Ok") {
        return tagged._0;
      }
      if (tagged._tag === "None" || tagged._tag === "Err") {
        return fallback;
      }
    }
    return v ?? fallback;
  },
  mapGetOr(m: Record<string, unknown> | undefined | null, k: string, def: unknown): unknown {
    if (m && k in m) return m[k];
    return def;
  },
  mapInsert(m: Record<string, unknown>, k: string, v: unknown): Record<string, unknown> {
    return { ...m, [k]: v };
  },
  mapRemove(m: Record<string, unknown>, k: string): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [kk, vv] of Object.entries(m ?? {})) if (kk !== k) out[kk] = vv;
    return out;
  },
  mapFilter(
    m: Record<string, unknown>,
    pred: (k: string, v: unknown) => boolean,
  ): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(m ?? {})) if (pred(k, v)) out[k] = v;
    return out;
  },
  /**
   * Polymorphic `.filter` dispatch — used by codegen when the receiver type
   * isn't statically known (e.g. `m.keys.filter(...)` vs `m.filter(...)`).
   * Arrays go through Array.prototype.filter; objects (Maps in Kumiki) fall
   * back to the (k, v) → boolean predicate of mapFilter.
   */
  filter(coll: unknown, pred: (...args: unknown[]) => boolean): unknown {
    if (Array.isArray(coll)) return coll.filter((x) => pred(x));
    if (coll && typeof coll === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(coll as Record<string, unknown>)) {
        if (pred(k, v)) out[k] = v;
      }
      return out;
    }
    return [];
  },
  listSize(xs: unknown[]): number {
    return xs?.length ?? 0;
  },
  listFilter<T>(xs: T[], pred: (x: T) => boolean): T[] {
    return (xs ?? []).filter(pred);
  },
  listMap<T, U>(xs: T[], fn: (x: T) => U): U[] {
    return (xs ?? []).map(fn);
  },
  /** Polymorphic `.map`: over List elements, or over Option/Result Some/Ok. */
  mapOver(coll: unknown, fn: (x: unknown) => unknown): unknown {
    if (Array.isArray(coll)) return coll.map(fn);
    if (coll && typeof coll === "object" && "_tag" in (coll as Record<string, unknown>)) {
      const tagged = coll as { _tag: string; _0?: unknown };
      if (tagged._tag === "Some") return { _tag: "Some", _0: fn(tagged._0) };
      if (tagged._tag === "Ok") return { _tag: "Ok", _0: fn(tagged._0) };
      return coll; // None / Err pass through
    }
    return coll == null ? [] : fn(coll);
  },
  /** Option(T).flat-map(f): Some(v) -> f(v), None -> None. f returns an Option. */
  flatMapOption(opt: unknown, fn: (x: unknown) => unknown): unknown {
    if (opt && typeof opt === "object" && "_tag" in (opt as Record<string, unknown>)) {
      const tagged = opt as { _tag: string; _0?: unknown };
      if (tagged._tag === "Some" || tagged._tag === "Ok") return fn(tagged._0);
      return opt; // None / Err pass through
    }
    return _stdlibCore.None;
  },
  listSortBy<T>(xs: T[], keyOf: (x: T) => number): T[] {
    return [...(xs ?? [])].sort((a, b) => keyOf(a) - keyOf(b));
  },
  /** List(T).fold(init, expr): left fold with $1=acc, $2=elem. */
  listFold<T, A>(xs: T[], init: A, fn: (acc: A, x: T) => A): A {
    let acc = init;
    for (const x of xs ?? []) acc = fn(acc, x);
    return acc;
  },
  setHas(s: Record<string, true> | undefined, x: unknown): boolean {
    return !!s && String(x) in s;
  },
  setToggle(s: Record<string, true> | undefined, x: unknown): Record<string, true> {
    const k = String(x);
    const cur = { ...(s ?? {}) };
    if (k in cur) {
      delete cur[k];
      return cur;
    }
    cur[k] = true;
    return cur;
  },
  add(a: unknown, b: unknown): unknown {
    if (typeof a === "string" || typeof b === "string") return String(a) + String(b);
    return (a as number) + (b as number);
  },
  show(v: unknown): string {
    if (v === null || v === undefined) return "";
    if (typeof v === "object" && v && "_tag" in v) {
      const obj = v as { _tag: string };
      return obj._tag;
    }
    return String(v);
  },
  eq(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (a == null || b == null) return false;
    if (typeof a === "object" && typeof b === "object") {
      const ao = a as { _tag?: string };
      const bo = b as { _tag?: string };
      if (ao._tag !== undefined || bo._tag !== undefined) {
        if (ao._tag !== bo._tag) return false;
        for (const k of Object.keys(ao)) {
          if (!Object.is((ao as Record<string, unknown>)[k], (bo as Record<string, unknown>)[k])) {
            return false;
          }
        }
        return true;
      }
    }
    return false;
  },
  freshId(): string {
    const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
    if (c?.randomUUID) return c.randomUUID();
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
  },
  now(): number {
    return Date.now();
  },
  recordCopy(
    rec: Record<string, unknown>,
    patch: Record<string, unknown>,
  ): Record<string, unknown> {
    return { ...rec, ...patch };
  },
  /**
   * `.get` — the polymorphic unwrap for Option AND Result. Per docs/spec/stdlib.md
   * §2.2 it PANICS on the empty case (`None` / `Err`); `Some(v)` / `Ok(v)`
   * unwrap to `v`. A plain (non-variant) value passes through unchanged.
   */
  unwrap(opt: unknown): unknown {
    if (opt && typeof opt === "object" && "_tag" in opt) {
      const o = opt as { _tag: string; _0?: unknown };
      if (o._tag === "Some" || o._tag === "Ok") return o._0;
      if (o._tag === "None") throw new KumikiPanic("get called on None");
      if (o._tag === "Err") throw new KumikiPanic("get called on an Err value");
    }
    return opt;
  },
  /** `panic(message)` — raise Kumiki's controlled stop-the-program signal. */
  panic(message: unknown): never {
    throw new KumikiPanic(String(message));
  },
  optionGetOr(opt: unknown, def: unknown): unknown {
    if (opt && typeof opt === "object" && "_tag" in opt) {
      const o = opt as { _tag: string; _0?: unknown };
      if (o._tag === "Some") return o._0;
      if (o._tag === "None") return def;
    }
    return opt ?? def;
  },
  Some(v: unknown): { _tag: "Some"; _0: unknown } {
    return { _tag: "Some", _0: v };
  },
  None: { _tag: "None" as const },
  Ok(v: unknown): { _tag: "Ok"; _0: unknown } {
    return { _tag: "Ok", _0: v };
  },
  Err(v: unknown): { _tag: "Err"; _0: unknown } {
    return { _tag: "Err", _0: v };
  },
  variant(tag: string, ...args: unknown[]): { _tag: string; [k: string]: unknown } {
    const o: { _tag: string; [k: string]: unknown } = { _tag: tag };
    args.forEach((a, i) => {
      o[`_${i}`] = a;
    });
    return o;
  },
  variantIs(v: unknown, tag: string): boolean {
    return !!v && typeof v === "object" && "_tag" in v && (v as { _tag: string })._tag === tag;
  },

  // ----- Issue #5: collection / value helpers for the stdlib methods that the
  // codegen now lowers to `_s.*` calls. See docs/spec/stdlib.md §2.2. -----

  /** List(T).chunk(n) → List(List(T)). The last chunk may be shorter. */
  listChunk(xs: unknown[] | undefined | null, n: number): unknown[] {
    const arr = xs ?? [];
    const size = Math.max(1, Math.floor(n));
    const out: unknown[] = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
  },
  /** List(T).zip(other) → List(Tuple(T, U)); truncates to the shorter list. */
  listZip(a: unknown[] | undefined | null, b: unknown[] | undefined | null): unknown[] {
    const xs = a ?? [];
    const ys = b ?? [];
    const n = Math.min(xs.length, ys.length);
    const out: unknown[] = [];
    for (let i = 0; i < n; i++) out.push([xs[i], ys[i]]);
    return out;
  },
  /** Map(K,V).update(k, fn): apply fn to the current value of k, no-op if absent. */
  mapUpdate(
    m: Record<string, unknown> | undefined | null,
    k: string,
    fn: (v: unknown) => unknown,
  ): Record<string, unknown> {
    const obj = m ?? {};
    if (!(k in obj)) return obj;
    return { ...obj, [k]: fn(obj[k]) };
  },
  /** Set(T).add(x). Sets are stored as `{ [String(x)]: true }`. */
  setAdd(s: Record<string, true> | undefined | null, x: unknown): Record<string, true> {
    return { ...(s ?? {}), [String(x)]: true };
  },
  /** Set(T).union(other). */
  setUnion(
    a: Record<string, true> | undefined | null,
    b: Record<string, true> | undefined | null,
  ): Record<string, true> {
    return { ...(a ?? {}), ...(b ?? {}) };
  },
  /** Set(T).intersect(other) — keys present in both. */
  setIntersect(
    a: Record<string, true> | undefined | null,
    b: Record<string, true> | undefined | null,
  ): Record<string, true> {
    const bb = b ?? {};
    const out: Record<string, true> = {};
    for (const k of Object.keys(a ?? {})) if (k in bb) out[k] = true;
    return out;
  },
  /** Set(T).diff(other) — keys in a not in b. */
  setDiff(
    a: Record<string, true> | undefined | null,
    b: Record<string, true> | undefined | null,
  ): Record<string, true> {
    const bb = b ?? {};
    const out: Record<string, true> = {};
    for (const k of Object.keys(a ?? {})) if (!(k in bb)) out[k] = true;
    return out;
  },
  /** Option(T).or / Result(T,E).or — receiver when Some/Ok, else `other`. */
  or(v: unknown, other: unknown): unknown {
    if (v && typeof v === "object" && "_tag" in (v as Record<string, unknown>)) {
      const tag = (v as { _tag: string })._tag;
      if (tag === "Some" || tag === "Ok") return v;
      if (tag === "None" || tag === "Err") return other;
    }
    return v ?? other;
  },
  /** Result(T,E).map-err(fn) — maps the Err payload, passes Ok through unchanged. */
  mapErr(r: unknown, fn: (e: unknown) => unknown): unknown {
    if (r && typeof r === "object" && "_tag" in (r as Record<string, unknown>)) {
      const t = r as { _tag: string; _0?: unknown };
      if (t._tag === "Err") return { _tag: "Err", _0: fn(t._0) };
    }
    return r;
  },
  /** Polymorphic `.diff`: numeric magnitude (Time/Duration) or Set difference. */
  diff(a: unknown, b: unknown): unknown {
    if (typeof a === "number" || typeof b === "number") {
      return Math.abs((a as number) - (b as number));
    }
    return _stdlibCore.setDiff(a as Record<string, true>, b as Record<string, true>);
  },

  // ----- Issue #7: argument-less spec stdlib methods (docs/spec/stdlib.md §2.2).
  // Callable both parenthesis-free (`xs.head`) and parenthesized (`xs.head()`);
  // codegen lowers both shapes to these. -----

  /** List(T).head → Option(T). */
  listHead(xs: unknown[] | undefined | null): unknown {
    const a = xs ?? [];
    return a.length > 0 ? _stdlibCore.Some(a[0]) : _stdlibCore.None;
  },
  /** List(T).tail → List(T) (all but the first; empty list stays empty). */
  listTail(xs: unknown[] | undefined | null): unknown[] {
    return (xs ?? []).slice(1);
  },
  /** List(T).last → Option(T). */
  listLast(xs: unknown[] | undefined | null): unknown {
    const a = xs ?? [];
    return a.length > 0 ? _stdlibCore.Some(a[a.length - 1]) : _stdlibCore.None;
  },
  /** Set(T).to-list / Option(T).to-list → List(T). */
  toList(v: unknown): unknown[] {
    if (v && typeof v === "object" && "_tag" in (v as Record<string, unknown>)) {
      // Option: Some(x) → [x], None → [].
      const o = v as { _tag: string; _0?: unknown };
      return o._tag === "Some" ? [o._0] : [];
    }
    // Return a fresh copy so the result never aliases a slot array, matching
    // listHead/listTail/listLast which all produce new values.
    if (Array.isArray(v)) return [...v];
    // Set is stored as `{ [key]: true }` (keys are stringified, like the other set ops).
    if (v && typeof v === "object") return Object.keys(v as Record<string, unknown>);
    return [];
  },
  /** Result(T,E).get-err → E; panics (KumikiPanic) if the value is Ok. */
  getErr(r: unknown): unknown {
    if (r && typeof r === "object" && "_tag" in (r as Record<string, unknown>)) {
      const t = r as { _tag: string; _0?: unknown };
      if (t._tag === "Err") return t._0;
    }
    throw new KumikiPanic("get-err called on a non-Err value");
  },
  /** Result(T,E).to-option → Option(T): Ok(v) → Some(v), Err(_) → None. */
  toOption(r: unknown): unknown {
    if (r && typeof r === "object" && "_tag" in (r as Record<string, unknown>)) {
      const t = r as { _tag: string; _0?: unknown };
      if (t._tag === "Ok") return _stdlibCore.Some(t._0);
    }
    return _stdlibCore.None;
  },
  /** Text.parse-int → Option(Int) (truncates; mirrors `Int.parse`). */
  parseIntOpt(s: unknown): unknown {
    const n = Number(s);
    return String(s).trim() !== "" && Number.isFinite(n)
      ? _stdlibCore.Some(Math.trunc(n))
      : _stdlibCore.None;
  },
  /** Text.parse-float → Option(Float) (mirrors `Float.parse`). */
  parseFloatOpt(s: unknown): unknown {
    const n = Number(s);
    return String(s).trim() !== "" && Number.isFinite(n) ? _stdlibCore.Some(n) : _stdlibCore.None;
  },
};
