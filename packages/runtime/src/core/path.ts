import { KumikiPanic } from "./panic.ts";

export type PathSegment = string | number | { get: true } | { at: unknown };

/** The segments a `bind=` path can hold — what `TileNode.bindPath` carries. */
export type BindSegment = Extract<PathSegment, string | { get: true }>;

function isUnwrapSegment(seg: PathSegment): seg is { get: true } {
  return typeof seg === "object" && seg !== null && (seg as { get?: unknown }).get === true;
}

function isIndexSegment(seg: PathSegment): seg is { at: unknown } {
  return typeof seg === "object" && seg !== null && Object.hasOwn(seg, "at");
}

/** A bind path never indexes, so an index step of `prefix` matches none of its steps. */
export function bindPathStartsWith(
  path: readonly BindSegment[],
  prefix: readonly PathSegment[],
): boolean {
  return (
    prefix.length <= path.length &&
    prefix.every((step, i) => {
      const own = path[i];
      if (typeof step !== "object" || step === null) return own === step;
      return !isIndexSegment(step) && isUnwrapSegment(step) && typeof own === "object";
    })
  );
}

export function entryKey(x: unknown): string {
  return x !== null && typeof x === "object" ? sortedJson(x) : String(x);
}

function sortedJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(sortedJson).join(",")}]`;
  if (v !== null && typeof v === "object") {
    const o = v as Record<string, unknown>;
    const fields = Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${sortedJson(o[k])}`);
    return `{${fields.join(",")}}`;
  }
  return JSON.stringify(v) ?? "null";
}

export function listPosition(list: readonly unknown[], index: unknown): number {
  if (typeof index === "number" && Number.isInteger(index) && index >= 0 && index < list.length) {
    return index;
  }
  const shown = typeof index === "string" ? JSON.stringify(index) : String(index);
  throw new KumikiPanic(`Index ${shown} is out of range for a List of length ${list.length}`);
}

export function _setPathHelper(
  obj: unknown,
  path: readonly PathSegment[],
  value: unknown,
): unknown {
  if (path.length === 0) return value;
  const step = path[0] as PathSegment;
  const rest = path.slice(1);
  const indexed = isIndexSegment(step);
  const head = (indexed ? step.at : step) as PathSegment;
  if (!indexed && isUnwrapSegment(head)) {
    if (obj && typeof obj === "object" && "_tag" in obj) {
      const o = obj as { _tag: string; _0?: unknown };
      if (o._tag === "None" || o._tag === "Err") return obj;
      if (o._tag === "Some" || o._tag === "Ok") {
        return { ...o, _0: _setPathHelper(o._0, rest, value) };
      }
    }
    return _setPathHelper(obj, rest, value);
  }
  if (Array.isArray(obj)) {
    const at = listPosition(obj, head);
    const element = obj[at];
    if (rest.length > 0 && (element === undefined || element === null)) {
      throw new KumikiPanic(`Index ${at} of a List holds no value to write through`);
    }
    const out = [...obj];
    out[at] = _setPathHelper(element, rest, value);
    return out;
  }
  if (typeof head === "number" && (obj === null || typeof obj !== "object")) {
    throw new KumikiPanic(`Index ${head} reaches no List or Map, but ${String(obj)}`);
  }
  if (indexed && rest.length > 0 && !isEntryOf(obj, head)) return obj;
  const cur = (obj && typeof obj === "object" ? obj : {}) as Record<string, unknown>;
  const key = entryKey(head);
  return { ...cur, [key]: _setPathHelper(cur[key], rest, value) };
}

export function isEntryOf(m: unknown, key: unknown): boolean {
  return m !== null && typeof m === "object" && Object.hasOwn(m, entryKey(key));
}

export function bindLabel(bind: string, path?: readonly BindSegment[]): string {
  if (!path || path.length === 0) return bind;
  return [bind, ...path.map((seg) => (typeof seg === "string" ? seg : "get"))].join(".");
}
