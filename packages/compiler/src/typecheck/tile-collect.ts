import {
  assertNever,
  type Expr,
  isTileExpr,
  type ReducerDef,
  type TileDef,
  type TileExpr,
} from "../ast.ts";
import { BUILTIN_TILES } from "../builtins.ts";
import { boundaryTarget, expansionTargets } from "../def-graph.ts";
import { HANDLER_NAMES, UI_EVENT_TILE_KINDS } from "../ui-lifts.ts";
import type { SymbolTable } from "./context.ts";

export function collectTileBuiltinKinds(tileName: string, sym: SymbolTable): Set<string> {
  const tree = renderedTree(tileName, sym);
  return new Set([...tree.root.values(), ...tree.inner.values()].map((e) => e.kind));
}

/** `id` is `null` when there is no literal to read: computed, absent, or decided by a call site. */
type RenderedElement = { readonly kind: string; readonly id: string | null };

/**
 * `root` holds the elements a call site of the tile merges its props onto (`_attachProps`);
 * `inner` the rest. Each is keyed by kind and id, so an element reached along many paths is
 * held once.
 */
type RenderedTree = {
  readonly root: ReadonlyMap<string, RenderedElement>;
  readonly inner: ReadonlyMap<string, RenderedElement>;
};

const NOTHING_RENDERED: RenderedTree = Object.freeze({ root: new Map(), inner: new Map() });

function addElement(into: Map<string, RenderedElement>, el: RenderedElement): void {
  into.set(JSON.stringify([el.kind, el.id]), el);
}

// The edges codegen lowers a tile by: its body's expansion, plus the error-boundary
// fallback of each tile called in it, which renders in that call's place. The tile's own
// fallback replaces its tree and renders outside it, so it is not included.
function renderedTree(
  tileName: string,
  sym: SymbolTable,
  memo: Map<string, RenderedTree> = new Map(),
): RenderedTree {
  const known = memo.get(tileName);
  if (known) return known;
  if (BUILTIN_TILES.has(tileName)) {
    return { root: new Map([[tileName, { kind: tileName, id: null }]]), inner: new Map() };
  }
  const def = sym.tiles.get(tileName);
  if (!def) return NOTHING_RENDERED;
  memo.set(tileName, NOTHING_RENDERED);
  const root = new Map<string, RenderedElement>();
  const inner = new Map<string, RenderedElement>();
  for (const edge of expansionTargets(def.body)) {
    const here = edge.root ? root : inner;
    if (BUILTIN_TILES.has(edge.to)) {
      const id = edge.call ? writtenValue(edge.call, "id") : undefined;
      addElement(here, { kind: edge.to, id: id?.kind === "Str" ? id.value : null });
      continue;
    }
    const callee = sym.tiles.get(edge.to);
    if (!callee) continue;
    const sub = renderedTree(callee.name, sym, memo);
    const decided = edge.call ? callSiteId(edge.call) : undefined;
    for (const el of sub.root.values()) {
      addElement(here, decided === undefined ? el : { kind: el.kind, id: decided });
    }
    for (const el of sub.inner.values()) addElement(inner, el);
    // Only a call is lowered with its callee's boundary; an identifier
    // argument standing in for the tile inlines the body alone.
    const boundary = edge.call ? boundaryTarget(callee) : null;
    if (boundary && sym.tiles.has(boundary.to)) {
      const fallback = renderedTree(boundary.to, sym, memo);
      for (const el of fallback.root.values()) addElement(here, el);
      for (const el of fallback.inner.values()) addElement(inner, el);
    }
  }
  const tree: RenderedTree = { root, inner };
  memo.set(tileName, tree);
  return tree;
}

