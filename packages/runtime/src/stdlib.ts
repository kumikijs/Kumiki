// Kumiki stdlib (#71): the collection / value helpers that codegen lowers
// `_s.*` calls to (docs/spec/stdlib.md §2.2). This is the PRODUCTION slice —
// the reducer-test / property-test harness lives in `testkit.ts` and is merged
// into the classic `_stdlib` export by `index.ts`, so `kumiki build` output
// never ships the test runners.

import {
  _setPathHelper,
  isPanic,
  KumikiPanic,
  type PathSegment,
  panicInfo,
  type RefinementRejection,
  refinementRejectionOf,
  tokenRef,
} from "./core.ts";

/**
 * The millisecond instant a `Time`-shaped value denotes, or `NaN`.
 *
 * A blank — `null`, `undefined`, `""`, whitespace — is not zero here. `Number`
 * says it is, and the epoch is a date that looks real, which is the worst
 * thing an absent field can render as.
 */
function instantOf(value: unknown): number {
  const raw = String(value ?? "").trim();
  if (raw === "") return Number.NaN;
  const n = Number(raw);
  if (Number.isFinite(n)) return n;
  const parsed = _stdlibCore.parseTime(raw);
  return parsed._tag === "Some" ? (parsed._0 as number) : Number.NaN;
}

