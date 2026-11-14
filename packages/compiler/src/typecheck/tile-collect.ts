import {
  assertNever,
  type Expr,
  isTileExpr,
  type ReducerDef,
  type TileDef,
  type TileExpr,
  writtenProp,
} from "../ast.ts";
import { BUILTIN_TILES, CHILD_RENDERING_BUILTINS } from "../builtins.ts";
import { boundaryTarget, expansionTargets, type TileEdge } from "../def-graph.ts";
import { HANDLER_NAMES, handlerReducerName, UI_EVENT_TILE_KINDS } from "../ui-lifts.ts";
import type { SymbolTable } from "./context.ts";

/**
 * The kinds a handler written at the tile's call site can land on (W0213). A nested tile's
 * `error-boundary` fallback is rendered without that call site's handlers, so it is left out.
 */
export function collectTileBuiltinKinds(tileName: string, sym: SymbolTable): Set<string> {
  return kindsIn(renderedTree(tileName, sym, false));
}

/** Of those, the kinds a handler written at the tile's call site is merged onto: its root's. */
export function collectTileRootKinds(tileName: string, sym: SymbolTable): Set<string> {
  return new Set([...renderedTree(tileName, sym, false).root.values()].map((e) => e.kind));
}

/** The kinds a subscription on the tile is wired onto (W0212), a nested tile's fallback included. */
export function subscribedKinds(tileName: string, sym: SymbolTable): Set<string> {
  return kindsIn(renderedTree(tileName, sym, true));
}

function kindsIn(tree: RenderedTree): Set<string> {
  return new Set([...tree.root.values(), ...tree.inner.values()].map((e) => e.kind));
}

/** `id` is `null` when there is no literal to read: computed, absent, or unknown at a call site. */
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

function renderedTree(tileName: string, sym: SymbolTable, fallbacks: boolean): RenderedTree {
  if (BUILTIN_TILES.has(tileName)) {
    return { root: new Map([[tileName, { kind: tileName, id: null }]]), inner: new Map() };
  }
  const def = sym.tiles.get(tileName);
  return def ? treeOf(def, sym, fallbacks, new Map()) : NOTHING_RENDERED;
}

// A call of a builtin's name renders the builtin, before a program tile of that name, while a
// bare child renders only a program tile (`collectChildren`), however it is named.
function rendersBuiltin(edge: TileEdge): edge is TileEdge & Required<Pick<TileEdge, "call">> {
  return edge.call !== undefined && BUILTIN_TILES.has(edge.to);
}

// The edges codegen lowers a tile by: its body's expansion, plus, with `fallbacks`, the
// error-boundary fallbacks of each tile called in it, which render in that call's place. The
// tile's own fallback replaces its tree and renders outside it, so it is not included.
function treeOf(
  def: TileDef,
  sym: SymbolTable,
  fallbacks: boolean,
  memo: Map<string, RenderedTree>,
): RenderedTree {
  const known = memo.get(def.name);
  if (known) return known;
  memo.set(def.name, NOTHING_RENDERED);
  const root = new Map<string, RenderedElement>();
  const inner = new Map<string, RenderedElement>();
  for (const edge of expansionTargets(def.body)) {
    const here = edge.root ? root : inner;
    if (rendersBuiltin(edge)) {
      const id = writtenProp(edge.call, "id")?.value;
      addElement(here, { kind: edge.to, id: id?.kind === "Str" ? id.value : null });
      continue;
    }
    const callee = sym.tiles.get(edge.to);
    if (!callee) continue;
    const sub = treeOf(callee, sym, fallbacks, memo);
    const decided = edge.call ? callSiteId(edge.call) : undefined;
    for (const el of sub.root.values()) {
      addElement(here, decided === undefined ? el : { kind: el.kind, id: decided });
    }
    for (const el of sub.inner.values()) addElement(inner, el);
    // A bare child that names the tile is lowered as its call, so it is placed with its boundary
    // as a call is.
    for (const fb of fallbacks ? fallbackChain(callee, sym) : []) {
      const fallback = treeOf(fb, sym, fallbacks, memo);
      for (const el of fallback.root.values()) addElement(here, el);
      for (const el of fallback.inner.values()) addElement(inner, el);
    }
  }
  const tree: RenderedTree = { root, inner };
  memo.set(def.name, tree);
  return tree;
}

