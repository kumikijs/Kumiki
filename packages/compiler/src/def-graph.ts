import type { Expr, Pos, TileDef, TileExpr, TypeDef, TypeExpr } from "./ast.ts";
import { isTileExpr, writtenProp } from "./ast.ts";
import { CHILD_RENDERING_BUILTINS } from "./builtins.ts";

/** An edge to another definition, positioned at the identifier that names it. */
export type GraphEdge = { readonly to: string; readonly pos: Pos };

/**
 * `level` counts from the root of the tile holding the edge (1); the target's body hangs below it.
 * For a call to a user tile it is the call's level plus the wrappers code generation puts around
 * the inlined body.
 */
export type PlacedEdge = GraphEdge & { readonly level: number };

/** A tile as written, before any tile it names is inlined. */
export type TileExpansion = {
  /** How deep it nests on its own: the parser's count of its body, expressions included. */
  readonly depth: number;
  /** The tiles it expands into, each placed at the level of its call. */
  readonly edges: readonly PlacedEdge[];
};

export type Cycle = {
  readonly path: readonly [string, ...string[]];
  /** The first edge of the loop — inside the definition `path[0]` names. */
  readonly pos: Pos;
};

/**
 * `root`: the node is one the body renders at its top, reached through `for` / `when` / `if` /
 * `match` alone, so a call site of the tile merges its props onto it (`_attachProps`). `call`
 * is absent for an identifier argument standing in for a tile.
 */
export type TileEdge = PlacedEdge & {
  readonly root: boolean;
  readonly call?: TileExpr & { kind: "TileCall" };
};

export function expansionTargets(body: TileExpr): readonly TileEdge[] {
  const edges: TileEdge[] = [];
  walkTileBody(body, 1, edges, true, false);
  return edges;
}

/**
 * A tree as written, before any tile it names is inlined: a tile's body, or a tile-test's expected
 * tree. `depth` is the parser's count of it, which puts every node at least as deep as the edges'
 * levels do.
 */
export function treeExpansion(body: TileExpr, depth: number): TileExpansion {
  const edges: TileEdge[] = [];
  walkTileBody(body, 1, edges, true, false);
  return { depth, edges };
}

// An `error-boundary` is a level of its own: codegen wraps every call of the tile in its `try`, so
// the tile's body and the fallback's both hang beneath it.
export function tileExpansion(def: TileDef): TileExpansion {
  const { depth, edges } = treeExpansion(def.body, def.depth);
  const boundary = boundaryTarget(def);
  if (!boundary) return { depth, edges };
  return {
    depth: depth + 1,
    edges: [...edges.map((e) => ({ ...e, level: e.level + 1 })), { ...boundary, level: 1 }],
  };
}

export function boundaryTarget(def: TileDef): GraphEdge | null {
  if (!def.errorBoundary) return null;
  return { to: def.errorBoundary, pos: def.errorBoundaryPos ?? def.pos };
}

type AliasHead =
  | {
      readonly kind: "name";
      readonly name: string;
      readonly pos: Pos;
      readonly args: readonly TypeExpr[];
    }
  | { readonly kind: "param"; readonly name: string };

export type NominalReading = "through" | "stop";

function headOf(
  t: TypeExpr,
  params: ReadonlySet<string>,
  nominal: NominalReading = "through",
): AliasHead | null {
  let cur = t;
  for (;;) {
    switch (cur.kind) {
      case "TypeNominal":
        if (nominal === "stop") return null;
        cur = cur.inner;
        continue;
      case "TypeRefinement":
        cur = cur.inner;
        continue;
      case "TypeRef":
        return params.has(cur.name)
          ? { kind: "param", name: cur.name }
          : { kind: "name", name: cur.name, pos: cur.pos, args: [] };
      case "TypeApp":
        return params.has(cur.name)
          ? null
          : { kind: "name", name: cur.name, pos: cur.pos, args: cur.args };
      case "TypePrim":
      case "TypeRecord":
      case "TypeUnion":
        return null;
      default: {
        const exhaustive: never = cur;
        void exhaustive;
        return null;
      }
    }
  }
}

