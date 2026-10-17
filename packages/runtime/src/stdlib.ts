import {
  _setPathHelper,
  currentEpisodeId,
  entryKey,
  isEntryOf,
  isPanic,
  isPlainDataBag,
  KumikiPanic,
  listPosition,
  type PathSegment,
  panicInfo,
  type RefinementNaming,
  type RefinementRejection,
  readEnv,
  refinementRejectionOf,
  type SlotGate,
  slotAccepts,
  tokenRef,
  userPanicInfo,
} from "./core.ts";

export type KeyKind = "number" | "bool" | "value";

/** A stored object key, restored to the kind of value it was written from. */
function restoreKey(key: string, kind: KeyKind | undefined): unknown {
  switch (kind) {
    case undefined:
      return key;
    case "number":
      return Number(key);
    case "bool":
      return key === "true";
    case "value":
      return restoreValueKey(key);
    default:
      return assertNeverKind(kind);
  }
}

function restoreValueKey(key: string): unknown {
  try {
    return JSON.parse(key);
  } catch {
    throw new KumikiPanic(
      `The key ${JSON.stringify(key)} was not stored by a Set or Map member, so it reads back as no value of its structured key type`,
    );
  }
}

/** Unreachable while `restoreKey` handles every `KeyKind`; a type error otherwise. */
function assertNeverKind(kind: never): never {
  throw new Error(`unknown key kind ${String(kind)}`);
}

export function valueEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  const aArr = Array.isArray(a);
  const bArr = Array.isArray(b);
  if (aArr || bArr) {
    if (!aArr || !bArr || a.length !== b.length) return false;
    return a.every((x, i) => valueEqual(x, (b as unknown[])[i]));
  }
  const aBytes = a instanceof Uint8Array;
  const bBytes = b instanceof Uint8Array;
  if (aBytes || bBytes) {
    if (!aBytes || !bBytes || a.length !== b.length) return false;
    return a.every((x, i) => x === (b as Uint8Array)[i]);
  }
  if (!isPlainDataBag(a) || !isPlainDataBag(b)) return false;
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const ak = Object.keys(ao);
  if (ak.length !== Object.keys(bo).length) return false;
  // Key presence too: `{a: undefined}` and `{b: undefined}` have equal key
  // counts but are not equal.
  return ak.every((k) => Object.hasOwn(bo, k) && valueEqual(ao[k], bo[k]));
}

function instantOf(value: unknown): number {
  // Trimmed here, not in `Time.parse`: the reading refuses padded text, but a
  // `Time` that arrived as padded text still renders as the instant it names.
  const raw = String(value ?? "").trim();
  if (raw === "") return Number.NaN;
  const n = Number(raw);
  if (Number.isFinite(n)) return n;
  const parsed = _stdlibCore.parseTime(raw);
  return parsed._tag === "Some" ? (parsed._0 as number) : Number.NaN;
}

const ISO_TIME =
  /^(\d{4})-(\d{2})-(\d{2})(?:[Tt ]([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d)(?:\.(\d+))?)?)?([Zz]|([+-])([01]\d|2[0-3]):([0-5]\d))?$/;

/** Whether month `m` (1–12) of year `y` has a day `d` — the proleptic Gregorian calendar. */
function isCalendarDate(y: number, m: number, d: number): boolean {
  const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
  const days = m === 2 ? (leap ? 29 : 28) : m === 4 || m === 6 || m === 9 || m === 11 ? 30 : 31;
  return m >= 1 && m <= 12 && d >= 1 && d <= days;
}

type PlatformCrypto = {
  randomUUID?: () => string;
  getRandomValues?: (bytes: Uint8Array) => Uint8Array;
};