/**
 * The fallbacks that can render in the tile's place: its `error-boundary`, that fallback's own,
 * and so on, since each is placed with its boundary like any other tile. The chain ends at a
 * tile already on it, which E0005 reports after the selector checks run.
 */
function fallbackChain(
  def: TileDef,
  sym: SymbolTable,
  seen: ReadonlySet<string> = new Set([def.name]),
): TileDef[] {
  const boundary = boundaryTarget(def);
  const fallback = boundary ? sym.tiles.get(boundary.to) : undefined;
  if (!fallback || seen.has(fallback.name)) return [];
  return [fallback, ...fallbackChain(fallback, sym, new Set([...seen, fallback.name]))];
}

/**
 * What one use of a tile leaves the elements it renders at its root with: a literal `id`, `null`
 * where the id is unknown, or `undefined` where the use writes none, so they keep their own.
 */
type Imposed = string | null | undefined;

// A call site's props are merged onto its tile's root elements one prop at a time, so a literal
// id written there replaces theirs, and a call site that writes no id leaves theirs.
function callSiteId(call: TileExpr & { kind: "TileCall" }): Imposed {
  const id = writtenProp(call, "id")?.value;
  if (id === undefined) return undefined;
  return id.kind === "Str" ? id.value : null;
}

/** A place the tile renders from: the tile whose body renders it, at its root or not, and what that call site imposes. */
type Use = { readonly by: string; readonly root: boolean; readonly id: Imposed };

function usesByTile(sym: SymbolTable): Map<string, Use[]> {
  const uses = new Map<string, Use[]>();
  const add = (tile: string, use: Use): void => {
    uses.set(tile, [...(uses.get(tile) ?? []), use]);
  };
  for (const def of sym.tiles.values()) {
    for (const edge of expansionTargets(def.body)) {
      const callee = rendersBuiltin(edge) ? undefined : sym.tiles.get(edge.to);
      if (!callee) continue;
      const id = edge.call ? callSiteId(edge.call) : undefined;
      add(callee.name, { by: def.name, root: edge.root, id });
      // A call's fallbacks, and a bare child's, render in its place, outside the props a call writes.
      for (const fb of fallbackChain(callee, sym)) {
        add(fb.name, { by: def.name, root: edge.root, id: undefined });
      }
    }
  }
  return uses;
}

// A route renders its tile, or one of that tile's fallbacks, with no call site at all.
function routeTargets(sym: SymbolTable): Set<string> {
  const targets = [
    ...(sym.app?.routes ?? []),
    ...[...sym.tiles.values()].flatMap((t) => t.subRoutes ?? []),
  ].flatMap((r) => (r.tile.startsWith(">>") ? [] : [r.tile]));
  const fallbacks = targets.flatMap((name) => {
    const def = sym.tiles.get(name);
    return def ? fallbackChain(def, sym).map((fb) => fb.name) : [];
  });
  return new Set([...targets, ...fallbacks]);
}

// Each call site up a chain of tiles that render the tile at their root merges its props onto
// the same elements, the outermost last (`_attachProps`), so a use is followed up that chain.
function imposedIds(
  tile: string,
  uses: ReadonlyMap<string, readonly Use[]>,
  routes: ReadonlySet<string>,
  memo: Map<string, ReadonlySet<Imposed>>,
): ReadonlySet<Imposed> {
  const known = memo.get(tile);
  if (known) return known;
  memo.set(tile, new Set([undefined]));
  const out = new Set<Imposed>();
  if (routes.has(tile)) out.add(undefined);
  for (const use of uses.get(tile) ?? []) {
    if (!use.root) {
      out.add(use.id);
      continue;
    }
    for (const above of imposedIds(use.by, uses, routes, memo)) {
      out.add(above === undefined ? use.id : above);
    }
  }
  // A tile nothing renders keeps its own ids, as it would wherever it rendered.
  if (out.size === 0) out.add(undefined);
  memo.set(tile, out);
  return out;
}

/**
 * The builtin kinds `tileName` renders: the tiles codegen inlines into its tree. Unlike
 * `collectTileBuiltinKinds`, a positional argument counts only where its builtin renders it.
 */