export function forwardedParams(
  lookup: (name: string) => TypeDef | undefined,
  nominal: NominalReading,
): (def: TypeDef) => number | null {
  const answers = new Map<string, number | null>();
  const follow = (expr: TypeExpr, params: readonly string[]): number | null | TypeDef => {
    const scope = new Set(params);
    let cur = expr;
    for (;;) {
      const head = headOf(cur, scope, nominal);
      if (!head) return null;
      if (head.kind === "param") return params.indexOf(head.name);
      const def = lookup(head.name);
      if (!def) return null;
      if (!answers.has(def.name)) return def;
      const i = answers.get(def.name);
      if (i === null || i === undefined) return null;
      const arg = head.args[i];
      if (!arg) return null;
      cur = arg;
    }
  };
  return (root) => {
    if (answers.has(root.name)) return answers.get(root.name) ?? null;
    const stack: TypeDef[] = [root];
    const open = new Set<string>([root.name]);
    while (stack.length > 0) {
      const def = stack[stack.length - 1];
      if (!def) break;
      const next = answers.has(def.name) ? answers.get(def.name) : follow(def.body, def.params);
      if (typeof next === "object" && next !== null) {
        if (!open.has(next.name)) {
          stack.push(next);
          open.add(next.name);
          continue;
        }
        answers.set(def.name, null);
      } else {
        answers.set(def.name, next ?? null);
      }
      stack.pop();
      open.delete(def.name);
    }
    return answers.get(root.name) ?? null;
  };
}

export function aliasTarget(
  def: TypeDef,
  lookup: (name: string) => TypeDef | undefined,
): GraphEdge | null {
  const params = new Set(def.params);
  const forwarded = forwardedParams(lookup, "through");
  let head = headOf(def.body, params);
  while (head?.kind === "name") {
    const edge = { to: head.name, pos: head.pos };
    const target = lookup(head.name);
    if (!target) return edge;
    const i = forwarded(target);
    if (i === null) return edge;
    const arg = head.args[i];
    if (!arg) return edge;
    head = headOf(arg, params);
  }
  return null;
}

// `keyed` is whether a `for` gives the tree here its key: code generation keys what a `for` renders,
// through any `when` / `if` / `match` between them, and a call nested in a builtin is not keyed.
function walkTileBody(
  t: TileExpr,
  level: number,
  out: TileEdge[],
  root: boolean,
  keyed: boolean,
): void {
  switch (t.kind) {
    case "TileFor":
      walkTileBody(t.body, level + 1, out, root, true);
      return;
    case "TileWhen":
      walkTileBody(t.body, level + 1, out, root, keyed);
      return;
    case "TileIf":
      walkTileBody(t.consequent, level + 1, out, root, keyed);
      walkTileBody(t.alternate, level + 1, out, root, keyed);
      return;
    case "TileMatch":
      for (const arm of t.arms) walkTileBody(arm.body, level + 1, out, root, keyed);
      return;
    case "TileCall": {
      out.push({ to: t.name, pos: t.pos, level: level + wrappers(t, keyed), root, call: t });
      // Codegen renders the positional arguments of these builtins alone, as children; every
      // other call reads them as values (`text(leaf)`, `Card(leaf)`) or drops them
      // (`button(leaf)`), so nothing written there is inlined.
      if (!CHILD_RENDERING_BUILTINS.has(t.name)) return;
      for (const a of t.args) {
        const v = a.value;
        if (a.name !== undefined) continue;
        if (isTileExpr(v)) walkTileBody(v, level + 1, out, false, false);
        else if ((v as Expr).kind === "Ref") {
          const ref = v as Expr & { kind: "Ref" };
          out.push({ to: ref.name, pos: ref.pos, level: level + 1, root: false });
        }
      }
      return;
    }
    default: {
      const exhaustive: never = t;
      void exhaustive;
      return;
    }
  }
}

// A user tile's inlined body is wrapped once more for each of these: an argument binds it in a
// function of its own, and a key wraps the result (`_wk`). Only an edge to a user tile is measured;
// a builtin's own arguments and key are in the parser's count of the tile that writes it.
function wrappers(call: TileExpr & { kind: "TileCall" }, keyed: boolean): number {
  const argument = call.args.some((a) => a.name === undefined) ? 1 : 0;
  const key = keyed || writtenProp(call, "key") !== undefined ? 1 : 0;
  return argument + key;
}

