import { type BindSegment, bindLabel } from "./path.ts";
import type { NeverEqualCause, TileNode } from "./types.ts";

export function* ownFieldPairs(
  oldNode: TileNode,
  newNode: TileNode,
): Generator<[string, unknown, unknown]> {
  const oa = oldNode as unknown as Record<string, unknown>;
  const ob = newNode as unknown as Record<string, unknown>;
  for (const k of new Set([...Object.keys(oa), ...Object.keys(ob)])) {
    if (TILE_SKIP_TOP.has(k)) continue;
    if (k === "props") {
      const pa = (oa.props ?? {}) as Record<string, unknown>;
      const pb = (ob.props ?? {}) as Record<string, unknown>;
      for (const pk of new Set([...Object.keys(pa), ...Object.keys(pb)])) {
        yield [`props.${pk}`, pa[pk], pb[pk]];
      }
      continue;
    }
    yield [k, oa[k], ob[k]];
  }
}

export function tileTouchedId(node: TileNode): string {
  const asBindable = node as { bind?: unknown; bindPath?: unknown };
  if (typeof asBindable.bind === "string") {
    const bind = asBindable.bind;
    if (Array.isArray(asBindable.bindPath) && asBindable.bindPath.length > 0) {
      return bindLabel(bind, asBindable.bindPath as BindSegment[]);
    }
    return bind;
  }
  if (typeof node.key === "string") return node.key;
  return node.kind;
}

const TILE_SKIP_TOP: ReadonlySet<string> = new Set(["kind", "children", "key"]);

export function tileFieldsEqual(a: TileNode, b: TileNode): boolean {
  const oa = a as unknown as Record<string, unknown>;
  const ob = b as unknown as Record<string, unknown>;
  const keys = new Set<string>();
  for (const k of Object.keys(oa)) if (!TILE_SKIP_TOP.has(k)) keys.add(k);
  for (const k of Object.keys(ob)) if (!TILE_SKIP_TOP.has(k)) keys.add(k);
  for (const k of keys) if (!tileValueEqual(oa[k], ob[k])) return false;
  return true;
}

function tileValueEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!tileValueEqual(a[i], b[i])) return false;
    return true;
  }
  if (!isPlainDataBag(a) || !isPlainDataBag(b)) return false;
  const oa = a as Record<string, unknown>;
  const ob = b as Record<string, unknown>;
  const keys = new Set<string>([...Object.keys(oa), ...Object.keys(ob)]);
  for (const k of keys) if (!tileValueEqual(oa[k], ob[k])) return false;
  return true;
}

export function isPlainDataBag(v: object): boolean {
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

export function neverEqualCause(a: unknown, b: unknown): NeverEqualCause | undefined {
  if (Number.isNaN(a) && Number.isNaN(b)) return "nan";
  if (a === b) return undefined;
  if (typeof a === "function" && typeof b === "function") return "function-identity";
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return undefined;
  if (Array.isArray(a) || Array.isArray(b)) return undefined;
  if (!isPlainDataBag(a) && !isPlainDataBag(b)) return "non-plain-object";
  return undefined;
}