// A call site's props are merged onto its tile's root elements, so an id written there
// replaces theirs. What any other prop leaves the dispatch payload holding is not followed,
// so the id is unknown then too. Handlers and `key` are not props.
function callSiteId(call: TileExpr & { kind: "TileCall" }): string | null | undefined {
  const id = writtenValue(call, "id");
  if (id !== undefined) return id.kind === "Str" ? id.value : null;
  const names = [...call.props.map((p) => p.name), ...call.args.map((a) => a.name)];
  const writesProp = names.some((n) => n !== undefined && n !== "key" && !HANDLER_NAMES.has(n));
  return writesProp ? null : undefined;
}

type TileIdCollection =
  | { readonly known: true; readonly ids: ReadonlySet<string> }
  | { readonly known: false };

// The subscription reaches the tile wherever it is called, so its root elements count
// as each call site leaves them as well as as they render.
export function subscriptionIds(tile: TileDef, ev: string, sym: SymbolTable): TileIdCollection {
  const tree = renderedTree(tile.name, sym);
  const decided: (string | null)[] = [];
  for (const def of sym.tiles.values()) {
    for (const edge of expansionTargets(def.body)) {
      if (edge.to !== tile.name || !edge.call) continue;
      const id = callSiteId(edge.call);
      if (id !== undefined) decided.push(id);
    }
  }
  const fires = UI_EVENT_TILE_KINDS[ev];
  const ids = new Set<string>();
  let known = true;
  const read = (id: string | null): void => {
    if (id === null) known = false;
    else ids.add(id);
  };
  for (const el of tree.root.values()) {
    if (fires && !fires.has(el.kind)) continue;
    read(el.id);
    for (const id of decided) read(id);
  }
  for (const el of tree.inner.values()) {
    if (fires && !fires.has(el.kind)) continue;
    read(el.id);
  }
  return known ? { known: true, ids } : { known: false };
}

export function bindsRoute(r: ReducerDef, sym: SymbolTable): boolean {
  if (r.on.kind === "LifecycleEvent" && r.on.name.startsWith("route.")) return true;
  return sym.prefetchTargets.has(r.name);
}

export function collectPrefetchTargets(expr: TileExpr, out: Set<string>): void {
  switch (expr.kind) {
    case "TileFor":
    case "TileWhen":
      collectPrefetchTargets(expr.body, out);
      return;
    case "TileIf":
      collectPrefetchTargets(expr.consequent, out);
      collectPrefetchTargets(expr.alternate, out);
      return;
    case "TileMatch":
      for (const arm of expr.arms) collectPrefetchTargets(arm.body, out);
      return;
    case "TileCall": {
      if (expr.name === "link") {
        const v = expr.props.find((p) => p.name === "prefetch")?.value;
        if (v?.kind === "Ref") out.add(v.name);
        else if (v?.kind === "Str") out.add(v.value);
      }
      for (const a of expr.args) if (isTileExpr(a.value)) collectPrefetchTargets(a.value, out);
      return;
    }
    default:
      assertNever(expr);
  }
}

export function writtenValue(t: TileExpr & { kind: "TileCall" }, name: string): Expr | undefined {
  const fromProp = t.props.find((p) => p.name === name)?.value;
  if (fromProp !== undefined) return fromProp;
  const fromArg = t.args.find((a) => a.name === name)?.value;
  return fromArg === undefined || isTileExpr(fromArg) ? undefined : fromArg;
}

export function collectElementIds(expr: TileExpr, out: Set<string>): void {
  switch (expr.kind) {
    case "TileFor":
    case "TileWhen":
      collectElementIds(expr.body, out);
      return;
    case "TileIf":
      collectElementIds(expr.consequent, out);
      collectElementIds(expr.alternate, out);
      return;
    case "TileMatch":
      for (const arm of expr.arms) collectElementIds(arm.body, out);
      return;
    case "TileCall": {
      const id = writtenValue(expr, "id");
      if (id?.kind === "Str") out.add(id.value);
      for (const a of expr.args) if (isTileExpr(a.value)) collectElementIds(a.value, out);
      return;
    }
    default:
      assertNever(expr);
  }
}
