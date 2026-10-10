import { valueEqual } from "../stdlib.ts";
import { _jsonStr } from "./expect.ts";

function tileField(node: unknown, k: string): unknown {
  return (node as Record<string, unknown> | null | undefined)?.[k];
}

function tileChildren(node: unknown): unknown[] {
  const c = tileField(node, "children");
  return Array.isArray(c) ? c.filter((x) => x != null) : [];
}

const TILE_NOT_CONTENT: ReadonlySet<string> = new Set([
  "kind",
  "children",
  "props",
  "key",
  "bind",
  "bindPath",
  "parse",
  "prefetch",
  "prefetchArgs",
]);

const TILE_PROPS_NOT_CONTENT: ReadonlySet<string> = new Set(["el", "_tile", "class", "style"]);

function tileContent(node: unknown): Map<string, unknown> {
  const out = new Map<string, unknown>();
  if (node === null || typeof node !== "object") return out;
  const isContent = (v: unknown): boolean => v !== undefined && typeof v !== "function";
  for (const [k, v] of Object.entries(node)) {
    if (!TILE_NOT_CONTENT.has(k) && isContent(v)) out.set(k === "checked" ? "value" : k, v);
  }
  const props = tileField(node, "props");
  if (props === null || typeof props !== "object") return out;
  for (const [k, v] of Object.entries(props)) {
    if (TILE_PROPS_NOT_CONTENT.has(k) || !isContent(v)) continue;
    if (out.has(k) || out.has(k.replace(/_(\w)/g, (_, c: string) => c.toUpperCase()))) continue;
    if (k === "aria" && v !== null && typeof v === "object" && !Array.isArray(v)) {
      for (const [attr, a] of Object.entries(v)) {
        if (a != null) out.set(attr.startsWith("aria-") ? attr : `aria-${attr}`, a);
      }
      continue;
    }
    out.set(k, v);
  }
  return out;
}

/** A content value as compared: `text` went through `show` on both sides. */
function contentValue(k: string, v: unknown): unknown {
  return k === "text" && v !== undefined ? String(v) : v;
}

export function tileStructEqual(
  expected: unknown,
  actual: unknown,
  path = "",
): { ok: boolean; path?: string; expectedLeaf?: unknown; actualLeaf?: unknown } {
  if (expected == null || actual == null) {
    return expected === actual ? { ok: true } : { ok: false, path: path || "(root)" };
  }
  const ek = tileField(expected, "kind");
  const here = path || String(ek ?? "(root)");
  if (ek !== tileField(actual, "kind")) return { ok: false, path: `${here}.kind` };
  const got = tileContent(actual);
  for (const [k, raw] of tileContent(expected)) {
    const ev = contentValue(k, raw);
    const av = contentValue(k, got.get(k));
    if (!valueEqual(ev, av)) {
      // Carry the leaf values so the runner can print the value arrow;
      // `kumiki fix --auto-patch` repairs a text leaf from them.
      return { ok: false, path: `${here}.${k}`, expectedLeaf: ev, actualLeaf: av };
    }
  }
  const ec = tileChildren(expected);
  const ac = tileChildren(actual);
  if (ec.length !== ac.length) return { ok: false, path: `${here}.children.length` };
  for (let i = 0; i < ec.length; i++) {
    const r = tileStructEqual(ec[i], ac[i], `${here}[${i}]`);
    if (!r.ok) return r;
  }
  return { ok: true };
}

export function serializeTileNode(node: unknown, shape: unknown = node): string {
  if (node == null) return "null";
  const kind = String(tileField(node, "kind"));
  const have = tileContent(node);
  const names = shape === null ? ["text"] : [...tileContent(shape).keys()];
  const parts: string[] = [];
  for (const k of names) {
    const v = have.get(k);
    if (v === undefined) continue;
    parts.push(k === "text" ? _jsonStr(String(v)) : `${k}=${_jsonStr(v)}`);
  }
  const shapeKids = shape === null ? [] : tileChildren(shape);
  tileChildren(node).forEach((kid, i) => {
    parts.push(serializeTileNode(kid, shapeKids[i] ?? null));
  });
  return `${kind}(${parts.join(", ")})`;
}