export const _stdlibCore = {
  /**
   * Record a slot write against its refinement and return the value unchanged
   * (runtime.md §10.3.3). Codegen wraps every assignment to a refined slot, so
   * the check happens *per write* rather than on the batch's final value —
   * without it a `for` loop whose slot leaves and re-enters its range would
   * pass, and the intermediate value it computed with is readable by later
   * statements exactly like a committed one.
   *
   * The value is returned regardless: the body keeps evaluating, but the batch
   * is already doomed and nothing it produces will be applied.
   */
  slotWrite(
    metas: Record<
      string,
      { refine?: (v: unknown) => boolean; refineKind?: string; refineArgs?: unknown }
    >,
    rejected: RefinementRejection[],
    name: string,
    value: unknown,
  ): unknown {
    const meta = metas[name];
    if (meta?.refine && !meta.refine(value))
      rejected.push(refinementRejectionOf(name, value, meta));
    return value;
  },
  /**
   * Resolve a theme-token reference `@<group>.<seg>(.<seg>)*` from a `style`
   * block (spec/style.md §4.3). Codegen lowers `@colors.surface` to
   * `_s.token("colors", ["surface"])`.
   */
  token(group: string, path: string[]): string {
    return tokenRef(group, path);
  },
  /**
   * `Time.parse(text)` (stdlib.md §2.2.8) — `Some(ms)`, or `None` for text that
   * names no instant.
   *
   * A **date-only** string is read as LOCAL midnight, not the UTC midnight
   * `Date.parse` gives it. `format` renders local fields, so the UTC reading
   * round-trips to the day before west of Greenwich: `"2026-08-14"` from a
   * `type="date"` input would come back as `2026-08-13` in Los Angeles. The two
   * halves have to agree on which clock a zone-less string is on, and the one
   * the reader is looking at is the only defensible answer.
   */
  parseTime(text: unknown): { _tag: "Some"; _0: unknown } | { _tag: "None" } {
    // No early return for a blank: `Date.parse("")` is already NaN, and a
    // branch that cannot change an answer is a branch the next reader has to
    // re-derive.
    const raw = String(text ?? "").trim();
    const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
    const ms = dateOnly
      ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3])).getTime()
      : Date.parse(raw);
    return Number.isFinite(ms) ? _stdlibCore.Some(ms) : _stdlibCore.None;
  },
  /**
   * `Time.format(pattern)` (stdlib.md §2.2.8). A `Time` is a millisecond
   * number, and the pattern is a template: `yyyy MM dd HH mm ss` are replaced
   * by the fields of that instant and everything else is copied through, so
   * `"yyyy-MM-dd HH:mm"` and `"dd/MM/yyyy"` both work.
   *
   * **Local time.** The string has no zone in it, so it is read as the reader's
   * wall clock. Rendering UTC fields instead would show the wrong day to
   * everyone whose local date differs from the UTC one at that moment — after
   * midnight east of Greenwich, and in the evening west of it.
   */
  formatTime(ms: unknown, pattern: unknown): string {
    // A `Time` is a millisecond number, and everything the compiler produces
    // is one. It can still arrive as text from outside the language — a JSON
    // payload mapped into a `Time` field, or state persisted by a build whose
    // `Time.parse` stored the string it was given. Reading those rather than
    // rendering a NaN date is the difference between a date and a bug report.
    //
    // `null`, `""` and other blanks are NOT 1970: `Number(null)` is 0, so
    // taking the numeric branch first would render the epoch for a field that
    // is simply absent — a date that looks real. Those, and text that names no
    // instant, render as NaN where they can be seen.
    const d = new Date(instantOf(ms));
    const p = typeof pattern === "string" ? pattern : String(pattern ?? "");
    const pad = (n: number, width = 2): string => String(n).padStart(width, "0");
    const fields: Record<string, string> = {
      yyyy: pad(d.getFullYear(), 4),
      MM: pad(d.getMonth() + 1),
      dd: pad(d.getDate()),
      HH: pad(d.getHours()),
      mm: pad(d.getMinutes()),
      ss: pad(d.getSeconds()),
    };
    // One pass over the whole pattern: replacing token by token would let the
    // digits of an earlier substitution match a later token.
    return p.replace(/yyyy|MM|dd|HH|mm|ss/g, (tok) => fields[tok] ?? tok);
  },
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
  /**
   * `List(T).sort` — polymorphic. Numeric elements sort numerically (so
   * `[3,1,2,10].sort` → `[1,2,3,10]`, not the JS default `[1,10,2,3]`); any
   * other element type falls back to a stable string comparison. Mixed lists
   * are sorted as strings so the result stays well-defined.
   */
  listSort(xs: unknown[] | undefined | null): unknown[] {
    const arr = [...(xs ?? [])];
    if (arr.length === 0) return arr;
    const allNumbers = arr.every((x) => typeof x === "number" && Number.isFinite(x));
    if (allNumbers) return (arr as number[]).sort((a, b) => a - b);
    return arr.sort((a, b) => {
      const sa = String(a);
      const sb = String(b);
      return sa < sb ? -1 : sa > sb ? 1 : 0;
    });
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
  /**
   * The setter a reducer's assignment lowers to. Shares its implementation
   * with `bind=` write-back, so `draft.get.title := v` and
   * `bind=draft.get.title` mean the same thing.
   */
  setPath(obj: unknown, path: readonly PathSegment[], value: unknown): unknown {
    return _setPathHelper(obj, path, value);
  },
  /** `panic(message)` — raise Kumiki's controlled stop-the-program signal. */
  panic(message: unknown): never {
    throw new KumikiPanic(String(message));
  },
  /**
   * What a tile's `error-boundary` hands its fallback — and what it refuses to
   * take (lifecycle.md §7.3).
   *
   * A boundary catches a **panic**: the controlled signal §7.2.2 defines, which
   * `panic(message)` and the polymorphic `.get` raise. Anything else reaching
   * the `catch` is a defect in the generated code or in the runtime — a
   * `ReferenceError` from a binding nothing supplied, `_wk`'s deliberate throw
   * on a key that would collapse two tiles onto one identity — and a fallback
   * that swallowed one would turn a failure into a rendered page: `smoke` and
   * `scenario` verify through the error channel, so the defect would leave no
   * trace at all. Those are re-thrown for the render bailout to report.
   *
   * The payload is the shape `app.error` already receives (`handleLivePanic`),
   * built by the same `panicInfo`, so the two ways a panic reaches a program
   * agree — and so an empty message stays empty instead of stringifying the
   * error object.
   */
  boundaryPanic(e: unknown, location: string): Record<string, unknown> {
    if (!isPanic(e)) throw e;
    const rec = panicInfo(e, "tile-render");
    return { message: rec.message, location, category: rec.category };
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
  /**
   * `file-url(file)` — URL.createObjectURL equivalent (forms.md §5.10). The
   * runtime stores picked files as `{name, size, type, _file: File}`; this
   * helper unwraps `_file` and hands it to URL.createObjectURL.
   *
   * Memoised on the File handle and registered for revocation on GC so that
   * (a) repeated renders of the same `image(src=file-url(...))` reuse one
   * blob URL and (b) when the picker slot is replaced and the old File
   * becomes unreachable, the URL is released without manual bookkeeping in
   * user code. The spec calls this out as "automatic release".
   *
   * Passing undefined / None / a value with no `_file` returns "" so a
   * render that races a slot clear cannot blow up.
   */
  fileUrl(file: unknown): string {
    if (!file || typeof file !== "object") return "";
    const tagged = file as { _tag?: string; _0?: unknown };
    const inner = tagged._tag === "Some" ? tagged._0 : file;
    if (!inner || typeof inner !== "object") return "";
    const handle = (inner as { _file?: unknown })._file;
    if (
      typeof URL === "undefined" ||
      typeof URL.createObjectURL !== "function" ||
      !(handle instanceof Blob)
    ) {
      return "";
    }
    const cached = _fileUrlCache.get(handle);
    if (cached) return cached;
    const url = URL.createObjectURL(handle);
    _fileUrlCache.set(handle, url);
    _fileUrlRegistry?.register(handle, url);
    return url;
  },

  /**
   * `prefers-dark()` — the OS colour-scheme preference (style.md §4.6.1).
   *
   * Read once per call rather than subscribed to: an `app.start` reducer uses
   * it to pick the initial theme, and a running app that wants to follow a
   * mid-session change has `theme = <slot>` plus a reducer to write it.
   *
   * The guard is for SSR, where there is no `window` at all. happy-dom does
   * implement `matchMedia` and answers `false` by default, so the smoke and
   * scenario tiers take the real path — see `prefers-dark.test.ts`, which
   * drives both branches by stubbing the media query.
   */
  prefersDark(): boolean {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  },

  // ----- Issue #92: Bytes constructors (docs/spec/stdlib.md §2.1.1 / §2.2.10).
  // Bytes is represented as Uint8Array at runtime. The constructors are
  // lenient on nullish / malformed input and return an empty Uint8Array
  // instead of throwing — same shape as the rest of stdlib (mapValues etc.). -----

  /** `Bytes.from-text(text)` — UTF-8 encode. */
  bytesFromText(text: unknown): Uint8Array {
    return new TextEncoder().encode(String(text ?? ""));
  },
  /**
   * `Bytes.from-base64(text)` — standard base64 decode. Returns an empty
   * Uint8Array for nullish input and for malformed base64 (atob would throw
   * a DOMException otherwise — inconsistent with the rest of stdlib).
   */
  bytesFromBase64(b64: unknown): Uint8Array {
    if (b64 == null) return new Uint8Array();
    const s = String(b64);
    let bin: string;
    try {
      bin = atob(s);
    } catch {
      return new Uint8Array();
    }
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  },
  /** `Bytes.from-bytes(list)` — from List(Int) of byte values; clamps to low 8 bits. */
  bytesFromBytes(arr: unknown): Uint8Array {
    const xs = Array.isArray(arr) ? (arr as number[]) : [];
    const out = new Uint8Array(xs.length);
    for (let i = 0; i < xs.length; i++) out[i] = Number(xs[i]) & 0xff;
    return out;
  },
};

// File → blob URL memoisation. WeakMap so a File made unreachable (slot
// overwritten, picker reset) can be collected; the FinalizationRegistry then
// revokes the URL it was holding. The registry is environments-gated because
// older runtimes / SSR shims may not expose it — the cache still works there,
// only the explicit revoke degrades to "let the browser reclaim at page end".
const _fileUrlCache: WeakMap<Blob, string> = new WeakMap();
const _fileUrlRegistry: FinalizationRegistry<string> | null =
  typeof FinalizationRegistry !== "undefined" && typeof URL !== "undefined"
    ? new FinalizationRegistry((url: string) => {
        try {
          URL.revokeObjectURL(url);
        } catch {
          // Old URLs on a closed document throw; nothing to do.
        }
      })
    : null;