export function collectRenderedBuiltinKinds(
  tileName: string,
  sym: SymbolTable,
  visited: Set<string> = new Set(),
): Set<string> {
  if (visited.has(tileName)) return new Set();
  visited.add(tileName);
  if (BUILTIN_TILES.has(tileName)) return new Set([tileName]);
  const def = sym.tiles.get(tileName);
  if (!def) return new Set();
  const out = new Set<string>();
  for (const target of renderedTiles(def.body, sym)) {
    for (const kind of collectRenderedBuiltinKinds(target, sym, visited)) out.add(kind);
  }
  return out;
}

function renderedTiles(t: TileExpr, sym: SymbolTable, out: string[] = []): string[] {
  switch (t.kind) {
    case "TileFor":
    case "TileWhen":
      return renderedTiles(t.body, sym, out);
    case "TileIf":
      renderedTiles(t.consequent, sym, out);
      return renderedTiles(t.alternate, sym, out);
    case "TileMatch":
      for (const arm of t.arms) renderedTiles(arm.body, sym, out);
      return out;
    case "TileCall":
      out.push(t.name);
      if (!CHILD_RENDERING_BUILTINS.has(t.name)) return out;
      for (const arg of t.args) {
        if (arg.name !== undefined) continue;
        const v = arg.value;
        if (isTileExpr(v)) renderedTiles(v, sym, out);
        else if (v.kind === "Ref" && sym.tiles.has(v.name)) out.push(v.name);
      }
      return out;
    default:
      assertNever(t);
      return out;
  }
}

type TileIdCollection =
  | { readonly known: true; readonly ids: ReadonlySet<string> }
  | { readonly known: false };

// The subscription reaches the tile wherever it renders, so each element at its root has
// the id each use leaves it with.
export function subscriptionIds(tile: TileDef, ev: string, sym: SymbolTable): TileIdCollection {
  const tree = renderedTree(tile.name, sym, true);
  const imposed = imposedIds(tile.name, usesByTile(sym), routeTargets(sym), new Map());
  const fires = UI_EVENT_TILE_KINDS[ev];
  const ids = new Set<string>();
  let known = true;
  const read = (id: string | null): void => {
    if (id === null) known = false;
    else ids.add(id);
  };
  for (const el of tree.root.values()) {
    if (fires && !fires.has(el.kind)) continue;
    for (const id of imposed) read(id === undefined ? el.id : id);
  }
  for (const el of tree.inner.values()) {
    if (fires && !fires.has(el.kind)) continue;
    read(el.id);
  }
  return known ? { known: true, ids } : { known: false };
}

/**
 * Whether a handler anywhere names the reducer. `onClick=r` is filtered by `r`'s `#id` too, on
 * whatever element carries it, so E0212 cannot tell which ids reach it.
 */
export function namedByHandler(reducer: string, sym: SymbolTable): boolean {
  const named = new Set<string>();
  for (const def of sym.tiles.values()) collectHandlerReducers(def.body, named);
  return named.has(reducer);
}

function collectHandlerReducers(expr: TileExpr, out: Set<string>): void {
  const add = (value: Expr | TileExpr): void => {
    const name = handlerReducerName(value);
    if (name !== null) out.add(name);
  };
  switch (expr.kind) {
    case "TileFor":
    case "TileWhen":
      collectHandlerReducers(expr.body, out);
      return;
    case "TileIf":
      collectHandlerReducers(expr.consequent, out);
      collectHandlerReducers(expr.alternate, out);
      return;
    case "TileMatch":
      for (const arm of expr.arms) collectHandlerReducers(arm.body, out);
      return;
    case "TileCall":
      for (const p of expr.props) if (HANDLER_NAMES.has(p.name)) add(p.value);
      for (const a of expr.args) {
        if (a.name !== undefined && HANDLER_NAMES.has(a.name)) add(a.value);
        else if (isTileExpr(a.value)) collectHandlerReducers(a.value, out);
      }
      return;
    default:
      assertNever(expr);
  }
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
        const v = writtenProp(expr, "prefetch")?.value;
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
      const id = writtenProp(expr, "id")?.value;
      if (id?.kind === "Str") out.add(id.value);
      for (const a of expr.args) if (isTileExpr(a.value)) collectElementIds(a.value, out);
      return;
    }
    default:
      assertNever(expr);
  }
}
