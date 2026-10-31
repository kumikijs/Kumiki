import {
  assertNever,
  type Expr,
  isTileExpr,
  type ReducerDef,
  type TileDef,
  type TileExpr,
} from "../ast.ts";
import { BUILTIN_TILES, CHILD_RENDERING_BUILTINS } from "../builtins.ts";
import { boundaryTarget, expansionTargets, type GraphEdge, reachedFrom } from "../def-graph.ts";
import { HANDLER_NAMES, handlerReducerName, UI_EVENT_TILE_KINDS } from "../ui-lifts.ts";
import type { SymbolTable } from "./context.ts";

/**
 * The kinds a handler written at the tile's call site can land on (W0213). A nested tile's
 * `error-boundary` fallback is rendered without that call site's handlers, so it is left out.
 */
export function collectTileBuiltinKinds(
  tiles: ReadonlyMap<string, TileDef>,
): (tileName: string) => ReadonlySet<string> {
  return renderedKinds(tiles, false);
}

/** The kinds a subscription on the tile is wired onto (W0212), a nested tile's fallback included. */
export function subscribedKinds(
  tiles: ReadonlyMap<string, TileDef>,
): (tileName: string) => ReadonlySet<string> {
  return renderedKinds(tiles, true);
}

// Answers are kept, so a tile is walked once however many positions ask about it, and the walk is
// iterative because nothing bounds how long a program may chain tiles. With `fallbacks`, a call
// also leads to its callee's `error-boundary` fallback, which renders in that call's place.
function renderedKinds(
  tiles: ReadonlyMap<string, TileDef>,
  fallbacks: boolean,
): (tileName: string) => ReadonlySet<string> {
  return reachedFrom(
    (name) => {
      if (BUILTIN_TILES.has(name)) return [];
      const def = tiles.get(name);
      if (!def) return [];
      const edges = expansionTargets(def.body);
      if (!fallbacks) return edges;
      return edges.flatMap((edge) => {
        const callee = edge.call ? tiles.get(edge.to) : undefined;
        const boundary = callee ? boundaryTarget(callee) : null;
        return boundary ? [edge, boundary] : [edge];
      });
    },
    (name) => (BUILTIN_TILES.has(name) ? [name] : []),
  );
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

// The edges codegen lowers a tile by: its body's expansion, plus the error-boundary fallback of
// each tile called in it, which renders in that call's place. The tile's own fallback replaces its
// tree and renders outside it, so it is not included.
function renderedTree(tileName: string, sym: SymbolTable): RenderedTree {
  const callees = (name: string): string[] => {
    const def = sym.tiles.get(name);
    if (!def) return [];
    return expansionTargets(def.body).flatMap((edge) => {
      const callee = sym.tiles.get(edge.to);
      if (!callee) return [];
      const boundary = edge.call ? boundaryTarget(callee) : null;
      return boundary && sym.tiles.has(boundary.to) ? [callee.name, boundary.to] : [callee.name];
    });
  };
  return bottomUp(tileName, callees, NOTHING_RENDERED, (name, treeOf) => {
    const def = sym.tiles.get(name);
    if (!def) return NOTHING_RENDERED;
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
      const sub = treeOf(callee.name);
      const decided = edge.call ? callSiteId(edge.call) : undefined;
      for (const el of sub.root.values()) {
        addElement(here, decided === undefined ? el : { kind: el.kind, id: decided });
      }
      for (const el of sub.inner.values()) addElement(inner, el);
      // Only a call is lowered with its callee's boundary; an identifier
      // argument standing in for the tile inlines the body alone.
      const boundary = edge.call ? boundaryTarget(callee) : null;
      if (boundary && sym.tiles.has(boundary.to)) {
        const fallback = treeOf(boundary.to);
        for (const el of fallback.root.values()) addElement(here, el);
        for (const el of fallback.inner.values()) addElement(inner, el);
      }
    }
    return { root, inner };
  });
}

/**
 * The value of `root`, built from the values of the nodes `next` leads it to, each worked out
 * before the node that reads it. The walk keeps its own stack, since nothing bounds how long a
 * program may chain tiles. A node read while it is still being worked out, on a loop back to it,
 * reads `onLoop`.
 */
function bottomUp<T>(
  root: string,
  next: (node: string) => readonly string[],
  onLoop: T,
  value: (node: string, read: (node: string) => T) => T,
): T {
  const done = new Map<string, T>();
  const open = new Set<string>();
  const read = (node: string): T => done.get(node) ?? onLoop;
  const frames: { node: string; next: readonly string[]; at: number }[] = [];
  const enter = (node: string): void => {
    open.add(node);
    frames.push({ node, next: next(node), at: 0 });
  };
  enter(root);
  while (frames.length > 0) {
    const frame = frames[frames.length - 1];
    if (!frame) break;
    const to = frame.next[frame.at];
    if (to !== undefined) {
      frame.at += 1;
      if (!done.has(to) && !open.has(to)) enter(to);
      continue;
    }
    frames.pop();
    done.set(frame.node, value(frame.node, read));
    open.delete(frame.node);
  }
  return read(root);
}

/**
 * What one use of a tile leaves the elements it renders at its root with: a literal `id`, `null`
 * where the id is unknown, or `undefined` where the use writes none, so they keep their own.
 */