function uuidV4(c: PlatformCrypto | undefined): string {
  const bytes = new Uint8Array(16);
  if (c?.getRandomValues) c.getRandomValues(bytes);
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export const _stdlibCore = {
  entryKey,
  slotWrite(
    metas: Record<string, SlotGate & RefinementNaming>,
    rejected: RefinementRejection[],
    name: string,
    value: unknown,
  ): unknown {
    const meta = metas[name];
    if (meta && !slotAccepts(meta, value)) rejected.push(refinementRejectionOf(name, value, meta));
    return value;
  },
  token(group: string, path: string[]): string {
    return tokenRef(group, path);
  },
  parseTime(text: unknown): { _tag: "Some"; _0: unknown } | { _tag: "None" } {
    const m = ISO_TIME.exec(String(text ?? ""));
    if (!m) return _stdlibCore.None;
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (!isCalendarDate(y, mo, d)) return _stdlibCore.None;
    // Milliseconds from the fraction's first three digits; the rest is finer
    // than a `Time` holds.
    const [h, mi, s] = [Number(m[4] ?? 0), Number(m[5] ?? 0), Number(m[6] ?? 0)];
    const ms = Number((m[7] ?? "").padEnd(3, "0").slice(0, 3));
    // `setFullYear` / `setUTCFullYear` so a year below 100 is not read as 19xx.
    const at = new Date(2000, 0, 1);
    if (m[8] === undefined) {
      at.setFullYear(y, mo - 1, d);
      at.setHours(h, mi, s, ms);
      return _stdlibCore.Some(at.getTime());
    }
    at.setUTCFullYear(y, mo - 1, d);
    at.setUTCHours(h, mi, s, ms);
    // `+09:00` is nine hours ahead of UTC, so the instant is nine hours earlier.
    const sign = m[9] === "-" ? 1 : -1;
    const offset = m[9] ? sign * (Number(m[10]) * 60 + Number(m[11])) * 60_000 : 0;
    return _stdlibCore.Some(at.getTime() + offset);
  },
  formatTime(ms: unknown, pattern: unknown): string {
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
    return p.replace(/yyyy|MM|dd|HH|mm|ss/g, (tok) => fields[tok] ?? tok);
  },
  mapSize(m: unknown): number {
    if (m instanceof Map) return m.size;
    // `.size` on a receiver the checker could not type, such as a File read off `$event`.
    if (isFileValue(m)) return m.size;
    if (m && typeof m === "object") return Object.keys(m as object).length;
    return 0;
  },
  isEmpty(v: unknown): boolean {
    if (typeof v === "string" || Array.isArray(v)) return v.length === 0;
    if (v && typeof v === "object") return Object.keys(v).length === 0;
    return v === undefined || v === null;
  },
  mapKeys(m: Record<string, unknown> | undefined | null, kind?: KeyKind): unknown[] {
    return m ? Object.keys(m).map((k) => restoreKey(k, kind)) : [];
  },
  mapValues(m: Record<string, unknown> | undefined | null): unknown[] {
    return m ? Object.values(m) : [];
  },
  mapEntries(m: Record<string, unknown> | undefined | null, kind?: KeyKind): unknown[] {
    return m ? Object.entries(m).map(([k, v]) => [restoreKey(k, kind), v]) : [];
  },
  mapGet(m: Record<string, unknown> | undefined | null, k: unknown): unknown {
    return m ? m[entryKey(k)] : undefined;
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
  mapGetOr(m: Record<string, unknown> | undefined | null, k: unknown, def: unknown): unknown {
    const key = entryKey(k);
    if (m && key in m) return m[key];
    return def;
  },
  mapInsert(m: Record<string, unknown>, k: unknown, v: unknown): Record<string, unknown> {
    return { ...m, [entryKey(k)]: v };
  },
  /** `Map.remove(k)` and `Set.remove(x)`: every entry but the one `k` is stored under. */
  mapRemove(m: Record<string, unknown>, k: unknown): Record<string, unknown> {
    const key = entryKey(k);
    const out: Record<string, unknown> = {};
    for (const [kk, vv] of Object.entries(m ?? {})) if (kk !== key) out[kk] = vv;
    return out;
  },
  filter(coll: unknown, pred: (x: unknown) => boolean, kind?: KeyKind): unknown {
    if (Array.isArray(coll)) return coll.filter((x) => pred(x));
    if (_stdlibCore.variantIs(coll, "Some")) {
      const value = (coll as { _0: unknown })._0;
      return pred(value) ? coll : _stdlibCore.None;
    }
    if (_stdlibCore.variantIs(coll, "None")) return coll;
    if (coll && typeof coll === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(coll as Record<string, unknown>)) {
        if (pred([restoreKey(k, kind), v])) out[k] = v;
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
  listFind<T>(xs: T[], pred: (x: T) => boolean): unknown {
    const hit = (xs ?? []).find(pred);
    return hit === undefined ? _stdlibCore.None : _stdlibCore.Some(hit);
  },
  contains(recv: unknown, x: unknown): boolean {
    if (typeof recv === "string") return recv.includes(x as string);
    return ((recv as unknown[] | null | undefined) ?? []).some((y) => valueEqual(y, x));
  },
  listUnique<T>(xs: T[] | undefined | null): T[] {
    const out: T[] = [];
    const seenPrimitives = new Set<unknown>();
    const keptObjects: unknown[] = [];
    for (const x of xs ?? []) {
      if (x !== null && typeof x === "object") {
        if (keptObjects.some((y) => valueEqual(y, x))) continue;
        keptObjects.push(x);
      } else if (!(typeof x === "number" && Number.isNaN(x))) {
        if (seenPrimitives.has(x)) continue;
        seenPrimitives.add(x);
      }
      out.push(x);
    }
    return out;
  },
  listMap<T, U>(xs: T[], fn: (x: T) => U): U[] {
    return (xs ?? []).map(fn);
  },
  mapOver(coll: unknown, fn: (x: unknown) => unknown, kind?: KeyKind): unknown {
    if (Array.isArray(coll)) return coll.map(fn);
    // Told apart by the variant tag, as `filter` does, not by a `_tag` field alone, which a `Map(Text, _)` may hold as a key.
    for (const tag of ["Some", "Ok"]) {
      if (_stdlibCore.variantIs(coll, tag)) {
        return { _tag: tag, _0: fn((coll as { _0: unknown })._0) };
      }
    }
    if (_stdlibCore.variantIs(coll, "None") || _stdlibCore.variantIs(coll, "Err")) return coll;
    if (coll && typeof coll === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(coll as Record<string, unknown>)) {
        out[k] = fn([restoreKey(k, kind), v]);
      }
      return out;
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
  listSortBy<T>(xs: T[], keyOf: (x: T) => unknown): T[] {
    const absent = (k: unknown): boolean => k == null || Number.isNaN(k);
    return [...(xs ?? [])].sort((a, b) => {
      const ka = keyOf(a) as number | string;
      const kb = keyOf(b) as number | string;
      const na = absent(ka);
      const nb = absent(kb);
      if (na || nb) return na === nb ? 0 : na ? 1 : -1;
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    });
  },
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
    return !!s && entryKey(x) in s;
  },
  setToggle(s: Record<string, true> | undefined, x: unknown): Record<string, true> {
    const k = entryKey(x);
    const cur = { ...(s ?? {}) };
    if (k in cur) {
      delete cur[k];
      return cur;
    }
    cur[k] = true;
    return cur;
  },
  add(a: unknown, b: unknown): unknown {
    if (typeof a === "string" || typeof b === "string") {
      return _stdlibCore.show(a) + _stdlibCore.show(b);
    }
    return (a as number) + (b as number);
  },
  loopKeys(xs: readonly unknown[], loop: string): string[] {
    const seen = new Map<string, number>();
    return xs.map((x) => {
      const shown = _stdlibCore.show(x);
      const n = (seen.get(shown) ?? 0) + 1;
      seen.set(shown, n);
      return `${loop}|${n}|${shown}`;
    });
  },
  show(v: unknown): string {
    if (v === null || v === undefined) return "";
    if (typeof v === "object" && v && "_tag" in v) {
      const obj = v as { _tag: string };
      return obj._tag;
    }
    if (v instanceof Uint8Array) {
      let bin = "";
      for (const byte of v) bin += String.fromCharCode(byte);
      return btoa(bin);
    }
    return String(v);
  },
  fmt(template: unknown, ...args: unknown[]): string {
    return _stdlibCore.show(template).replace(/\{(\d+)\}/g, (placeholder, digits: string) => {
      const i = Number(digits);
      return i < args.length ? _stdlibCore.show(args[i]) : placeholder;
    });
  },
  eq(a: unknown, b: unknown): boolean {
    return valueEqual(a, b);
  },
  freshId(): string {
    return readEnv("fresh-id", () => {
      const c = (globalThis as { crypto?: PlatformCrypto }).crypto;
      if (c?.randomUUID) return c.randomUUID();
      return uuidV4(c);
    });
  },
  now(): number {
    return readEnv("now", () => Date.now());
  },
  random(): number {
    return readEnv("random", () => Math.random());
  },
  recordCopy(
    rec: Record<string, unknown>,
    patch: Record<string, unknown>,
  ): Record<string, unknown> {
    return { ...rec, ...patch };
  },
  unwrap(opt: unknown): unknown {
    if (opt && typeof opt === "object" && "_tag" in opt) {
      const o = opt as { _tag: string; _0?: unknown };
      if (o._tag === "Some" || o._tag === "Ok") return o._0;
      if (o._tag === "None") throw new KumikiPanic("get called on None");
      if (o._tag === "Err") throw new KumikiPanic("get called on an Err value");
    }
    return opt;
  },
  setPath(obj: unknown, path: readonly PathSegment[], value: unknown): unknown {
    return _setPathHelper(obj, path, value);
  },
  index(recv: unknown, key: unknown): unknown {
    if (Array.isArray(recv)) return recv[listPosition(recv, key)];
    if (isEntryOf(recv, key)) return (recv as Record<string, unknown>)[entryKey(key)];
    const shown = typeof key === "string" ? JSON.stringify(key) : entryKey(key);
    throw new KumikiPanic(`Key ${shown} is not in the Map`);
  },
  /** `panic(message)` — raise Kumiki's controlled stop-the-program signal. */
  panic(message: unknown): never {
    throw new KumikiPanic(String(message));
  },
  boundaryPanic(e: unknown, location: string): Record<string, unknown> {
    if (!isPanic(e)) throw e;
    const rec = panicInfo(e, "tile-render");
    return userPanicInfo(rec, rec.location || location, currentEpisodeId());
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
    k: unknown,
    fn: (v: unknown) => unknown,
  ): Record<string, unknown> {
    const obj = m ?? {};
    const key = entryKey(k);
    if (!(key in obj)) return obj;
    return { ...obj, [key]: fn(obj[key]) };
  },
  setOf(xs: readonly unknown[]): Record<string, true> {
    let s: Record<string, true> = {};
    for (const x of xs) s = _stdlibCore.setAdd(s, x);
    return s;
  },
  /** Set(T).add(x). Sets are stored as `{ [entryKey(x)]: true }`. */
  setAdd(s: Record<string, true> | undefined | null, x: unknown): Record<string, true> {
    return { ...(s ?? {}), [entryKey(x)]: true };
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
  toList(v: unknown, kind?: KeyKind): unknown[] {
    if (v && typeof v === "object" && "_tag" in (v as Record<string, unknown>)) {
      const o = v as { _tag: string; _0?: unknown };
      return o._tag === "Some" ? [o._0] : [];
    }
    // Return a fresh copy so the result never aliases a slot array, matching listHead/listTail/listLast which all produce new values.
    if (Array.isArray(v)) return [...v];
    // Set is stored as `{ [entryKey(x)]: true }`, so the element is read back through its recorded kind.
    if (v && typeof v === "object") {
      return Object.keys(v as Record<string, unknown>).map((k) => restoreKey(k, kind));
    }
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
  parseIntOpt(s: unknown): unknown {
    const n = Number(s);
    return String(s).trim() !== "" && Number.isFinite(n)
      ? _stdlibCore.Some(Math.trunc(n))
      : _stdlibCore.None;
  },
  parseFloatOpt(s: unknown): unknown {
    const n = Number(s);
    return String(s).trim() !== "" && Number.isFinite(n) ? _stdlibCore.Some(n) : _stdlibCore.None;
  },
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

  prefersDark(): boolean {
    return readEnv("prefers-dark", () => {
      if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
      return window.matchMedia("(prefers-color-scheme: dark)").matches;
    });
  },

  /** `Bytes.from-text(text)` — UTF-8 encode. */
  bytesFromText(text: unknown): Uint8Array {
    return new TextEncoder().encode(String(text ?? ""));
  },
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

function isFileValue(v: unknown): v is { size: number; _file: Blob } {
  return (
    typeof Blob !== "undefined" &&
    !!v &&
    typeof v === "object" &&
    (v as { _file?: unknown })._file instanceof Blob
  );
}

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
