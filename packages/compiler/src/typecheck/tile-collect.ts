import {
  assertNever,
  type Expr,
  isTileExpr,
  type ReducerDef,
  type TileDef,
  type TileExpr,
  writtenProp,
} from "../ast.ts";
import { BUILTIN_TILES, CHILD_RENDERING_BUILTINS, TILE_FAMILY } from "../builtins.ts";
import {
  boundaryTarget,
  expansionTargets,
  type GraphEdge,
  reachedFrom,
  type TileEdge,
} from "../def-graph.ts";
import {
  HANDLER_NAMES,
  handlerReducerName,
  UI_EVENT_TILE_KINDS,
  WRAPS_FOCUSED,
} from "../ui-lifts.ts";
import type { SymbolTable } from "./context.ts";

/** For each question a check asks of a tile, the builtin kinds it renders: each follows its own edges. */
export type TileKinds = {
  /**
   * The kinds a handler written at the tile's call site can land on (W0213). A nested tile's
   * `error-boundary` fallback is rendered without that call site's handlers, so it is left out.
   */
  readonly handled: (tileName: string) => ReadonlySet<string>;
  /**
   * Of those, the kinds a handler written at the tile's call site is merged onto: its root's. A
   * tile called at the root lends its own root, and a nested tile's fallback is left out as above.
   */
  readonly root: (tileName: string) => ReadonlySet<string>;
  /** The kinds a subscription on the tile is wired onto (W0212), a nested tile's fallback included. */
  readonly subscribed: (tileName: string) => ReadonlySet<string>;
  /**
   * The kinds the tile renders: the tiles codegen inlines into its tree (E0113). A bare name
   * counts only where it names a tile, since codegen reads any other as a value.
   */
  readonly rendered: (tileName: string) => ReadonlySet<string>;
  /**
   * Whether a subscription on the tile reaches a scroll that may take focus (W0212). Chromium
   * leaves a scroll out of the tab order while it holds an element that takes focus, so a scroll
   * is left out only where every way its content renders holds one (`WRAPS_FOCUSED`).
   */
  readonly focusableScroll: (tileName: string) => boolean;
};

// A node of the walks below is a program tile's name, or a builtin's behind this prefix, which no
// name can start with: a builtin and a program tile may share a name, and render differently.
const BUILTIN_NODE = "builtin ";

// Each answer is kept, so a tile is walked once however many positions ask about it. The walks
// keep their own stack: they run before E0237 refuses a tree too deep to inline, so they also
// walk the trees it will refuse.
export function tileKinds(tiles: ReadonlyMap<string, TileDef>): TileKinds {
  const own = (node: string): readonly string[] =>
    node.startsWith(BUILTIN_NODE) ? [node.slice(BUILTIN_NODE.length)] : [];
  const expansion = (node: string): readonly TileEdge[] => {
    const def = node.startsWith(BUILTIN_NODE) ? undefined : tiles.get(node);
    if (!def) return [];
    return expansionTargets(def.body).map((edge) =>
      rendersBuiltin(edge) ? { ...edge, to: BUILTIN_NODE + edge.to } : edge,
    );
  };
  // A position that asks about a tile by a builtin's name calls it, so it asks about the builtin.
  const asked =
    (walk: (node: string) => ReadonlySet<string>) =>
    (tileName: string): ReadonlySet<string> =>
      walk(BUILTIN_TILES.has(tileName) ? BUILTIN_NODE + tileName : tileName);
  // A handler at a call site lands on what the tile renders, bar the fallbacks of tiles in it.
  const rendered = asked(reachedFrom(expansion, own));
  // A tile placed in the body also leads to its `error-boundary` fallbacks, which render in its
  // place: a bare child that names the tile is lowered as its call, so it is placed as a call is.
  const placed = (node: string): readonly GraphEdge[] =>
    expansion(node).flatMap((edge) => {
      const callee = tiles.get(edge.to);
      return callee ? [edge, ...fallbackChain(callee, tiles)] : [edge];
    });
  const held = focusHeld(tiles);
  const scrolls = reachedFrom(placed, (node): readonly true[] => {
    const def = tiles.get(node);
    if (!def) return [];
    const mayTakeFocus = expansionTargets(def.body).some(
      (edge) => rendersBuiltin(edge) && edge.to === "scroll" && !held(edge.call),
    );
    return mayTakeFocus ? [true] : [];
  });
  return {
    handled: rendered,
    rendered,
    root: asked(reachedFrom((node) => expansion(node).filter((edge) => edge.root), own)),
    subscribed: asked(reachedFrom(placed, own)),
    // A builtin asked by name is a call with no content to read.
    focusableScroll: (tileName) =>
      BUILTIN_TILES.has(tileName) ? tileName === "scroll" : scrolls(tileName).size > 0,
  };
}