/**
 * Every node that can reach itself: each node of a strongly connected component of more than one
 * node, and each node with an edge to itself. Unlike `findCycles`, which reports each loop once,
 * this names every node on one, however the walk first reached it.
 */
export function nodesOnCycles(
  nodes: Iterable<string>,
  edgesOf: (node: string) => readonly GraphEdge[],
): Set<string> {
  const on = new Set<string>();
  const order = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const stacked = new Set<string>();
  const lowOf = (node: string): number => low.get(node) ?? 0;

  for (const root of nodes) {
    if (order.has(root)) continue;
    const frames: { node: string; edges: readonly GraphEdge[]; next: number }[] = [];
    const enter = (node: string): void => {
      order.set(node, order.size);
      low.set(node, order.size - 1);
      stack.push(node);
      stacked.add(node);
      frames.push({ node, edges: edgesOf(node), next: 0 });
    };
    enter(root);
    while (frames.length > 0) {
      const frame = frames[frames.length - 1];
      if (!frame) break;
      const edge = frame.edges[frame.next];
      if (edge) {
        frame.next += 1;
        if (edge.to === frame.node) on.add(frame.node);
        else if (!order.has(edge.to)) enter(edge.to);
        else if (stacked.has(edge.to)) {
          low.set(frame.node, Math.min(lowOf(frame.node), order.get(edge.to) ?? 0));
        }
        continue;
      }
      frames.pop();
      const parent = frames[frames.length - 1];
      if (parent) low.set(parent.node, Math.min(lowOf(parent.node), lowOf(frame.node)));
      if (lowOf(frame.node) !== order.get(frame.node)) continue;
      const component: string[] = [];
      for (let top = stack.pop(); top !== undefined; top = stack.pop()) {
        stacked.delete(top);
        component.push(top);
        if (top === frame.node) break;
      }
      if (component.length > 1) for (const node of component) on.add(node);
    }
  }
  return on;
}

export function findCycles(
  nodes: Iterable<string>,
  edgesOf: (node: string) => readonly GraphEdge[],
): readonly Cycle[] {
  const cycles: Cycle[] = [];
  const finished = new Set<string>();
  const reported = new Set<string>();

  for (const root of nodes) {
    if (finished.has(root)) continue;
    const frames: { node: string; edges: readonly GraphEdge[]; next: number; enteredBy?: Pos }[] = [
      { node: root, edges: edgesOf(root), next: 0 },
    ];
    const depthOf = new Map<string, number>([[root, 0]]);

    while (frames.length > 0) {
      const frame = frames[frames.length - 1];
      if (!frame) break;
      const edge = frame.edges[frame.next];
      if (!edge) {
        finished.add(frame.node);
        depthOf.delete(frame.node);
        frames.pop();
        continue;
      }
      frame.next += 1;

      const depth = depthOf.get(edge.to);
      if (depth !== undefined) {
        const head = frames[depth];
        if (!head) continue;
        const path: [string, ...string[]] = [
          head.node,
          ...frames.slice(depth + 1).map((f) => f.node),
          edge.to,
        ];
        const key = path.join(" ");
        if (reported.has(key)) continue;
        reported.add(key);
        cycles.push({ path, pos: frames[depth + 1]?.enteredBy ?? edge.pos });
        continue;
      }
      if (finished.has(edge.to)) continue;
      depthOf.set(edge.to, frames.length);
      frames.push({ node: edge.to, edges: edgesOf(edge.to), next: 0, enteredBy: edge.pos });
    }
  }
  return cycles;
}