type Imposed = string | null | undefined;

// A call site's props are merged onto its tile's root elements, so a literal id written there
// replaces theirs. What a call site that writes no id but another prop leaves the dispatch
// payload holding is not followed, so the id is unknown then. Handlers and `key` are not props.
function callSiteId(call: TileExpr & { kind: "TileCall" }): Imposed {
  const id = writtenValue(call, "id");
  if (id !== undefined) return id.kind === "Str" ? id.value : null;
  const names = [...call.props.map((p) => p.name), ...call.args.map((a) => a.name)];
  const writesProp = names.some((n) => n !== undefined && n !== "key" && !HANDLER_NAMES.has(n));
  return writesProp ? null : undefined;
}

/** A place the tile renders from: the tile whose body renders it, at its root or not, and what that call site imposes. */
type Use = { readonly by: string; readonly root: boolean; readonly id: Imposed };

function usesByTile(sym: SymbolTable): Map<string, Use[]> {
  const uses = new Map<string, Use[]>();
  const add = (tile: string, use: Use): void => {
    const known = uses.get(tile);
    if (known) known.push(use);
    else uses.set(tile, [use]);
  };
  for (const def of sym.tiles.values()) {
    for (const edge of expansionTargets(def.body)) {
      const id = edge.call ? callSiteId(edge.call) : undefined;
      add(edge.to, { by: def.name, root: edge.root, id });
      // A call's fallback renders in its place, outside the props the call writes.
      const callee = edge.call ? sym.tiles.get(edge.to) : undefined;
      const boundary = callee ? boundaryTarget(callee) : null;
      if (boundary) add(boundary.to, { by: def.name, root: edge.root, id: undefined });
    }
  }
  return uses;
}

// A route renders its tile, or that tile's fallback, with no call site at all.
function routeTargets(sym: SymbolTable): Set<string> {
  const targets = [
    ...(sym.app?.routes ?? []),
    ...[...sym.tiles.values()].flatMap((t) => t.subRoutes ?? []),
  ].flatMap((r) => (r.tile.startsWith(">>") ? [] : [r.tile]));
  const fallbacks = targets.flatMap((name) => {
    const def = sym.tiles.get(name);
    const boundary = def ? boundaryTarget(def) : null;
    return boundary ? [boundary.to] : [];
  });
  return new Set([...targets, ...fallbacks]);
}

// Each call site up a chain of tiles that render the tile at their root merges its props onto
// the same elements, the outermost last (`_attachProps`), so a use is followed up that chain.
function imposedIds(
  tile: string,
  uses: ReadonlyMap<string, readonly Use[]>,
  routes: ReadonlySet<string>,
): ReadonlySet<Imposed> {
  const callers = (name: string): string[] =>
    (uses.get(name) ?? []).flatMap((use) => (use.root ? [use.by] : []));
  return bottomUp<ReadonlySet<Imposed>>(tile, callers, new Set([undefined]), (name, idsOf) => {
    const out = new Set<Imposed>();
    if (routes.has(name)) out.add(undefined);
    for (const use of uses.get(name) ?? []) {
      if (!use.root) {
        out.add(use.id);
        continue;
      }
      for (const above of idsOf(use.by)) out.add(above === undefined ? use.id : above);
    }
    // A tile nothing renders keeps its own ids, as it would wherever it rendered.
    if (out.size === 0) out.add(undefined);
    return out;
  });
}

/**
 * The builtin kinds a tile renders: the tiles codegen inlines into its tree (E0113). Unlike
 * `collectTileBuiltinKinds`, a positional argument counts only where its builtin renders it.
 */
export function collectRenderedBuiltinKinds(
  tiles: ReadonlyMap<string, TileDef>,
): (tileName: string) => ReadonlySet<string> {
  return reachedFrom(
    (name) => {
      const def = BUILTIN_TILES.has(name) ? undefined : tiles.get(name);
      return def ? renderedTiles(def.body, tiles) : [];
    },
    (name) => (BUILTIN_TILES.has(name) ? [name] : []),
  );
}

function renderedTiles(
  t: TileExpr,
  tiles: ReadonlyMap<string, TileDef>,
  out: GraphEdge[] = [],
): GraphEdge[] {
  switch (t.kind) {
    case "TileFor":
    case "TileWhen":
      return renderedTiles(t.body, tiles, out);
    case "TileIf":
      renderedTiles(t.consequent, tiles, out);
      return renderedTiles(t.alternate, tiles, out);
    case "TileMatch":
      for (const arm of t.arms) renderedTiles(arm.body, tiles, out);
      return out;
    case "TileCall":
      out.push({ to: t.name, pos: t.pos });
      if (!CHILD_RENDERING_BUILTINS.has(t.name)) return out;
      for (const arg of t.args) {
        if (arg.name !== undefined) continue;
        const v = arg.value;
        if (isTileExpr(v)) renderedTiles(v, tiles, out);
        else if (v.kind === "Ref" && tiles.has(v.name)) out.push({ to: v.name, pos: v.pos });
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
  const tree = renderedTree(tile.name, sym);
  const imposed = imposedIds(tile.name, usesByTile(sym), routeTargets(sym));
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