// The content an overlay holds shows only while it is open, so none of it is counted as held.
function rendersContent(builtin: string): boolean {
  return CHILD_RENDERING_BUILTINS.has(builtin) && TILE_FAMILY[builtin] !== "overlay";
}

/**
 * Whether every way a tree renders holds an element of `WRAPS_FOCUSED` that takes focus, one not
 * written `disabled`. Read so that a scroll is never wrongly taken to hold one: what may render
 * nothing (a `when`, a `for`), a tile placed with an `error-boundary` fallback that holds none,
 * and a tile on a loop of tiles hold none. Each tile is answered once.
 */
function focusHeld(tiles: ReadonlyMap<string, TileDef>): (tree: TileExpr) => boolean {
  const known = new Map<string, boolean>();
  const callees = (name: string): string[] => {
    const def = tiles.get(name);
    if (!def) return [];
    return expansionTargets(def.body).flatMap((edge) => {
      const callee = placedTile(edge, tiles);
      if (!callee) return [];
      const placedAs = [callee.name, ...fallbackChain(callee, tiles).map((fb) => fb.to)];
      return placedAs.filter((n) => !known.has(n));
    });
  };
  const holds = (t: TileExpr, tileHolds: (name: string) => boolean): boolean => {
    const placedHolds = (def: TileDef | undefined): boolean =>
      def !== undefined &&
      tileHolds(def.name) &&
      fallbackChain(def, tiles).every((fb) => tileHolds(fb.to));
    switch (t.kind) {
      case "TileWhen":
      case "TileFor":
        return false;
      case "TileIf":
        return holds(t.consequent, tileHolds) && holds(t.alternate, tileHolds);
      case "TileMatch":
        return t.arms.length > 0 && t.arms.every((arm) => holds(arm.body, tileHolds));
      case "TileCall":
        if (!BUILTIN_TILES.has(t.name)) return placedHolds(tiles.get(t.name));
        if (WRAPS_FOCUSED.has(t.name)) return writtenProp(t, "disabled") === undefined;
        if (!rendersContent(t.name)) return false;
        return t.args.some((a) => {
          if (a.name !== undefined) return false;
          if (isTileExpr(a.value)) return holds(a.value, tileHolds);
          return a.value.kind === "Ref" && placedHolds(tiles.get(a.value.name));
        });
      default:
        assertNever(t);
        return false;
    }
  };
  const tileHolds = (name: string): boolean =>
    known.get(name) ??
    bottomUp(name, callees, false, (node, read) => {
      const def = tiles.get(node);
      const answer = def !== undefined && holds(def.body, (n) => known.get(n) ?? read(n));
      known.set(node, answer);
      return answer;
    });
  return (tree) => holds(tree, tileHolds);
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

// A call of a builtin's name renders the builtin, before a program tile of that name, while a
// bare child renders only a program tile (`collectChildren`), however it is named.
function rendersBuiltin(edge: TileEdge): edge is TileEdge & Required<Pick<TileEdge, "call">> {
  return edge.call !== undefined && BUILTIN_TILES.has(edge.to);
}

/** The program tile `edge` places, with its boundary: none where it renders a builtin. */
function placedTile(edge: TileEdge, tiles: ReadonlyMap<string, TileDef>): TileDef | undefined {
  return rendersBuiltin(edge) ? undefined : tiles.get(edge.to);
}

// The edges codegen lowers a tile by: its body's expansion, plus the error-boundary fallbacks of
// each tile placed in it, which render in that tile's place. A bare child that names the tile is
// lowered as its call, so it is placed with its boundary as a call is. The tile's own fallback
// replaces its tree and renders outside it, so it is not included.
function renderedTree(tileName: string, sym: SymbolTable): RenderedTree {
  const callees = (name: string): string[] => {
    const def = sym.tiles.get(name);
    if (!def) return [];
    return expansionTargets(def.body).flatMap((edge) => {
      const callee = placedTile(edge, sym.tiles);
      if (!callee) return [];
      return [callee.name, ...fallbackChain(callee, sym.tiles).map((fb) => fb.to)];
    });
  };
  return bottomUp(tileName, callees, NOTHING_RENDERED, (name, treeOf) => {
    const def = sym.tiles.get(name);
    if (!def) return NOTHING_RENDERED;
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
      const sub = treeOf(callee.name);
      const decided = edge.call ? callSiteId(edge.call) : undefined;
      for (const el of sub.root.values()) {
        addElement(here, decided === undefined ? el : { kind: el.kind, id: decided });
      }
      for (const el of sub.inner.values()) addElement(inner, el);
      for (const fb of fallbackChain(callee, sym.tiles)) {
        const fallback = treeOf(fb.to);
        for (const el of fallback.root.values()) addElement(here, el);
        for (const el of fallback.inner.values()) addElement(inner, el);
      }
    }
    return { root, inner };
  });
}