// Tarjan's strongly connected components: the nodes on one loop reach the same nodes, so they
// share one answer, and each node is visited once however many questions reach it.
export function reachedFrom<T>(
  edgesOf: (node: string) => readonly GraphEdge[],
  own: (node: string) => readonly T[],
): (root: string) => ReadonlySet<T> {
  type Frame = {
    node: string;
    edges: readonly GraphEdge[];
    next: number;
    /** When the node was entered — the first entered on its loop answers for it. */
    at: number;
    /** The earliest-entered node it is known to be on a loop with. */
    low: number;
    reached: Set<T>;
  };
  const answers = new Map<string, ReadonlySet<T>>();
  return (root) => {
    const known = answers.get(root);
    if (known) return known;
    // Every node a question enters is answered before it returns, so the
    // entry order only has to last for one question.
    const order = new Map<string, number>();
    const unanswered: string[] = [];
    const enter = (node: string): Frame => {
      const at = order.size;
      order.set(node, at);
      unanswered.push(node);
      return { node, edges: edgesOf(node), next: 0, at, low: at, reached: new Set(own(node)) };
    };
    const frames: Frame[] = [enter(root)];
    while (frames.length > 0) {
      const frame = frames[frames.length - 1];
      if (!frame) break;
      const edge = frame.edges[frame.next];
      if (edge) {
        frame.next += 1;
        const answered = answers.get(edge.to);
        const entered = order.get(edge.to);
        if (answered) for (const v of answered) frame.reached.add(v);
        else if (entered === undefined) frames.push(enter(edge.to));
        // Entered and not yet answered: it is on a loop with a node still on
        // the path to this one, so this node is on that loop too.
        else frame.low = Math.min(frame.low, entered);
        continue;
      }
      frames.pop();
      const below = frames[frames.length - 1];
      if (below) for (const v of frame.reached) below.reached.add(v);
      if (frame.low < frame.at) {
        if (below) below.low = Math.min(below.low, frame.low);
        continue;
      }
      for (;;) {
        const member = unanswered.pop();
        if (member === undefined) break;
        answers.set(member, frame.reached);
        if (member === frame.node) break;
      }
    }
    const answer = answers.get(root);
    if (answer) return answer;
    throw new Error(`reachedFrom: "${root}" was entered but never answered`);
  };
}

/** How deep a node's tree goes once every edge is followed. */
export type Expansion = {
  readonly depth: number;
  /** The edge the deepest path leaves by; `null` where the node's own depth is the deepest. */
  readonly via: PlacedEdge | null;
};

// A node that reaches a loop is absent: its tree is infinite, and the loop is `findCycles`'s to
// report.
export function expansionDepths(
  nodes: Iterable<string>,
  edgesOf: (node: string) => readonly PlacedEdge[],
  ownDepth: (node: string) => number,
): ReadonlyMap<string, Expansion> {
  type Frame = {
    node: string;
    edges: readonly PlacedEdge[];
    next: number;
    best: Expansion;
    reachesLoop: boolean;
  };
  const measured = new Map<string, Expansion>();
  const unbounded = new Set<string>();
  const open = new Set<string>();
  const enter = (node: string): Frame => {
    open.add(node);
    const best = { depth: ownDepth(node), via: null };
    return { node, edges: edgesOf(node), next: 0, best, reachesLoop: false };
  };
  const follow = (frame: Frame, edge: PlacedEdge, target: Expansion | undefined): void => {
    if (!target) {
      frame.reachesLoop = true;
      return;
    }
    const depth = edge.level + target.depth;
    if (depth > frame.best.depth) frame.best = { depth, via: edge };
  };

  for (const root of nodes) {
    if (measured.has(root) || unbounded.has(root)) continue;
    const frames: Frame[] = [enter(root)];
    while (frames.length > 0) {
      const frame = frames[frames.length - 1];
      if (!frame) break;
      const edge = frame.edges[frame.next];
      if (edge) {
        frame.next += 1;
        if (open.has(edge.to) || unbounded.has(edge.to)) follow(frame, edge, undefined);
        else if (measured.has(edge.to)) follow(frame, edge, measured.get(edge.to));
        else frames.push(enter(edge.to));
        continue;
      }
      frames.pop();
      open.delete(frame.node);
      if (frame.reachesLoop) unbounded.add(frame.node);
      else measured.set(frame.node, frame.best);
      const below = frames[frames.length - 1];
      const entered = below?.edges[below.next - 1];
      if (below && entered) follow(below, entered, measured.get(frame.node));
    }
  }
  return measured;
}