/**
 * The value of `root`, built from the values of the nodes `next` leads it to, each worked out
 * before the node that reads it. The walk keeps its own stack: it runs before E0237 refuses a tree
 * too deep to inline, so it also walks the trees E0237 will refuse. A node read while it is still
 * being worked out, on a loop back to it, reads `onLoop`.
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
 * The fallbacks that can render in the tile's place: its `error-boundary`, that fallback's own,
 * and so on, since each is placed with its boundary like any other tile. The chain ends at a
 * tile already on it, which E0005 reports after the selector checks run. It is followed in a
 * loop, since it runs before E0237 refuses a chain of fallbacks too deep to inline.
 */
function fallbackChain(def: TileDef, tiles: ReadonlyMap<string, TileDef>): GraphEdge[] {
  const chain: GraphEdge[] = [];
  const seen = new Set([def.name]);
  let boundary = boundaryTarget(def);
  while (boundary) {
    const fallback = tiles.get(boundary.to);
    if (!fallback || seen.has(fallback.name)) break;
    chain.push(boundary);
    seen.add(fallback.name);
    boundary = boundaryTarget(fallback);
  }
  return chain;
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
    const known = uses.get(tile);
    if (known) known.push(use);
    else uses.set(tile, [use]);
  };
  for (const def of sym.tiles.values()) {
    for (const edge of expansionTargets(def.body)) {
      const callee = placedTile(edge, sym.tiles);
      if (!callee) continue;
      const id = edge.call ? callSiteId(edge.call) : undefined;
      add(callee.name, { by: def.name, root: edge.root, id });
      // A call's fallbacks, and a bare child's, render in its place, outside the props a call writes.
      for (const fb of fallbackChain(callee, sym.tiles)) {
        add(fb.to, { by: def.name, root: edge.root, id: undefined });
      }
    }
  }
  return uses;
}

/**
 * Whether a route shows a tile in the outlets the tile renders: it, or a tile that renders it,
 * declares `sub-routes`, so that tile's outlet is the route target's. A tile that renders one
 * declaring `sub-routes` does not fill its outlet, which that tile fills only as the route target.
 */
export function outletFilled(tile: string, sym: SymbolTable): boolean {
  const uses = usesByTile(sym);
  const seen = new Set<string>();
  const open = [tile];
  for (let name = open.pop(); name !== undefined; name = open.pop()) {
    if (seen.has(name)) continue;
    seen.add(name);
    if (sym.tiles.get(name)?.subRoutes !== undefined) return true;
    for (const use of uses.get(name) ?? []) open.push(use.by);
  }
  return false;
}

// A route renders its tile, or one of that tile's fallbacks, with no call site at all.
function routeTargets(sym: SymbolTable): Set<string> {
  const targets = [
    ...(sym.app?.routes ?? []),
    ...[...sym.tiles.values()].flatMap((t) => t.subRoutes ?? []),
  ].flatMap((r) => (r.tile.startsWith(">>") ? [] : [r.tile]));
  const fallbacks = targets.flatMap((name) => {
    const def = sym.tiles.get(name);
    return def ? fallbackChain(def, sym.tiles).map((fb) => fb.to) : [];
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
